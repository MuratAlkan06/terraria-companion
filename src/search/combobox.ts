/**
 * Pure keyboard logic for the OmniSearch combobox (WAI-ARIA APG "combobox with listbox popup",
 * list autocomplete; UX_SPEC §9 "OmniSearch keyboard-operable; `/` opens it").
 *
 * Focus stays in the input; the highlighted option is conveyed with aria-activedescendant.
 *   ↓ / ↑   open the popup (when there is a query) or move the highlight, wrapping
 *   Enter   activate the highlighted option
 *   Escape  close the popup; when already closed, clear the query
 * Home/End/←/→ are left to the text field (caret movement).
 */

export interface ComboboxKeyState {
  /** The popup is showing results (or a state panel) for the current query. */
  expanded: boolean
  hasQuery: boolean
  /** Highlighted option index, -1 for none. */
  active: number
  optionCount: number
}

export type ComboboxKeyAction =
  | { type: 'open' }
  | { type: 'move'; to: number }
  | { type: 'activate'; index: number }
  | { type: 'close' }
  | { type: 'clear' }

/** Next highlighted index for a ↓ (+1) / ↑ (-1) press: wraps; from "none" goes to first/last. */
export function moveActive(active: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (active < 0 || active >= count) return delta > 0 ? 0 : count - 1
  return (active + delta + count) % count
}

/** The action for a key press in the combobox input, or null to leave the key to the browser. */
export function comboboxKeyAction(key: string, state: ComboboxKeyState): ComboboxKeyAction | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (!state.expanded) return state.hasQuery ? { type: 'open' } : null
      if (state.optionCount === 0) return null
      return { type: 'move', to: moveActive(state.active, key === 'ArrowDown' ? 1 : -1, state.optionCount) }
    }
    case 'Enter':
      return state.expanded && state.active >= 0 && state.active < state.optionCount ? { type: 'activate', index: state.active } : null
    case 'Escape':
      if (state.expanded) return { type: 'close' }
      return state.hasQuery ? { type: 'clear' } : null
    default:
      return null
  }
}

/** Minimal element shape (keeps this module DOM-free for unit tests). */
interface ElementLike {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/**
 * True when a key press belongs to something else: a text field, a contenteditable region, or an
 * open dialog (e.g. the mobile "More" sheet), whose focus trap must not be broken.
 */
export function isTypingContext(target: EventTarget | null): boolean {
  const element = target as ElementLike | null
  if (!element || typeof element.closest !== 'function') return false
  if (element.isContentEditable) return true
  const tag = element.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element.closest('[role="dialog"],[role="alertdialog"]') != null
}

export interface ShortcutEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  isComposing?: boolean
  target: EventTarget | null
}

/**
 * The "/" search shortcut (UX_SPEC §9). Shift is allowed: "/" needs it on many layouts
 * (e.g. German Shift+7). Never while typing elsewhere or inside a dialog.
 */
export function isSearchShortcut(event: ShortcutEventLike): boolean {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.defaultPrevented || event.isComposing) return false
  return !isTypingContext(event.target)
}

/**
 * "Desktop" for autofocus purposes: the primary pointer hovers and is precise (mouse/trackpad).
 * Phones and tablets fail it, so focusing never pops an on-screen keyboard over the page.
 */
export const DESKTOP_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

/** Minimal shapes (DOM-free for unit tests). */
export interface AutofocusInputLike {
  focus: (options?: { preventScroll?: boolean }) => void
  getClientRects: () => { length: number }
}
export interface AutofocusEnvLike {
  matchMedia?: (query: string) => { matches: boolean }
  activeElement: unknown
  body: unknown
}

/**
 * Hero search autofocus, desktop only (UX_SPEC §3.2, AMENDMENTS-007 B28). Focuses `input` and
 * returns true only when all hold:
 * - it is rendered (the inline field exists from lg; below that the hero shows an overlay trigger);
 * - the primary pointer is a desktop one (DESKTOP_POINTER_QUERY) — never on touch devices;
 * - nothing else has focus (never steal focus, e.g. from the link that navigated here — the shell
 *   then focuses <main> per UX_SPEC §9).
 * `preventScroll`: landing scrolled down (restored scroll) must not jump back to the hero.
 */
export function autofocusSearch(input: AutofocusInputLike | null | undefined, env: AutofocusEnvLike): boolean {
  if (!input || input.getClientRects().length === 0) return false
  if (!env.matchMedia?.(DESKTOP_POINTER_QUERY).matches) return false
  if (env.activeElement != null && env.activeElement !== env.body) return false
  input.focus({ preventScroll: true })
  return true
}
