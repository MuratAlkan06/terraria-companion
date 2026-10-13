import { describe, expect, it, vi } from 'vitest'
import {
  autofocusSearch,
  comboboxKeyAction,
  DESKTOP_POINTER_QUERY,
  isSearchShortcut,
  isTypingContext,
  moveActive,
  type ComboboxKeyState,
} from './combobox'

const state = (overrides: Partial<ComboboxKeyState> = {}): ComboboxKeyState => ({
  expanded: true,
  hasQuery: true,
  active: 0,
  optionCount: 3,
  ...overrides,
})

describe('moveActive (↑/↓ wrap)', () => {
  it('moves and wraps in both directions', () => {
    expect([moveActive(0, 1, 3), moveActive(2, 1, 3), moveActive(0, -1, 3), moveActive(1, -1, 3)]).toEqual([1, 0, 2, 0])
  })
  it('from "none" goes to the first (↓) or last (↑) option; no options → none', () => {
    expect([moveActive(-1, 1, 3), moveActive(-1, -1, 3), moveActive(5, 1, 3), moveActive(0, 1, 0)]).toEqual([0, 2, 0, -1])
  })
})

describe('comboboxKeyAction (APG list autocomplete)', () => {
  it('↓/↑ open a collapsed popup when there is a query, otherwise do nothing', () => {
    expect(comboboxKeyAction('ArrowDown', state({ expanded: false }))).toEqual({ type: 'open' })
    expect(comboboxKeyAction('ArrowUp', state({ expanded: false }))).toEqual({ type: 'open' })
    expect(comboboxKeyAction('ArrowDown', state({ expanded: false, hasQuery: false }))).toBeNull()
  })

  it('↓/↑ move the highlight when expanded; nothing to move through → browser default', () => {
    expect(comboboxKeyAction('ArrowDown', state())).toEqual({ type: 'move', to: 1 })
    expect(comboboxKeyAction('ArrowUp', state())).toEqual({ type: 'move', to: 2 })
    expect(comboboxKeyAction('ArrowDown', state({ optionCount: 0, active: -1 }))).toBeNull()
  })

  it('Enter activates the highlighted option (the pre-highlighted best match), never "nothing"', () => {
    expect(comboboxKeyAction('Enter', state())).toEqual({ type: 'activate', index: 0 })
    expect(comboboxKeyAction('Enter', state({ active: 2 }))).toEqual({ type: 'activate', index: 2 })
    expect(comboboxKeyAction('Enter', state({ active: -1, optionCount: 0 }))).toBeNull()
    expect(comboboxKeyAction('Enter', state({ expanded: false }))).toBeNull()
  })

  it('Escape closes an open popup, then clears the query, then is left alone', () => {
    expect(comboboxKeyAction('Escape', state())).toEqual({ type: 'close' })
    expect(comboboxKeyAction('Escape', state({ expanded: false }))).toEqual({ type: 'clear' })
    expect(comboboxKeyAction('Escape', state({ expanded: false, hasQuery: false }))).toBeNull()
  })

  it('leaves caret keys and typing to the text field', () => {
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'a', 'Tab']) expect(comboboxKeyAction(key, state())).toBeNull()
  })
})

const element = (tagName: string, extra: { isContentEditable?: boolean; inDialog?: boolean } = {}) => ({
  tagName,
  isContentEditable: extra.isContentEditable ?? false,
  closest: (selector: string) => (extra.inDialog && selector.includes('dialog') ? {} : null),
})
const key = (target: unknown, overrides: Record<string, unknown> = {}) => ({
  key: '/',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  isComposing: false,
  target: target as EventTarget,
  ...overrides,
})

describe('"/" shortcut (UX_SPEC §9)', () => {
  it('fires from the page (body, links, buttons)', () => {
    expect(isSearchShortcut(key(element('BODY')))).toBe(true)
    expect(isSearchShortcut(key(element('A')))).toBe(true)
    expect(isSearchShortcut(key(element('BUTTON')))).toBe(true)
    expect(isSearchShortcut(key(null))).toBe(true)
    // Shift is allowed: "/" needs it on many keyboard layouts.
    expect(isSearchShortcut(key(element('BODY'), { shiftKey: true }))).toBe(true)
  })

  it('never while typing in another field, inside a dialog, with modifiers, or mid-composition', () => {
    expect(isSearchShortcut(key(element('INPUT')))).toBe(false)
    expect(isSearchShortcut(key(element('TEXTAREA')))).toBe(false)
    expect(isSearchShortcut(key(element('SELECT')))).toBe(false)
    expect(isSearchShortcut(key(element('DIV', { isContentEditable: true })))).toBe(false)
    expect(isSearchShortcut(key(element('BUTTON', { inDialog: true })))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { ctrlKey: true }))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { metaKey: true }))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { altKey: true }))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { isComposing: true }))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { defaultPrevented: true }))).toBe(false)
    expect(isSearchShortcut(key(element('BODY'), { key: '?' }))).toBe(false)
  })

  it('isTypingContext ignores non-element targets (document/window)', () => {
    expect(isTypingContext({} as EventTarget)).toBe(false)
  })
})

describe('autofocusSearch — hero search, desktop only (UX_SPEC §3.2, AMENDMENTS-007 B28)', () => {
  const body = { tag: 'body' }
  /** A fake input: `rendered` false = display:none (below lg the hero shows the overlay trigger). */
  const input = (rendered = true) => ({ focus: vi.fn(), getClientRects: () => ({ length: rendered ? 1 : 0 }) })
  /** A fake environment: `pointer` answers DESKTOP_POINTER_QUERY. */
  const env = (pointer: 'fine' | 'coarse', activeElement: unknown = body) => ({
    matchMedia: (query: string) => ({ matches: query === DESKTOP_POINTER_QUERY && pointer === 'fine' }),
    activeElement,
    body,
  })

  it('desktop (mouse/trackpad), field rendered, nothing focused → focuses without scrolling', () => {
    const field = input()
    expect(autofocusSearch(field, env('fine'))).toBe(true)
    expect(field.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    // A null activeElement (some browsers before first paint) counts as "nothing focused".
    expect(autofocusSearch(input(), env('fine', null))).toBe(true)
  })

  it('never on touch devices: a coarse / non-hovering primary pointer would pop the keyboard', () => {
    const field = input()
    expect(autofocusSearch(field, env('coarse'))).toBe(false)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('never below lg: the inline field is not rendered there (the overlay trigger is)', () => {
    const field = input(false)
    expect(autofocusSearch(field, env('fine'))).toBe(false)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('never steals focus (e.g. the link that navigated here; the shell then focuses <main>)', () => {
    const field = input()
    expect(autofocusSearch(field, env('fine', { tag: 'a' }))).toBe(false)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('no matchMedia (non-browser) or no input → no focus', () => {
    expect(autofocusSearch(input(), { activeElement: body, body })).toBe(false)
    expect(autofocusSearch(null, env('fine'))).toBe(false)
  })
})
