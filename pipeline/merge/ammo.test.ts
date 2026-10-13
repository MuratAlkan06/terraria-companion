/* Ammo merge (P2-S7) on synthetic Cargo Items rows + Iteminfo / Projectileinfo stats + article infoboxes
 * shaped like the 2026-10-13 sync (pipeline/merge/ammo.ts states every rule). */
import { describe, expect, it } from 'vitest'
import { Item } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import type { Iteminfo } from '../parse/iteminfo'
import type { Projectileinfo } from '../parse/projectileinfo'
import { buildAmmo, identifyAmmo, multiplierOf } from './ammo'
import type { GatingResult } from './gating'

const DEFAULTS = { damage: -1, knockBack: 0, shootSpeed: 0, shoot: 0, ammo: 0, rare: 0, value: 0, maxStack: 9999, consumable: false, buffType: 0, buffTime: 0 }
const ITEMS: { id: number; name: string; stats: Record<string, unknown> }[] = [
  { id: 9, name: 'Wood', stats: {} },
  { id: 23, name: 'Gel', stats: { ammo: 23, consumable: true } },
  { id: 40, name: 'Wooden Arrow', stats: { ammo: 40, damage: 5, knockBack: 2, shootSpeed: 3, shoot: 1, consumable: true } },
  { id: 97, name: 'Musket Ball', stats: { ammo: 97, damage: 7, knockBack: 2, shootSpeed: 4, shoot: 14, value: 7, consumable: true } },
  { id: 353, name: 'Ale', stats: { ammo: 353, consumable: true, buffType: 25, buffTime: 7200 } },
  { id: 771, name: 'Rocket I', stats: { ammo: 771, damage: 40, knockBack: 4, consumable: true } },
  { id: 772, name: 'Rocket II', stats: { ammo: 771, damage: 40, knockBack: 4, shoot: 3, rare: 1, consumable: true } },
  { id: 949, name: 'Snowball', stats: { ammo: 949, damage: 8, knockBack: 5.75, shootSpeed: 7, shoot: 166, consumable: true } },
  { id: 1302, name: 'High Velocity Bullet', stats: { ammo: 97, damage: 11, knockBack: 4, shootSpeed: 4, shoot: 242, rare: 3, consumable: true } },
  { id: 1350, name: 'Nano Bullet', stats: { ammo: 97, damage: 10, knockBack: 3.6, shootSpeed: 4.6, shoot: 285, rare: 3, consumable: true } },
  { id: 3103, name: 'Endless Quiver', stats: { ammo: 40, damage: 5, knockBack: 2, shootSpeed: 3, shoot: 1, rare: 2 } },
]
const info: Iteminfo = {
  rev: 1023241,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-13T02:44:40.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(ITEMS.map((i) => [i.id, { id: i.id, internalName: i.name.replaceAll(' ', ''), name: i.name, stats: { ...DEFAULTS, ...i.stats } }])),
  idsByName: new Map(ITEMS.map((i) => [i.name, [i.id]])),
  wikiIdFromName: new Map(),
}
const proj: Projectileinfo = {
  title: 'Module:Projectileinfo/data',
  rev: 1030091,
  fetchedAt: '2026-10-13T08:38:00.000Z',
  generated: '2026-09-13 15:45 (+00:00)',
  projectiles: new Map(
    [
      [1, 0],
      [14, 1],
      [166, 0],
      [242, 7],
      [285, 2],
    ].map(([id, xu]) => [id, { id, stats: { extraUpdates: xu } }]),
  ),
}

const row = (over: Record<string, string>): CargoRow => ({ _rowid: '1', _page: over.name ?? '', itemid: '', name: '', internalname: '', imagefile: '', type: 'ammunition', listcat: '', tag: '', damage: '', knockback: '', velocity: '', rare: '0', consumable: '1', buffs: '', debuffs: '', unobtainable: '', buy: '', ...over })
const ROWS: CargoRow[] = [
  row({ _rowid: '1', itemid: '23', name: 'Gel', type: 'ammunition^crafting material' }),
  row({ _rowid: '2', itemid: '97', name: 'Musket Ball', damage: '7', knockback: '2', velocity: '4', imagefile: 'Musket Ball.png', tag: 'buyable^vendor:Arms Dealer' }),
  row({ _rowid: '3', itemid: '353', name: 'Ale', debuffs: 'Tipsy', type: 'potion^ammunition' }),
  row({ _rowid: '4', itemid: '771', name: 'Rocket I', _page: 'Rockets', damage: '40', knockback: '4' }),
  row({ _rowid: '5', itemid: '772', name: 'Rocket II', _page: 'Rockets', damage: '40', knockback: '4', rare: '1' }),
  row({ _rowid: '6', itemid: '949', name: 'Snowball', type: 'weapon^ammunition', damage: '8', knockback: '5.75', velocity: '7' }),
  row({ _rowid: '7', itemid: '1302', name: 'High Velocity Bullet', damage: '11', knockback: '4', velocity: '4', rare: '3', listcat: 'bullets^craftable items' }),
  row({ _rowid: '8', itemid: '1350', name: 'Nano Bullet', damage: '10', knockback: '3.6', velocity: '4.6', rare: '3' }),
  row({ _rowid: '9', itemid: '3103', name: 'Endless Quiver', damage: '5', knockback: '2', velocity: '3', rare: '2', consumable: '' }),
  row({ _rowid: '10', itemid: '', name: 'Mobile Arrow' }),
  row({ _rowid: '11', itemid: '9', name: 'Wood' }),
]

const ids = (kind: string, v: string) => `<li>Internal <a href="/wiki/${kind}_IDs">${kind} ID</a>:&#32;<b>${v}</b></li>`
const box = (title: string, rows: [string, string][], itemId: number, projId?: number) =>
  `<div class="infobox item"><div class="title">${title}</div><table class="stat"><tbody>${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</tbody></table><div class="section ids"><ul>${ids('Item', String(itemId))}${projId ? ids('Projectile', String(projId)) : ''}</ul></div></div>`
const mult = (n: string): [string, string] => ['<a href="/wiki/Velocity#extraUpdates">Velocity Multiplier</a>', n]
const article = (title: string, html: string): [string, Article] => [title, { title, resolvedTitle: title, revid: 100, html, fetchedAt: '2026-10-13T08:00:00.000Z' }]
const ARTICLES = new Map<string, Article>([
  article('Gel', box('Gel', [], 23)),
  article('Musket Ball', box('Musket Ball', [mult('2×')], 97, 14)),
  article('Ale', box('Ale', [], 353)),
  article('Rockets', '<table><tr><td>Rocket I Internal Item ID : 771</td></tr></table>'),
  article('Snowball', box('Snowball', [], 949, 166)),
  article('High Velocity Bullet', box('High Velocity Bullet', [mult('8×')], 1302, 242)),
  article('Nano Bullet', box('Nano Bullet', [mult('4×')], 1350, 285)),
  article('Endless Quiver', box('Endless Quiver', [], 3103, 1)),
])
const tree: CategoryTree = {
  roots: ['Category:Ammunition items'],
  categories: new Map([
    ['Category:Ammunition items', { pages: ['Gel'], subcats: ['Category:Bullets'] }],
    ['Category:Bullets', { pages: ['High Velocity Bullet', 'Musket Ball'], subcats: [] }],
  ]),
  pages: ['Gel', 'High Velocity Bullet', 'Musket Ball'],
  fetchedAt: '2026-10-13T08:00:00.000Z',
}
const NOT_DERIVABLE: GatingResult = { ok: false, blockers: ['no-known-route'] }

function build() {
  return buildAmmo({
    itemRows: ROWS,
    itemsFetchedAt: '2026-10-13T02:50:00.000Z',
    iteminfo: info,
    projectileinfo: proj,
    articles: ARTICLES,
    categories: tree,
    images: { found: new Map([['Musket Ball.png', { file: 'Musket Ball.png', title: 'File:Musket Ball.png', url: 'https://terraria.wiki.gg/images/Musket_Ball.png', descriptionUrl: 'https://terraria.wiki.gg/wiki/File:Musket_Ball.png', sha1: 'a'.repeat(40), bytes: 200, width: 12, height: 12, mime: 'image/png' }]]), missing: [], fetchedAt: '2026-10-13T08:00:00.000Z' },
    recipes: [{ id: '1302-abc', resultItemId: 1302 }],
    drops: [{ id: '23-blue-slime-x', itemId: 23 }],
    gating: (id) => (id === 1302 ? { ok: true, gatedBy: { bosses: ['wall-of-flesh'], conditions: [], stage: 'early-hm' } } : NOT_DERIVABLE),
    weaponIds: new Set([949]),
    usedSlugs: new Set(['gel']),
    stationIds: new Set(),
    buffTable: [{ id: 25, name: 'Tipsy', internalName: 'Tipsy', isDebuff: true, article: 'Tipsy' }],
    buffSlug: (name) => (name === 'Tipsy' ? 'tipsy' : undefined),
  })
}

describe('ammo identification', () => {
  it('Cargo "ammunition" rows that are the same Iteminfo item with a non-zero AmmoID; the rest excluded with a reason', () => {
    const idn = identifyAmmo(ROWS, info)
    expect(idn.included.map((c) => c.item.id)).toEqual([23, 97, 353, 771, 772, 949, 1302, 1350, 3103])
    expect(idn.excluded.map((e) => [e.row.name, e.kind])).toEqual([['Mobile Arrow', 'count-reconciliation'], ['Wood', 'source-mismatch']])
    expect(idn.iteminfoOnly.map((i) => i.id)).toEqual([40]) // Iteminfo ammo without a Cargo ammunition row (reconciliation)
  })
})

describe('buildAmmo', () => {
  const out = build()
  const item = (id: number) => out.items.find((i) => i.id === id)!

  it('emits schema-valid ammo items; the weapon that is also ammo (Snowball) goes to weaponAmmo, not items', () => {
    for (const i of out.items) expect(Item.parse(i)).toEqual(i)
    expect(out.items.map((i) => i.id)).toEqual([23, 97, 353, 771, 772, 1302, 1350, 3103])
    expect(out.weaponAmmo.get(949)).toMatchObject({ ammoStats: { ammoClass: 'snowball', damage: 8, velocityBonusTps: 26.25, knockback: 5.75 }, unverified: [], crossCheckFailed: false })
  })

  it('stats from Iteminfo, cross-checked with Cargo: velocityBonusTps = shootSpeed × 3.75; B2 multiplier from the own infobox', () => {
    expect(item(97)).toMatchObject({ category: 'ammo', consumable: true, maxStack: 9999, valueCopper: 7, tags: ['bullets'], sprite: '/sprites/items/97.png' })
    expect(item(97).ammoStats).toEqual({ ammoClass: 'musket-ball', damage: 7, velocityBonusTps: 15, velocityMultiplier: 2, knockback: 2 })
    expect(item(1302).ammoStats?.velocityMultiplier).toBe(8)
    expect(item(1302)).toMatchObject({ stage: 'early-hm', gatedBy: { bosses: ['wall-of-flesh'] }, acquisition: [{ method: 'craft', recipeIds: ['1302-abc'] }] })
    expect(out.multiplier.get(97)).toBe('2× (own infobox; Projectileinfo projectile 14 extraUpdates 1)')
  })

  it('multiplier: infobox vs 1 + extraUpdates disagreement withholds it; no own infobox → Unknown; shoot 0 / infobox states none → not applicable', () => {
    expect(item(1350).ammoStats?.velocityMultiplier).toBeUndefined()
    expect(item(1350)._prov.unverifiedFields).toContain('ammoStats.velocityMultiplier')
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'i:1350', field: 'ammoStats.velocityMultiplier', kind: 'source-mismatch' }))
    expect(item(772)._prov.unverifiedFields).toContain('ammoStats.velocityMultiplier') // Rockets list article, shoot = type index 3
    expect(item(771)._prov.unverifiedFields).not.toContain('ammoStats.velocityMultiplier') // shoot 0
    expect(item(3103)._prov.unverifiedFields).not.toContain('ammoStats.velocityMultiplier') // own infobox none, extraUpdates 0
    expect(out.crossCheck.get('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)')).toEqual({ agree: 4, mismatch: 1, noWikiValue: 0 })
  })

  it('no damage of its own (Gel, Ale): damage / knockback / velocity bonus Unknown, never 0; slugs stay unique across the item ID space', () => {
    expect(item(23).ammoStats).toEqual({ ammoClass: 'gel' })
    expect(item(23)._prov.unverifiedFields).toEqual(expect.arrayContaining(['ammoStats.damage', 'ammoStats.knockback', 'ammoStats.velocityBonusTps']))
    expect(item(23).slug).toBe('gel-23')
  })

  it('buffGrants from Iteminfo buffType/buffTime when the wiki infobox names the same buff (Ale → Tipsy 2 min); maxStack only for consumables', () => {
    expect(item(353).buffGrants).toEqual([{ buffId: 'tipsy', durationTicks: 7200 }])
    expect(item(3103)).toMatchObject({ consumable: false })
    expect(item(3103).maxStack).toBeUndefined()
  })

  it('every unsprited item is a missing-sprite gap; Unknown acquisition is listed', () => {
    expect(out.gaps.filter((g) => g.kind === 'missing-sprite').map((g) => g.ref)).toEqual(['i:23', 'i:353', 'i:771', 'i:772', 'i:1302', 'i:1350', 'i:3103'])
    expect(item(3103)._prov.unverifiedFields).toContain('acquisition')
  })

  it('multiplierOf reads the infobox factor cell', () => {
    expect([multiplierOf('2×'), multiplierOf(' 8× '), multiplierOf('2x'), multiplierOf('fast')]).toEqual([2, 8, 2, undefined])
  })
})
