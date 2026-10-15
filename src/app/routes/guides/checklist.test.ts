import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChecklistsV1 } from '../../../schemas'
import { loadDomain, storageKey, type StorageBackend } from '../../../storage'
import { EMPTY_CHECKLISTS, parseChecklists } from '../../../storage/checklists'
import { checkedIn, createChecklistStore } from './checklistStore'
import { guideBySlug } from './content'
import { ChecklistView, GuideChecklist, PERSIST_ERROR_NOTICE, QUARANTINE_NOTICE, type ChecklistViewProps } from './GuideChecklist'
import { checklistKey } from './guideModel'

/** P6-S8 AC3: guide checklists are interactive and persist locally (tc.v1.checklists, A7). */
function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const envelope = (data: unknown) => JSON.stringify({ v: 1, savedAt: '2026-10-14T12:00:00.000Z', gameVersion: '1.4.5.8', data })
const KEY = checklistKey('new-world')

describe('guide checklist persistence (tc.v1.checklists)', () => {
  it('keys guide checklists as guide:<slug>', () => {
    expect(KEY).toBe('guide:new-world')
    expect(storageKey('checklists')).toBe('tc.v1.checklists')
  })

  it('starts empty, saves each check as a ChecklistsV1 envelope, and survives a reload', () => {
    const backend = memoryBackend()
    const store = createChecklistStore(backend)
    expect(store.getState()).toMatchObject({ byKey: {}, loadStatus: 'empty', persistError: false })

    store.getState().setChecked(KEY, 'work-bench', true)
    store.getState().setChecked(KEY, 'torches', true)
    const stored = JSON.parse(backend.dump()['tc.v1.checklists'])
    expect(ChecklistsV1.safeParse(stored).success).toBe(true)
    expect(stored.data).toEqual({ byKey: { [KEY]: ['work-bench', 'torches'] } })

    // A fresh store (a reload / browser restart) hydrates the same checks.
    const reloaded = createChecklistStore(backend)
    expect(reloaded.getState()).toMatchObject({ loadStatus: 'loaded', byKey: { [KEY]: ['work-bench', 'torches'] } })
  })

  it('unchecking removes the entry; an emptied checklist leaves no key behind; repeats are idempotent', () => {
    const backend = memoryBackend()
    const store = createChecklistStore(backend)
    store.getState().setChecked(KEY, 'house', true)
    store.getState().setChecked(KEY, 'house', true)
    expect(store.getState().byKey[KEY]).toEqual(['house'])
    store.getState().setChecked(KEY, 'house', false)
    expect(store.getState().byKey).toEqual({})
    expect(loadDomain('checklists', backend)).toEqual({ kind: 'loaded', data: EMPTY_CHECKLISTS })
  })

  it('read-merge-write: never drops another owner’s checklist, even one written after this store loaded', () => {
    const backend = memoryBackend({ 'tc.v1.checklists': envelope({ byKey: { 'guide:exploring-safely': ['torches'] } }) })
    const store = createChecklistStore(backend)
    // Another writer (e.g. a boss page's prep checklist) saves after this store hydrated.
    const other = createChecklistStore(backend)
    other.getState().setChecked('boss:eye-of-cthulhu:prep', 'arena', true)

    store.getState().setChecked(KEY, 'furnace', true)
    expect(loadDomain('checklists', backend)).toEqual({
      kind: 'loaded',
      data: {
        byKey: {
          'guide:exploring-safely': ['torches'],
          'boss:eye-of-cthulhu:prep': ['arena'],
          [KEY]: ['furnace'],
        },
      },
    })
  })

  it('quarantines an unreadable payload at startup (set aside, not deleted) and starts fresh', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = envelope({ byKey: { [KEY]: 'work-bench' } })
    const backend = memoryBackend({ 'tc.v1.checklists': raw })
    const store = createChecklistStore(backend)
    expect(store.getState()).toMatchObject({ byKey: {}, loadStatus: 'quarantined' })
    const quarantined = Object.entries(backend.dump()).filter(([k]) => k.startsWith('tc.quarantine.checklists.'))
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0][1]).toBe(raw)
    expect(backend.dump()['tc.v1.checklists']).toBeUndefined()

    // Checking again afterwards writes a clean payload; the quarantined copy stays.
    store.getState().setChecked(KEY, 'house', true)
    expect(loadDomain('checklists', backend)).toEqual({ kind: 'loaded', data: { byKey: { [KEY]: ['house'] } } })
    expect(Object.keys(backend.dump()).filter((k) => k.startsWith('tc.quarantine.checklists.'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('reports a payload that turned unreadable after startup when it next writes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend()
    const store = createChecklistStore(backend)
    store.getState().setChecked(KEY, 'house', true)
    backend.setItem('tc.v1.checklists', '{not json')
    store.getState().setChecked(KEY, 'furnace', true)
    expect(store.getState().loadStatus).toBe('quarantined')
    expect(Object.keys(backend.dump()).some((k) => k.startsWith('tc.quarantine.checklists.'))).toBe(true)
    // The in-memory checks carry over into the rewritten payload.
    expect(loadDomain('checklists', backend)).toEqual({ kind: 'loaded', data: { byKey: { [KEY]: ['house', 'furnace'] } } })
    warn.mockRestore()
  })

  it('keeps checks in memory (and says so) when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createChecklistStore(null)
    store.getState().setChecked(KEY, 'house', true)
    expect(store.getState()).toMatchObject({ byKey: { [KEY]: ['house'] }, persistError: true })
    warn.mockRestore()
  })

  it('counts only entries the guide still has (stale stored ids are ignored)', () => {
    expect([...checkedIn({ [KEY]: ['house', 'retired-step'] }, KEY, ['house', 'furnace'])]).toEqual(['house'])
  })

  it('domain parser accepts exactly what Zod ChecklistsV1 accepts for guide payloads', () => {
    const valid = [{ byKey: {} }, { byKey: { [KEY]: ['house'], 'boss:eye-of-cthulhu:prep': [] } }]
    const invalid = [[], { byKey: [] }, { byKey: { [KEY]: 'house' } }, { byKey: { [KEY]: [1] } }, { byKey: {}, extra: 1 }]
    for (const data of valid) {
      expect(parseChecklists(data)).toEqual(data)
      expect(ChecklistsV1.safeParse(JSON.parse(envelope(data))).success).toBe(true)
    }
    for (const data of invalid) {
      expect(() => parseChecklists(data)).toThrow(TypeError)
      expect(ChecklistsV1.safeParse(JSON.parse(envelope(data))).success).toBe(false)
    }
  })
})

describe('checklist panel', () => {
  const guide = guideBySlug('new-world')!
  const view = (props: Partial<ChecklistViewProps>) =>
    renderToStaticMarkup(
      createElement(ChecklistView, { guide, byKey: {}, quarantined: false, persistError: false, onChange: () => {}, ...props }),
    )

  it('the page container renders the store (empty in a fresh browser)', () => {
    const html = renderToStaticMarkup(createElement(GuideChecklist, { guide }))
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(guide.checklist.length)
    expect(html).not.toContain('checked=""')
    expect(html).toContain('Not started')
  })

  it('renders persisted checks as checked, with progress and done styling', () => {
    const html = view({ byKey: { [KEY]: ['work-bench', 'torches', 'retired-step'] } })
    const checked = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('checked=""'))
    expect(checked.map((tag) => /data-entry="([^"]+)"/.exec(tag)?.[1])).toEqual(['work-bench', 'torches'])
    expect(html).toContain(`2 of ${guide.checklist.length} done`)
    expect(html).toMatch(/line-through[^"]*">Craft and place a Work Bench</)
    // Each checkbox is labelled by its step text (label[for] -> input#id).
    for (const entry of guide.checklist) expect(html).toContain(`for="check-new-world-${entry.id}"`)
    expect(html).not.toContain(QUARANTINE_NOTICE)
  })

  it('shows "All N done" when every step is checked', () => {
    expect(view({ byKey: { [KEY]: guide.checklist.map((e) => e.id) } })).toContain(`All ${guide.checklist.length} done`)
  })

  it('tells the reader when saved checklist data was set aside, or could not be saved', () => {
    expect(view({ quarantined: true })).toContain('Some saved data couldn’t be read and was set aside (not deleted).')
    expect(view({ persistError: true })).toContain(PERSIST_ERROR_NOTICE)
    expect(view({})).not.toContain(PERSIST_ERROR_NOTICE)
  })

  it('announces like the boss prep checklists: progress and both notices are polite status regions', () => {
    expect(view({})).toMatch(/<p role="status"[^>]*>[^<]*Not started/)
    expect(view({ quarantined: true })).toMatch(/<p role="status"[^>]*>(<svg[\s\S]*?<\/svg>)?Some saved data/)
    expect(view({ persistError: true })).toMatch(/<p role="status"[^>]*>(<svg[\s\S]*?<\/svg>)?Couldn’t save/)
    expect(view({ persistError: true })).not.toContain('role="alert"')
  })
})
