/* Item corpus (P6-S0, merge/corpus.ts) on synthetic Cargo Items rows + Iteminfo stats shaped like the
 * 2026-10-15 sync: identification, the category rules, the field cross-checks and the honest Unknowns. */
import { describe, expect, it } from 'vitest'
import { getField, Item } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { ImageInfo } from '../fetch/images'
import type { Iteminfo } from '../parse/iteminfo'
import { buildCorpus, CATEGORY_RULES, corpusCategory, corpusFoodBuffNames, identifyCorpus } from './corpus'
import type { GatingResult } from './gating'

const DEFAULTS = { rare: 0, value: 0, maxStack: 9999, consumable: false, buffType: 0, buffTime: 0, pick: 0, axe: 0, hammer: 0, fishingPole: 0, bait: 0 }
const ITEMS: { id: number; name: string; stats: Record<string, unknown> }[] = [
  { id: 8, name: 'Torch', stats: { consumable: true, value: 50 } },
  { id: 22, name: 'Iron Bar', stats: { consumable: true, value: 1500 } },
  { id: 43, name: 'Suspicious Looking Eye', stats: { consumable: true, rare: 1 } },
  { id: 84, name: 'Grappling Hook', stats: { rare: 1, value: 20000 } },
  { id: 225, name: 'Silk', stats: { value: 1000 } },
  { id: 269, name: 'Familiar Shirt', stats: { value: 10000 } },
  { id: 357, name: 'Bowl of Soup', stats: { buffType: 206, buffTime: 36000, consumable: true } },
  { id: 2290, name: 'Bass', stats: { value: 2500 } },
  { id: 2294, name: 'Golden Fishing Rod', stats: { fishingPole: 50, rare: 3 } },
  { id: 2334, name: 'Wooden Crate', stats: { consumable: true, rare: 1 } },
  { id: 3509, name: 'Copper Pickaxe', stats: { pick: 35, value: 500 } },
  { id: 3506, name: 'Copper Axe', stats: { axe: 7, value: 400 } },
  { id: 2673, name: 'Truffle Worm', stats: { bait: 666, consumable: true, rare: 3 } },
  { id: 1162, name: 'Leaf Wings', stats: {} }, // emitted elsewhere (accessories)
  { id: 669, name: 'Fish', stats: { buffType: 41, buffTime: 18000, rare: 3 } },
  { id: 5077, name: 'Glass Slipper', stats: {} },
]
const info: Iteminfo = {
  rev: 1023241,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-13T00:00:00.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(ITEMS.map((i) => [i.id, { id: i.id, internalName: i.name.replaceAll(' ', ''), name: i.name, stats: { ...DEFAULTS, ...i.stats } }])),
  idsByName: new Map(ITEMS.map((i) => [i.name, [i.id]])),
  wikiIdFromName: new Map(),
}
const row = (over: Record<string, string>): CargoRow => ({ _rowid: '1', _page: over.name ?? '', itemid: '', name: '', internalname: '', imagefile: '', type: '', listcat: '', tag: '', rare: '0', consumable: '', buffs: '', debuffs: '', unobtainable: '', pick: '', axe: '', hammer: '', fishing: '', bait: '', ...over })
const ROWS: CargoRow[] = [
  row({ _rowid: '1', itemid: '8', name: 'Torch', _page: 'Torches', type: 'furniture^light Source^crafting material', consumable: '1', imagefile: 'Torch.png' }),
  row({ _rowid: '2', itemid: '22', name: 'Iron Bar', type: 'bar^crafting material', consumable: '1' }),
  row({ _rowid: '3', itemid: '43', name: 'Suspicious Looking Eye', type: 'boss summon', consumable: '1', rare: '1' }),
  row({ _rowid: '4', itemid: '84', name: 'Grappling Hook', type: 'tool', tag: 'Hooks^vendor:Goblin Tinkerer', rare: '1' }),
  row({ _rowid: '5', itemid: '225', name: 'Silk', type: 'crafting material' }),
  row({ _rowid: '6', itemid: '269', name: 'Familiar Shirt', _page: 'Familiar set', type: 'vanity' }),
  row({ _rowid: '7', itemid: '357', name: 'Bowl of Soup', type: 'food^potion', consumable: '1', buffs: 'Plenty Satisfied' }),
  row({ _rowid: '8', itemid: '2290', name: 'Bass', type: 'crafting material', tag: 'fished' }),
  row({ _rowid: '9', itemid: '2294', name: 'Golden Fishing Rod', _page: 'Fishing poles', type: 'tool', tag: 'fishing poles^quest rewards', fishing: '50', rare: '3' }),
  row({ _rowid: '10', itemid: '2334', name: 'Wooden Crate', type: 'grab bag^furniture^crate', consumable: '1', rare: '1' }),
  row({ _rowid: '11', itemid: '3509', name: 'Copper Pickaxe', type: 'tool', pick: '35%' }),
  row({ _rowid: '12', itemid: '3506', name: 'Copper Axe', type: 'tool', axe: '35%' }),
  row({ _rowid: '13', itemid: '2673', name: 'Truffle Worm', type: 'boss summon^bait^crafting material', bait: '666', consumable: '1', rare: '3' }),
  row({ _rowid: '14', itemid: '1162', name: 'Leaf Wings', type: 'accessory' }),
  row({ _rowid: '15', itemid: '669', name: 'Fish', type: 'pet summon', buffs: 'Baby Penguin', rare: '3' }),
  row({ _rowid: '16', name: 'Princess set', _page: 'Princess set', type: 'vanity^set' }),
  row({ _rowid: '17', itemid: '5077', name: 'Mythical Robe', type: 'vanity' }),
  row({ _rowid: '18', itemid: '9999', name: 'Future Item', type: 'furniture' }),
  row({ _rowid: '19', itemid: '225', name: 'Silk', _page: 'Silk (duplicate)', type: 'crafting material' }),
]
const BUFF_TABLE = [
  { id: 206, name: 'Plenty Satisfied', internalName: 'WellFed2', isDebuff: false, article: 'Well Fed' },
  { id: 41, name: 'Baby Penguin', internalName: 'BabyPenguin', isDebuff: false, article: 'Fish' },
]
const freeGate: GatingResult = { ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } }
const image = (file: string): ImageInfo => ({ file, title: `File:${file}`, url: `https://terraria.wiki.gg/images/${file}`, descriptionUrl: `https://terraria.wiki.gg/wiki/File:${file}`, sha1: 'a'.repeat(40), bytes: 300, width: 16, height: 16, mime: 'image/png' })

function build(over: Partial<Parameters<typeof buildCorpus>[0]> = {}) {
  return buildCorpus({
    itemRows: ROWS,
    itemsFetchedAt: '2026-10-13T00:00:00.000Z',
    iteminfo: info,
    images: new Map([['Torch.png', image('Torch.png')]]),
    recipes: [{ id: '225-31031c1c', resultItemId: 225 }],
    drops: [],
    gating: (id) => (id === 225 ? freeGate : { ok: false, blockers: ['no-known-route'] }),
    elsewhere: new Set([1162]),
    usedSlugs: new Set(['leaf-wings']),
    stationIds: new Set([8]),
    buffTable: BUFF_TABLE,
    buffSlug: (name) => (name === 'Plenty Satisfied' ? 'plenty-satisfied' : undefined),
    summons: new Map([[43, ['eye-of-cthulhu']], [2673, ['duke-fishron']]]),
    fishedIds: new Set([2334]),
    ...over,
  })
}

describe('identifyCorpus', () => {
  it('takes every same desktop item no other collection emits; excludes set rows, missing ids, sync lag, name mismatches and duplicates', () => {
    const idn = identifyCorpus(ROWS, info, new Set([1162]))
    expect(idn.included.map((c) => c.item.id).sort((a, b) => a - b)).toEqual([8, 22, 43, 84, 225, 269, 357, 669, 2290, 2294, 2334, 2673, 3506, 3509])
    expect(idn.elsewhere).toBe(1)
    expect(idn.excluded.map((e) => [e.kind, e.reason.split(' — ')[0]])).toEqual([
      ['count-reconciliation', '"Princess set" (page Princess set) is the set infobox of an armor / vanity set article, not an item'],
      ['source-mismatch', 'Cargo row "Mythical Robe" carries item ID 5077, which Module:Iteminfo/data assigns to "Glass Slipper"'],
      ['sync-lag-1457', 'item ID 9999 ("Future Item") is not in Module:Iteminfo/data rev 1023241 (synced to 1.4.5.7)'],
      ['count-reconciliation', 'duplicate Cargo row for item 225 ("Silk", page Silk (duplicate))'],
    ])
  })
})

describe('corpusCategory: first matching rule over the infobox type list', () => {
  const cat = (types: string, tags = '', fished = false) => corpusCategory(types.split('^'), tags.split('^').filter(Boolean), fished).category
  it('stations, summons, mounts, pets, hooks, tools, dyes, vanity, food, boosters, utility, fishing, grab bags, furniture, blocks, materials, other', () => {
    expect(cat('furniture^crafting station')).toBe('station')
    expect(cat('boss summon^bait^crafting material')).toBe('summoning')
    expect(cat('furniture^mount summon^crafting material')).toBe('mount')
    expect(cat('light pet')).toBe('pet')
    expect(cat('tool', 'hooks')).toBe('hook')
    expect(cat('tool', 'fishing poles')).toBe('tool')
    expect(cat('hair dye')).toBe('dye')
    expect(cat('furniture^accessory^vanity')).toBe('vanity')
    expect(cat('food^potion^crafting material')).toBe('food')
    expect(cat('permanent booster')).toBe('permanent-booster')
    expect(cat('potion')).toBe('exploration-utility')
    expect(cat('key')).toBe('exploration-utility')
    expect(cat('crafting material', '', true)).toBe('fishing')
    expect(cat('grab bag^furniture^crate')).toBe('fishing')
    expect(cat('grab bag')).toBe('grab-bag')
    expect(cat('furniture^light source')).toBe('furniture')
    expect(cat('wall^crafting material')).toBe('block')
    expect(cat('bar^crafting material')).toBe('material')
    expect(cat('seeds')).toBe('other')
    expect(cat('')).toBe('other')
    expect(CATEGORY_RULES.at(-1)?.category).toBe('other')
  })
})

describe('buildCorpus', () => {
  const corpus = build()
  const byId = (id: number) => corpus.items.find((i) => i.id === id) as Item

  it('every record strict-parses as an Item; slugs avoid the ones already used', () => {
    for (const i of corpus.items) expect(() => Item.parse(i), i.name).not.toThrow()
    expect(new Set(corpus.items.map((i) => i.slug)).size).toBe(corpus.items.length)
  })

  it('categories and tags (the full type list, slugged)', () => {
    expect(byId(8)).toMatchObject({ category: 'furniture', tags: ['crafting-material', 'furniture', 'light-source'], isStation: true, sprite: '/sprites/items/8.png', wikiUrl: 'https://terraria.wiki.gg/wiki/Torches' })
    expect(byId(2334).category).toBe('fishing')
    expect(byId(2290).category).toBe('fishing')
    expect(byId(84).category).toBe('hook')
  })

  it('tool / fishing / bait powers are Iteminfo cross-checked with the infobox (axe power = Iteminfo axe × 5)', () => {
    expect(byId(3509).toolStats).toEqual({ pickaxePowerPct: 35 })
    expect(byId(3506).toolStats).toEqual({ axePowerPct: 35 })
    expect(byId(2294).toolStats).toEqual({ fishingPowerPct: 50 })
    expect(byId(2673).baitPowerPct).toBe(666)
    expect(corpus.crossCheck.get('toolStats.axePowerPct')).toEqual({ agree: 1, mismatch: 0, noWikiValue: 0 })
    // a disagreement withholds the value (Unknown + source-mismatch gap), never picks a side
    const bad = build({ itemRows: ROWS.map((r) => (r.itemid === '3509' ? { ...r, pick: '40%' } : r)) })
    const pick = bad.items.find((i) => i.id === 3509) as Item
    expect(pick.toolStats).toBeUndefined()
    expect(getField(pick, 'toolStats.pickaxePowerPct')).toEqual({ status: 'unverified' })
    expect(bad.gaps).toContainEqual(expect.objectContaining({ ref: 'i:3509', field: 'toolStats.pickaxePowerPct', kind: 'source-mismatch' }))
  })

  it('maxStack only for consumable items (non-stacking items report 9999 in both sources, B7)', () => {
    expect(byId(8).maxStack).toBe(9999)
    expect(byId(3509).maxStack).toBeUndefined()
    expect(getField(byId(3509), 'maxStack')).toEqual({ status: 'not-applicable' })
  })

  it('buffGrants: food grants its registry buff for buffTime ticks; a pet buff outside the registry is Unknown, never omitted', () => {
    expect(byId(357).buffGrants).toEqual([{ buffId: 'plenty-satisfied', durationTicks: 36000 }])
    expect(getField(byId(669), 'buffGrants')).toEqual({ status: 'unverified' })
    expect(corpusFoodBuffNames(ROWS, info, BUFF_TABLE)).toEqual(new Map([['Plenty Satisfied', ['Bowl of Soup']]]))
  })

  it('hook / mount stats are Unknown (not extracted); summonsBossNode is derived from the boss summon items', () => {
    expect(getField(byId(84), 'hookStats')).toEqual({ status: 'unverified' })
    expect(byId(43).summonsBossNode).toBe('eye-of-cthulhu')
    expect(byId(2673).summonsBossNode).toBe('duke-fishron')
    expect(byId(22).summonsBossNode).toBeUndefined()
  })

  it('acquisition + gating: a recipe and a derived gate; no route → acquisition and gating Unknown with the reason', () => {
    expect(byId(225)).toMatchObject({ acquisition: [{ method: 'craft', recipeIds: ['225-31031c1c'] }], gatedBy: { stage: 'early-prehm' }, stage: 'early-prehm' })
    expect(getField(byId(269), 'acquisition')).toEqual({ status: 'unverified' })
    expect(getField(byId(269), 'gatedBy')).toEqual({ status: 'unverified' })
    expect(corpus.gaps).toContainEqual(expect.objectContaining({ ref: 'i:9999', field: 'id', kind: 'sync-lag-1457' }))
    // a resolved image is a sprite; an unresolved one is a missing-sprite gap (placeholder art)
    expect(corpus.gaps.filter((g) => g.kind === 'missing-sprite').map((g) => g.ref)).not.toContain('i:8')
    expect(corpus.gaps).toContainEqual(expect.objectContaining({ ref: 'i:225', field: 'sprite', kind: 'missing-sprite' }))
  })
})
