/* Weapons merge (P2-S2) on synthetic Cargo Items rows + Iteminfo stats shaped like the 2026-10-13 sync. */
import { describe, expect, it } from 'vitest'
import { SearchDoc, Weapon } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import type { ImageInfoFetch } from '../fetch/images'
import type { Iteminfo } from '../parse/iteminfo'
import type { GatingResult } from './gating'
import { reconcileCategories, reconcileWeaponLists } from './reconcile'
import { buildSearchDocs } from './search'
import { ammoClassSlug, buildWeapons, cargoRarity, coinPrice, identifyWeapons, leadingNumber, rarityOf, tooltipText, type WithheldField } from './weapons'

const DEFAULTS = { damage: -1, crit: 0, useTime: 100, useAnimation: 100, knockBack: 0, autoReuse: false, mana: 0, useAmmo: 0, shootSpeed: 0, rare: 0, value: 0, ammo: 0, maxStack: 9999, consumable: false, melee: false, ranged: false, magic: false, summon: false, pick: 0, axe: 0, hammer: 0, headSlot: -1, bodySlot: -1, legSlot: -1, accessory: false }
const ITEMS: { id: number; name?: string; internalName: string; stats: Record<string, unknown> }[] = [
  { id: 4956, name: 'Zenith', internalName: 'Zenith', stats: { damage: 190, crit: 10, useTime: 10, useAnimation: 30, knockBack: 6.5, autoReuse: true, shootSpeed: 16, rare: 10, value: 1000000, melee: true } },
  { id: 98, name: 'Minishark', internalName: 'Minishark', stats: { damage: 6, useTime: 8, useAnimation: 8, autoReuse: true, useAmmo: 97, shootSpeed: 7, rare: 2, value: 350000, ranged: true } },
  { id: 97, name: 'Musket Ball', internalName: 'MusketBall', stats: { damage: 7, ammo: 97, ranged: true } },
  { id: 5005, name: 'Terraprisma', internalName: 'EmpressBlade', stats: { damage: 90, useTime: 36, useAnimation: 36, knockBack: 4, autoReuse: true, shootSpeed: 10, rare: 5, summon: true } },
  { id: 166, name: 'Bomb', internalName: 'Bomb', stats: { damage: 0, useTime: 25, useAnimation: 25, shootSpeed: 5, consumable: true, maxStack: 9999 } },
  { id: 112, name: 'Flower of Fire', internalName: 'FlowerofFire', stats: { damage: 48, useTime: 20, useAnimation: 20, knockBack: 5.5, mana: 9, rare: 3, magic: true } },
  { id: 4722, internalName: 'FirstFractal', stats: { damage: 190, crit: 10, useTime: 7, useAnimation: 35, knockBack: 6.5, autoReuse: true, rare: 10, melee: true } },
  { id: 5079, name: 'Prince Pants', internalName: 'PrincePants', stats: { legSlot: 3 } },
  { id: 213, name: 'Staff of Regrowth', internalName: 'StaffofRegrowth', stats: { damage: 7, magic: true } },
]
const info: Iteminfo = {
  rev: 1023241,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-13T02:44:40.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(ITEMS.map((i) => [i.id, { id: i.id, internalName: i.internalName, ...(i.name ? { name: i.name } : {}), stats: { ...DEFAULTS, ...i.stats } }])),
  idsByName: new Map(ITEMS.flatMap((i) => (i.name ? [[i.name, [i.id]] as [string, number[]]] : []))),
  wikiIdFromName: new Map(),
}

const coin = (copper: number) => `<span class="coin" data-sort-value="${copper}" title="x"><span class="gc">x</span></span>`
const row = (over: Record<string, string>): CargoRow => ({
  _rowid: '1', _page: over.name ?? '', itemid: '', name: '', internalname: '', imagefile: `${over.name}.png`, type: 'weapon', listcat: '', tag: '', damage: '', damagetype: '', critical: '',
  knockback: '', usetime: '', autoswing: '', mana: '', rare: '', velocity: '', tooltip: '', buy: '', unobtainable: '', ...over,
})
const ROWS: CargoRow[] = [
  row({ _rowid: '10', itemid: '4956', name: 'Zenith', internalname: 'Zenith', damage: '190', damagetype: 'Melee', critical: '14', knockback: '6.5', usetime: '30', autoswing: '1', rare: '10', velocity: '32', listcat: 'craftable items' }),
  row({ _rowid: '11', itemid: '98', name: 'Minishark', internalname: 'Minishark', damage: '6', damagetype: 'Ranged', critical: '4', knockback: '0', usetime: '8 <span class=usetime>(Insanely fast)</span>', autoswing: '1', rare: '2', tag: 'vendor^vendor:Arms Dealer', buy: coin(350000), tooltip: '<span class="gameText">33% chance to save ammo<br/>\'Half shark, half gun, completely awesome.\'</span>' }),
  row({ _rowid: '12', itemid: '5005', name: 'Terraprisma', internalname: 'EmpressBlade', damage: '90', damagetype: 'Summon', knockback: '4', usetime: '36', autoswing: '1', rare: '5', tag: 'drop^minion' }),
  row({ _rowid: '13', itemid: '166', name: 'Bomb', internalname: 'Bomb', damage: '100', knockback: '8', usetime: '25', rare: '1', tag: 'Loot^vendor:Demolitionist^vendor:Skeleton Merchant', buy: coin(300) }),
  row({ _rowid: '14', itemid: '112', name: 'Flower of Fire', internalname: 'FlowerofFire', damage: '48', damagetype: 'Magic', critical: '4', knockback: '5.5', usetime: '20', mana: '12', rare: '3' }),
  row({ _rowid: '15', itemid: '4722', name: 'First Fractal', internalname: 'FirstFractal', damage: '190', damagetype: 'Melee', critical: '14', knockback: '6.5', usetime: '35', autoswing: '1', rare: '10', unobtainable: '1' }),
  row({ _rowid: '16', itemid: '5079', name: 'Firecracker (mobile)', internalname: 'Firecracker' }),
  row({ _rowid: '17', itemid: '', name: 'Icemourne' }),
  row({ _rowid: '18', itemid: '9', name: 'Wood', type: 'crafting material' }),
]

const tree: CategoryTree & { pageStatus: Map<string, { exists: boolean; resolvedTitle: string }> } = {
  roots: ['Category:Weapon items', 'Category:Weapon types'],
  categories: new Map([
    ['Category:Weapon items', { pages: ['Bomb', 'Flower of Fire', 'Minishark', 'Terraprisma', 'Zenith', 'Icemourne', 'Iron Pickaxe', 'Blue Phaseblade', 'Bows'], subcats: ['Category:Weapon types'] }],
    ['Category:Weapon types', { pages: [], subcats: ['Category:Melee weapons'] }],
    ['Category:Melee weapons', { pages: ['Zenith'], subcats: ['Category:Broadswords'] }],
    ['Category:Broadswords', { pages: ['Zenith', 'First Fractal'], subcats: [] }],
  ]),
  pages: ['Blue Phaseblade', 'Bomb', 'Bows', 'First Fractal', 'Flower of Fire', 'Icemourne', 'Iron Pickaxe', 'Minishark', 'Terraprisma', 'Zenith'],
  fetchedAt: '2026-10-13T04:22:27.816Z',
  pageStatus: new Map([
    ['Blue Phaseblade', { exists: true, resolvedTitle: 'Phaseblades' }],
    ...['Bomb', 'Bows', 'First Fractal', 'Flower of Fire', 'Icemourne', 'Iron Pickaxe', 'Minishark', 'Terraprisma', 'Zenith'].map((p) => [p, { exists: true, resolvedTitle: p }] as [string, { exists: boolean; resolvedTitle: string }]),
  ]),
}
const img = (file: string, sha: string) => ({ file, title: `File:${file}`, url: `https://terraria.wiki.gg/images/${file}?${sha.slice(0, 6)}`, descriptionUrl: `https://terraria.wiki.gg/wiki/File:${file}`, sha1: sha, bytes: 300, width: 24, height: 24, mime: 'image/png' })
const images: ImageInfoFetch = {
  found: new Map(['Zenith.png', 'Minishark.png', 'Terraprisma.png', 'Bomb.png', 'Flower of Fire.png'].map((f, i) => [f, img(f, String(i).repeat(40))])),
  missing: ['First Fractal.png'],
  fetchedAt: '2026-10-13T04:30:00.000Z',
}
const NOT_DERIVABLE: GatingResult = { ok: false, blockers: ['no-known-route'] }

function build(gating: (id: number) => GatingResult = () => NOT_DERIVABLE, withheld?: ReadonlyMap<number, WithheldField>) {
  return buildWeapons({
    itemRows: ROWS,
    itemsFetchedAt: '2026-10-13T04:21:00.000Z',
    iteminfo: info,
    recipes: [{ id: '4956-aaaaaaaa', resultItemId: 4956 }],
    drops: [{ id: '5005-empress-of-light-741638a5', itemId: 5005 }],
    categories: tree,
    images,
    gating,
    ...(withheld ? { withheld } : {}),
  })
}
const byName = (out: ReturnType<typeof build>, name: string) => out.weapons.find((w) => w.name === name) as Weapon

describe('identifyWeapons', () => {
  it('keeps desktop weapons only: no item ID and platform-exclusive ID reuse are excluded; unnamed IDs match by internal name', () => {
    const id = identifyWeapons(ROWS, info)
    expect(id.typedRows).toBe(8)
    expect(id.included.map((c) => c.item.id).sort((a, b) => a - b)).toEqual([98, 112, 166, 4722, 4956, 5005])
    expect(id.excluded.map((e) => [e.row.name, e.kind])).toEqual([
      ['Firecracker (mobile)', 'source-mismatch'],
      ['Icemourne', 'count-reconciliation'],
    ])
    expect(id.untypedIteminfoCandidates.map((i) => i.name)).toEqual(['Staff of Regrowth'])
  })
})

describe('buildWeapons', () => {
  const out = build()

  it('emits schema-valid records with Iteminfo stats; TO-VERIFY #10: useTime and useAnimation both kept', () => {
    for (const w of out.weapons) expect(() => Weapon.parse(w)).not.toThrow()
    const zenith = byName(out, 'Zenith')
    expect(zenith).toMatchObject({ id: 4956, slug: 'zenith', damageClass: 'melee', damage: 190, critPct: 10, useTimeTicks: 10, useAnimationTicks: 30, knockback: 6.5, autoReuse: true, rarity: 10, shootSpeedTps: 60, valueCopper: 1000000, tags: ['broadswords'] })
    expect(zenith.acquisition).toEqual([{ method: 'craft', recipeIds: ['4956-aaaaaaaa'] }])
    expect(zenith._prov.unverifiedFields).toEqual(['gatedBy', 'stage'])
    expect(zenith.labBehavior).toMatchObject({ kind: 'limitation', inGameBehavior: 'See the Zenith wiki page for its in-game behavior.', sourceUrl: 'https://terraria.wiki.gg/wiki/Zenith' })
  })

  it('ammo class = slug of the AmmoID item; vendor tag → purchase with conditions Unknown; tooltip → behavior text', () => {
    const mini = byName(out, 'Minishark')
    expect(mini).toMatchObject({ ammoClass: 'musket-ball', acquisition: [{ method: 'purchase', npcName: 'Arms Dealer', priceCopper: 350000, conditions: [] }] })
    expect(mini._prov.unverifiedFields).toContain('acquisition.0.conditions')
    expect(mini.behaviorText).toBe("33% chance to save ammo\n'Half shark, half gun, completely awesome.'")
    expect(mini.labBehavior).toMatchObject({ kind: 'limitation', inGameBehavior: mini.behaviorText })
  })

  it('summon weapons: crit not applicable (absent and NOT listed); classless: damage/knockback/crit Unknown', () => {
    const prism = byName(out, 'Terraprisma')
    expect(prism.critPct).toBeUndefined()
    expect(prism._prov.unverifiedFields).not.toContain('critPct')
    expect(prism.acquisition).toEqual([{ method: 'drop', dropIds: ['5005-empress-of-light-741638a5'] }])
    const bomb = byName(out, 'Bomb')
    expect(bomb).toMatchObject({ damageClass: 'other', maxStack: 9999 })
    expect(bomb.damage).toBeUndefined()
    expect(bomb._prov.unverifiedFields).toEqual(expect.arrayContaining(['damage', 'knockback', 'critPct', 'acquisition.0.priceCopper', 'acquisition.1.priceCopper']))
    expect(bomb.acquisition.map((a) => (a.method === 'purchase' ? a.npcName : a.method))).toEqual(['Demolitionist', 'Skeleton Merchant'])
  })

  it('a Cargo/Iteminfo disagreement withholds the value (Unknown) with a source-mismatch gap — never picks one', () => {
    const fof = byName(out, 'Flower of Fire')
    expect(fof.manaCost).toBeUndefined()
    expect(fof._prov).toMatchObject({ verified: false, unverifiedFields: expect.arrayContaining(['manaCost']) })
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'i:112', field: 'manaCost', kind: 'source-mismatch' }))
    expect(out.crossCheck.get('manaCost')).toEqual({ agree: 0, mismatch: 1, noWikiValue: 0 })
    expect(out.crossCheck.get('useAnimationTicks (wiki "Use time")')).toMatchObject({ agree: 6, mismatch: 0 })
  })

  it('sprites: manifest entry per resolved wiki image; a missing image → placeholder + missing-sprite gap; unobtainable tag', () => {
    expect(byName(out, 'Zenith').sprite).toBe('/sprites/weapons/4956.png')
    expect(out.sprites.find((s) => s.ref === 'i:4956')).toMatchObject({ path: '/sprites/weapons/4956.png', wikiFileUrl: 'https://terraria.wiki.gg/wiki/File:Zenith.png', rights: 're-logic' })
    const ff = byName(out, 'First Fractal')
    expect(ff).toMatchObject({ name: 'First Fractal', tags: ['broadswords', 'unobtainable'] })
    expect(ff.sprite).toBeUndefined()
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'i:4722', kind: 'missing-sprite' }))
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'i:0', field: 'id', kind: 'count-reconciliation' }))
  })

  it('derived gating is emitted with its stage; vendor routes add their own blocker when not derivable', () => {
    const derived = build((id) => (id === 4956 ? { ok: true, gatedBy: { bosses: ['moon-lord'], conditions: [], stage: 'endgame' } } : NOT_DERIVABLE))
    expect(byName(derived, 'Zenith')).toMatchObject({ gatedBy: { bosses: ['moon-lord'], stage: 'endgame' }, stage: 'endgame' })
    expect(byName(derived, 'Zenith')._prov.unverifiedFields).toEqual([])
    expect(derived.gatingBlockers.get('no-known-route + vendor-conditions-unknown')?.examples).toContain('Minishark')
  })

  it('a vendor route (conditions Unknown) next to a derived, gated craft/drop route makes gating Unknown (§7b minimum over routes)', () => {
    const gated = build((id) => (id === 98 || id === 166 ? { ok: true, gatedBy: { bosses: ['skeletron'], conditions: [], stage: 'late-prehm' } } : NOT_DERIVABLE))
    expect(byName(gated, 'Minishark').gatedBy).toBeUndefined()
    expect(byName(gated, 'Minishark')._prov.unverifiedFields).toEqual(expect.arrayContaining(['gatedBy', 'stage']))
    expect(gated.gatingBlockers.get('alternative-route-unverified + vendor-conditions-unknown')?.count).toBe(2)
    // a gate-free derived route is already the minimum: the vendor route cannot be less gated
    const free = build((id) => (id === 98 ? { ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } } : NOT_DERIVABLE))
    expect(byName(free, 'Minishark')).toMatchObject({ gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' }, stage: 'early-prehm' })
  })

  it('B19: a withheld wiki self-conflict empties acquisition (Unknown + source-mismatch gap, gating Unknown); a stale entry fails the build', () => {
    const withheld = new Map<number, WithheldField>([[98, { field: 'acquisition', detail: 'test conflict', cargoTag: 'vendor:Arms Dealer', sources: ['https://terraria.wiki.gg/wiki/1.4.5.7'] }]])
    const out2 = build(() => ({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } }), withheld)
    const mini = byName(out2, 'Minishark')
    expect(Weapon.parse(mini).acquisition).toEqual([])
    expect(mini._prov).toMatchObject({ verified: false, unverifiedFields: expect.arrayContaining(['acquisition', 'gatedBy', 'stage']) })
    expect(mini._prov.unverifiedFields).not.toContain('acquisition.0.conditions')
    expect(out2.gaps).toContainEqual({ ref: 'i:98', field: 'acquisition', kind: 'source-mismatch', detail: 'Minishark: test conflict; value withheld (Unknown)', sources: ['https://terraria.wiki.gg/wiki/Minishark', 'https://terraria.wiki.gg/wiki/1.4.5.7'] })
    expect(out2.gatingBlockers.get('acquisition-withheld')?.examples).toEqual(['Minishark'])
    expect(() => build(undefined, new Map([[98, { ...withheld.get(98)!, cargoTag: 'vendor:Clothier' }]]))).toThrow(/no longer carries the conflicting tag/)
  })

  it('search docs: one per weapon, enemy and boss, schema-valid', () => {
    const prov = byName(out, 'Zenith')._prov
    const boss = { id: 'eater-of-worlds', name: 'Eater of Worlds', nodeId: 'eater-of-worlds', wikiUrl: 'https://terraria.wiki.gg/wiki/Eater_of_Worlds', stage: 'early-prehm' as const, worldEvil: 'corruption' as const, summon: { items: [], conditions: [] }, location: { biomes: [] }, statsByDifficulty: {}, dropIds: [], _prov: prov }
    const docs = buildSearchDocs({ weapons: out.weapons, enemies: [{ id: 'zombie', name: 'Zombie', dropIds: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Zombie', _prov: prov }], bosses: [boss] })
    expect(docs.map((d) => SearchDoc.parse(d).id)).toEqual(['i:98', 'i:112', 'i:166', 'i:4722', 'i:4956', 'i:5005', 'enemy:zombie', 'boss:eater-of-worlds'])
    expect(docs[4]).toEqual({ id: 'i:4956', name: 'Zenith', type: 'weapon', class: 'melee', rarity: 10, tags: ['broadswords'] })
    expect(docs[7]).toEqual({ id: 'boss:eater-of-worlds', name: 'Eater of Worlds', type: 'boss', stage: 'early-prehm', tags: ['corruption'] })
  })
})

describe('reconciliation', () => {
  const out = build()
  it('classifies every category-tree article and reconciles the weapon total', () => {
    const r = reconcileCategories(tree, ROWS, out.weapons, out.identification, out.pageOf)
    expect(r.buckets['weapon-article'].sort()).toEqual(['Bomb', 'First Fractal', 'Flower of Fire', 'Minishark', 'Terraprisma', 'Zenith'])
    expect(r.buckets.redirect).toEqual(['Blue Phaseblade → Phaseblades'])
    expect(r.buckets['excluded-weapon-rows']).toEqual(['Icemourne'])
    expect(r.buckets['no-item-infobox'].sort()).toEqual(['Bows', 'Iron Pickaxe'])
    expect(r.weaponsOnTreePages + r.weaponsOutsideTree.length).toBe(out.weapons.length)
  })

  it('compares the wiki weapon list pages name by name', () => {
    const src = [
      { _page: 'Melee weapons', weapon: 'Zenith', lang: 'en' },
      { _page: 'Melee weapons', weapon: 'Phaseblade', lang: 'en' },
      { _page: 'Magic weapons/id', weapon: 'Bomb', lang: 'id' },
    ]
    const r = reconcileWeaponLists(src, ROWS, out.weapons, out.identification)
    expect(r).toMatchObject({ listPages: ['Melee weapons'], names: 2, both: 1, listOnly: [{ name: 'Phaseblade', why: 'no Cargo Items row with this name' }] })
    expect(r.emittedOnly).toContain('Minishark')
  })
})

describe('cell helpers', () => {
  it('rarity tiers (TO-VERIFY #9), Cargo rarity cells, numbers, coins, tooltips, ammo slugs', () => {
    expect([rarityOf(-1), rarityOf(10), rarityOf(-11), rarityOf(-12), rarityOf(-13), rarityOf(-5)]).toEqual([-1, 10, 'amber', 'rainbow', 'fiery-red', undefined])
    expect(cargoRarity('<span class="rarity">[[File:Rarity color 4.png|Light Red (Rarity level: 4)]]</span>')).toBe(4)
    expect(cargoRarity('-12')).toBe(-12)
    expect(leadingNumber('6 <span class=usetime>(Insanely fast)</span>')).toBe(6)
    expect(leadingNumber('16 (0 with Meteor armor)')).toBe(16)
    expect(leadingNumber('')).toBeUndefined()
    expect(coinPrice(coin(350000))).toBe(350000)
    expect(coinPrice('15 Defender Medals')).toBeUndefined()
    expect(coinPrice(coin(1) + coin(2))).toBeUndefined()
    expect(tooltipText('<span class="gameText">A<br/>[[Link|B]]</span>')).toBe('A\nB')
    expect(ammoClassSlug(97, info)).toBe('musket-ball')
    expect(ammoClassSlug(12345, info)).toBeUndefined()
  })
})
