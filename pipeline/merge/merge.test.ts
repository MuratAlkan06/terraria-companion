/* Merge stage on synthetic Cargo rows shaped like the real tables (2026-10-13 sync). */
import { describe, expect, it } from 'vitest'
import { DropSource, Enemy, Recipe, RecipeGroup } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { Iteminfo } from '../parse/iteminfo'
import { buildDrops, indexNpcs, parseNpcIdCell } from './drops'
import { buildEnemies } from './enemies'
import { conditionMatchers, type ConditionsOverlay } from './overlays'
import { buildRecipes } from './recipes'

const NAMES: Record<number, string> = {
  9: 'Wood', 22: 'Iron Bar', 704: 'Lead Bar', 35: 'Iron Anvil', 716: 'Lead Anvil', 36: 'Work Bench', 48: 'Chest', 381: 'Cobalt Bar', 371: 'Cobalt Hat',
  1329: 'Tissue Sample', 3322: 'Treasure Bag (Queen Bee)', 1121: 'Bee Gun', 216: 'Shackle', 5134: 'Terraformer', 5011: 'Clentaminator', 699: 'Tin Ore', 701: 'Iron Ore',
  267: 'Voodoo Doll', 2: 'Dirt Block', 3: 'Stone Block', 61: 'Ebonstone Block', 836: 'Crimstone Block', 409: 'Pearlstone Block', 405: 'Spectre Boots',
}
const iteminfo: Iteminfo = {
  rev: 1023241,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-13T02:44:40.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(Object.entries(NAMES).map(([id, name]) => [Number(id), { id: Number(id), name, internalName: name.replaceAll(' ', ''), stats: {} }])),
  idsByName: new Map(Object.entries(NAMES).map(([id, name]) => [name, [Number(id)]])),
  wikiIdFromName: new Map(),
}

const overlay: ConditionsOverlay = {
  overlay: 'conditions',
  authoredAt: '2026-10-13',
  notes: [],
  entries: [
    { id: 'shimmer', name: 'Shimmer', kind: 'environment', wikiTitle: 'Shimmer', description: 'x', match: { stations: ['Shimmer'] } },
    { id: 'near-water', name: 'Water, Sink, or Water fountain', kind: 'environment', wikiTitle: 'Water', description: 'x', match: { stations: ['Water'] } },
    { id: 'post-moon-lord', name: 'Moon Lord defeated', kind: 'world-state', wikiTitle: 'Moon Lord', description: 'x', satisfiedByNode: 'moon-lord', match: { recipeNotes: ['#note_post_moon_lord'] } },
    { id: 'hardmode', name: 'Hardmode', kind: 'world-state', wikiTitle: 'Hardmode', description: 'x', match: { dropNotes: ['Hardmode'] } },
    { id: 'pre-hardmode', name: 'Pre-Hardmode', kind: 'world-state', wikiTitle: 'Pre-Hardmode', description: 'x' },
  ],
}
const matchers = conditionMatchers(overlay)
const mod = (title: string) => ({ title, rev: 7, fetchedAt: '2026-10-13T02:44:40.000Z' })

const recipeRow = (over: Partial<Record<string, string>>): CargoRow => ({
  _rowid: '1', _page: 'Recipes/Work Bench/register', result: 'Chest', resultid: '48', resulttext: '', amount: '1', version: '', station: 'Work Bench', ings: '¦Any Iron Bar¦2^¦Wood¦8', legacy: '0', ...over,
})

function recipes(rows: CargoRow[]) {
  return buildRecipes({
    rows,
    fetchedAt: '2026-10-13T02:45:00.000Z',
    iteminfo,
    modules: { recipes: mod('Module:Recipes'), recipeGroups: mod('Module:RecipeGroups'), l10n: mod('Module:Recipes/l10n') },
    wikiGroups: [
      { name: 'Any Iron Bar', memberNames: ['Iron Bar', 'Lead Bar'] },
      { name: 'Any Stone Block', memberNames: ['Stone Block', 'Ebonstone Block', 'Crimstone Block', 'Pearlstone Block'] },
    ],
    gameGroups: [
      { internalName: 'IronBar', descriptorKey: 'ItemName.IronBar', itemIds: [22, 704] },
      { internalName: 'Stone', descriptorKey: 'ItemName.StoneBlock', itemIds: [3, 61, 836, 409, 9999] },
    ],
    l10n: { stationCate: { 'Iron Anvil': 'Iron or Lead Anvil', 'Lead Anvil': 'Iron or Lead Anvil', Water: 'Water, Sink, or Water fountain', Sink: 'Water, Sink, or Water fountain' }, resultNotes: { '#note_post_moon_lord': '(After [[Moon Lord]] is defeated)' } },
    conditions: matchers,
  })
}

describe('buildRecipes', () => {
  it('reproduces the P2-S1 sample recipe id and resolves the "Any Iron Bar" group (cross-checked)', () => {
    const out = recipes([recipeRow({})])
    expect(out.recipes.map((r) => Recipe.parse(r).id)).toEqual(['48-5d2fabc3'])
    expect(out.groups).toHaveLength(1)
    const group = RecipeGroup.parse(out.groups[0])
    expect(group).toMatchObject({ id: 'any-iron-bar', name: 'Any Iron Bar', memberItemIds: [22, 704] })
    expect(group._prov.verified).toBe(true)
    expect(group._prov.sources.map((s) => s.url)).toContain('https://terraria.wiki.gg/wiki/Module:RecipeGroups')
  })

  it('drops legacy/non-desktop rows and dedupes identical canonical recipes', () => {
    const out = recipes([recipeRow({ legacy: '1' }), recipeRow({ _rowid: '2', version: 'old-gen 3ds' }), recipeRow({ _rowid: '3', version: 'desktop console mobile' }), recipeRow({ _rowid: '4' })])
    expect(out.ledger).toMatchObject({ cargoRows: 4, legacyRows: 1, nonDesktopRows: 1, duplicateRows: 1, emitted: 1 })
  })

  it('B3: "Iron Anvil" becomes the Iron-or-Lead station group; environments and result notes become condition stations', () => {
    const out = recipes([
      recipeRow({ _rowid: '5', result: 'Cobalt Hat', resultid: '371', station: 'Iron Anvil', ings: '¦Cobalt Bar¦10' }),
      recipeRow({ _rowid: '6', result: 'Terraformer', resultid: '5134', station: 'Shimmer', resulttext: '#note_post_moon_lord', ings: '¦Clentaminator¦1' }),
    ])
    const [hat, terraformer] = out.recipes
    expect(hat.stations).toEqual([{ kind: 'group', groupId: 'iron-or-lead-anvil' }])
    expect(out.groups.find((g) => g.id === 'iron-or-lead-anvil')?.memberItemIds.sort()).toEqual([35, 716])
    expect(terraformer.stations).toEqual([
      { kind: 'environment', condition: 'shimmer', name: 'Shimmer' },
      { kind: 'environment', condition: 'post-moon-lord', name: 'Moon Lord defeated' },
    ])
    expect(out.ledger.availabilityNoteStations).toBe(1) // B9 migration debt, reported in the gap report
  })

  it('excludes unresolvable rows with a gap entry, never guessing', () => {
    const out = recipes([
      recipeRow({ _rowid: '7', ings: '¦Recorded Music Boxes¦1' }),
      recipeRow({ _rowid: '8', result: 'Tin Ore', resultid: '396', station: 'Shimmer', ings: '¦Iron Ore¦1' }),
      recipeRow({ _rowid: '9', ings: '¦Any Torch¦1' }),
    ])
    expect(out.recipes).toEqual([])
    expect(out.gaps.map((g) => [g.ref, g.kind])).toEqual([
      ['rcp:cargo-row-7', 'count-reconciliation'],
      ['rcp:cargo-row-8', 'source-mismatch'],
      ['rcp:cargo-row-9', 'count-reconciliation'],
    ])
  })

  it('a group whose members disagree with the game recipe group is emitted unverified with a source-mismatch gap', () => {
    const out = recipes([recipeRow({ _rowid: '10', result: 'Iron Anvil', resultid: '35', ings: '¦Any Stone Block¦20' })])
    const stone = out.groups.find((g) => g.id === 'any-stone-block')
    expect(stone?._prov.verified).toBe(false)
    expect(out.gaps).toEqual([expect.objectContaining({ ref: 'grp:any-stone-block', kind: 'source-mismatch' })])
  })
})

const npcRows: CargoRow[] = [
  { _page: 'Creeper', nameraw: 'Creeper', npcid: '267', type: 'enemy', environment: 'The Crimson' },
  { _page: 'Zombie', nameraw: 'Zombie', npcid: '3', type: 'undead Enemy', environment: 'Surface+Night/Graveyard' },
  { _page: 'Zombie', nameraw: 'Zombie', npcid: '-26', type: 'undead Enemy', environment: 'Surface+Night' },
  { _page: 'Queen Bee', nameraw: 'Queen Bee', npcid: '222', type: 'boss', environment: 'Jungle' },
  { _page: 'Moon Lord', nameraw: 'Moon Lord', npcid: '396', type: 'boss Part', environment: 'Lunar Events' },
  { _page: 'Bunny', nameraw: 'Bunny', npcid: '46', type: 'critter', environment: 'Forest' },
]

const dropRow = (over: Partial<Record<string, string>>): CargoRow => ({
  _rowid: '1', _page: 'Zombie', nameraw: 'Zombie', id: '3', name: '[[Zombie]]', item: 'Shackle', quantity: '1', rate: '2%', custom: '', isfromnpc: '1', normal: '1', expert: '1', master: '1', ...over,
})

function drops(rows: CargoRow[]) {
  return buildDrops({ rows, fetchedAt: '2026-10-13T02:46:00.000Z', npcs: indexNpcs(npcRows), npcsFetchedAt: '2026-10-13T02:47:00.000Z', iteminfo, conditions: matchers })
}

describe('buildDrops', () => {
  it('reproduces the P2-S1 sample drop id and parses a plain row', () => {
    const [d] = drops([dropRow({})]).drops
    expect(DropSource.parse(d)).toMatchObject({ id: '216-zombie-741638a5', source: { npcName: 'Zombie', npcIds: [3] }, quantity: { min: 1, max: 1 }, rates: { classic: 0.02, expert: 0.02, master: 0.02 } })
    expect(d._prov.verified).toBe(true)
  })

  it('B1: per-difficulty quantity and rates (Creeper → Tissue Sample)', () => {
    const q = '<span class="mode-content"><span class="m-normal m-journey">2–5</span><span class="m-expert">[[Expert Mode|<span class="mode-exclusive expert" >1–3</span>]]</span><span class="m-master">[[Master Mode|<span class="mode-exclusive master" >1–2</span>]]</span></span>'
    const r = '<span class="mode-content"><span class="m-normal m-journey">66.67%</span><span class="m-expert">66.67%</span><span class="m-master">[[Master Mode|<span class="mode-exclusive master" >50%</span>]]</span></span>'
    const [d] = drops([dropRow({ _page: 'Creeper', nameraw: 'Creeper', id: '267', item: 'Tissue Sample', quantity: q, rate: r })]).drops
    expect(d.quantity).toEqual({ classic: { min: 2, max: 5 }, expert: { min: 1, max: 3 }, master: { min: 1, max: 2 } })
    expect(d.rates).toEqual({ classic: 0.6667, expert: 0.6667, master: 0.5 })
  })

  it('boss and treasure-bag sources list source.bossId as unverified (P2-S6 registry pending); flags gate difficulties', () => {
    const out = drops([
      dropRow({ _page: 'Queen Bee', nameraw: 'Queen Bee', id: '222', item: 'Bee Gun', rate: '33%', expert: '0', master: '0' }),
      dropRow({ _rowid: '2', _page: 'Queen Bee', nameraw: 'Treasure Bag (Queen Bee)', id: '222', item: 'Bee Gun', rate: '33%', isfromnpc: '0', normal: '0' }),
    ])
    const [boss, bag] = out.drops
    expect(boss).toMatchObject({ rates: { classic: 0.33 }, source: { npcName: 'Queen Bee', npcIds: [222] } })
    expect(boss._prov.unverifiedFields).toEqual(['source.bossId'])
    expect(bag).toMatchObject({ rates: { expert: 0.33, master: 0.33 }, source: { npcName: 'Treasure Bag (Queen Bee)', treasureBag: true } })
    expect(bag.source.npcIds).toBeUndefined()
  })

  it('NPC ids: mismatches are withheld with a gap; multi-part bosses are not filled from the NPCs table; B10 negative variant ids are emitted', () => {
    const out = drops([
      dropRow({ id: '262' }),
      dropRow({ _rowid: '2', _page: 'Moon Lord', nameraw: 'Moon Lord', id: '', item: 'Shackle' }),
      dropRow({ _rowid: '3', id: '-26', item: 'Voodoo Doll' }),
      dropRow({ _rowid: '4', id: '', item: 'Tissue Sample' }),
      dropRow({ _rowid: '5', id: '-99', item: 'Spectre Boots' }),
    ])
    const byItem = (itemId: number, npcName = 'Zombie') => out.drops.find((d) => d.itemId === itemId && d.source.npcName === npcName)!
    for (const d of [byItem(216), byItem(216, 'Moon Lord'), byItem(405)]) {
      expect(d.source.npcIds).toBeUndefined()
      expect(d._prov.unverifiedFields).toContain('source.npcIds')
    }
    const variant = DropSource.parse(byItem(267))
    expect(variant.source.npcIds).toEqual([-26]) // cross-checked against the NPCs table (Zombie: 3, -26)
    expect(variant._prov.unverifiedFields).not.toContain('source.npcIds')
    expect(byItem(1329).source.npcIds).toEqual([-26, 3]) // empty cell filled from NPCs, variants included
    expect(out.gaps).toEqual([
      expect.objectContaining({ ref: 'drop:cargo-row-1', field: 'source.npcIds', kind: 'source-mismatch' }),
      expect.objectContaining({ ref: 'drop:cargo-row-5', field: 'source.npcIds', kind: 'source-mismatch' }),
    ])
    expect(parseNpcIdCell('170 <span class="note-text ">(Corrupt)</span>, 171 (Hallow), 87–89')).toEqual({ ok: true, value: { positive: [170, 171, 87, 88, 89], negative: [] } })
  })

  it('"A<br/>B (Hardmode)" splits into pre-hardmode / hardmode records; unparseable rates are Unknown', () => {
    const out = drops([
      dropRow({ rate: '<span class="chance">0.64%<br/>0.6% <span class="note-text ">(Hardmode)</span></span>' }),
      dropRow({ _rowid: '2', item: 'Voodoo Doll', rate: '2.5–12.5%' }),
    ])
    const split = out.drops.filter((d) => d.itemId === 216).map((d) => [d.conditions, d.rates.classic] as const)
    expect(split.sort((a, b) => a[0][0].localeCompare(b[0][0]))).toEqual([
      [['hardmode'], 0.006],
      [['pre-hardmode'], 0.0064],
    ])
    const unknown = out.drops.find((d) => d.itemId === 267)!
    expect(unknown.rates).toEqual({})
    expect(unknown._prov.unverifiedFields).toEqual(['rates.classic', 'rates.expert', 'rates.master'])
    expect(out.ledger).toMatchObject({ emittedRows: 2, emittedRecords: 3, splitRows: 1 })
  })

  it('skips rows whose platform icons exclude Desktop; unresolvable items are excluded with a gap', () => {
    const oldGen = '<span class="eico s i3" title="Old-gen console and 3DS versions"><b></b><i></i><span>(Old-gen console and 3DS versions)</span></span>'
    const out = drops([dropRow({ name: `[[Zombie]]${oldGen}` }), dropRow({ _rowid: '2', item: 'Golden furniture' })])
    expect(out.drops).toEqual([])
    expect(out.ledger).toMatchObject({ nonDesktopRows: 1, excludedRows: 1 })
  })
})

describe('buildEnemies', () => {
  it('keeps enemy-typed NPCs only, merges rows by name, keeps environments verbatim and derives dropIds', () => {
    const d = drops([dropRow({})]).drops
    const { enemies } = buildEnemies(npcRows, d, '2026-10-13T02:47:00.000Z', '2026-10-13T02:46:00.000Z')
    expect(enemies.map((e) => e.id)).toEqual(['creeper', 'zombie'])
    const zombie = Enemy.parse(enemies[1])
    expect(zombie).toMatchObject({ npcIds: [-26, 3], biomes: ['Surface + Night', 'Graveyard'], dropIds: ['216-zombie-741638a5'] })
    expect(zombie._prov.unverifiedFields).toEqual(['stage'])
  })
})
