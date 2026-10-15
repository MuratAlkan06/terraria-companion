import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import manifest from '../../../../public/sprites/manifest.json'
import { CURATED_EXPLANATION } from '../../../components/CuratedLabel'
import { createDataAccess, loadBosses, loadList } from '../../../data-access'
import type { AccessoryListRecord, ArmorListRecord, Boss, SpriteIndex, Weapon, WeaponListRecord } from '../../../data-access/types'
import accessoriesListJson from '../../../data/accessories.list.json'
import armorListJson from '../../../data/armor.list.json'
import bossesJson from '../../../data/bosses.json'
import weaponsDetailJson from '../../../data/weapons.detail.json'
import weaponsListJson from '../../../data/weapons.list.json'
import { getField } from '../../../schemas/getField'
import { auditCopy } from '../../../scoring/copyAudit'
import { saveDomain, type StorageBackend } from '../../../storage'
import type { SavedBuild } from '../../../storage/builds'
import { createBuildsStore } from '../../buildsStore'
import { APP_ROUTES, pathFor } from '../../routes'
import HomePage from '../HomePage'
import { FeaturedRow, MAX_UPSCALE } from './FeaturedRow'
import { heroActions } from './heroActions'
import {
  featuredWeaponPool,
  loadBuildPreviewData,
  localDayNumber,
  pickFeaturedBoss,
  pickFeaturedWeapon,
  pickForDay,
  previewItems,
  readRecentEntries,
  resolveRecent,
  type HomeData,
  type HomeResource,
} from './homeData'
import { SavedBuildsSection } from './SavedBuildsRail'
import { RAIL_ALL, RAIL_EMPTY_BUILD, RAIL_QUARANTINE, RAIL_TITLE, railItems, railMeta, railPreview, railSaved } from './savedBuildsRailCopy'

const weapons = weaponsListJson as WeaponListRecord[]
const bosses = bossesJson as Boss[]
const detailById = new Map((weaponsDetailJson as Weapon[]).map((w) => [w.id, w]))
const weaponsById = new Map(weapons.map((w) => [w.id, w]))

/** Local-time dates (the picks follow the user's calendar day, whatever the test machine's TZ). */
const day = (d: number, hour = 12, minute = 0) => new Date(2026, 9, d, hour, minute)

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { keys: () => string[] } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  }
}

const recentEnvelope = (refs: string[]) =>
  JSON.stringify({
    v: 1,
    savedAt: '2026-10-13T10:00:00.000Z',
    gameVersion: '1.4.5.8',
    data: { entries: refs.map((ref, i) => ({ ref, viewedAt: new Date(Date.UTC(2026, 9, 13, 10, 59 - i)).toISOString() })) },
  })

describe('featured picks: deterministic per local day (PRD P2-S5 AC1)', () => {
  it('localDayNumber is one number per local calendar day, +1 at local midnight', () => {
    expect(localDayNumber(day(13, 0, 0))).toBe(localDayNumber(day(13, 23, 59)))
    expect(localDayNumber(day(14, 0, 0)) - localDayNumber(day(13, 23, 59))).toBe(1)
    // Month and year boundaries are plain +1 steps too.
    expect(localDayNumber(new Date(2026, 10, 1)) - localDayNumber(new Date(2026, 9, 31))).toBe(1)
    expect(localDayNumber(new Date(2027, 0, 1)) - localDayNumber(new Date(2026, 11, 31))).toBe(1)
  })

  it('pickForDay walks a permutation: every entry once per n days, never the same entry two days running', () => {
    for (const n of [2, 3, 18, 461, 488]) {
      const pool = Array.from({ length: n }, (_, i) => i)
      const start = localDayNumber(day(13))
      const picks = Array.from({ length: n }, (_, k) => pickForDay(pool, start + k))
      expect(new Set(picks).size, `n=${n}`).toBe(n)
      for (let k = 1; k < n; k++) expect(picks[k], `n=${n} day ${k}`).not.toBe(picks[k - 1])
    }
    expect(pickForDay([], 20_000)).toBeUndefined()
    expect(pickForDay(['only'], 20_000)).toBe('only')
    expect(pickForDay(['a', 'b'], -3)).toBeDefined()
  })

  it('the featured weapon is stable within a day and rotates when the date changes', () => {
    const morning = pickFeaturedWeapon(weapons, day(13, 0, 5))
    expect(morning).toBeDefined()
    expect(pickFeaturedWeapon(weapons, day(13, 23, 55))?.id).toBe(morning?.id)
    const tomorrow = pickFeaturedWeapon(weapons, day(14, 0, 5))
    expect(tomorrow?.id).not.toBe(morning?.id)
    const week = Array.from({ length: 7 }, (_, i) => pickFeaturedWeapon(weapons, day(13 + i))?.id)
    expect(new Set(week).size).toBe(7)
  })

  it('does not depend on the order of the shipped list', () => {
    const shuffled = [...weapons].reverse()
    for (const d of [13, 14, 15]) expect(pickFeaturedWeapon(shuffled, day(d))?.id).toBe(pickFeaturedWeapon(weapons, day(d))?.id)
  })

  it('every weapon that can be featured has a real detail page and a VERIFIED damage value', () => {
    const pool = featuredWeaponPool(weapons)
    expect(pool.length).toBeGreaterThan(400)
    for (const w of pool) {
      const detail = detailById.get(w.id)
      expect(detail, `detail record for ${w.id}`).toBeDefined()
      expect(getField(detail, 'damage'), `${w.name} damage`).toEqual({ status: 'verified', value: w.damage })
    }
    // Weapons whose damage is Unknown are never featured (the card must show a verified stat).
    expect(pool.some((w) => w.damage === undefined)).toBe(false)
    expect(weapons.some((w) => w.damage === undefined)).toBe(true)
  })

  it('the featured weapon resolves through the same loader as its detail page', async () => {
    const da = createDataAccess({ validate: null })
    const pick = pickFeaturedWeapon(weapons, day(13))
    await expect(da.loadDetail('weapons', String(pick?.id))).resolves.toMatchObject({ id: pick?.id, name: pick?.name })
  })

  it('the featured boss rotates per day too, and is absent when there are no bosses (A17)', () => {
    const today = pickFeaturedBoss(bosses, day(13))
    expect(bosses.map((b) => b.id)).toContain(today?.id)
    expect(pickFeaturedBoss(bosses, day(13, 23, 59))?.id).toBe(today?.id)
    expect(pickFeaturedBoss(bosses, day(14))?.id).not.toBe(today?.id)
    expect(pickFeaturedBoss([...bosses].reverse(), day(13))?.id).toBe(today?.id)
    expect(pickFeaturedBoss([], day(13))).toBeUndefined()
  })
})

describe('recently viewed resolution (PRD P2-S5 AC2)', () => {
  const [a, b, c] = featuredWeaponPool(weapons)

  it('keeps stored order (most recent first) and skips refs that no longer resolve, silently', () => {
    const entries = [`i:${a.id}`, 'i:999999', 'boss:plantera', `i:${b.id}`, 'enemy:blue-slime', `i:${c.id}`].map((ref) => ({
      ref,
      viewedAt: '2026-10-13T10:00:00.000Z',
    }))
    expect(resolveRecent(entries, weaponsById).map((r) => r.weapon.id)).toEqual([a.id, b.id, c.id])
  })

  it('drops repeated refs (keys stay unique even if storage was hand-edited)', () => {
    const entries = [`i:${a.id}`, `i:${a.id}`].map((ref) => ({ ref, viewedAt: '2026-10-13T10:00:00.000Z' }))
    expect(resolveRecent(entries, weaponsById)).toHaveLength(1)
  })

  it('reads tc.v1.recent; missing, unavailable or corrupt storage reads as empty (corrupt is quarantined)', () => {
    expect(readRecentEntries(memoryBackend({ 'tc.v1.recent': recentEnvelope([`i:${a.id}`, `i:${b.id}`]) })).map((e) => e.ref)).toEqual([
      `i:${a.id}`,
      `i:${b.id}`,
    ])
    expect(readRecentEntries(memoryBackend())).toEqual([])
    expect(readRecentEntries(null)).toEqual([])
    const corrupt = memoryBackend({ 'tc.v1.recent': '{oops' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readRecentEntries(corrupt)).toEqual([])
    expect(corrupt.keys().some((k) => k.startsWith('tc.quarantine.recent.'))).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('HomePage render (SSR markup)', () => {
  beforeAll(async () => {
    // Warm the shared data-access cache so the page renders its ready state on the first pass.
    await Promise.all([loadList('weapons'), loadBosses()])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderHome(at: Date, storage: StorageBackend = memoryBackend()): string {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at)
    // HomeHero's dev-only `?hero=` preview reads window.location; storage is the recent list.
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', storage)
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HomePage)))
  }

  it('AC1: the featured weapon card links to its real detail page; the boss card to its wiki article', () => {
    const html = renderHome(day(13))
    const weapon = pickFeaturedWeapon(weapons, day(13))
    const boss = pickFeaturedBoss(bosses, day(13))
    expect(html).toContain(`href="/weapons/${weapon?.id}"`)
    expect(html).toContain('Weapon of the day')
    expect(html).toContain(`Damage </span><span class="font-semibold tabular-nums">${weapon?.damage}<`)
    expect(html).toContain(`href="${boss?.wikiUrl}" target="_blank" rel="noopener noreferrer"`)
    expect(html).toContain(`${boss?.name}<span class="sr-only"> on the Terraria Wiki (opens in a new tab)</span></a>`)
    expect(html).toContain('via Terraria Wiki')
    // The featured boss card links its wiki article, never a local boss URL (the hero's only /bosses
    // link is the P5-S5 recommender button).
    const featured = html.slice(html.indexOf('id="featured-title"'), html.indexOf('Recently viewed'))
    expect(featured).not.toMatch(/href="\/bosses/)
    expect(html.match(/href="\/bosses[^"]*"/g)).toEqual(['href="/bosses?recommend=1"'])
  })

  it('B33: an editorial (curated) field reads "curated" with a toggletip, never "editorial guidance"', () => {
    const html = renderHome(day(13))
    expect(getField(pickFeaturedBoss(bosses, day(13)), 'stage').status).toBe('editorial') // boss stage is overlay data
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>curated<span class="sr-only"> \(show what this means\)<\/span><\/button>/)
    expect(html).not.toMatch(/editorial/i)
    expect(CURATED_EXPLANATION).toMatch(/by hand from the Terraria Wiki, not extracted/)
  })

  it('the boss card is a stretched link: the toggletip is never nested inside a link', () => {
    const html = renderHome(day(13))
    const featured = html.slice(html.indexOf('id="featured-title"'), html.indexOf('Recently viewed'))
    for (const [anchor] of featured.matchAll(/<a [^>]*>.*?<\/a>/g)) expect(anchor).not.toContain('<button')
    expect(featured).toMatch(/<div class="group [^"]*\brelative\b[^"]*"><span[^>]*>Boss of the day/)
    expect(featured).toMatch(/<a href="https:\/\/terraria\.wiki\.gg\/[^"]*"[^>]*class="[^"]*after:absolute after:inset-0/)
  })

  it('B31: the weapons source link sits directly under the weapon card, labelled as the category', () => {
    const html = renderHome(day(13))
    const featured = html.slice(html.indexOf('id="featured-title"'), html.indexOf('Recently viewed'))
    const weaponCardEnd = featured.indexOf('</a>', featured.indexOf('Weapon of the day'))
    const source = featured.indexOf('Source: Weapons category, terraria.wiki.gg')
    expect(source).toBeGreaterThan(weaponCardEnd)
    expect(source).toBeLessThan(featured.indexOf('Boss of the day'))
    expect(featured).toMatch(/<a href="https:\/\/terraria\.wiki\.gg\/wiki\/Category:Weapon_items"[^>]*class="[^"]*\bmd:col-start-1 md:row-start-2\b/)
    expect(featured).not.toContain('Source: terraria.wiki.gg') // never the generic label implying per-item provenance
  })

  it('B28: the hero carries the large search instance, with no unconditional autofocus', () => {
    const html = renderHome(day(13))
    const hero = html.slice(html.indexOf('aria-labelledby="home-title"'), html.indexOf('</section>'))
    const inputs = hero.match(/<input[^>]*role="combobox"[^>]*>/g) ?? []
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatch(/\bh-14\b/)
    expect(inputs[0]).not.toContain('aria-keyshortcuts') // "/" stays with the header field
    expect(hero).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*class="[^"]*\bh-14\b/)
    // Desktop-only autofocus is a runtime decision (autofocusSearch), never the HTML attribute.
    expect(html.toLowerCase()).not.toContain('autofocus')
  })

  it('AC1: a different day renders a different featured weapon', () => {
    const today = pickFeaturedWeapon(weapons, day(13))
    const tomorrow = pickFeaturedWeapon(weapons, day(14))
    const html = renderHome(day(14))
    expect(html).toContain(`href="/weapons/${tomorrow?.id}"`)
    expect(html).not.toContain(`href="/weapons/${today?.id}"`)
  })

  it('AC2: with nothing viewed, the designed empty state with a single CTA', () => {
    const html = renderHome(day(13))
    expect(html).toContain('Recently viewed')
    expect(html).toContain('Nothing viewed yet — try searching Zenith')
    expect(html).toContain('href="/weapons"')
  })

  it('AC2: stored visits render as rail cards linking back to their pages, unresolvable ones skipped', () => {
    const [first, second] = featuredWeaponPool(weapons).slice(-2)
    const storage = memoryBackend({ 'tc.v1.recent': recentEnvelope([`i:${second.id}`, 'i:999999', 'boss:plantera', `i:${first.id}`]) })
    const html = renderHome(day(13), storage)
    expect(html).not.toContain('Nothing viewed yet')
    const rail = html.slice(html.indexOf('Recently viewed'))
    const hrefs = [...rail.matchAll(/href="(\/weapons\/\d+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([`/weapons/${second.id}`, `/weapons/${first.id}`])
    expect(rail).toContain(second.name)
    expect(html).not.toContain('/weapons/999999')
  })

  it('AC3 (P3-S1, P4-S2, P5-S5 shipped): "Build My Loadout" links into /loadout, "Test Weapons" into /lab and "What Should I Do Next?" into the recommender; unshipped rails stay absent', () => {
    const html = renderHome(day(13))
    const start = html.indexOf('data-hero-actions')
    const actions = html.slice(start, html.indexOf('</ul>', start))
    // Real links to registered routes — never a disabled control.
    expect(heroActions().map((a) => [a.label, a.to])).toEqual([
      ['Build My Loadout', pathFor('loadout')],
      ['Test Weapons', pathFor('lab')],
      ['What Should I Do Next?', `${pathFor('bosses')}?recommend=1`],
    ])
    expect(pathFor('lab')).toBe('/lab')
    expect(pathFor('loadout')).toBe('/loadout')
    expect(actions.match(/<a [^>]*>/g)).toHaveLength(3)
    expect(actions).toMatch(/<a [^>]*href="\/loadout"[^>]*>.*Build My Loadout<\/a>/s)
    expect(actions).toMatch(/<a [^>]*href="\/lab"[^>]*>.*Test Weapons<\/a>/s)
    // P5-S5: the /bosses route lists its `recommend` feature, so the button opens the panel there
    expect(actions).toMatch(/<a [^>]*href="\/bosses\?recommend=1"[^>]*>.*What Should I Do Next\?<\/a>/s)
    expect(actions).not.toMatch(/disabled/)
    // P4-S4: the saved-builds rail shows only once a build is saved in this browser — none here, so absent
    // (and there is no /builds route: the list is the builder's `?view=builds`).
    expect(html).not.toMatch(/saved builds/i)
    expect(html).not.toMatch(/href="\/builds/)
  })

  it('P5-S5: the recommender button exists only while /bosses lists the `recommend` feature (absent, never disabled)', () => {
    const bosses = APP_ROUTES.find((r) => r.id === 'bosses')!
    const features = bosses.features
    try {
      ;(bosses as { features?: readonly string[] }).features = []
      expect(heroActions().map((a) => a.label)).not.toContain('What Should I Do Next?')
    } finally {
      ;(bosses as { features?: readonly string[] }).features = features
    }
    expect(heroActions().map((a) => a.label)).toContain('What Should I Do Next?')
  })

  it('B43: below 375px the featured cards stack full-width and each stacks its slot above the text (no slot shrink)', () => {
    const html = renderHome(day(13))
    const featured = html.slice(html.indexOf('id="featured-title"'), html.indexOf('Recently viewed'))
    // Cards: one column below md.
    expect(featured).toMatch(/class="grid gap-x-6 gap-y-2 md:grid-cols-2"/)
    // Inside each card: slot over text below xs (375px), side by side from xs.
    expect(featured.match(/class="flex flex-1 flex-col items-start gap-3 xs:flex-row xs:items-center xs:gap-4"/g)).toHaveLength(2)
    expect(featured.match(/class="grid size-28 shrink-0 /g)).toHaveLength(2)
    expect(featured).not.toMatch(/(max-)?xs:size-/)
  })

  it('FeaturedRow without boss records shows the weapon card only (A17)', () => {
    const data: HomeData = { weapons, weaponsById, bosses: [], sprites: null }
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(FeaturedRow, { home: { status: 'ready', data, retry: () => {} } })),
    )
    expect(html).toContain('Weapon of the day')
    expect(html).not.toContain('Boss of the day')
    expect(html).not.toContain('md:grid-cols-2')
  })
})

describe('featured card sprites: thumbnails and the upscale cap (AMENDMENTS-009 B42a/c)', () => {
  let sprites: SpriteIndex
  beforeAll(async () => {
    sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
  })

  const renderRow = (data: HomeData) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FeaturedRow, { home: { status: 'ready', data, retry: () => {} } })))

  it('on a heavy-GIF day the boss card loads the small still thumbnail, never the heavy GIF', () => {
    const heavy = bosses.filter((b) => b.sprite !== undefined && sprites.byPath.get(b.sprite)?.thumbnail)
    expect(heavy.length).toBeGreaterThan(0)
    for (const boss of heavy) {
      // A one-boss pool forces the day's pick.
      expect(pickFeaturedBoss([boss], day(13))).toBe(boss)
      const entry = sprites.byPath.get(boss.sprite!)!
      const html = renderRow({ weapons, weaponsById, bosses: [boss], sprites })
      expect(html, boss.id).toContain('Boss of the day')
      expect(html, boss.id).toContain(`<img src="${entry.thumbnail!.path}"`)
      expect(html, boss.id).not.toContain(entry.path)
    }
  })

  it('the featured weapon sprite is upscaled at most 3× (a small sprite would otherwise fill the slot)', () => {
    expect(MAX_UPSCALE).toBe(3)
    const box = 96 // SSR markup: below lg
    const small = featuredWeaponPool(weapons).find((w) => {
      const f = sprites.byPath.get(w.sprite!)
      return f !== undefined && Math.floor(box / Math.max(f.width, f.height)) > 3
    })!
    const f = sprites.byPath.get(small.sprite!)!
    const html = renderRow({ weapons: [small], weaponsById, bosses: [], sprites })
    expect(html).toContain(`href="/weapons/${small.id}"`)
    expect(html).toContain(`<img src="${f.path}" alt="" style="width:${f.width * 3}px;height:${f.height * 3}px"`)
  })
})

describe('saved-builds rail (PRD P4-S4 AC4; UX_SPEC §3.2 SavedBuildsRail)', () => {
  const armorList = armorListJson as ArmorListRecord[]
  const accessoryList = accessoriesListJson as AccessoryListRecord[]
  const [w1, w2] = featuredWeaponPool(weapons)
  const helmet = armorList.find((a) => a.slot === 'head' && a.sprite)!
  const acc = accessoryList.find((a) => a.sprite)!
  const slots = (o: Partial<SavedBuild['slots']> = {}): SavedBuild['slots'] => ({ mainWeapon: null, altWeapon: null, helmet: null, chest: null, legs: null, accessories: [null, null, null, null, null, null, null], ammo: [], buffs: [], summon: null, ...o })
  const older: SavedBuild = { buildId: 'b-rail-0001', name: 'Older melee', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', stage: 'early-prehm', class: 'melee', difficulty: 'classic', slots: slots({ mainWeapon: w1.id }) }
  const newer: SavedBuild = {
    buildId: 'b-rail-0002',
    name: 'Newer ranged',
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    stage: 'early-hm',
    class: 'ranged',
    difficulty: 'expert',
    goal: 'boss',
    // an ammo id with no light list record: counted, no square
    slots: slots({ mainWeapon: w2.id, helmet: helmet.id, accessories: [acc.id, null, null, null, null, null, null], ammo: [97] }),
  }
  const ready: HomeResource = { status: 'ready', data: { weapons, weaponsById, bosses, sprites: null }, retry: () => {} }
  const renderRail = (builds: SavedBuild[], quarantined = false) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SavedBuildsSection, { builds, quarantined, home: ready })))

  beforeAll(async () => {
    await loadBuildPreviewData()
  })
  /**
   * The homepage as a fresh page load: storage seeded first, then the app modules imported anew, so the
   * builds store hydrates from it (the store hydrates once, at import — PRD P4-S4 AC4 "survive reload").
   */
  async function freshHome(seed: Record<string, string>): Promise<string> {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryBackend(seed))
    vi.stubGlobal('window', { location: { search: '' } })
    try {
      const [{ default: Home }, router] = await Promise.all([import('../HomePage'), import('react-router')])
      return renderToStaticMarkup(createElement(router.MemoryRouter, null, createElement(Home)))
    } finally {
      vi.unstubAllGlobals()
    }
  }
  const stored = (builds: SavedBuild[]) => {
    const backend = memoryBackend()
    saveDomain('builds', { builds }, backend)
    return { 'tc.v1.builds': backend.getItem('tc.v1.builds') as string }
  }

  it('appears on the homepage once a build is saved (a fresh load reads it back), after "Recently viewed", newest first; each card opens its build; the full list is one link away', async () => {
    const html = await freshHome(stored([older, newer]))
    expect(html).toContain('data-saved-builds-rail')
    expect(html.indexOf(RAIL_TITLE)).toBeGreaterThan(html.indexOf('Recently viewed'))
    expect([...html.matchAll(/data-rail-build="([^"]+)"/g)].map((m) => m[1])).toEqual(['b-rail-0002', 'b-rail-0001'])
    expect(html).toContain('href="/loadout?build=b-rail-0002"')
    expect(html).toContain('href="/loadout?view=builds"')
    expect(html).toContain(railMeta(newer))
    expect(railMeta(newer)).toBe('Ranged · Early Hardmode · Expert Mode · Boss fight')
  })

  it('absent with no builds; with unreadable builds it says so (UX_SPEC §5.6, never silent)', async () => {
    expect(await freshHome({})).not.toContain('data-saved-builds-rail')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const q = await freshHome({ 'tc.v1.builds': '{oops' })
    warn.mockRestore()
    expect(q).toContain('data-saved-builds-rail')
    expect(q).toContain(RAIL_QUARANTINE)
  })

  it('a mini equip preview of the build as saved: weapons, armor and accessories by name and sprite; ammo and potions counted', () => {
    const html = renderRail([newer])
    const card = /data-rail-build="b-rail-0002"[\s\S]*?<\/article>/.exec(html)?.[0] ?? ''
    expect(card).toContain(`aria-label="${railPreview('Newer ranged')}"`)
    const squares = [...card.matchAll(/role="img" aria-label="([^"]+)"/g)].map((m) => m[1])
    expect(squares).toEqual([w2.name, helmet.name, acc.name])
    expect(card).toContain(railItems(4))
    expect(previewItems([w2.id, 97], weaponsById, { armor: new Map(), accessories: new Map() }).map((p) => p.id)).toEqual([w2.id])
  })

  it('survives reload: a build saved through the store reads back from storage, and the rail lists it', () => {
    const backend = memoryBackend()
    const { buildId: _id, createdAt: _c, updatedAt: _u, ...draft } = newer
    createBuildsStore(backend, () => 'b-rail-0100').getState().create(draft, new Date('2026-10-14T09:00:00.000Z'))
    const reloaded = createBuildsStore(backend).getState()
    expect(reloaded.loadStatus).toBe('loaded')
    expect(reloaded.builds.map((b) => b.buildId)).toEqual(['b-rail-0100'])
    expect(renderRail(reloaded.builds)).toContain('data-rail-build="b-rail-0100"')
  })

  it('copy audit: no outcome, odds or forward-promise wording', () => {
    for (const t of [RAIL_TITLE, RAIL_ALL, RAIL_QUARANTINE, RAIL_EMPTY_BUILD, railItems(1), railItems(3), railSaved('Oct 14, 2026'), railPreview('X'), railMeta(older)]) expect(auditCopy(t), t).toBeUndefined()
  })
})
