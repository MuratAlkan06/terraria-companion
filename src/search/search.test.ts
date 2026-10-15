import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { ChunkLoadError, createDataAccess } from '../data-access'
import { validateDataFile } from '../data-access/devValidate'
import type { SpriteIndex } from '../data-access/types'
import bossesJson from '../data/bosses.json'
import enemiesJson from '../data/enemies.json'
import meta from '../data/meta.json'
import searchDocsJson from '../data/search-docs.json'
import type { SearchDoc } from '../schemas'
import { BOSS_PAGE_IDS } from '../schemas/bossPages'
import { buildSearchIndex, detailLine, type BuildDeps } from './buildIndex'
import { createSearchEngine } from './engine'
import { ENTITY_TYPES, searchableCounts, searchPlaceholder, searchScopeSummary } from './entityTypes'
import { groupByType } from './group'
import { resolveTarget, wikiSearchUrl } from './links'

const docs = searchDocsJson as SearchDoc[]
const bosses = bossesJson as Array<{ id: string; wikiUrl: string }>
const enemies = enemiesJson as Array<{ id: string; wikiUrl: string }>

async function realSprites(): Promise<SpriteIndex> {
  return createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
}

function deps(overrides: Partial<BuildDeps> = {}): BuildDeps {
  return {
    loadDocs: async () => docs,
    loadSprites: realSprites,
    now: () => performance.now(),
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('search data (DATA_SCHEMA_SPEC §2.10, §4a loadSearchDocs)', () => {
  it('the shipped search-docs.json and enemies.json pass their dev schemas', () => {
    expect(() => validateDataFile('search-docs', searchDocsJson)).not.toThrow()
    expect(() => validateDataFile('enemies', enemiesJson)).not.toThrow()
    expect(docs).toHaveLength(1735)
  })

  it('loadSearchDocs is a lazy singleton; a failed chunk is a ChunkLoadError and is retried', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(docs)
    const da = createDataAccess({ validate: null, importers: { 'search-docs': importer } })
    expect(importer).not.toHaveBeenCalled()
    const failure = await da.loadSearchDocs().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ChunkLoadError)
    expect((failure as ChunkLoadError).file).toBe('search-docs')
    await expect(da.loadSearchDocs()).resolves.toHaveLength(1735)
    await da.loadSearchDocs()
    expect(importer).toHaveBeenCalledTimes(2)
  })
})

describe('MiniSearch engine (ADR D4 config)', () => {
  const engine = createSearchEngine(docs)

  it('indexes every doc and finds "zenith" as the top hit (AC1)', () => {
    expect(engine.size).toBe(1735)
    const [top] = engine.search('zenith')
    expect(top.doc).toMatchObject({ id: 'i:4956', name: 'Zenith', type: 'weapon' })
  })

  it('is prefix + fuzzy (0.2) and searches tags too', () => {
    expect(engine.search('zen')[0].doc.name).toBe('Zenith')
    expect(engine.search('zenth')[0].doc.name).toBe('Zenith')
    const broadswords = engine.search('broadswords')
    expect(broadswords.length).toBeGreaterThan(10)
    expect(broadswords.every((h) => h.doc.tags.includes('broadswords'))).toBe(true)
  })

  it('AND-combines words, so each word narrows the result', () => {
    const hits = engine.search('eye cthulhu')
    expect(hits[0].doc).toMatchObject({ id: 'boss:eye-of-cthulhu', type: 'boss' })
    expect(hits.length).toBeLessThan(engine.search('eye').length)
  })

  it('returns nothing for a blank or nonsense query (AC3)', () => {
    expect(engine.search('')).toEqual([])
    expect(engine.search('   ')).toEqual([])
    expect(engine.search('qwxzvbnmkj')).toEqual([])
  })

  it('filters by entity type (facet filter over the stored type)', () => {
    const slimes = engine.search('slime')
    expect(new Set(slimes.map((h) => h.doc.type))).toEqual(new Set(['weapon', 'boss', 'enemy', 'buff', 'accessory'])) // P2-S8: fuzzy 'Lime String' / 'Lime Golf Ball'
    const onlyBosses = engine.search('slime', { types: new Set(['boss']) })
    expect(onlyBosses.length).toBeGreaterThan(0)
    expect(onlyBosses.every((h) => h.doc.type === 'boss')).toBe(true)
  })
})

describe('groupByType (AC2)', () => {
  const hit = (type: SearchDoc['type'], name: string, score: number) => ({ item: { type, name }, score })

  it('puts the group with the best match first, keeps score order inside, caps rows and counts all', () => {
    const groups = groupByType(
      [
        hit('boss', 'King Slime', 9),
        hit('weapon', 'Slime Staff', 7),
        hit('enemy', 'Blue Slime', 6),
        hit('weapon', 'Slimy Saddle', 5),
        hit('weapon', 'Slime Gun', 4),
      ],
      2,
    )
    expect(groups.map((g) => [g.label, g.items.map((i) => i.name), g.total])).toEqual([
      ['Bosses', ['King Slime'], 1],
      ['Weapons', ['Slime Staff', 'Slimy Saddle'], 3],
      ['Enemies', ['Blue Slime'], 1],
    ])
  })

  it('breaks a best-score tie by registry order (Weapons before Bosses before Enemies)', () => {
    const groups = groupByType([hit('enemy', 'a', 5), hit('boss', 'b', 5), hit('weapon', 'c', 5)])
    expect(groups.map((g) => g.type)).toEqual(['weapon', 'boss', 'enemy'])
  })
})

describe('result targets (internal vs the doc’s own wiki article; B42b)', () => {
  it('weapons navigate in-app to their detail page (a local route wins over the doc’s wikiUrl)', () => {
    const zenith = { id: 'i:4956', type: 'weapon', name: 'Zenith', wikiUrl: 'https://terraria.wiki.gg/wiki/Zenith' } as const
    expect(resolveTarget(zenith)).toEqual({ kind: 'internal', to: '/weapons/4956' })
  })

  it('a boss ref without a page opens its own wiki article from the doc', () => {
    // P5-S3: every registry boss has a page; a boss ref outside the list (e.g. an event boss, were one
    // ever indexed) still opens its own article, never a dead local link.
    const pumpking = { id: 'boss:pumpking', type: 'boss', name: 'Pumpking', wikiUrl: 'https://terraria.wiki.gg/wiki/Pumpking' } as const
    expect(resolveTarget(pumpking)).toEqual({ kind: 'external', href: 'https://terraria.wiki.gg/wiki/Pumpking' })
  })

  it('P5-S2: bosses with a page (src/schemas/bossPages.ts) navigate in-app to it', () => {
    for (const id of BOSS_PAGE_IDS) {
      expect(resolveTarget({ id: `boss:${id}`, type: 'boss', name: id, wikiUrl: `https://terraria.wiki.gg/wiki/${id}` })).toEqual({ kind: 'internal', to: `/bosses/${id}` })
    }
    // A malformed boss ref has no route: its wiki article, never a broken local link.
    expect(resolveTarget({ id: 'boss:Eye' as SearchDoc['id'], type: 'boss', name: 'Eye', wikiUrl: 'https://terraria.wiki.gg/wiki/Eye_of_Cthulhu' })).toEqual({ kind: 'external', href: 'https://terraria.wiki.gg/wiki/Eye_of_Cthulhu' })
  })

  it('an ammo item and a buff open their own article, not the wiki search page', () => {
    const ammo = { id: 'i:97', type: 'item', name: 'Musket Ball', wikiUrl: 'https://terraria.wiki.gg/wiki/Musket_Ball' } as const
    const buff = { id: 'buff:on-fire', type: 'buff', name: 'On Fire!', wikiUrl: 'https://terraria.wiki.gg/wiki/On_Fire!' } as const
    expect(resolveTarget(ammo)).toEqual({ kind: 'external', href: 'https://terraria.wiki.gg/wiki/Musket_Ball' })
    expect(resolveTarget(buff)).toEqual({ kind: 'external', href: 'https://terraria.wiki.gg/wiki/On_Fire!' })
  })

  it('anything without a page or URL falls back to the wiki search for its exact name (never a dead link)', () => {
    expect(resolveTarget({ id: 'buff:on-fire', type: 'buff', name: 'On Fire!' })).toEqual({
      kind: 'external',
      href: 'https://terraria.wiki.gg/wiki/Special:Search?search=On%20Fire!',
    })
    // A malformed weapon ref has no route: still a live target, not a broken local link.
    expect(resolveTarget({ id: 'i:abc' as SearchDoc['id'], type: 'weapon', name: 'X' })).toEqual({
      kind: 'external',
      href: wikiSearchUrl('X'),
    })
  })
})

describe('buildSearchIndex (lazy index; AC1/AC2/AC5)', () => {
  it('builds from the shipped data: "zenith" → Zenith first, internal, with its sprite', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    expect(index.docCount).toBe(1735)
    const { groups, options } = index.suggest('zenith')
    expect(groups[0].label).toBe('Weapons')
    expect(options[0]).toMatchObject({
      ref: 'i:4956',
      name: 'Zenith',
      type: 'weapon',
      rarity: 10,
      detail: 'Melee · Red (10)',
      sprite: '/sprites/weapons/4956.png',
      target: { kind: 'internal', to: '/weapons/4956' },
    })
  })

  it('every row without a local page opens its own doc’s wiki article (never a guessed URL, never the search page)', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    const all = docs.flatMap((d) => index.suggest(d.name).options.filter((o) => o.ref === d.id))
    expect(all).toHaveLength(1735)
    const docById = new Map(docs.map((d) => [d.id, d]))
    const pageBosses = new Set<string>(BOSS_PAGE_IDS.map((id) => `boss:${id}`))
    for (const option of all) {
      if (option.type === 'weapon') {
        expect(option.target).toEqual({ kind: 'internal', to: `/weapons/${option.ref.slice(2)}` })
        continue
      }
      if (pageBosses.has(option.ref)) {
        expect(option.target, option.ref).toEqual({ kind: 'internal', to: `/bosses/${option.ref.slice(5)}` })
        continue
      }
      const wikiUrl = docById.get(option.ref)?.wikiUrl
      expect(wikiUrl, option.ref).toMatch(/^https:\/\/terraria\.wiki\.gg\/wiki\//)
      expect(wikiUrl, option.ref).not.toContain('Special:Search')
      expect(option.target, option.ref).toEqual({ kind: 'external', href: wikiUrl })
    }
    // P2-S7 ammo items and buffs are covered too (they used to open the wiki search page); P2-S8 armor, accessories, sets.
    expect(new Set(all.map((o) => o.type))).toEqual(new Set(['weapon', 'boss', 'enemy', 'item', 'buff', 'armor', 'accessory', 'set']))
    // e.g. the Enchanted Sword ENEMY must not link to the item article of the same name.
    const enchanted = index.suggest('enchanted sword').options.find((o) => o.type === 'enemy')
    expect(enchanted?.target).toEqual({ kind: 'external', href: 'https://terraria.wiki.gg/wiki/Enchanted_Sword_(NPC)' })
  })

  it('retiring the boss/enemy URL loaders loses nothing: doc URLs match the records’ own wikiUrl', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    const records = [...bosses.map((b) => [`boss:${b.id}`, b] as const), ...enemies.map((e) => [`enemy:${e.id}`, e] as const)]
    for (const [ref, record] of records) {
      const doc = docs.find((d) => d.id === ref)
      expect(doc, ref).toBeDefined()
      expect(doc?.wikiUrl, ref).toBe(record.wikiUrl)
      const option = index.suggest(doc!.name).options.find((o) => o.ref === ref)
      // P5-S2: a boss with a page navigates to it; every other record opens its own article.
      const page = ref.startsWith('boss:') && (BOSS_PAGE_IDS as readonly string[]).includes(ref.slice(5))
      expect(option?.target, ref).toEqual(page ? { kind: 'internal', to: `/bosses/${ref.slice(5)}` } : { kind: 'external', href: record.wikiUrl })
    }
  })

  it('an ammo row and a buff row from the shipped data open their own article', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    const ammo = docs.find((d) => d.type === 'item' && d.tags.includes('bullets'))!
    const buff = docs.find((d) => d.type === 'buff')!
    for (const doc of [ammo, buff]) {
      const row = index.suggest(doc.name).options.find((o) => o.ref === doc.id)
      expect(row?.target, doc.id).toEqual({ kind: 'external', href: doc.wikiUrl })
      expect(row?.target, doc.id).not.toEqual({ kind: 'external', href: wikiSearchUrl(doc.name) })
    }
  })

  it('groups mixed results by type with labels, bosses carry sprites, enemies fall back to placeholder art', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    const { groups } = index.suggest('slime')
    expect(groups.map((g) => g.label).sort()).toEqual(['Accessories', 'Bosses', 'Buffs', 'Enemies', 'Weapons'])
    const king = groups.find((g) => g.type === 'boss')!.items.find((i) => i.name === 'King Slime')!
    expect(king.sprite).toBe('/sprites/bosses/50.gif')
    expect(king.detail).toBe('Early Pre-Hardmode')
    const enemy = groups.find((g) => g.type === 'enemy')!.items[0]
    expect(enemy.sprite).toBeUndefined()
    expect(groups.every((g) => g.items.length <= 5 && g.total >= g.items.length)).toBe(true)
  })

  it('AC5: a dataset type the UI has never seen is indexed, grouped and labelled with no code change', async () => {
    const extra: SearchDoc[] = [
      { id: 'i:29', name: 'Life Crystal', type: 'item', rarity: 2, tags: ['consumables'] },
      // P2-S8 ships armor sets; Wizard set is a real set article the dataset withholds, so it is not a shipped doc
      { id: 'set:wizard-set', name: 'Wizard set', type: 'set', tags: [] },
    ]
    // Neither extra doc carries a wikiUrl: the row falls back to the wiki search (never a dead link).
    const index = await buildSearchIndex(performance.now(), deps({ loadDocs: async () => [...docs, ...extra] }))
    const crystal = index.suggest('life crystal')
    expect(crystal.groups[0]).toMatchObject({ type: 'item', label: ENTITY_TYPES.item.plural })
    expect(crystal.options[0].target).toEqual({ kind: 'external', href: wikiSearchUrl('Life Crystal') })
    expect(index.suggest('wizard set').groups.map((g) => g.label)).toContain('Armor sets')
  })

  it('facet filter by entity type and the per-group cap are honoured', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    const bossOnly = index.suggest('slime', { types: new Set(['boss']) })
    expect(bossOnly.groups.map((g) => g.type)).toEqual(['boss'])
    expect(index.suggest('sword', { perGroup: 3 }).groups.every((g) => g.items.length <= 3)).toBe(true)
  })

  it('nonsense → no groups and no options (AC3)', async () => {
    const index = await buildSearchIndex(performance.now(), deps())
    expect(index.suggest('qwxzvbnmkj')).toEqual({ query: 'qwxzvbnmkj', groups: [], options: [] })
  })

  it('a missing sprite manifest degrades to placeholder art; failing docs reject (error state)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const index = await buildSearchIndex(performance.now(), deps({ loadSprites: async () => Promise.reject(new Error('404')) }))
    expect(index.sprites).toBeNull()
    expect(index.suggest('zenith').options[0].sprite).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    const docsFailure = new ChunkLoadError('search-docs', new Error('offline'))
    await expect(buildSearchIndex(0, deps({ loadDocs: async () => Promise.reject(docsFailure) }))).rejects.toBe(docsFailure)
  })

  it('records load/build timings and user-timing marks (ADR D7 ≤500 ms evidence)', async () => {
    let t = 1000
    const index = await buildSearchIndex(1000, deps({ now: () => (t += 40) }))
    expect(index.timing).toEqual({ loadMs: 40, buildMs: 40, totalMs: 80 })
    expect(performance.getEntriesByName('tc:search-index').length).toBeGreaterThan(0)
  })

  it('builds the real 1735-doc index well inside the 500 ms budget on this machine', async () => {
    const start = performance.now()
    createSearchEngine(docs)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('detail line + placeholder copy', () => {
  it('shows only the fields a doc carries', () => {
    expect(detailLine({ id: 'i:4956', name: 'Zenith', type: 'weapon', class: 'melee', rarity: 10, tags: [] })).toBe('Melee · Red (10)')
    expect(detailLine({ id: 'boss:plantera', name: 'Plantera', type: 'boss', stage: 'mid-hm', tags: [] })).toBe('Mid-Hardmode')
    expect(detailLine({ id: 'enemy:blue-slime', name: 'Blue Slime', type: 'enemy', tags: [] })).toBe('')
  })

  it('names only shipped datasets, from meta.json counts', () => {
    const shipped = searchableCounts(meta.counts)
    expect(shipped).toEqual([
      { type: 'weapon', count: 488 },
      { type: 'boss', count: 18 },
      { type: 'item', count: 145 },
      { type: 'armor', count: 256 },
      { type: 'accessory', count: 352 },
      { type: 'set', count: 67 },
      { type: 'enemy', count: 334 },
      { type: 'buff', count: 75 },
    ])
    expect(searchPlaceholder(shipped)).toBe('Search weapons, bosses, items…')
    expect(searchScopeSummary(shipped)).toBe('488 weapons, 18 bosses, 145 items, 256 armor, 352 accessories, 67 armor sets, 334 enemies and 75 buffs')
    expect(searchPlaceholder([])).toBe('Search…')
    const later = searchableCounts({ ...meta.counts, items: 5000, armor: 300 })
    expect(searchPlaceholder(later)).toBe('Search weapons, bosses, items…')
  })
})
