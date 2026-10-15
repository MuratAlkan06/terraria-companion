/**
 * A hand-built mini dataset for the loadout builder's engine goldens (SCORING_SPEC §8.1 "checked-in
 * fixtures"): every number in recommend.test.ts's fixture goldens is derived from these records by
 * hand, so the goldens never move when src/data is regenerated. Test-only (imported by tests alone;
 * pure data, inside the src/scoring boundary).
 *
 * Graph: wall-of-flesh (late pre-HM) → hardmode (milestone) → mech (early HM) → plant (mid HM), all
 * required gates; slime (early pre-HM, optional); evil-c / evil-k (the two world-evil bosses).
 * VirtualDefeats: early-hm = {wall-of-flesh}; mid-hm = {wall-of-flesh, hardmode, mech}.
 */
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Item, StatEffect, Weapon } from '../../schemas'
import type { BuilderData } from '../recommend'
import type { ReadinessGraph } from '../readiness'

const prov = (unverifiedFields: string[] = []) => ({ gameVersion: '1.4.5.8', sources: [], verified: unverifiedFields.length === 0, unverifiedFields, editorialFields: [] })
const gate = (...bosses: string[]) => ({ bosses, conditions: [] as string[], stage: 'early-prehm' })
const url = (name: string) => `https://terraria.wiki.gg/wiki/${name.replace(/ /g, '_')}`
const stat = (s: string, value: number, scope?: string): StatEffect => ({ kind: 'stat', stat: s, value, ...(scope ? { scope } : {}) }) as StatEffect
const special = (text: string): StatEffect => ({ kind: 'special', text, simulated: false, sourceUrl: url('Special') })

type W = Partial<Weapon> & { id: number; name: string }
function weapon(w: W & { unverified?: string[]; gated?: string[] | 'unknown'; conditions?: string[] }): Weapon {
  const { unverified = [], gated = [], conditions = [], ...rest } = w
  return {
    slug: rest.name.toLowerCase().replace(/ /g, '-'),
    type: 'weapon',
    tags: [],
    wikiUrl: url(rest.name),
    acquisition: [],
    rarity: 1,
    useTimeTicks: 20,
    useAnimationTicks: 20,
    critPct: 0,
    autoReuse: false,
    labBehavior: { kind: 'none' },
    ...(gated === 'unknown' ? {} : { gatedBy: { ...gate(...gated), conditions } }),
    ...rest,
    _prov: prov([...unverified, ...(gated === 'unknown' ? ['gatedBy'] : [])]),
  } as unknown as Weapon
}

function piece(id: number, name: string, slot: 'head' | 'chest' | 'legs', defense: number, setId: string, effects: StatEffect[] = [], gated: string[] = []): ArmorPiece {
  return { id, name, slug: `p${id}`, type: 'armor', slot, defense, effects, setId, tags: [], wikiUrl: url(name), acquisition: [], rarity: 1, gatedBy: gate(...gated), _prov: prov() } as unknown as ArmorPiece
}

function set(id: string, name: string, pieces: [number, number, number], classes: ArmorSet['variants'][number]['classes'], setBonus: StatEffect[]): ArmorSet {
  return {
    id,
    name,
    pieces: { helmets: [pieces[0]], chest: pieces[1], legs: pieces[2] },
    variants: [{ helmetId: pieces[0], class: classes && classes.length === 1 ? classes[0] : 'other', classes, setBonus, setBonusText: name }],
    wikiUrl: url(name),
    _prov: prov(),
  } as unknown as ArmorSet
}

function accessory(id: number, name: string, categories: Accessory['categories'], effects: StatEffect[], o: { gated?: string[] | 'unknown'; wing?: number; combinedFrom?: number[]; upgradesTo?: number[]; rarity?: number } = {}): Accessory {
  const gated = o.gated ?? []
  return {
    id,
    name,
    slug: `a${id}`,
    type: 'accessory',
    categories,
    effects,
    combinedFrom: o.combinedFrom ?? [],
    upgradesTo: o.upgradesTo ?? [],
    ...(o.wing !== undefined ? { wingStats: { flightTimeTicks: o.wing } } : {}),
    tags: [],
    wikiUrl: url(name),
    acquisition: [],
    rarity: o.rarity ?? 1,
    ...(gated === 'unknown' ? {} : { gatedBy: gate(...gated) }),
    _prov: prov(gated === 'unknown' ? ['gatedBy'] : []),
  } as unknown as Accessory
}

function item(id: number, name: string, o: Partial<Item> & { gated?: string[]; unverified?: string[] }): Item {
  const { gated = [], unverified = [], ...rest } = o
  return { id, name, slug: `i${id}`, type: 'item', category: 'other', isStation: false, tags: [], wikiUrl: url(name), acquisition: [], rarity: 0, gatedBy: gate(...gated), ...rest, _prov: prov(unverified) } as unknown as Item
}

const buff = (id: string, effects: StatEffect[], isDebuff = false): Buff => ({ id, gameBuffId: 1, name: id, isDebuff, effects, wikiUrl: url(id), _prov: prov() }) as unknown as Buff

export const FIXTURE_WEAPONS: Weapon[] = [
  weapon({ id: 1, name: 'Copper Blade', damageClass: 'melee', damage: 10, tags: ['broadswords'] }),
  weapon({ id: 2, name: 'Iron Blade', damageClass: 'melee', damage: 12, tags: ['broadswords'], rarity: 1 }),
  weapon({ id: 3, name: 'Spear X', damageClass: 'melee', damage: 12, tags: ['spears'], rarity: 0 }),
  weapon({ id: 4, name: 'Hard Blade', damageClass: 'melee', damage: 40, tags: ['broadswords'], gated: ['hardmode'] }),
  weapon({ id: 5, name: 'Mystery Blade', damageClass: 'melee', damage: 100, tags: ['broadswords'], gated: 'unknown' }),
  weapon({ id: 6, name: 'Broken Blade', damageClass: 'melee', tags: ['broadswords'], unverified: ['damage'] }),
  weapon({ id: 7, name: 'Mech Blade', damageClass: 'melee', damage: 60, tags: ['broadswords'], gated: ['mech'] }),
  weapon({ id: 8, name: 'Evil Blade', damageClass: 'melee', damage: 50, tags: ['broadswords'], gated: ['evil-c'] }),
  weapon({ id: 10, name: 'Pistol', damageClass: 'ranged', damage: 10, useTimeTicks: 10, useAnimationTicks: 10, autoReuse: true, ammoClass: 'bullet', tags: ['guns'] }),
  weapon({ id: 11, name: 'Bow', damageClass: 'ranged', damage: 14, useTimeTicks: 15, useAnimationTicks: 15, autoReuse: true, ammoClass: 'arrow', tags: ['bows'] }),
  weapon({ id: 30, name: 'Finch Staff', damageClass: 'summon', damage: 7, tags: ['minion-summon-items'], useTimeTicks: 30, useAnimationTicks: 30 }),
  weapon({ id: 31, name: 'Bigger Staff', damageClass: 'summon', damage: 20, tags: ['minion-summon-items'], gated: ['mech'] }),
  weapon({ id: 32, name: 'Leather Whip', damageClass: 'summon', damage: 14, tags: ['whips'], useTimeTicks: 30, useAnimationTicks: 30, autoReuse: true }),
  weapon({ id: 33, name: 'Bomb', damageClass: 'other', damage: 100, useTimeTicks: 40, useAnimationTicks: 40, maxStack: 99, tags: ['explosives'] }),
  // AMENDMENTS-016 B108(b): needs a Corruption world — out of play once a Crimson world is chosen
  weapon({ id: 34, name: 'Vile Staff', damageClass: 'summon', damage: 5, tags: ['minion-summon-items'], conditions: ['corruption-world'] }),
]

export const FIXTURE_ARMOR: ArmorPiece[] = [
  piece(100, 'Wood Helmet', 'head', 1, 'wood'),
  piece(101, 'Wood Breastplate', 'chest', 1, 'wood'),
  piece(102, 'Wood Greaves', 'legs', 0, 'wood'),
  piece(110, 'Ninja Hood', 'head', 2, 'ninja', [stat('crit-pct', 5)]),
  piece(111, 'Ninja Shirt', 'chest', 3, 'ninja'),
  piece(112, 'Ninja Pants', 'legs', 2, 'ninja'),
  piece(120, 'Tank Helmet', 'head', 5, 'tank'),
  piece(121, 'Tank Plate', 'chest', 6, 'tank'),
  piece(122, 'Tank Greaves', 'legs', 5, 'tank'),
  piece(130, 'Mage Hat', 'head', 1, 'mage', [stat('damage-pct', 10, 'magic')]),
  piece(131, 'Mage Robe', 'chest', 1, 'mage'),
  piece(132, 'Mage Pants', 'legs', 1, 'mage'),
  piece(140, 'Mech Helmet', 'head', 10, 'mecha', [], ['mech']),
  piece(141, 'Mech Plate', 'chest', 10, 'mecha', [], ['mech']),
  piece(142, 'Mech Greaves', 'legs', 10, 'mecha', [], ['mech']),
  piece(150, 'Duo Helmet', 'head', 2, 'duo', [stat('damage-pct', 4)]),
  piece(151, 'Duo Plate', 'chest', 2, 'duo'),
  piece(152, 'Duo Greaves', 'legs', 2, 'duo'),
]

export const FIXTURE_SETS: ArmorSet[] = [
  set('wood', 'Wood armor', [100, 101, 102], ['other'], [stat('defense-flat', 1)]),
  set('ninja', 'Ninja armor', [110, 111, 112], ['melee'], [stat('move-speed-pct', 20), special('Allows the ability to dash')]),
  set('tank', 'Tank armor', [120, 121, 122], ['melee'], [stat('damage-reduction-pct', 5)]),
  set('mage', 'Mage armor', [130, 131, 132], ['magic'], [stat('mana-cost-pct', -10)]),
  set('mecha', 'Mech armor', [140, 141, 142], ['other'], [stat('defense-flat', 5)]),
  // B52 hybrid: melee and ranged
  set('duo', 'Duo armor', [150, 151, 152], ['melee', 'ranged'], [stat('crit-pct', 4)]),
]

export const FIXTURE_ACCESSORIES: Accessory[] = [
  accessory(200, 'Warrior Emblem', ['offense'], [stat('damage-pct', 15, 'melee')], { upgradesTo: [202] }),
  accessory(201, 'Ranger Emblem', ['offense'], [stat('damage-pct', 15, 'ranged')], { upgradesTo: [202] }),
  accessory(202, 'Avenger Emblem', ['offense'], [stat('damage-pct', 12)], { gated: ['hardmode'], combinedFrom: [200, 201], rarity: 4 }),
  accessory(203, 'Feral Claws', ['offense'], [stat('melee-speed-pct', 12)]),
  accessory(204, 'Volatile Gel', ['offense'], [special('Releases volatile gelatin periodically')]),
  accessory(205, 'Boots', ['mobility'], [stat('move-speed-pct', 8)]),
  accessory(206, 'Wings A', ['mobility'], [special('Allows flight and slow fall')], { wing: 100 }),
  accessory(207, 'Wings B', ['mobility'], [special('Allows flight and slow fall')], { wing: 150, rarity: 3 }),
  accessory(208, 'Shield', ['defense'], [stat('defense-flat', 2)]),
  accessory(209, 'Band', ['defense'], [stat('life-regen', 1)]),
  accessory(210, 'Fishing Thing', ['utility'], [stat('fishing-power-flat', 10)]),
  accessory(211, 'Mystery Charm', ['offense'], [stat('damage-pct', 30)], { gated: 'unknown' }),
  accessory(212, 'Evil Scarf', ['defense'], [stat('damage-reduction-pct', 17)], { gated: ['evil-c'] }),
  accessory(213, 'Info Charm', ['utility'], [special('Displays the time')]),
  // AMENDMENTS-016 B108(a): 0-point accessories whose only effect the keyword registry ties to one class
  accessory(214, 'Mana Charm', ['utility'], [special('Automatically use mana potions when needed')]),
  accessory(215, 'Yoyo String', ['offense'], [special('Increases yoyo range and duration')]),
]

export const FIXTURE_ITEMS: Item[] = [
  item(20, 'Musket Ball', { category: 'ammo', ammoStats: { ammoClass: 'bullet', damage: 5 } }),
  item(21, 'Silver Bullet', { category: 'ammo', ammoStats: { ammoClass: 'bullet', damage: 8 }, gated: ['hardmode'] }),
  item(22, 'Mystery Arrow', { category: 'ammo', ammoStats: { ammoClass: 'arrow' }, unverified: ['ammoStats.damage'] }),
  item(300, 'Swift Potion', { category: 'potion', buffGrants: [{ buffId: 'swift' }] }),
  item(301, 'Iron Potion', { category: 'potion', buffGrants: [{ buffId: 'iron' }] }),
  item(302, 'Rage Potion', { category: 'potion', buffGrants: [{ buffId: 'rage' }] }),
  item(303, 'Swift Potion II', { category: 'potion', buffGrants: [{ buffId: 'swift' }] }),
  item(304, 'Healing Potion', { category: 'potion', healLife: 100, buffGrants: [{ buffId: 'potion-sickness' }] }),
  item(305, 'Fish Potion', { category: 'potion', buffGrants: [{ buffId: 'fishing' }] }),
]

export const FIXTURE_BUFFS: Buff[] = [
  buff('swift', [stat('move-speed-pct', 25)]),
  buff('iron', [stat('defense-flat', 8)]),
  buff('rage', [stat('crit-pct', 10)]),
  buff('fishing', [stat('fishing-power-flat', 15)]),
  buff('potion-sickness', [special('Cannot use healing items')], true),
]

const node = (id: string, kind: 'boss' | 'milestone', stage: string, worldEvil?: 'corruption' | 'crimson') => ({ id, kind, stage, name: id === 'wall-of-flesh' ? 'Wall of Flesh' : id.replace(/(^|-)([a-z])/g, (_m, sep: string, c: string) => `${sep ? ' ' : ''}${c.toUpperCase()}`), ...(worldEvil ? { worldEvil } : {}) })

export const FIXTURE_GRAPH: ReadinessGraph = {
  nodes: [
    node('slime', 'boss', 'early-prehm'),
    node('evil-c', 'boss', 'early-prehm', 'corruption'),
    node('evil-k', 'boss', 'early-prehm', 'crimson'),
    node('wall-of-flesh', 'boss', 'late-prehm'),
    node('hardmode', 'milestone', 'early-hm'),
    node('mech', 'boss', 'early-hm'),
    node('plant', 'boss', 'mid-hm'),
  ],
  edges: [
    { from: 'wall-of-flesh', to: 'hardmode', type: 'required-gate' },
    { from: 'hardmode', to: 'mech', type: 'required-gate' },
    { from: 'mech', to: 'plant', type: 'required-gate' },
    { from: 'slime', to: 'wall-of-flesh', type: 'optional' },
  ],
}

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))

export const FIXTURE_DATA: BuilderData = {
  weapons: byId(FIXTURE_WEAPONS),
  armor: byId(FIXTURE_ARMOR),
  accessories: byId(FIXTURE_ACCESSORIES),
  sets: byId(FIXTURE_SETS),
  items: byId(FIXTURE_ITEMS),
  buffs: byId(FIXTURE_BUFFS),
  bosses: byId([{ id: 'mech', nodeId: 'mech', name: 'Mech', wikiUrl: url('Mech') } as unknown as Boss, { id: 'plant', nodeId: 'plant', name: 'Plant', wikiUrl: url('Plant') } as unknown as Boss]),
  conditions: new Map([
    ['corruption-world', { id: 'corruption-world', name: 'Corruption world' }],
    ['crimson-world', { id: 'crimson-world', name: 'Crimson world' }],
  ]),
  graph: FIXTURE_GRAPH,
  ammoTypeName: (slug) => ({ bullet: 'Bullets', arrow: 'Arrows' })[slug] ?? slug,
  gameVersion: '1.4.5.8',
}
