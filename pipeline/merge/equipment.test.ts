/* P2-S8 armor / armor-set / accessory derivation helpers on synthetic inputs shaped like the 2026-10-13
 * sync (pipeline/merge/effects.ts, merge/armor.ts, parse/equipment.ts and validate/integrity.ts state
 * every rule; the emitted-dataset checks live in validate/emitted.test.ts). */
import { describe, expect, it } from 'vitest'
import type { Recipe, StatEffect } from '../../src/schemas'
import { parseSetInfoboxes, parseWingTable } from '../parse/equipment'
import { deriveTinkering, TINKERERS_WORKSHOP_ITEM_ID } from '../validate/integrity'
import { bonusPerHelmet, classSignals } from './armor'
import { classifyLine, crossCheckEquipinfo, EFFECT_RULES, normalizeEffectLines } from './effects'

const URL = 'https://terraria.wiki.gg/wiki/Test'
const stat = (s: Extract<StatEffect, { kind: 'stat' }>['stat'], value: number, scope?: 'melee' | 'ranged' | 'magic' | 'summon'): StatEffect => ({ kind: 'stat', stat: s, value, ...(scope ? { scope } : {}) })
const special = (text: string): StatEffect => ({ kind: 'special', text, simulated: false, sourceUrl: URL })
const effects = (line: string) => classifyLine(line, URL, 'test').effects

describe('game-text lines → StatEffect (closed StatKind, DATA_SCHEMA_SPEC §2.3)', () => {
  it('stat rules: class-scoped and class-less damage / crit; a reduction is a negative value', () => {
    expect(effects('15% increased ranged damage')).toEqual([stat('damage-pct', 15, 'ranged')])
    expect(effects('7% increased damage')).toEqual([stat('damage-pct', 7)])
    expect(effects('12% increased magic damage and critical strike chance')).toEqual([stat('damage-pct', 12, 'magic'), stat('crit-pct', 12, 'magic')])
    expect(effects('17% reduced mana cost')).toEqual([stat('mana-cost-pct', -17)])
    expect(effects('Reduces damage taken by 17%')).toEqual([stat('damage-reduction-pct', 17)])
    expect(effects('Increases your max number of minions by 2')).toEqual([stat('minion-slots', 2)])
    expect(effects('1 defense')).toEqual([stat('defense-flat', 1)])
  })

  it('specials keep the verbatim line (simulated: false, sourceUrl); amendment candidates name the StatKind they would need', () => {
    const r = classifyLine('25% chance not to consume arrows', URL, 'test')
    expect(r.effects).toEqual([special('25% chance not to consume arrows')])
    expect(r.rule).toMatchObject({ kind: 'special', proposed: 'ammo-save-pct with an ammo scope (arrows)' })
    expect(r.categories).toEqual(['offense'])
    expect(effects('Become immune after striking an enemy')).toEqual([special('Become immune after striking an enemy')])
    // B54 kinds whose line states no value stay specials ("no value/unit rows stay Unknown")
    expect(classifyLine('Increases melee knockback', URL, 'test').rule).toMatchObject({ kind: 'special', proposed: 'knockback-pct / minion-knockback (value)' })
  })

  it('AMENDMENTS-011 B54: the 11 pre-approved kinds structure lines that state their value (category unchanged)', () => {
    const r = classifyLine('20% chance to save ammo', URL, 'test')
    expect(r.effects).toEqual([stat('ammo-save-pct', 20)])
    expect(r.categories).toEqual(['offense'])
    expect(effects('Increases armor penetration by 5')).toEqual([stat('armor-penetration-flat', 5)])
    expect(effects('Increases your max number of summon tag effects by 1')).toEqual([stat('tag-effect-slots', 1)])
    expect(effects('Increases fishing power by 10')).toEqual([stat('fishing-power-flat', 10)])
    expect(effects('Increases block placement & tool range by 1')).toEqual([stat('tile-reach-flat', 1)])
    expect(effects('Reduces the cooldown of healing potions by 25%')).toEqual([stat('potion-cooldown-pct', -25)])
    // seconds → ticks (§2 units); the LINE must state the seconds
    expect(effects('Provides 7 seconds of immunity to lava')).toEqual([stat('lava-immunity-ticks', 420)])
    expect(effects('Increases whip range by 30% and speed by 15%')).toEqual([stat('whip-range-pct', 30), stat('whip-speed-pct', 15)])
    expect(effects('10% increased summon and ranged damage and 20% chance to save ammo')).toEqual([stat('damage-pct', 10, 'summon'), stat('damage-pct', 10, 'ranged'), stat('ammo-save-pct', 20)])
  })

  it('stat + remainder: the stated number is structured, the unmodeled rest stays a quoted special', () => {
    expect(effects('Fishing line will never break, decreases chance of bait consumption, increases fishing power by 10')).toEqual([stat('fishing-power-flat', 10), special('Fishing line will never break, decreases chance of bait consumption, increases fishing power by 10')])
    expect(effects('Grants immunity to fire blocks and 7 seconds of immunity to lava')).toEqual([stat('lava-immunity-ticks', 420), special('Grants immunity to fire blocks and 7 seconds of immunity to lava')])
    expect(effects('Increases your summon damage by 10% and the knockback of your minions')).toEqual([stat('damage-pct', 10, 'summon'), special('Increases your summon damage by 10% and the knockback of your minions')])
  })

  it('flavor / explanation lines emit nothing; an unclassifiable line fails the build (never silent text)', () => {
    expect(effects("'The darkness holds no secrets for you'")).toEqual([])
    expect(() => classifyLine('Increases luck by a lot', URL, 'test')).toThrow('matches no rule')
  })

  it('rule ids are unique; a two-stat line yields both stats, each number taken from the line', () => {
    expect(new Set(EFFECT_RULES.map((r) => r.id)).size).toBe(EFFECT_RULES.length)
    expect(effects('Increases maximum mana by 40 and 7% reduced mana cost')).toEqual([stat('max-mana-flat', 40), stat('mana-cost-pct', -7)])
  })

  it('normalizeEffectLines: drops other-platform variants, strips the desktop note, joins "," continuations', () => {
    const out = normalizeEffectLines([
      'Increases jump height (Old-gen console version)',
      'Allows flight (Desktop, Console and Mobile versions)',
      'Fishing line will never break,',
      'decreases chance of bait consumption, increases fishing power by 10',
    ])
    expect(out.lines).toEqual(['Allows flight', 'Fishing line will never break, decreases chance of bait consumption, increases fishing power by 10'])
    expect(out.dropped).toEqual(['Increases jump height (Old-gen console version)'])
  })
})

describe('Cargo Equipinfo cross-check of the game-text stats', () => {
  it('agree: a scoped stat equals its Equipinfo field; a class-less damage bonus fills all four class fields', () => {
    expect(crossCheckEquipinfo([stat('damage-pct', 10, 'melee')], { meleeDamage: '+0.1' }).outcome).toBe('agree')
    expect(crossCheckEquipinfo([stat('damage-pct', 7)], { meleeDamage: '+0.07', rangedDamage: '+0.07', magicDamage: '+0.07', minionDamage: '+0.07' }).outcome).toBe('agree')
    expect(crossCheckEquipinfo([stat('damage-reduction-pct', 17)], { endurance: '+0.17' }).outcome).toBe('agree')
  })

  it('disagree withholds; one-sided fields are partial (game text only / Equipinfo only); no row = nothing to compare', () => {
    expect(crossCheckEquipinfo([stat('damage-pct', 10, 'melee')], { meleeDamage: '+0.12' })).toMatchObject({ outcome: 'disagree', differences: ['meleeDamage: game text 0.1 vs Equipinfo 0.12'] })
    expect(crossCheckEquipinfo([stat('mana-cost-pct', -8)], { itemid: '555' })).toMatchObject({ outcome: 'partial', textOnly: ['manaCost -0.08'], equipinfoOnly: [] })
    expect(crossCheckEquipinfo([special('Slightly increases mobility')], { moveSpeed: '+0.25' })).toMatchObject({ outcome: 'partial', textOnly: [], equipinfoOnly: ['moveSpeed 0.25'] })
    expect(crossCheckEquipinfo([stat('minion-slots', 1)], undefined).outcome).toBe('no-equipinfo-row')
  })
})

const icon = (alt: string) => `<span class="i"><img alt="${alt}" src="/images/x.png" /></span>`
const SET_ARTICLE = `<div class="infobox item"><div class="title">Hallowed armor</div><table class="stat"><tbody>
<tr><th>Type</th><td><div class="tags"><span class="nowrap tag"><a href="/wiki/Armor">Armor</a></span><span class="nowrap tag"><a href="/wiki/Set">Set</a></span></div></td></tr>
<tr><th><a href="/wiki/Defense">Defense</a></th><td>${icon('Hallowed Headgear')}&#8239;&#58;&#160;31&#32;/&#32;${icon('Hallowed Hood')}&#8239;&#58;&#160;27<span class="note-text">&#32;(set)</span></td></tr>
<tr><th><a href="/wiki/Set_bonus">Set Bonus</a></th><td><i><span class="gameText">Become immune after striking an enemy</span></i><br />${icon('Hallowed Hood')}&#8239;&#58;&#160;<i><span class="gameText">Become immune after striking an enemy<br />Increases your max number of minions by 2</span></i></td></tr>
</tbody></table></div><div class="infobox item"><div class="title">Hallowed Hood</div><table class="stat"><tbody><tr><th>Type</th><td><div class="tags"><span class="nowrap tag">Armor</span></div></td></tr></tbody></table></div>`

describe('armor sets (merge/armor.ts, parse/equipment.ts)', () => {
  it('parseSetInfoboxes: only the infobox tagged "Set"; per-helmet Defense totals; default + helmet-specific Set Bonus segments', () => {
    const [box, ...rest] = parseSetInfoboxes(SET_ARTICLE)
    expect(rest).toEqual([])
    expect(box.title).toBe('Hallowed armor')
    expect([...box.defense]).toEqual([['Hallowed Headgear', 31], ['Hallowed Hood', 27]])
    expect(box.bonus).toEqual([
      { pieces: [], lines: ['Become immune after striking an enemy'] },
      { pieces: ['Hallowed Hood'], lines: ['Become immune after striking an enemy', 'Increases your max number of minions by 2'] },
    ])
  })

  it('bonusPerHelmet: a helmet segment replaces the default for that helmet; a segment keyed by a non-helmet piece cannot be expressed', () => {
    const segments = parseSetInfoboxes(SET_ARTICLE)[0].bonus!
    const r = bonusPerHelmet(segments, ['Hallowed Headgear', 'Hallowed Hood'])
    expect(r).toEqual({
      ok: true,
      byHelmet: new Map([
        ['Hallowed Headgear', ['Become immune after striking an enemy']],
        ['Hallowed Hood', ['Become immune after striking an enemy', 'Increases your max number of minions by 2']],
      ]),
    })
    // Beetle armor: the bonus is keyed by the two alternative chests
    const beetle = [{ pieces: ['Beetle Scale Mail'], lines: ['Beetles increase your melee damage and speed'] }, { pieces: ['Beetle Shell'], lines: ['Beetles protect you from damage'] }]
    expect(bonusPerHelmet(beetle, ['Beetle Helmet'])).toEqual({ ok: false, reason: expect.stringContaining('"Beetle Scale Mail", which is not a helmet of the set') })
    expect(bonusPerHelmet([], ['Rain Hat'])).toEqual({ ok: false, reason: expect.stringContaining('no Set Bonus text applies') })
  })

  it('classSignals: damage / crit scopes, summon slots + whip range, mana, melee speed; class-less stats and specials give none', () => {
    expect([...classSignals([stat('damage-pct', 15, 'ranged'), stat('crit-pct', 8, 'ranged')])]).toEqual(['ranged'])
    expect([...classSignals([stat('minion-slots', 1), stat('whip-range-pct', 20)])]).toEqual(['summon'])
    expect([...classSignals([stat('max-mana-flat', 100), stat('mana-cost-pct', -17)])]).toEqual(['magic'])
    expect([...classSignals([stat('melee-speed-pct', 10)])]).toEqual(['melee'])
    expect([...classSignals([stat('damage-pct', 7), stat('defense-flat', 1), special('Become immune after striking an enemy')])]).toEqual([])
    expect([...classSignals([stat('damage-pct', 16, 'melee'), stat('damage-pct', 16, 'ranged')])].sort()).toEqual(['melee', 'ranged']) // hybrid → overlay ruling
  })
})

const wingRow = (name: string, id: number, flight: string, speeds: string[], notes: string) =>
  `<tr><td>${icon(name)}</td><td><span class="i -w break"><span><span><a href="/wiki/${name}">${name}</a></span><span class="id">Internal <a href="/wiki/Item_IDs">Item ID</a>: ${id}</span></span></span></td><td>img</td><td>source</td><td>${flight}</td><td>${speeds.map((s) => `<abbr><span class="gameText">${s}</span></abbr>`).join(' <br /> ')}</td><td>2.5×</td><td>1.5×</td><td>3×</td><td>rarity</td><td class="small align-left"><ul><li>${notes}</li></ul></td></tr>`
const WINGS = `<table class="terraria"><tbody><tr><th>Item</th><th>Name</th><th>Equipped</th><th>Source</th><th>Flight time</th><th>Horizontal speed</th></tr>
${wingRow('Celestial Starboard', 4954, '3&#160;s', ['41 mph', '82 mph'], 'Can hover at a fixed height.')}
${wingRow('Fledgling Wings', 4978, '0.42&#160;s', ['15 mph'], 'The only pre-Hardmode wings.')}</tbody></table>`

describe('Wings article list table (accessory wingStats)', () => {
  it('reads name, item IDs, flight time, normal / hovering horizontal speeds and notes per row', () => {
    const rows = parseWingTable(WINGS)
    expect(rows).toEqual([
      { name: 'Celestial Starboard', itemIds: [4954], flightTime: '3 s', horizontalSpeed: ['41 mph', '82 mph'], notes: 'Can hover at a fixed height.', cells: 11 },
      { name: 'Fledgling Wings', itemIds: [4978], flightTime: '0.42 s', horizontalSpeed: ['15 mph'], notes: 'The only pre-Hardmode wings.', cells: 11 },
    ])
    expect(parseWingTable('<table class="terraria"><tr><th>Name</th></tr></table>')).toEqual([])
  })
})

const recipe = (id: string, resultItemId: number, stations: Recipe['stations'], ingredients: (number | string)[]): Recipe =>
  ({ id, resultItemId, resultAmount: 1, stations, ingredients: ingredients.map((x) => ({ amount: 1, ref: typeof x === 'number' ? { kind: 'item', itemId: x } : { kind: 'group', groupId: x } })), conditions: [] }) as unknown as Recipe
const TINKER: Recipe['stations'] = [{ kind: 'item', itemId: TINKERERS_WORKSHOP_ITEM_ID }]

describe("tinkering derivation (§7a-7): Tinkerer's Workshop recipes → combinedFrom / upgradesTo", () => {
  it('links accessory item ingredients both ways; other stations, groups and materials never link', () => {
    const accessories = new Set([397, 1612, 1613, 1290, 111, 1164, 5331])
    const d = deriveTinkering(
      [
        recipe('1613-a', 1613, TINKER, [397, 1612]), // Ankh Shield ← Obsidian Shield + Ankh Charm
        recipe('111-a', 111, [...TINKER, { kind: 'environment', condition: 'ecto-mist', name: 'Ecto Mist' }], [109, 1290]), // material 109 never links
        recipe('5331-a', 5331, TINKER, ['any-cloud-balloon', 1164]), // the group does not link
        recipe('1612-shimmer', 1612, [{ kind: 'item', itemId: 9999 }], [397]), // not the Tinkerer's Workshop
      ],
      (id) => accessories.has(id),
    )
    expect([...(d.combinedFrom.get(1613)?.keys() ?? [])]).toEqual([397, 1612])
    expect([...(d.upgradesTo.get(1612)?.keys() ?? [])]).toEqual([1613])
    expect([...(d.combinedFrom.get(111)?.keys() ?? [])]).toEqual([1290])
    expect([...(d.combinedFrom.get(5331)?.keys() ?? [])]).toEqual([1164])
    expect(d.upgradesTo.get(397)?.get(1613)).toBe('rcp:1613-a')
    expect(d.upgradesTo.has(109)).toBe(false)
    expect(d.combinedFrom.has(1612)).toBe(false)
    // symmetric by construction: every combinedFrom edge is an upgradesTo edge reversed
    const forward = [...d.combinedFrom].flatMap(([to, from]) => [...from.keys()].map((f) => `${f}>${to}`)).sort()
    const backward = [...d.upgradesTo].flatMap(([from, to]) => [...to.keys()].map((t) => `${from}>${t}`)).sort()
    expect(forward).toEqual(backward)
  })
})
