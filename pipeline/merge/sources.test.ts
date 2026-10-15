/* AMENDMENTS-014 B68 / AMENDMENTS-015 B78 acquisition sources (merge/sources.ts) and the NPC shop-table
 * parser (parse/shops.ts) on synthetic articles shaped like the 2026-10-14 sync. */
import { describe, expect, it } from 'vitest'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { Iteminfo } from '../parse/iteminfo'
import { normalizeAvailability, parseShopTables } from '../parse/shops'
import { itemRoutes } from './acquisition'
import { Evidence } from './evidence'
import { containerKey } from './gating'
import type { ConditionsOverlay, ContainersOverlay, GatherablesOverlay, VendorsOverlay } from './overlays'
import { buildAcquisitionSources, sameDesktopItem, vendorTags } from './sources'

const shopTable = (rows: [string, string][]) =>
  `<table class="terraria lined sortable"><caption>Inventory</caption><tbody><tr><th>Item</th><th data-sort-type="number">Cost</th><th>Availability<p class="mw-empty-elt"></p></th></tr>${rows
    .map(([item, avail]) => `<tr><td><span class="i"><a href="/wiki/${item}" title="${item}"><img alt="${item}" /></a><span><span><a href="/wiki/${item}" title="${item}">${item}</a></span></span></span></td><td><span class="coin">7</span></td><td>${avail}</td></tr>`)
    .join('')}</tbody></table>`
const article = (title: string, html: string): [string, Article] => [title, { title, resolvedTitle: title, revid: 300, html, fetchedAt: '2026-10-14T08:00:00.000Z' }]

const ITEMS = [
  { id: 9, name: 'Wood' },
  { id: 23, name: 'Gel' },
  { id: 97, name: 'Musket Ball' },
  { id: 95, name: 'Flintlock Pistol' },
  { id: 166, name: 'Bomb' },
  { id: 8, name: 'Torch' },
  { id: 98, name: 'Minishark' },
  { id: 22, name: 'Iron Bar' },
  { id: 281, name: 'Blowpipe' },
  { id: 62, name: 'Seed' },
  { id: 5577, name: 'Pretty Mirror' },
]
const info: Iteminfo = {
  rev: 1,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-14T00:00:00.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(ITEMS.map((i) => [i.id, { id: i.id, internalName: i.name.replaceAll(' ', ''), name: i.name, stats: {} }])),
  idsByName: new Map(ITEMS.map((i) => [i.name, [i.id]])),
  wikiIdFromName: new Map(),
}
const row = (itemid: string, name: string, tag: string): CargoRow => ({ _rowid: itemid, _page: name, itemid, name, internalname: name.replaceAll(' ', ''), tag })
const ROWS: CargoRow[] = [
  row('97', 'Musket Ball', 'buyable^vendor:Arms Dealer'),
  row('8', 'Torch', 'vendor:Merchant'),
  row('98', 'Minishark', 'vendor:Arms Dealer^vendor:seed:Merchant'),
  row('166', 'Bomb', 'vendor:Demolitionist^vendor:Traveling Merchant'),
  row('5577', 'Pretty Mirror', 'vendor:Clothier'),
  row('999', 'Not An Item', 'vendor:Merchant'),
]
const ARTICLES = new Map<string, Article>([
  article('Merchant', `<p>All players in the current world have more than 50 Silver total between them in their inventories.</p>${shopTable([['Torch', 'Always available.'], ['Flare', 'During night .']])}`),
  article('Arms Dealer', `<p>The player has at least one bullet or bullet-firing gun in their inventory.</p><p>At least one of these must be in the player's inventory for the Arms Dealer to spawn. Flintlock Pistol Musket Ball</p>${shopTable([['Musket Ball', 'Always available.'], ['Minishark', 'In <a href="/wiki/Hardmode">Hardmode</a> .']])}`),
  article('Demolitionist', `<p>The player has an explosive in their inventory.</p>${shopTable([['Bomb', 'When the player has a Bomb in their inventory.']])}`),
  article('Traveling Merchant', `<p>His inventory is randomized and different every visit, selling items.</p>${shopTable([['Bomb', '']])}`),
  article('Clothier', `<p>Skeletron has been defeated.</p>${shopTable([['Pretty Mirror', 'Always available.']])}`),
  article('Chests', '<p>Ordinary Chests that occur naturally on the Surface contain various loot. Iron Bar(in worlds with Iron)</p>'),
  article('Seed', "<p>While a Blowpipe or Blowgun is in a player's inventory, grass drops Seeds.</p>"),
  article('Gel', '<p>Gel is a common crafting material dropped by most slimes.</p>'),
  article('Evil biomes', '<p>Corruption or Crimson is saved as the world\'s naturally generated evil biome.</p>'),
])
const vendors = (over: Partial<VendorsOverlay> = {}): VendorsOverlay => ({
  overlay: 'vendors',
  authoredAt: '2026-10-14',
  notes: [],
  npcs: [
    { npc: 'Merchant', page: 'Merchant', conditions: [], evidence: [{ page: 'Merchant', quote: 'All players in the current world have more than 50 Silver total' }], why: 'no gate' },
    {
      npc: 'Arms Dealer',
      page: 'Arms Dealer',
      conditions: [],
      evidence: [{ page: 'Arms Dealer', quote: 'The player has at least one bullet or bullet-firing gun' }],
      requiresAnyOf: { quote: "At least one of these must be in the player's inventory", items: ['Flintlock Pistol', 'Musket Ball'] },
      requiresNpcs: { quote: 'The player has at least one bullet', npcs: ['Merchant'] },
      why: 'list',
    },
    { npc: 'Demolitionist', page: 'Demolitionist', conditions: [], evidence: [{ page: 'Demolitionist', quote: 'The player has an explosive in their inventory' }], why: 'x' },
    { npc: 'Clothier', page: 'Clothier', conditions: ['post-skeletron'], evidence: [{ page: 'Clothier', quote: 'Skeletron has been defeated.' }], why: 'x' },
  ],
  unavailable: [{ npc: 'Traveling Merchant', aliases: ['Travelling Merchant'], page: 'Traveling Merchant', reason: 'random stock', quote: 'His inventory is randomized and different every visit' }],
  availability: [
    { text: 'Always available.', conditions: [] },
    { text: 'In Hardmode.', conditions: ['hardmode'] },
  ],
  ...over,
})
const containers: ContainersOverlay = {
  overlay: 'containers',
  authoredAt: '2026-10-14',
  notes: [],
  worldSpecificLoot: [{ item: 'Iron Bar', conditions: ['iron-ore-world'], page: 'Chests', quote: 'Iron Bar(in worlds with Iron)' }],
  entries: [{ container: 'Chest', page: 'Chests', conditions: [], evidence: [{ page: 'Chests', quote: 'Ordinary Chests that occur naturally on the Surface' }], why: 'x' }],
}
const gatherables = (over: Partial<GatherablesOverlay> = {}): GatherablesOverlay => ({
  overlay: 'gatherables',
  authoredAt: '2026-10-14',
  notes: [],
  entries: [
    { item: 'Gel', page: 'Gel', quote: 'Gel is a common crafting material dropped by most slimes.', conditions: [], why: 'x' },
    { item: 'Seed', page: 'Seed', quote: "While a Blowpipe or Blowgun is in a player's inventory", requiresAnyOf: ['Blowpipe'], conditions: [], why: 'x' },
  ],
  ...over,
})
const conditions: ConditionsOverlay = {
  overlay: 'conditions',
  authoredAt: '2026-10-14',
  notes: [],
  entries: ['hardmode', 'post-skeletron', 'iron-ore-world', 'corruption-world', 'crimson-world'].map((id) => ({ id, name: id, kind: 'world-state' as const, wikiTitle: id, description: id })),
  exhaustive: [{ conditions: ['corruption-world', 'crimson-world'], page: 'Evil biomes', quote: "Corruption or Crimson is saved as the world's naturally generated evil biome", why: 'x' }],
}
const build = (over: { vendors?: VendorsOverlay; gatherables?: GatherablesOverlay } = {}) =>
  buildAcquisitionSources({
    itemRows: ROWS,
    iteminfo: info,
    articles: ARTICLES,
    evidence: new Evidence(ARTICLES),
    vendors: over.vendors ?? vendors(),
    containers,
    gatherables: over.gatherables ?? gatherables(),
    conditions,
    withheld: new Map([[5577, { field: 'acquisition', detail: 'conflict', cargoTag: 'vendor:Clothier', sources: [] }]]),
  })

describe('parse/shops: NPC "Item · Cost · Availability" tables', () => {
  it('reads each row\'s item display name and its availability text, link spacing normalized', () => {
    expect(parseShopTables(shopTable([['Musket Ball', 'Always available.'], ['Minishark', 'In <a href="/wiki/Hardmode">Hardmode</a> .']]))).toEqual([
      { item: 'Musket Ball', availability: 'Always available.' },
      { item: 'Minishark', availability: 'In Hardmode.' },
    ])
    expect(parseShopTables('<table class="terraria"><tr><th>Item</th><th>Price</th></tr><tr><td>X</td><td>1</td></tr></table>')).toEqual([])
    expect(normalizeAvailability('During a full moon :‌')).toBe('During a full moon:')
  })
})

describe('merge/sources: reviewed vendor / container / gatherable sources', () => {
  it('vendor tags (seed vendors excluded) and the same-desktop-item rule', () => {
    expect(vendorTags(ROWS[2])).toEqual(['Arms Dealer'])
    expect(sameDesktopItem(ROWS[0], info)?.id).toBe(97)
    expect(sameDesktopItem(ROWS[5], info)).toBeUndefined()
  })

  it('a purchase route derives from the NPC availability + a reviewed shop row; otherwise it is an explicit unknown route', () => {
    const s = build()
    expect(s.vendorRoute(97, 'Musket Ball', 'Arms Dealer')).toEqual({ ok: true, npc: 'Arms Dealer', conditions: [] })
    expect(s.vendorRoute(98, 'Minishark', 'Arms Dealer')).toEqual({ ok: true, npc: 'Arms Dealer', conditions: ['hardmode'] })
    expect(s.vendorRoute(166, 'Bomb', 'Demolitionist')).toMatchObject({ ok: false, blocker: 'vendor-conditions-unknown' }) // unmapped "has a Bomb" row
    expect(s.vendorRoute(166, 'Bomb', 'Travelling Merchant')).toMatchObject({ ok: false, npc: 'Traveling Merchant', blocker: 'vendor-availability-unknown' })
    expect(s.vendorRoute(8, 'Wood', 'Merchant')).toMatchObject({ ok: false, blocker: 'vendor-conditions-unknown', why: expect.stringContaining('does not list') })
    expect(s.extraRoutes.get(97)).toEqual([{ kind: 'purchase', conditions: [], requiresNpcs: ['Arms Dealer'] }])
    expect(s.extraRoutes.get(98)).toEqual([{ kind: 'purchase', conditions: ['hardmode'], requiresNpcs: ['Arms Dealer'] }])
    expect(s.extraRoutes.get(166)).toEqual([{ kind: 'unknown', blocker: 'vendor-availability-unknown' }, { kind: 'unknown', blocker: 'vendor-conditions-unknown' }])
    expect(s.extraRoutes.get(5577)).toEqual([{ kind: 'unknown', blocker: 'acquisition-withheld' }]) // B19 withheld
    expect(s.npcs.get('Arms Dealer')).toEqual({ conditions: [], requiresAnyOf: [[95, 97]], requiresNpcs: ['Merchant'] })
    expect(s.npcs.get('Clothier')).toEqual({ conditions: ['post-skeletron'] })
  })

  it('containers by name + article, world-specific loot, exhaustive groups, gatherables (with a "one of these items" requirement)', () => {
    const s = build()
    expect(s.containers.get(containerKey('Chest', 'https://terraria.wiki.gg/wiki/Chests'))).toEqual({ conditions: [] })
    expect(s.containerItemConditions.get(22)).toEqual(['iron-ore-world'])
    expect(s.exhaustive).toEqual([['corruption-world', 'crimson-world']])
    expect(s.extraRoutes.get(23)).toEqual([{ kind: 'gather', conditions: [] }])
    expect(s.extraRoutes.get(62)).toEqual([{ kind: 'gather', conditions: [], requiresAnyOf: [[281]] }])
    expect(s.gather.get(23)).toEqual({ description: 'Gel is a common crafting material dropped by most slimes.', sourceUrl: 'https://terraria.wiki.gg/wiki/Gel', conditions: [] })
  })

  it('never assumed: an unreviewed vendor, a stale availability mapping, a quote not on its page or an unknown condition fail the build', () => {
    expect(() => buildAcquisitionSources({ itemRows: [row('8', 'Torch', 'vendor:Painter')], iteminfo: info, articles: ARTICLES, evidence: new Evidence(ARTICLES), vendors: vendors(), containers, gatherables: gatherables(), conditions })).toThrow(/does not review/)
    expect(() => build({ vendors: vendors({ availability: [...vendors().availability, { text: 'During a Party.', conditions: [] }] }) })).toThrow(/stale mapping/)
    expect(() => build({ gatherables: gatherables({ entries: [{ item: 'Gel', page: 'Gel', quote: 'Gel grows on trees everywhere.', conditions: [], why: 'x' }] }) })).toThrow(/quote not found verbatim/)
    expect(() => build({ gatherables: gatherables({ entries: [{ item: 'Gel', page: 'Gel', quote: 'Gel is a common crafting material dropped by most slimes.', conditions: ['blood-moon'], why: 'x' }] }) })).toThrow(/not in overlays\/conditions.json/)
  })
})

describe('itemRoutes with acquisition sources (purchase conditions, gatherable route)', () => {
  const run = (rowOver: Partial<CargoRow>, id: number, name: string) => {
    const unknown: string[] = []
    const r = itemRoutes({
      id,
      name,
      noun: 'item',
      row: { _rowid: '1', _page: name, itemid: String(id), name, tag: '', listcat: '', buy: '', ...rowOver },
      wikiUrl: `https://terraria.wiki.gg/wiki/${name.replaceAll(' ', '_')}`,
      recipesBy: new Map(),
      dropsBy: new Map(),
      gating: () => ({ ok: true, gatedBy: { bosses: ['skeletron'], conditions: [], stage: 'late-prehm' } }),
      unknown: (f) => unknown.push(f),
      mismatch: () => undefined,
      gaps: { add: () => undefined },
      reasons: new Map(),
      sources: build(),
    })
    return { ...r, unknown }
  }

  it('a derivable vendor route carries its conditions (NPC ∪ shop row) and the deriver\'s gating stands; an underivable one lists them Unknown', () => {
    const mini = run({ tag: 'vendor:Arms Dealer' }, 98, 'Minishark')
    expect(mini.acquisition).toEqual([{ method: 'purchase', npcName: 'Arms Dealer', conditions: ['hardmode'] }])
    expect(mini.unknown).toEqual(['acquisition.0.priceCopper'])
    // with sources the deriver already weighed every vendor route: no P2-S2 post-adjustment of a gated result
    expect(mini.gating).toEqual({ ok: true, gatedBy: { bosses: ['skeletron'], conditions: [], stage: 'late-prehm' } })
    const bomb = run({ tag: 'vendor:Traveling Merchant' }, 166, 'Bomb')
    expect(bomb.acquisition).toEqual([{ method: 'purchase', npcName: 'Traveling Merchant', conditions: [] }])
    expect(bomb.unknown).toEqual(['acquisition.0.conditions', 'acquisition.0.priceCopper'])
  })

  it('a gatherable item gets an "other" route quoting its evidence', () => {
    expect(run({}, 23, 'Gel').acquisition).toEqual([{ method: 'other', description: 'Gel is a common crafting material dropped by most slimes.', sourceUrl: 'https://terraria.wiki.gg/wiki/Gel', conditions: [] }])
  })
})
