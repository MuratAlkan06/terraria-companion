/* Merge stage on synthetic Cargo rows shaped like the real tables (2026-10-13 sync). */
import { describe, expect, it } from 'vitest'
import { DropSource, Enemy, getField, type Prov, Recipe, RecipeGroup } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { Iteminfo } from '../parse/iteminfo'
import { buildDrops, indexNpcs, parseNpcIdCell, unreadCellNotes } from './drops'
import { buildEnemies } from './enemies'
import { conditionMatchers, type ConditionsOverlay } from './overlays'
import { fnv1a32hex } from '../parse/text'
import { buildRecipes } from './recipes'

const NAMES: Record<number, string> = {
  9: 'Wood', 22: 'Iron Bar', 704: 'Lead Bar', 35: 'Iron Anvil', 716: 'Lead Anvil', 36: 'Work Bench', 48: 'Chest', 381: 'Cobalt Bar', 371: 'Cobalt Hat',
  1329: 'Tissue Sample', 3322: 'Treasure Bag (Queen Bee)', 1121: 'Bee Gun', 216: 'Shackle', 5134: 'Terraformer', 5011: 'Clentaminator', 699: 'Tin Ore', 701: 'Iron Ore',
  267: 'Voodoo Doll', 2: 'Dirt Block', 3: 'Stone Block', 61: 'Ebonstone Block', 836: 'Crimstone Block', 409: 'Pearlstone Block', 405: 'Spectre Boots',
  758: 'Grenade Launcher', 771: 'Rocket I',
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

  it('B3: "Iron Anvil" becomes the Iron-or-Lead station group; environments stay stations; B9: result notes become Recipe.conditions', () => {
    const out = recipes([
      recipeRow({ _rowid: '5', result: 'Cobalt Hat', resultid: '371', station: 'Iron Anvil', ings: '¦Cobalt Bar¦10' }),
      recipeRow({ _rowid: '6', result: 'Terraformer', resultid: '5134', station: 'Shimmer', resulttext: '#note_post_moon_lord', ings: '¦Clentaminator¦1' }),
    ])
    const [hat, terraformer] = out.recipes
    expect(hat.stations).toEqual([{ kind: 'group', groupId: 'iron-or-lead-anvil' }])
    expect(hat.conditions).toEqual([])
    expect(out.groups.find((g) => g.id === 'iron-or-lead-anvil')?.memberItemIds.sort()).toEqual([35, 716])
    expect(Recipe.parse(terraformer)).toMatchObject({ stations: [{ kind: 'environment', condition: 'shimmer', name: 'Shimmer' }], conditions: ['post-moon-lord'] })
    expect(out.ledger).toMatchObject({ availabilityNoteStations: 0, withConditions: 1 }) // B9 migrated
  })

  it('B9 keeps recipe ids stable: conditions hash exactly like the former condition stations', () => {
    // id computed before B9 from stations [shimmer, cond:post-moon-lord] (P2-S2a emitted dataset)
    const [terraformer] = recipes([recipeRow({ _rowid: '6', result: 'Terraformer', resultid: '5134', station: 'Shimmer', resulttext: '#note_post_moon_lord', ings: '¦Clentaminator¦1' })]).recipes
    const legacyCanonical = JSON.stringify({ s: ['cond:post-moon-lord', 'cond:shimmer'], i: ['i:5011*1'] })
    expect(terraformer.id).toBe(`5134-${fnv1a32hex(legacyCanonical)}`)
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

/** Boss registry by article (merge/bosses.ts bossAttribution): Queen Bee is a registry boss, Moon Lord is not in this test registry. */
const registry = { byPage: new Map([['Queen Bee', { id: 'queen-bee', npcIds: new Set([222]) }]]), authoredAt: '2026-10-13' }

function drops(rows: CargoRow[]) {
  return buildDrops({ rows, fetchedAt: '2026-10-13T02:46:00.000Z', npcs: indexNpcs(npcRows), npcsFetchedAt: '2026-10-13T02:47:00.000Z', iteminfo, conditions: matchers, bosses: registry })
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

  it('B12: boss and treasure-bag rows on a registry boss article get its bossId (curated source); flags gate difficulties', () => {
    const out = drops([
      dropRow({ _page: 'Queen Bee', nameraw: 'Queen Bee', id: '222', item: 'Bee Gun', rate: '33%', expert: '0', master: '0' }),
      dropRow({ _rowid: '2', _page: 'Queen Bee', nameraw: 'Treasure Bag (Queen Bee)', id: '222', item: 'Bee Gun', rate: '33%', isfromnpc: '0', normal: '0' }),
    ])
    const [boss, bag] = out.drops
    expect(DropSource.parse(boss)).toMatchObject({ rates: { classic: 0.33 }, source: { npcName: 'Queen Bee', npcIds: [222], bossId: 'queen-bee' } })
    expect(boss._prov).toMatchObject({ verified: true, unverifiedFields: [] })
    expect(boss._prov.sources).toContainEqual({ kind: 'curated', overlay: 'bosses', url: 'https://terraria.wiki.gg/wiki/Queen_Bee', fetchedAt: '2026-10-13' })
    expect(bag).toMatchObject({ rates: { expert: 0.33, master: 0.33 }, source: { npcName: 'Treasure Bag (Queen Bee)', treasureBag: true, bossId: 'queen-bee' } })
    expect(bag.source.npcIds).toBeUndefined()
    expect(out.ledger).toMatchObject({ bossLinkedRecords: 2, eventBossRecords: 0, bossMismatchRecords: 0 })
  })

  it('P5-S3 (B82): a condition from the article\'s drop-list caption joins the row\'s conditions (and its id), with the article revision as source; an ambiguous listing makes them Unknown', () => {
    const rows = [
      dropRow({ _page: 'Queen Bee', nameraw: 'Queen Bee', id: '222', item: 'Bee Gun', rate: '100%' }),
      dropRow({ _rowid: '2', _page: 'Queen Bee', nameraw: 'Treasure Bag (Queen Bee)', id: '222', item: 'Bee Gun', rate: '100%', isfromnpc: '0', normal: '0' }),
    ]
    const article = { url: 'https://terraria.wiki.gg/wiki/Queen_Bee', rev: 123, fetchedAt: '2026-10-14T00:00:00.000Z' }
    const plain = buildDrops({ rows, fetchedAt: '2026-10-13T02:46:00.000Z', npcs: indexNpcs(npcRows), npcsFetchedAt: '2026-10-13T02:47:00.000Z', iteminfo, conditions: matchers, bosses: registry })
    const captioned = buildDrops({
      rows,
      fetchedAt: '2026-10-13T02:46:00.000Z',
      npcs: indexNpcs(npcRows),
      npcsFetchedAt: '2026-10-13T02:47:00.000Z',
      iteminfo,
      conditions: matchers,
      bosses: registry,
      captions: new Map([['Queen Bee', { ...article, items: new Map([['Bee Gun', { conditions: ['corruption-world'] }]]) }]]),
    })
    expect(plain.drops.map((d) => d.conditions)).toEqual([[], []])
    for (const d of captioned.drops) {
      expect(d.conditions).toEqual(['corruption-world'])
      expect(d._prov.unverifiedFields).not.toContain('conditions')
      expect(d._prov.sources).toContainEqual({ kind: 'wiki-article', url: article.url, rev: 123, fetchedAt: '2026-10-14' })
    }
    // drop ids hash the conditions: the captioned records are distinct records
    expect(captioned.drops.map((d) => d.id).some((id) => plain.drops.some((p) => p.id === id))).toBe(false)
    expect(captioned.ledger.captionConditionRecords).toBe(2)
    // listed both under a caption and outside it on the article: conditions Unknown, never a guess
    const ambiguous = buildDrops({
      rows,
      fetchedAt: '2026-10-13T02:46:00.000Z',
      npcs: indexNpcs(npcRows),
      npcsFetchedAt: '2026-10-13T02:47:00.000Z',
      iteminfo,
      conditions: matchers,
      bosses: registry,
      captions: new Map([['Queen Bee', { ...article, items: new Map([['Bee Gun', { ambiguous: ['Only in Corrupt worlds', '(no caption)'] }]]) }]]),
    })
    for (const d of ambiguous.drops) {
      expect(d.conditions).toEqual([])
      expect(d._prov.unverifiedFields).toContain('conditions')
    }
    expect(ambiguous.ledger.captionConditionRecords).toBe(0)
  })

  it('B12: a boss-typed row on a non-registry article is an event boss (bossId not applicable); NPC ids foreign to the registry boss keep bossId Unknown + gap', () => {
    const out = drops([
      dropRow({ _page: 'Moon Lord', nameraw: 'Moon Lord', id: '', item: 'Shackle' }),
      // a Moon Lord NPC row listed on the Queen Bee article: NPC ids agree with Cargo NPCs, but not with the registry boss
      dropRow({ _rowid: '2', _page: 'Queen Bee', nameraw: 'Moon Lord', id: '396', item: 'Bee Gun' }),
    ])
    const event = out.drops.find((d) => d.itemId === 216)!
    expect(event.source.bossId).toBeUndefined()
    expect(event._prov.unverifiedFields).not.toContain('source.bossId')
    const mismatch = out.drops.find((d) => d.itemId === 1121)!
    expect(mismatch.source.bossId).toBeUndefined()
    expect(mismatch._prov.unverifiedFields).toContain('source.bossId')
    expect(out.ledger).toMatchObject({ bossLinkedRecords: 0, eventBossRecords: 1, bossMismatchRecords: 1 })
    expect(out.ledger.eventBossPages).toEqual(new Map([['Moon Lord', 1]]))
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'drop:cargo-row-2', field: 'source.bossId', kind: 'source-mismatch' }))
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

  it('AMENDMENTS-016 B139(a): a rate cell that is not a rate but carries notes keeps its conditions Unknown (never asserted empty); the Source link stands', () => {
    const seedRate = '<span class="chance">[[I am error#chest loot|More info]] <div class="note-text ">(In [[I am error]] worlds)</div></span>'
    const out = drops([
      // the 29 Cargo Drops rows 134056–134084 have exactly this shape (2026-10-13 sync)
      dropRow({ _rowid: '134056', _page: 'I am error', nameraw: 'Chest', id: '', name: '<span class=" eil"><span>[[Chest|Chest]]</span></span>', isfromnpc: '0', rate: seedRate }),
      // not a rate, but no notes: nothing went unread, so the parsed (empty) conditions stand
      dropRow({ _rowid: '2', item: 'Voodoo Doll', rate: 'More info' }),
      // the second value is not a rate: parsing stopped, so the first value's note was never applied either
      dropRow({ _rowid: '3', item: 'Tissue Sample', rate: '<span class="chance">2% <span class="note-text ">(Hardmode)</span><br/>More info</span>' }),
    ])
    const seed = DropSource.parse(out.drops.find((d) => d.source.npcName === 'Chest'))
    expect(seed.id).toBe('216-chest-741638a5') // the id still hashes the parsed conditions: unchanged by the ruling
    expect(seed.conditions).toEqual([])
    expect(seed.rates).toEqual({})
    expect(seed._prov.unverifiedFields).toEqual(['conditions', 'rates.classic', 'rates.expert', 'rates.master'])
    expect(getField(seed, 'conditions')).toEqual({ status: 'unverified' }) // renders "Conditions: Unknown"
    expect(seed._prov.sources[0]).toEqual({ kind: 'cargo:Drops', url: 'https://terraria.wiki.gg/wiki/I_am_error', fetchedAt: '2026-10-13' })
    const noNotes = out.drops.find((d) => d.itemId === 267)!
    expect(noNotes._prov.unverifiedFields).toEqual(['rates.classic', 'rates.expert', 'rates.master'])
    const laterFailure = out.drops.find((d) => d.itemId === 1329)!
    expect(laterFailure.conditions).toEqual([])
    expect(laterFailure._prov.unverifiedFields).toContain('conditions')
    expect(out.reasons.get('conditions: the rate cell is not a rate, so its notes were not read (B139)')).toEqual({
      count: 2,
      examples: ['I am error: Chest → Shackle (In I am error worlds)', 'Zombie: Zombie → Tissue Sample (Hardmode)'],
    })
    expect(out.gaps).toEqual([]) // the per-field gaps come from _prov (validate/report.ts), never duplicated here
  })

  describe('AMENDMENTS-016 B140/B141: the note-unmapped drop rows', () => {
    // the shipped registry's B140(a) entries (pipeline/overlays/conditions.json), on top of this file's fixture
    const entry = (id: string, note: string, kind: 'biome' | 'world-state' = 'biome') => ({ id, name: id, kind, wikiTitle: id, description: 'x', match: { dropNotes: [note] } })
    const b140 = conditionMatchers({
      ...overlay,
      entries: [
        ...overlay.entries,
        entry('underground', 'Underground'),
        entry('cavern', 'Cavern'),
        entry('lava-layer', '"lava layer"'),
        entry('bottom-250-tiles', 'within bottom 250 tiles of world'),
        entry('first-destruction', 'on first destruction', 'world-state'),
        entry('subsequent-destructions', 'all other destructions', 'world-state'),
      ],
    })
    const chest = { _page: 'Gold Chest', nameraw: 'Gold Chest', id: '', name: '[[Gold Chest]]', isfromnpc: '0' }
    const note = (text: string) => `<span class="note-text ">(${text})</span>`
    const chance = (v: string) => `<span class="chance" data-sort-value="1">${v}</span>`
    const build = (rows: CargoRow[]) => buildDrops({ rows, fetchedAt: '2026-10-13T02:46:00.000Z', npcs: indexNpcs(npcRows), npcsFetchedAt: '2026-10-13T02:47:00.000Z', iteminfo, conditions: b140, bosses: registry })
    const unknownConditions = (d: DropSource) => getField(d, 'conditions').status === 'unverified'

    it('(a) registered location / sequence notes become exact per-variant conditions (Gold Chest layers, lava layer, bottom 250 tiles, first / other destructions)', () => {
      const out = build([
        // Cargo rows 128239 (Mace), 128267 (Lava Charm), 128273 (Meteorite Bar), 123078 (Musket) have these shapes (2026-10-13 sync)
        dropRow({ ...chest, _rowid: '128239', item: 'Shackle', rate: `<span class="chance">${chance('1/6 (16.67%)')} ${note('Underground')}<br/>\n${chance('2/15 (13.33%)')} ${note('Cavern')}<br/>\n${chance('19/150 (12.67%)')} ${note('"lava layer"')}</span>` }),
        dropRow({ ...chest, _rowid: '128267', item: 'Voodoo Doll', rate: `<span class="chance">${chance('1/20 (5%)')} ${note('"lava layer"')}</span>` }),
        dropRow({ ...chest, _rowid: '128273', item: 'Iron Bar', quantity: '15-29', rate: `<span class="chance">${chance('1/4 (25%)')} ${note('within bottom 250 tiles of world')}</span>` }),
        dropRow({ _rowid: '123078', _page: 'Creeper', nameraw: 'Creeper', id: '267', item: 'Tissue Sample', rate: `100% ${note('on first destruction')}<br/>20% ${note('all other destructions')}` }),
      ])
      const of = (itemId: number) => out.drops.filter((d) => d.itemId === itemId).map((d) => [d.conditions, d.rates.classic, d._prov.unverifiedFields] as const)
      expect(of(216)).toEqual(expect.arrayContaining([
        [['underground'], 0.166666666667, []],
        [['cavern'], 0.133333333333, []],
        [['lava-layer'], 0.126666666667, []],
      ]))
      expect(of(216)).toHaveLength(3)
      expect(of(267)).toEqual([[['lava-layer'], 0.05, []]])
      expect(of(22)).toEqual([[['bottom-250-tiles'], 0.25, []]])
      expect(of(1329)).toEqual(expect.arrayContaining([[['first-destruction'], 1, []], [['subsequent-destructions'], 0.2, []]]))
      expect(out.ledger).toMatchObject({ emittedRows: 4, emittedRecords: 7, splitRows: 2, unreadNoteRecords: 0 })
      expect([...out.reasons.keys()].filter((r) => /note|B14/.test(r))).toEqual([])
    })

    it('(b) a parseable rate whose note maps to no registered condition (a seed world, a layer + seed combo, "regular worlds"): conditions Unknown, never []', () => {
      const out = build([
        dropRow({ ...chest, _rowid: '128286', item: 'Shackle', rate: `<span class="chance">${chance('1/4 (25%)')} ${note('Cavern, in [[Celebration Mk 10]] or [[Rainbow road]] worlds')}</span>` }),
        dropRow({ ...chest, _rowid: '133940', _page: 'Obsidian Lock Box', nameraw: 'Obsidian Lock Box', item: 'Voodoo Doll', rate: `1/5 (20%) ${note('In regular worlds')}` }),
        dropRow({ ...chest, _rowid: '134129', _page: 'Biome Chests', nameraw: 'Jungle Chest', item: 'Bee Gun', rate: `100% ${note('In Rainbow Road worlds')}` }),
      ])
      expect(out.drops).toHaveLength(3)
      for (const d of out.drops) {
        expect(d.conditions, d.id).toEqual([])
        expect(unknownConditions(d), d.id).toBe(true) // "Conditions: Unknown"
        expect(d._prov.unverifiedFields, d.id).toEqual(['conditions', 'rates.classic', 'rates.expert', 'rates.master'])
      }
      expect(out.reasons.get('conditions: a rate-cell note maps to no registered condition (B140(b): seed worlds stay unmapped)')).toEqual({
        count: 3,
        examples: [
          'Gold Chest: Gold Chest → Shackle (Cavern, in Celebration Mk 10 or Rainbow road worlds)',
          'Obsidian Lock Box: Obsidian Lock Box → Voodoo Doll (In regular worlds)',
          'Biome Chests: Jungle Chest → Bee Gun (In Rainbow Road worlds)',
        ],
      })
      expect(out.ledger.unreadNoteRecords).toBe(0)
    })

    it('(ii) a quantity cell with notes (amounts per location) leaves the quantity Unknown with its own reason; the plain rate stands', () => {
      const out = build([dropRow({ ...chest, _rowid: '128249', item: 'Iron Bar', quantity: `5–14 ${note('Underground')}<br/>\n3–10 ${note('Cavern')}`, rate: `<span class="chance">${chance('1/4 (25%)')}</span>` })])
      const [d] = out.drops
      expect(d).toMatchObject({ quantity: {}, rates: { classic: 0.25, expert: 0.25, master: 0.25 }, conditions: [] })
      expect(d._prov.unverifiedFields).toEqual(['quantity.classic', 'quantity.expert', 'quantity.master'])
      expect(out.reasons.get('quantity: the cell states amounts per location (notes), not one quantity (B141(ii))')).toEqual({ count: 1, examples: ['Gold Chest: Gold Chest → Iron Bar ("Underground / Cavern")'] })
      expect(out.reasons.has('quantity: not parseable')).toBe(false)
      expect(out.ledger.unreadNoteRecords).toBe(0)
    })

    it('(c) the sweep reads the raw cells independently: a stated field beside a note it never read is caught; Unknown fields and mapped notes pass', () => {
      const prov = (unverifiedFields: string[]): Prov => ({ gameVersion: '1.4.5.8', sources: [], verified: unverifiedFields.length === 0, unverifiedFields, editorialFields: [] })
      const rateRow = dropRow({ rate: `1/4 ${note('In Rainbow Road worlds')}` })
      const qtyRow = dropRow({ quantity: `5–14 ${note('Underground')}<br/>3–10 ${note('Cavern')}` })
      const mappedRow = dropRow({ rate: `1/6 ${note('Underground')}<br/>2/15 ${note('Cavern')}` })
      const stated = { conditions: [] as string[], quantity: { min: 1, max: 1 }, _prov: prov([]) }
      expect(unreadCellNotes(rateRow, stated, b140.dropNote)).toEqual(['rate-cell note(s) "In Rainbow Road worlds" beside conditions: []', 'rate-cell note "In Rainbow Road worlds" maps to no registered condition, yet conditions are stated'])
      expect(unreadCellNotes(rateRow, { ...stated, _prov: prov(['conditions']) }, b140.dropNote)).toEqual([])
      expect(unreadCellNotes(qtyRow, stated, b140.dropNote)).toEqual(['quantity-cell note(s) "Underground", "Cavern" beside a stated quantity'])
      expect(unreadCellNotes(qtyRow, { ...stated, quantity: {}, _prov: prov(['quantity.classic', 'quantity.expert', 'quantity.master']) }, b140.dropNote)).toEqual([])
      expect(unreadCellNotes(mappedRow, { ...stated, conditions: ['cavern'] }, b140.dropNote)).toEqual([])
      expect(unreadCellNotes(mappedRow, stated, b140.dropNote)).toEqual(['rate-cell note(s) "Underground", "Cavern" beside conditions: []'])
      // a note on a non-Desktop platform value is not the Desktop value's
      const oldGen = '<span class="eico s i3" title="Old-gen console and 3DS versions"><b></b><i></i><span>(Old-gen console and 3DS versions)</span></span>'
      const desktop = '<span class="eico s i0" title="Desktop, Console and Mobile versions"><b></b><i></i><span>(Desktop, Console and Mobile versions)</span></span>'
      expect(unreadCellNotes(dropRow({ rate: `1/4${desktop}<br/>1/2 ${note('In regular worlds')}${oldGen}` }), stated, b140.dropNote)).toEqual([])
    })
  })

  it('P5-S3 review: a bundled custom cell gives each row its OWN entry\'s quantity (Grenade Launcher 1, Rocket I 50–149); a companion without its own row is a gap, never merged', () => {
    const link = (name: string) => `<span class="i">[[File:${name}.png|link=${name}|${name}]]<span><span>[[${name}]]</span></span></span>`
    const custom = `${link('Grenade Launcher')}\n:+ ${link('Rocket I')} (50–149)`
    const bundled = { quantity: '', rate: '12.5%', custom }
    const out = drops([
      dropRow({ ...bundled, _rowid: '133017', item: 'Grenade Launcher' }),
      dropRow({ ...bundled, _rowid: '133018', item: 'Rocket I' }),
      // the same bundle from another source with no Rocket I row of its own
      dropRow({ ...bundled, _rowid: '133037', _page: 'Creeper', nameraw: 'Creeper', id: '267', item: 'Grenade Launcher' }),
    ])
    const of = (itemId: number, npcName: string) => out.drops.find((d) => d.itemId === itemId && d.source.npcName === npcName)
    expect(DropSource.parse(of(758, 'Zombie'))).toMatchObject({ quantity: { min: 1, max: 1 }, rates: { classic: 0.125, expert: 0.125, master: 0.125 } })
    expect(of(758, 'Zombie')?._prov.unverifiedFields).toEqual([])
    expect(DropSource.parse(of(771, 'Zombie'))).toMatchObject({ quantity: { min: 50, max: 149 }, rates: { classic: 0.125, expert: 0.125, master: 0.125 } })
    expect(of(758, 'Creeper')?.quantity).toEqual({ min: 1, max: 1 })
    expect(of(771, 'Creeper')).toBeUndefined() // not synthesized from the cell
    expect(out.ledger).toMatchObject({ bundledRows: 3, bundleCompanionsWithoutRow: 1, emittedRecords: 3 })
    expect(out.gaps).toEqual([expect.objectContaining({ ref: 'drop:cargo-row-133037', field: 'bundle', kind: 'count-reconciliation' })])
    expect(out.gaps[0].detail).toContain('"Rocket I" (50–149) with "Grenade Launcher"')
  })

  it('a bundled cell this grammar cannot read leaves the quantity Unknown (never the trailing amount)', () => {
    const link = (name: string) => `<span class="i">[[File:${name}.png|link=${name}|${name}]]<span><span>[[${name}]]</span></span></span>`
    const out = drops([dropRow({ quantity: '', custom: `${link('Grenade Launcher')}\nstray\n:+ ${link('Rocket I')} (50–149)`, item: 'Grenade Launcher' })])
    expect(out.drops[0].quantity).toEqual({})
    expect(out.drops[0]._prov.unverifiedFields).toEqual(['quantity.classic', 'quantity.expert', 'quantity.master'])
    expect([...out.reasons.keys()]).toContain('quantity: bundled custom cell — unexpected text "…" on a line of a bundled cell')
  })

  it('AMENDMENTS-016 B105 input: only a cell that states NO quantity is flagged unstated (never a stated-but-unparseable or bundled one)', () => {
    const link = (name: string) => `<span class="i">[[File:${name}.png|link=${name}|${name}]]<span><span>[[${name}]]</span></span></span>`
    const out = drops([
      dropRow({ quantity: '' }), // nothing stated
      dropRow({ _rowid: '2', _page: 'Creeper', nameraw: 'Creeper', id: '267', quantity: 'a few' }), // stated, unparseable
      dropRow({ _rowid: '3', quantity: '', custom: `${link('Grenade Launcher')}\nstray\n:+ ${link('Rocket I')} (50–149)`, item: 'Grenade Launcher' }), // bundle
    ])
    const unstated = out.drops.filter((d) => out.unstatedQuantity.has(d.id))
    expect(unstated.map((d) => [d.itemId, d.source.npcName])).toEqual([[216, 'Zombie']])
    expect(out.unstatedQuantity.get(unstated[0].id)).toBe(false)
    // drops.ts itself never defaults it: merge/quantity.ts rules per item kind
    expect(unstated[0].quantity).toEqual({})
    expect(unstated[0]._prov.unverifiedFields).toEqual(['quantity.classic', 'quantity.expert', 'quantity.master'])
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
