import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FAVORITE_UNSAVED, FAVORITES_NOT_SAVING, FavoritesSaveNotice, FavoritesSaveNoticeView, FavoriteStar, FavoriteStarButton } from '../components/FavoriteStar'
import { FavoritesV1 } from '../schemas'
import { loadDomain, storageKey, type StorageBackend } from '../storage'
import { EMPTY_FAVORITES, parseFavorites, uniqueRefs, withFavorite } from '../storage/favorites'
import { createFavoritesStore, useFavoritesStore } from './favoritesStore'

/**
 * P7-S1 favorites: the tc.v1.favorites domain (round trip, quarantine, quota warning), the one
 * shared store every surface reads, and the FavoriteStar control's contract (UX_SPEC §3.1, §9, §12).
 * The /favorites page itself is covered in routes/favorites/favorites.test.ts.
 */
function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string>; failWrites: (fail: boolean) => void } {
  const map = new Map(Object.entries(seed))
  let failing = false
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failing) throw new DOMException('full', 'QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
    failWrites: (fail) => {
      failing = fail
    },
  }
}

const envelope = (data: unknown, v = 1) => ({ v, savedAt: '2026-10-14T12:00:00.000Z', gameVersion: '1.4.5.8', data })
const stored = (backend: ReturnType<typeof memoryBackend>) => JSON.parse(backend.dump()['tc.v1.favorites'])

describe('tc.v1.favorites: store round trip (PRD P7-S1 "favorites persist locally")', () => {
  it('starts empty when nothing is stored', () => {
    const store = createFavoritesStore(memoryBackend())
    expect(store.getState()).toMatchObject({ refs: [], loadStatus: 'empty', persistError: false })
  })

  it('writes a FavoritesV1 envelope under tc.v1.favorites that a fresh store (a reload) reads back', () => {
    const backend = memoryBackend()
    const store = createFavoritesStore(backend)
    expect(store.getState().setFavorite('i:4956', true)).toBe(true)
    expect(store.getState().setFavorite('boss:king-slime', true)).toBe(true)

    expect(storageKey('favorites')).toBe('tc.v1.favorites')
    const payload = stored(backend)
    expect(FavoritesV1.safeParse(payload).success).toBe(true)
    // Most recently starred first.
    expect(payload.data).toEqual({ refs: ['boss:king-slime', 'i:4956'] })

    const reloaded = createFavoritesStore(backend)
    expect(reloaded.getState()).toMatchObject({ refs: ['boss:king-slime', 'i:4956'], loadStatus: 'loaded' })
  })

  it('unstarring removes the ref and persists; starring twice is idempotent and keeps its place', () => {
    const backend = memoryBackend()
    const store = createFavoritesStore(backend)
    for (const ref of ['i:1', 'i:2', 'i:3']) store.getState().setFavorite(ref, true)
    store.getState().setFavorite('i:1', true)
    expect(store.getState().refs).toEqual(['i:3', 'i:2', 'i:1'])
    store.getState().setFavorite('i:2', false)
    store.getState().setFavorite('i:2', false)
    expect(store.getState().refs).toEqual(['i:3', 'i:1'])
    expect(createFavoritesStore(backend).getState().refs).toEqual(['i:3', 'i:1'])
  })

  it('hydrates a stored list with repeats as one entry each (first occurrence kept)', () => {
    const backend = memoryBackend({ 'tc.v1.favorites': JSON.stringify(envelope({ refs: ['i:1', 'boss:skeletron', 'i:1'] })) })
    expect(createFavoritesStore(backend).getState().refs).toEqual(['i:1', 'boss:skeletron'])
  })

  it('keeps refs the dataset no longer has (dataset drift is skipped on display, never deleted)', () => {
    const backend = memoryBackend({ 'tc.v1.favorites': JSON.stringify(envelope({ refs: ['i:999999', 'node:wall-of-flesh'] })) })
    const store = createFavoritesStore(backend)
    store.getState().setFavorite('i:4956', true)
    expect(stored(backend).data.refs).toEqual(['i:4956', 'i:999999', 'node:wall-of-flesh'])
  })

  it('merges with what another tab saved since startup (read-merge-write)', () => {
    const backend = memoryBackend()
    const tabA = createFavoritesStore(backend)
    const tabB = createFavoritesStore(backend)
    tabA.getState().setFavorite('i:1', true)
    tabB.getState().setFavorite('i:2', true)
    expect(stored(backend).data.refs).toEqual(['i:2', 'i:1'])
    expect(tabB.getState().refs).toEqual(['i:2', 'i:1'])
  })
})

describe('tc.v1.favorites: quarantine (ADR D6 — set aside, never deleted)', () => {
  const corrupt: Array<[string, string]> = [
    ['malformed JSON', '{not json'],
    ['a ref that is not a TypedRef', JSON.stringify(envelope({ refs: ['weapon:4956'] }))],
    ['an extra key', JSON.stringify(envelope({ refs: [], pinned: [] }))],
    ['refs not an array', JSON.stringify(envelope({ refs: 'i:1' }))],
    ['a newer schema version', JSON.stringify(envelope({ refs: [] }, 2))],
  ]

  it.each(corrupt)('quarantines a payload with %s and starts empty', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend({ 'tc.v1.favorites': raw })
    const store = createFavoritesStore(backend)
    expect(store.getState()).toMatchObject({ refs: [], loadStatus: 'quarantined' })
    const dump = backend.dump()
    const keys = Object.keys(dump).filter((k) => k.startsWith('tc.quarantine.favorites.'))
    expect(keys).toHaveLength(1)
    expect(dump[keys[0]]).toBe(raw)
    expect(dump['tc.v1.favorites']).toBeUndefined()
    warn.mockRestore()
  })

  it('a payload that turns unreadable after startup is set aside at the next write, and flagged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend()
    const store = createFavoritesStore(backend)
    store.getState().setFavorite('i:1', true)
    backend.setItem('tc.v1.favorites', '{garbled')
    store.getState().setFavorite('i:2', true)
    expect(store.getState()).toMatchObject({ refs: ['i:2', 'i:1'], loadStatus: 'quarantined' })
    expect(stored(backend).data.refs).toEqual(['i:2', 'i:1'])
    expect(Object.values(backend.dump())).toContain('{garbled')
    warn.mockRestore()
  })
})

describe('tc.v1.favorites: quota warning (DATA_SCHEMA_SPEC §4b — visible warning, state kept in memory)', () => {
  it('a failed save keeps the change in memory, reports it, and recovers once storage accepts writes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend()
    const store = createFavoritesStore(backend)
    store.getState().setFavorite('i:1', true)

    backend.failWrites(true)
    expect(store.getState().setFavorite('i:2', true)).toBe(false)
    expect(store.getState()).toMatchObject({ refs: ['i:2', 'i:1'], persistError: true })
    // Still failing: the unsaved star isn't lost to the (stale) stored list on the next change.
    expect(store.getState().setFavorite('i:3', true)).toBe(false)
    expect(store.getState().refs).toEqual(['i:3', 'i:2', 'i:1'])
    expect(stored(backend).data.refs).toEqual(['i:1'])

    backend.failWrites(false)
    expect(store.getState().setFavorite('i:1', false)).toBe(true)
    expect(store.getState()).toMatchObject({ refs: ['i:3', 'i:2'], persistError: false })
    expect(stored(backend).data.refs).toEqual(['i:3', 'i:2'])
    warn.mockRestore()
  })

  it('without any storage (blocked / private mode) every change is kept for the session and flagged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createFavoritesStore(null)
    expect(store.getState().setFavorite('boss:queen-bee', true)).toBe(false)
    expect(store.getState()).toMatchObject({ refs: ['boss:queen-bee'], persistError: true, persistWarnings: 1 })
    warn.mockRestore()
  })

  it('counts RUNS of failed saves (the shell notice shows once per run, not once per star)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend()
    const store = createFavoritesStore(backend)
    store.getState().setFavorite('i:1', true)
    expect(store.getState().persistWarnings).toBe(0)
    backend.failWrites(true)
    store.getState().setFavorite('i:2', true)
    store.getState().setFavorite('i:3', true)
    store.getState().setFavorite('i:1', false)
    expect(store.getState().persistWarnings).toBe(1) // three failed toggles, one run
    backend.failWrites(false)
    store.getState().setFavorite('i:4', true)
    expect(store.getState()).toMatchObject({ persistError: false, persistWarnings: 1 })
    backend.failWrites(true)
    store.getState().setFavorite('i:5', true)
    expect(store.getState().persistWarnings).toBe(2) // failing again after a working save: a new run
    warn.mockRestore()
  })
})

describe('the visible quota notice (design review P7-S1: one notice, not a glyph on every star)', () => {
  const view = (open: boolean) => renderToStaticMarkup(createElement(FavoritesSaveNoticeView, { open, onDismiss: () => {} }))

  it('one polite, non-focus-taking notice with the plain-words reason and a 44px Dismiss button', () => {
    const html = view(true)
    expect(html).toContain(`<div role="status" class="w-full max-w-sm">`)
    expect(html).toContain(FAVORITES_NOT_SAVING)
    expect(FAVORITES_NOT_SAVING).toBe('Favorites aren’t saving in this browser — changes last until you reload or close this tab.')
    const dismiss = html.match(/<button[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(dismiss).toContain('type="button"')
    expect(dismiss).toMatch(/\bmin-h-tap\b/)
    expect(dismiss).toMatch(/\bmin-w-tap\b/)
    expect(dismiss).toContain('<span class="sr-only">Dismiss this notice</span>')
    expect(html).not.toMatch(/autofocus|tabindex/i)
    // a toast above the mobile tab bar, on the toast layer
    expect(html).toContain('z-(--z-toast)')
    expect(html).toContain('bottom-[calc(var(--spacing-tabbar)')
  })

  it('closed, the status region stays mounted and empty (so the notice is announced when it appears)', () => {
    expect(view(false)).toMatch(/<div role="status" class="w-full max-w-sm"><\/div>/)
  })

  it('the shell-mounted notice is closed while saves work (app-wide store, no failure run yet)', () => {
    expect(useFavoritesStore.getState().persistWarnings).toBe(0)
    expect(renderToStaticMarkup(createElement(FavoritesSaveNotice))).not.toContain(FAVORITES_NOT_SAVING)
  })
})

describe('one shared store: a toggle on any surface reflects on every other (PRD P7-S1)', () => {
  it('list row, detail header and /favorites observe the same change without a reload', () => {
    const store = createFavoritesStore(memoryBackend())
    // Three surfaces, each subscribed with the selector it renders from.
    const listRow = { value: false }
    const detailHeader = { value: false }
    const favoritesPage = { refs: [] as readonly string[] }
    const sync = () => {
      const s = store.getState()
      listRow.value = s.refs.includes('i:4956')
      detailHeader.value = s.refs.includes('i:4956')
      favoritesPage.refs = s.refs
    }
    const unsubscribe = store.subscribe(sync)

    store.getState().setFavorite('i:4956', true) // starred from the weapon page header
    expect({ listRow: listRow.value, detailHeader: detailHeader.value, page: favoritesPage.refs }).toEqual({
      listRow: true,
      detailHeader: true,
      page: ['i:4956'],
    })

    store.getState().setFavorite('i:4956', false) // unstarred from /favorites
    expect({ listRow: listRow.value, detailHeader: detailHeader.value, page: favoritesPage.refs }).toEqual({
      listRow: false,
      detailHeader: false,
      page: [],
    })
    unsubscribe()
  })

  it('a star for one ref does not change the answer for another (rows re-render only when theirs changes)', () => {
    const store = createFavoritesStore(memoryBackend())
    const answers: boolean[] = []
    const unsubscribe = store.subscribe((s, prev) => {
      const now = s.refs.includes('i:1')
      if (now !== prev.refs.includes('i:1')) answers.push(now)
    })
    store.getState().setFavorite('i:2', true)
    store.getState().setFavorite('i:1', true)
    store.getState().setFavorite('i:2', false)
    expect(answers).toEqual([true])
    unsubscribe()
  })
})

describe('favorites domain parser ⇄ Zod FavoritesV1 parity', () => {
  const valid: unknown[] = [
    { refs: [] },
    { refs: ['i:4956', 'boss:king-slime', 'set:molten', 'enemy:green-slime', 'rcp:4956-a1b2c3d4'] },
    { refs: ['i:1', 'i:1'] }, // the schema allows repeats; the store shows each once
  ]
  const invalid: Array<[string, unknown]> = [
    ['not an object', []],
    ['missing refs', {}],
    ['extra key', { refs: [], extra: 1 }],
    ['refs not an array', { refs: {} }],
    ['bad ref prefix', { refs: ['weapon:4956'] }],
    ['uppercase slug', { refs: ['boss:King-Slime'] }],
    ['non-string ref', { refs: [4956] }],
  ]

  it.each(valid.map((v) => [JSON.stringify(v), v]))('accepts %s like Zod', (_label, data) => {
    expect(parseFavorites(data)).toEqual(data)
    expect(FavoritesV1.safeParse(envelope(data)).success).toBe(true)
  })

  it.each(invalid)('rejects %s like Zod', (_label, data) => {
    expect(() => parseFavorites(data)).toThrow(TypeError)
    expect(FavoritesV1.safeParse(envelope(data)).success).toBe(false)
  })

  it('loadDomain reads a valid stored payload as loaded', () => {
    const backend = memoryBackend({ 'tc.v1.favorites': JSON.stringify(envelope({ refs: ['i:4956'] })) })
    expect(loadDomain('favorites', backend)).toEqual({ kind: 'loaded', data: { refs: ['i:4956'] } })
  })

  it('withFavorite and uniqueRefs are pure', () => {
    const before = { refs: ['i:2'] }
    expect(withFavorite(before, 'i:3', true).refs).toEqual(['i:3', 'i:2'])
    expect(withFavorite(before, 'i:2', false).refs).toEqual([])
    expect(before.refs).toEqual(['i:2'])
    expect(uniqueRefs(['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(EMPTY_FAVORITES).toEqual({ refs: [] })
  })
})

describe('FavoriteStar control (UX_SPEC §3.1, §9, §12)', () => {
  const render = (props: Partial<Parameters<typeof FavoriteStarButton>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(FavoriteStarButton, { entityRef: 'i:4956', name: 'Zenith', pressed: false, onToggle: () => {}, ...props }),
    )
  const button = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? ''

  it('is a 44px toggle button with aria-pressed and a constant accessible name', () => {
    for (const pressed of [false, true]) {
      const tag = button(render({ pressed }))
      expect(tag).toContain(`aria-pressed="${pressed}"`)
      expect(tag).toContain('aria-label="Favorite Zenith"')
      expect(tag).toContain('type="button"')
      expect(tag).toContain('data-favorite-ref="i:4956"')
      expect(tag).toMatch(/\bmin-h-tap\b/)
      expect(tag).toMatch(/\bmin-w-tap\b/)
    }
  })

  it('state is shape, not colour alone: starred = solid gold fill, not starred = outline only', () => {
    const svg = (html: string) => html.match(/<svg[^>]*>/)?.[0] ?? ''
    expect(svg(render({ pressed: true }))).toMatch(/\bfill-current\b.*\btext-accent\b/)
    expect(svg(render({ pressed: false }))).toMatch(/\bfill-none\b/)
    expect(svg(render({ pressed: false }))).not.toMatch(/\bfill-current\b/)
  })

  it('press feedback is the shared scale(0.97) over --dur-press — no celebration animation', () => {
    const tag = button(render())
    expect(tag).toContain('active:scale-[0.97]')
    expect(tag).toContain('duration-(--dur-press)')
    expect(render({ pressed: true })).not.toMatch(/animate-/)
  })

  it('announces politely through a status region that is empty until the user acts', () => {
    expect(render()).toMatch(/<span role="status" class="sr-only"><\/span>/)
    expect(render({ status: 'Added to favorites' })).toMatch(/<span role="status" class="sr-only">Added to favorites<\/span>/)
  })

  it('a failed save shows a warning glyph and describes it to assistive tech', () => {
    const html = render({ unsaved: true })
    const describedBy = button(html).match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}" class="sr-only">${FAVORITE_UNSAVED}</span>`)
    expect(button(render())).not.toContain('aria-describedby')
  })

  it('the warning glyph gains a tooltip trigger on the star (hover / keyboard focus; content in a portal on open), wired without remounting the button', () => {
    // Radix marks its trigger with data-state; the content (FAVORITE_UNSAVED) renders on open, only while unsaved.
    expect(button(render({ unsaved: true }))).toContain('data-state="closed"')
    // The same <button> either way (only its description differs), so a failed save never drops focus.
    const strip = (tag: string) => tag.replace(/ aria-describedby="[^"]*"/, '')
    expect(strip(button(render({ unsaved: true })))).toBe(strip(button(render())))
    expect(FAVORITE_UNSAVED).toBe('Not saved in this browser — kept until you reload or close this tab')
  })

  it('the store-bound star reads the app-wide store (empty here: no localStorage in tests)', () => {
    expect(useFavoritesStore.getState().refs).toEqual([])
    const html = renderToStaticMarkup(createElement(FavoriteStar, { entityRef: 'boss:king-slime', name: 'King Slime' }))
    expect(button(html)).toContain('aria-pressed="false"')
    expect(button(html)).toContain('aria-label="Favorite King Slime"')
  })
})
