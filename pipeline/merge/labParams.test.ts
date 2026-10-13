/* P3-S0 Weapon Lab params: B36, derivation formulas, article screen, overlay rules, guard contract — on
 * synthetic records shaped like the 2026-10-13 sync — plus the contract over the emitted src/data. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArchetypeParams, Buff, modelingConventionFor, simRequiredWeaponFields, Weapon, type Item, type SpriteManifestFile } from '../../src/schemas'
import { assessWeapon, createLabSim } from '../../src/sim'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { Iteminfo } from '../parse/iteminfo'
import type { Projectileinfo } from '../parse/projectileinfo'
import { downgradeUnverifiedArchetype } from '../validate/labDowngrade'
import { Evidence } from './evidence'
import {
  behaviorText,
  buildLabParams,
  chancePctOf,
  deriveDot,
  durationTicksOf,
  familyOf,
  infoboxDebuffs,
  pierceFromPenetrate,
  projectileVelocityTps,
  RULE_QUOTES,
  screenText,
  statedRangeTiles,
  statesDamagePct,
  statesLifetime,
  statesPierce,
  statesSlightSpread,
  swingReachTiles,
  thrustReachTiles,
  type LabBuildInput,
} from './labParams'
import { LabParamsOverlay, type LabParamsEntry } from './overlays'

describe('AMENDMENTS-008 B36 — simRequiredWeaponFields', () => {
  it('requires useAnimationTicks for every archetype and autoReuse for the melee archetypes only', () => {
    for (const a of ['swing-melee', 'thrust', 'returning', 'bow-gun', 'magic-bolt', 'piercing-beam', 'minion-sentry', 'whip', 'explosive-aoe'] as const) {
      expect(simRequiredWeaponFields(a)).toContain('useAnimationTicks')
      expect(simRequiredWeaponFields(a).includes('autoReuse')).toBe(['swing-melee', 'thrust', 'returning'].includes(a))
    }
  })

  it('the validate downgrade now fires on an unverified cadence (useAnimationTicks) / melee autoReuse', () => {
    const sword = weapon(1, 'Sword', { labBehavior: { kind: 'archetype', params: { archetype: 'swing-melee', arcDegrees: 180, reachTiles: 2 } } })
    const blocked = (w: Weapon, fields: string[]) => downgradeUnverifiedArchetype({ ...w, _prov: { ...w._prov, verified: false, unverifiedFields: fields } })
    expect(blocked(sword, ['useAnimationTicks']).warning?.code).toBe('W_LAB_DOWNGRADE')
    expect(blocked(sword, ['autoReuse']).warning?.message).toContain('autoReuse')
    const bow = weapon(2, 'Bow', {
      damageClass: 'ranged',
      ammoClass: 'wooden-arrow',
      shootSpeedTps: 24,
      labBehavior: { kind: 'archetype', params: { archetype: 'bow-gun', ammoClass: 'wooden-arrow', projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true } },
    })
    expect(blocked(bow, ['useAnimationTicks']).warning?.code).toBe('W_LAB_DOWNGRADE')
    expect(blocked(bow, ['autoReuse']).warning).toBeUndefined() // pipeline rule: melee archetypes only (the merge guard check covers the rest)
  })
})

describe('derivation formulas', () => {
  it('swing reach = sprite diagonal × scale ÷ 16 px (B44)', () => {
    expect(swingReachTiles(32, 32, 1)).toBe(2.828)
    expect(swingReachTiles(40, 40, 1.1)).toBe(3.889)
  })
  it('thrust reach = sprite diagonal × scale ÷ 16 px + 1 tile arm extension (B46)', () => {
    expect(thrustReachTiles(32, 32, 0.8)).toBe(3.263) // Copper Shortsword
    expect(thrustReachTiles(36, 38, 1)).toBe(4.272) // Slime Spear
  })
  it('a stated range is detected (B56: it is the reach; B46 only where none is stated)', () => {
    expect(statedRangeTiles('The Spear has a maximum range of approximately 5.05 tiles. Melee speed bonuses …')).toEqual({ tiles: 5.05, quote: 'The Spear has a maximum range of approximately 5.05 tiles' })
    expect(statedRangeTiles('The Copper Shortsword is a pre-Hardmode shortsword.')).toBeUndefined()
  })
  it('B47 / B48(b) quote checks', () => {
    expect(statesSlightSpread('When used, it rapidly fires bullets at a slight spread')).toBe(true)
    expect(statesSlightSpread('it fires bullets very rapidly in a small spread.')).toBe(true)
    expect(statesSlightSpread('it fires bullets in a slight spread of 6°')).toBe(false) // an angle is stated: not B47
    expect(statesSlightSpread('it fires bullets in a wide spread.')).toBe(false)
    expect(statesDamagePct("quickly fires a red bolt, which deals 50% of the weapon's damage (9 base damage)", 50)).toBe(true)
    expect(statesDamagePct("deals 150% of the weapon's damage", 50)).toBe(false)
  })
  it('infobox debuff rows → chance (whole %) and duration ticks (B5 range)', () => {
    expect(chancePctOf('100%')).toBe(100)
    expect(chancePctOf('33.33%')).toBeUndefined()
    expect(durationTicksOf('7 seconds')).toBe(420)
    expect(durationTicksOf('1−4 seconds')).toEqual({ minTicks: 60, maxTicks: 240 })
    expect(durationTicksOf('4–6 seconds')).toEqual({ minTicks: 240, maxTicks: 360 })
    expect(durationTicksOf('0.5 seconds')).toBe(30)
    expect(durationTicksOf('1.01 seconds')).toBeUndefined() // not whole ticks
    expect(durationTicksOf('until hit')).toBeUndefined()
    const rows = [
      { label: 'Buff', value: 'Striking Moment' },
      { label: 'Duration', value: '5 seconds' },
      { label: 'Debuff', value: 'Hellfire' },
      { label: 'Debuff tooltip', value: 'Slowly losing life' },
      { label: 'Chance', value: '25%' },
      { label: 'Duration', value: '5 seconds' },
      { label: 'Use', value: '' },
    ]
    expect(infoboxDebuffs({ title: 'T', itemIds: [], projectileIds: [], buffIds: [], rows })).toEqual([{ name: 'Hellfire', chance: '25%', duration: '5 seconds' }])
  })
  it('projectile velocity = shootSpeed × (1 + extraUpdates) × 60/16 tiles/s', () => {
    expect(projectileVelocityTps(6, 0)).toBe(22.5)
    expect(projectileVelocityTps(10, 2)).toBe(112.5)
  })
  it('pierce = penetrate − 1 (B37: extra targets after the first); −1 = infinite', () => {
    expect(pierceFromPenetrate(1)).toBe(0)
    expect(pierceFromPenetrate(3)).toBe(2)
    expect(pierceFromPenetrate(-1)).toBe('infinite')
    expect(pierceFromPenetrate(0)).toBeUndefined()
  })
  it('quote checks for residual values', () => {
    expect(statesPierce('The lasers do not pierce enemies.', 0)).toBe(true)
    expect(statesPierce('a bolt which can pierce once', 1)).toBe(true)
    expect(statesPierce('pierces two enemies', 2)).toBe(true)
    expect(statesPierce('a bolt which can pierce once', 2)).toBe(false)
    expect(statesPierce('piercing an infinite number of enemies', 'infinite')).toBe(true)
    expect(statesLifetime('dissipates after 5 seconds', 300)).toBe(true)
    expect(statesLifetime('lasts 90 ticks', 90)).toBe(true)
    expect(statesLifetime('dissipates after 5 seconds', 600)).toBe(false)
  })
  it('family = the wiki category tag of the weapon article', () => {
    expect(familyOf(['broadswords', 'projectile-melee'])).toBe('swing-melee')
    expect(familyOf(['spears'])).toBe('thrust')
    expect(familyOf(['repeaters'])).toBe('bow-gun')
    expect(familyOf(['magic-guns'])).toBe('magic-bolt')
    expect(familyOf(['yoyos'])).toBeUndefined()
  })
})

describe('article screen', () => {
  it('reads the lead and behavior sections only (no crafting tables, history, references)', () => {
    const html = page(4, 'The Test Sword is a broadsword.', {
      Crafting: '<table><tr><td>Explosive Bullet</td></tr></table>',
      Notes: '<ul><li>It deals no special damage.<sup class="reference">[1]</sup></li></ul>',
      History: '<ul><li>Now fires three beams and explodes.</li></ul>',
    })
    const text = behaviorText(html)
    expect(text).toContain('The Test Sword is a broadsword.')
    expect(text).toContain('It deals no special damage.')
    expect(text).not.toMatch(/Explosive|explodes|three|\[1\]/)
  })
  it('flags per family; a flag never assigns a value', () => {
    expect(screenText('bow-gun', 'It fires three arrows at once.').map((f) => f.id)).toContain('multi-projectile')
    expect(screenText('magic-bolt', 'a bolt which homes onto enemies').map((f) => f.id)).toEqual(['homing'])
    expect(screenText('swing-melee', 'It fires a beam when swung.').map((f) => f.id)).toEqual(['projectile'])
    expect(screenText('swing-melee', 'It homes in.')).toEqual([]) // homing is a projectile-family rule
    expect(screenText('bow-gun', 'The Wooden Bow is a pre-Hardmode bow.')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// buildLabParams on synthetic data
// ---------------------------------------------------------------------------------------------

const FETCHED = '2026-10-13T05:00:00.000Z'
const prov = (unverifiedFields: string[] = []): Weapon['_prov'] => ({
  gameVersion: '1.4.5.8',
  sources: [{ kind: 'cargo:Items', url: 'https://terraria.wiki.gg/wiki/X', fetchedAt: '2026-10-13' }],
  verified: unverifiedFields.length === 0,
  unverifiedFields,
  editorialFields: [],
})
function weapon(id: number, name: string, over: Partial<Weapon> = {}): Weapon {
  return Weapon.parse({
    id,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    type: 'weapon',
    tags: [],
    wikiUrl: `https://terraria.wiki.gg/wiki/${name.replaceAll(' ', '_')}`,
    acquisition: [],
    _prov: prov(),
    damageClass: 'melee',
    damage: 10,
    critPct: 0,
    useTimeTicks: 20,
    useAnimationTicks: 20,
    knockback: 5,
    autoReuse: false,
    labBehavior: { kind: 'limitation', inGameBehavior: 'x', reason: 'default', sourceUrl: 'https://terraria.wiki.gg/wiki/X' },
    ...over,
  })
}
function page(itemId: number, lead: string, sections: Record<string, string> = {}, ids: string[] = []): string {
  return `<div class="mw-parser-output"><div class="infobox item"><div class="title">T</div><div class="section ids"><ul><li>Internal Item ID: ${itemId}</li>${ids.map((i) => `<li>${i}</li>`).join('')}</ul></div></div><p>${lead}</p>${Object.entries(sections)
    .map(([h, body]) => `<h2><span class="mw-headline" id="${h}">${h}</span></h2>${body}`)
    .join('')}</div>`
}
const article = (title: string, html: string, revid = 100): Article => ({ title, resolvedTitle: title, revid, html, fetchedAt: FETCHED })

const STAT_DEFAULTS = { useStyle: 1, shoot: 0, shootSpeed: 0, noMelee: false, channel: false, scale: 1 }
function fixture(
  specs: { w: Weapon; stats: Record<string, unknown>; html: string; sprite?: [number, number] }[],
  entries: LabParamsEntry[] = [],
  projectiles: Record<number, Record<string, unknown>> = {},
): LabBuildInput {
  const rulePages = [...new Set(Object.values(RULE_QUOTES).map((q) => q.page))].map((p) =>
    article(p, `<div class="mw-parser-output"><p>${Object.values(RULE_QUOTES).filter((q) => q.page === p).map((q) => q.quote).join('. ')}</p></div>`),
  )
  const articles = new Map<string, Article>([...rulePages, ...specs.map((s) => article(s.w.name, s.html))].map((a) => [a.title, a]))
  const info = { items: new Map(specs.map((s) => [s.w.id, { id: s.w.id, internalName: s.w.name, name: s.w.name, stats: { ...STAT_DEFAULTS, ...s.stats } }])) } as unknown as Iteminfo
  const projectileinfo: Projectileinfo = {
    title: 'Module:Projectileinfo/data',
    rev: 1030091,
    fetchedAt: FETCHED,
    generated: '',
    projectiles: new Map(Object.entries(projectiles).map(([id, stats]) => [Number(id), { id: Number(id), name: typeof stats.name === 'string' ? stats.name : `P${id}`, stats }])),
  }
  const sprites = new Map(
    specs.flatMap((s): [number, SpriteManifestFile][] =>
      s.sprite
        ? [[s.w.id, { path: `/sprites/weapons/${s.w.id}.png`, ref: `i:${s.w.id}`, wikiFileUrl: `https://terraria.wiki.gg/wiki/File:${s.w.id}.png`, sha1: 'a'.repeat(40), bytes: 100, width: s.sprite[0], height: s.sprite[1], rights: 're-logic' }]]
        : [],
    ),
  )
  return {
    weapons: specs.map((s) => s.w),
    iteminfo: info,
    projectileinfo,
    articles,
    evidence: new Evidence(articles),
    pageOf: new Map(specs.map((s) => [s.w.id, s.w.name])),
    rows: new Map(specs.map((s): [number, CargoRow] => [s.w.id, { debuffs: '' }])),
    sprites,
    buffs: [],
    buffTable: [],
    overlay: LabParamsOverlay.parse({ overlay: 'lab-params', authoredAt: '2026-10-13', notes: [], entries }),
  }
}

const SWORD = weapon(4, 'Iron Broadsword', { tags: ['broadswords'] })
const swordSpec = (w = SWORD, lead = 'The Iron Broadsword is a pre-Hardmode broadsword.') => ({ w, stats: { useStyle: 1 }, html: page(w.id, lead), sprite: [32, 32] as [number, number] })
const BOW = weapon(39, 'Wooden Bow', { tags: ['bows'], damageClass: 'ranged', ammoClass: 'wooden-arrow', shootSpeedTps: 22.875, knockback: 0 })
const bowSpec = (lead = 'The Wooden Bow is a pre-Hardmode bow.') => ({ w: BOW, stats: { useStyle: 5, shoot: 1, shootSpeed: 6.1 }, html: page(39, lead) })
const BULLET: Item = {
  id: 97,
  name: 'Musket Ball',
  slug: 'musket-ball',
  type: 'item',
  tags: [],
  wikiUrl: 'https://terraria.wiki.gg/wiki/Musket_Ball',
  acquisition: [],
  _prov: prov(),
  category: 'ammo',
  isStation: false,
  ammoStats: { ammoClass: 'musket-ball', damage: 7, velocityBonusTps: 15 },
}
const STAFF = weapon(739, 'Amethyst Staff', { tags: ['wands'], damageClass: 'magic', manaCost: 7, shootSpeedTps: 22.5 })
const staffSpec = (w = STAFF, lead = 'The Amethyst Staff is a pre-Hardmode wand.') => ({ w, stats: { useStyle: 5, shoot: 121, shootSpeed: 6 }, html: page(739, lead) })
const PROJ = { 121: { extraUpdates: 0, penetrate: 1 } }

describe('buildLabParams', () => {
  it('derives a plain broadsword: 180° arc, sprite-diagonal reach, provenance of every input', () => {
    const out = buildLabParams(fixture([swordSpec()]))
    const w = out.weapons[0]
    expect(w.labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'swing-melee', arcDegrees: 180, reachTiles: 2.828 } })
    expect(out.decisions[0]).toMatchObject({ method: 'derived', flags: [] })
    expect(w._prov.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['cargo:Imageinfo', 'wiki-article']))
    expect(w._prov.editorialFields).toEqual([])
    expect(w._prov.modeledFields).toEqual(['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles']) // B44 via B49
    expect(assessWeapon(w)).toMatchObject({ simulable: true, archetype: 'swing-melee' })
  })

  it('a flagged weapon is never auto-parameterized: limitation naming what was flagged', () => {
    const tooltip = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], behaviorText: 'Hitting enemies restores life' })
    const out = buildLabParams(fixture([swordSpec(tooltip)]))
    expect(out.weapons[0].labBehavior).toMatchObject({ kind: 'limitation', reason: expect.stringContaining('extra effects on hit') })
    expect(out.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'flagged', flags: [{ id: 'on-hit', evidence: 'tooltip "Hitting"' }] })
    // a flavor-text tooltip is screened like the article text, not flagged for existing
    const flavor = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], behaviorText: "'A trusty blade for a new adventurer.'" })
    expect(buildLabParams(fixture([swordSpec(flavor)])).decisions[0].method).toBe('derived')
  })

  it('B48(a): a reuse delay is part of the sim cadence now — no limitation; the Use time rule is cited', () => {
    const w = weapon(39, 'Wooden Bow', { tags: ['bows'], damageClass: 'ranged', ammoClass: 'wooden-arrow', shootSpeedTps: 22.875, knockback: 0, reuseDelayTicks: 14 })
    const out = buildLabParams(fixture([{ ...bowSpec(), w, stats: { useStyle: 5, shoot: 1, shootSpeed: 6.1, reuseDelay: 14 } }]))
    expect(out.decisions[0]).toMatchObject({ method: 'derived' })
    expect(out.decisions[0].derivation.join(' ')).toContain('reuse delay: 20 + 14 ticks')
    expect(out.weapons[0]._prov.sources.some((x) => x.url.endsWith('/Use_time'))).toBe(true)
    expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true })
  })

  it('a reviewed overlay entry resolves a flagged weapon (editorial, curated source); its quote is revision-checked', () => {
    const tooltip = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], behaviorText: 'Hitting enemies restores life' })
    const entry: LabParamsEntry = {
      itemId: 4,
      name: 'Iron Broadsword',
      decision: 'archetype',
      archetype: 'swing-melee',
      evidence: [{ page: 'Iron Broadsword', quote: 'The Iron Broadsword is a pre-Hardmode broadsword.' }],
      why: 'healing does not change damage dealt',
    }
    const out = buildLabParams(fixture([swordSpec(tooltip)], [entry]))
    expect(out.decisions[0].method).toBe('overlay')
    expect(out.weapons[0]._prov.editorialFields).toEqual(['labBehavior'])
    expect(out.weapons[0]._prov.sources.some((s) => s.kind === 'curated' && s.overlay === 'lab-params')).toBe(true)
    expect(() => buildLabParams(fixture([swordSpec(tooltip)], [{ ...entry, evidence: [{ page: 'Iron Broadsword', quote: 'a quote that is not on the page' }] }]))).toThrow(/quote not found verbatim/)
    expect(() => buildLabParams(fixture([swordSpec(tooltip)], [{ ...entry, name: 'Gold Broadsword' }]))).toThrow(/name/)
    expect(() => buildLabParams(fixture([swordSpec()], [entry]))).toThrow(/not needed/) // residuals only
  })

  it('an overlay limitation decision emits its quoted reason', () => {
    const entry: LabParamsEntry = { itemId: 4, name: 'Iron Broadsword', decision: 'limitation', reason: 'Its swing creates a slash projectile.', evidence: [{ page: 'Iron Broadsword', quote: 'The Iron Broadsword is a pre-Hardmode broadsword.' }], why: 'x' }
    const out = buildLabParams(fixture([swordSpec(SWORD, 'The Iron Broadsword is a pre-Hardmode broadsword. It fires a beam.')], [entry]))
    expect(out.weapons[0].labBehavior).toMatchObject({ kind: 'limitation', reason: 'Its swing creates a slash projectile.' })
    expect(out.weapons[0]._prov.editorialFields).toEqual(['labBehavior'])
  })

  describe('thrust (AMENDMENTS-010 B46)', () => {
    const SHORT = weapon(3507, 'Copper Shortsword', { tags: ['shortswords'] })
    const stab = { 938: { name: 'Copper Shortsword', extraUpdates: 1, penetrate: -1 } }
    const shortSpec = (lead = 'The Copper Shortsword is a pre-Hardmode shortsword.', stats: Record<string, unknown> = {}) => ({
      w: SHORT,
      stats: { useStyle: 13, shoot: 938, shootSpeed: 2.1, noMelee: true, scale: 0.8, ...stats },
      html: page(3507, lead, {}, ['Internal Projectile ID: 938']),
      sprite: [32, 32] as [number, number],
    })

    it('a plain stab (the shoot projectile IS the stab) gets the modeled reach, listed in modeledFields', () => {
      const out = buildLabParams(fixture([shortSpec()], [], stab))
      expect(out.decisions[0]).toMatchObject({ family: 'thrust', method: 'derived', flags: [], modeled: ['labBehavior.params.reachTiles'] })
      expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'thrust', reachTiles: 3.263 } })
      expect(out.weapons[0]._prov.modeledFields).toEqual(['labBehavior.params.reachTiles'])
      expect(out.decisions[0].derivation[0]).toContain('AMENDMENTS-010 B46')
      expect(modelingConventionFor('thrust', 'labBehavior.params.reachTiles')?.ruling).toBe('AMENDMENTS-010 B46')
      expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true, archetype: 'thrust' })
    })

    it('AMENDMENTS-012 B56: a range the article states IS the reach — extracted wiki data, not modeled, no convention label', () => {
      const lead = 'The Copper Shortsword has a maximum range of approximately 4.5 tiles.'
      const out = buildLabParams(fixture([shortSpec(lead)], [], stab))
      expect(out.decisions[0]).toMatchObject({ method: 'derived', modeled: [], thrustReach: { conventionTiles: 3.263, statedTiles: 4.5 } })
      expect(out.decisions[0].derivation[0]).toContain('AMENDMENTS-012 B56')
      expect(out.decisions[0].derivation[0]).toContain('"The Copper Shortsword has a maximum range of approximately 4.5 tiles"')
      expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'thrust', reachTiles: 4.5 } })
      expect(out.weapons[0]._prov.modeledFields).toBeUndefined()
      expect(out.weapons[0]._prov.editorialFields).toEqual([])
      expect(out.weapons[0]._prov.sources).toContainEqual(expect.objectContaining({ kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Copper_Shortsword', rev: 100 }))
      expect(out.weapons[0]._prov.sources.map((s) => s.kind)).not.toContain('cargo:Imageinfo') // the sprite is not an input
      const created = createLabSim({ weapon: out.weapons[0] })
      if (!created.ok) throw new Error(JSON.stringify(created.refusal))
      expect(created.sim.approximations.map((a) => a.id)).not.toContain('thrust-reach')
    })

    it('B56: the stated reach needs no sprite; a flagged article still needs a reviewed entry (the reach never comes from it)', () => {
      const lead = 'The Copper Shortsword has a maximum range of approximately 4.5 tiles. Both modifiers increase the average damage output by the same amount.'
      const noSprite = buildLabParams(fixture([{ ...shortSpec('The Copper Shortsword has a maximum range of approximately 4.5 tiles.'), sprite: undefined }], [], stab))
      expect(noSprite.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'thrust', reachTiles: 4.5 } })
      expect(buildLabParams(fixture([shortSpec(lead)], [], stab)).decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'flagged' })
      const entry: LabParamsEntry = { itemId: 3507, name: 'Copper Shortsword', decision: 'archetype', archetype: 'thrust', evidence: [{ page: 'Copper Shortsword', quote: 'Both modifiers increase the average damage output by the same amount.' }], why: 'modifier advice' }
      const out = buildLabParams(fixture([shortSpec(lead)], [entry], stab))
      expect(out.decisions[0]).toMatchObject({ method: 'overlay', modeled: [] })
      expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'thrust', reachTiles: 4.5 } })
      expect(out.weapons[0]._prov.modeledFields).toBeUndefined()
    })

    it('B56: the stated-range sentence must be verbatim on the cached revision (quote-checked), else the build fails', () => {
      const lead = 'The Copper Shortsword has a maximum range of approximately 4.5<sup class="reference">[1]</sup> tiles.'
      expect(() => buildLabParams(fixture([shortSpec(lead)], [], stab))).toThrow(/stated thrust range: quote not found verbatim/)
    })

    it('a projectile other than the stab is a screen flag; a held stab is not a plain thrust', () => {
      const other = buildLabParams(fixture([shortSpec(undefined, { shoot: 939 })], [], { 939: { name: 'Something Else' } }))
      expect(other.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'not-thrust' })
      const extra = buildLabParams(fixture([{ ...shortSpec(), html: page(3507, 'The Copper Shortsword is a pre-Hardmode shortsword.', {}, ['Internal Projectile ID: 938, 940']) }], [], stab))
      expect(extra.decisions[0].flags).toEqual([{ id: 'infobox-projectile', evidence: 'infobox projectile 940' }])
      const held = buildLabParams(fixture([shortSpec(undefined, { channel: true })], [], stab))
      expect(held.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'not-thrust', reason: expect.stringContaining('held use') })
    })
  })

  describe('bow-gun slight spread (AMENDMENTS-010 B47)', () => {
    const GUN = weapon(98, 'Minishark', { tags: ['guns'], damageClass: 'ranged', ammoClass: 'musket-ball', shootSpeedTps: 26.25, knockback: 0, autoReuse: true })
    const lead = 'When used, it rapidly fires bullets at a slight spread.'
    const gunSpec = (w = GUN, text = lead) => ({ w, stats: { useStyle: 5, shoot: 10, shootSpeed: 7 }, html: page(w.id, text) })
    const entry = (over: Partial<Extract<LabParamsEntry, { decision: 'archetype' }>> = {}): LabParamsEntry => ({
      itemId: 98,
      name: 'Minishark',
      decision: 'archetype',
      archetype: 'bow-gun',
      slightSpread: true,
      evidence: [{ page: 'Minishark', quote: lead }],
      why: 'B47',
      ...over,
    })

    it('"slight spread" without an angle → 10°, modeled (B49) and labeled by the sim', () => {
      const out = buildLabParams(fixture([gunSpec()], [entry()]))
      expect(out.weapons[0].labBehavior).toMatchObject({ params: { spreadDegrees: 10, projectilesPerUse: 1 } })
      expect(out.weapons[0]._prov.modeledFields).toEqual(['labBehavior.params.spreadDegrees'])
      expect(out.weapons[0]._prov.editorialFields).toEqual(['labBehavior'])
      const created = createLabSim({ weapon: out.weapons[0], ammo: BULLET })
      if (!created.ok) throw new Error(JSON.stringify(created.refusal))
      expect(created.sim.approximations).toContainEqual(expect.objectContaining({ id: 'slight-spread', ruling: 'AMENDMENTS-010 B47' }))
    })

    it('needs the slight/small wording with no angle, a gun, and no explicit spreadDegrees', () => {
      const wide = 'When used, it rapidly fires bullets at a wide spread.'
      expect(() => buildLabParams(fixture([gunSpec(GUN, wide)], [entry({ evidence: [{ page: 'Minishark', quote: wide }] })]))).toThrow(/slight or small spread/)
      expect(() => buildLabParams(fixture([gunSpec()], [entry({ spreadDegrees: 10 })]))).toThrow(/exclusive/)
      const bow = weapon(98, 'Minishark', { tags: ['bows'], damageClass: 'ranged', ammoClass: 'musket-ball', shootSpeedTps: 26.25, knockback: 0 })
      expect(() => buildLabParams(fixture([gunSpec(bow)], [entry()]))).toThrow(/guns \(Category:Guns\) only/)
    })
  })

  describe('per-projectile damage multiplier (AMENDMENTS-010 B48(b))', () => {
    const RUBY = weapon(743, 'Ruby Staff', { tags: ['wands'], damageClass: 'magic', manaCost: 9, damage: 18 })
    const lead = "The Ruby Staff quickly fires a red bolt, which deals 50% of the weapon's damage (9 base damage) and does not pierce."
    const spec = { w: RUBY, stats: { useStyle: 5, shoot: 125, shootSpeed: 9 }, html: page(743, lead) }
    const entry = (over: Partial<Extract<LabParamsEntry, { decision: 'archetype' }>> = {}): LabParamsEntry => ({
      itemId: 743,
      name: 'Ruby Staff',
      decision: 'archetype',
      archetype: 'magic-bolt',
      damageMultiplierPct: 50,
      evidence: [{ page: 'Ruby Staff', quote: lead }],
      why: 'test',
      ...over,
    })
    const proj = { 125: { extraUpdates: 0, penetrate: 1 } }

    it('a quoted percentage lands on the bolt; the sim deals ⌊18 × 50%⌋ = 9 = the wiki\'s "(9 base damage)"', () => {
      const out = buildLabParams(fixture([spec], [entry()], proj))
      expect(out.weapons[0].labBehavior).toMatchObject({ params: { projectile: { velocityTps: 33.75, pierce: 0, damageMultiplierPct: 50 } } })
      const created = createLabSim({ weapon: out.weapons[0] })
      expect(created.ok && created.sim.weapon.baseHitDamage).toBe(9)
    })

    it('the percentage must be quoted, and a quoted base damage must match the sim rounding', () => {
      expect(() => buildLabParams(fixture([spec], [entry({ damageMultiplierPct: 60 })], proj))).toThrow(/60% of the weapon's damage/)
      const off = "The Ruby Staff quickly fires a red bolt, which deals 50% of the weapon's damage (10 base damage) and does not pierce."
      expect(() => buildLabParams(fixture([{ ...spec, html: page(743, off) }], [entry({ evidence: [{ page: 'Ruby Staff', quote: off }] })], proj))).toThrow(/states 10 base damage/)
    })
  })

  describe('damage over time from the infobox (AMENDMENTS-010 B48(c))', () => {
    const buffFixture = (id: string, name: string, gameBuffId: number, dps?: number, unverifiedDot = false) =>
      Buff.parse({ id, gameBuffId, name, isDebuff: true, effects: [], ...(dps !== undefined ? { dot: { dps } } : {}), wikiUrl: `https://terraria.wiki.gg/wiki/${name}`, _prov: { ...prov(unverifiedDot ? ['dot'] : []) } })
    const BUFFS = [buffFixture('frostbite', 'Frostbite', 324, 25), buffFixture('confused', 'Confused', 31), buffFixture('betsys-curse', "Betsy's Curse", 203, undefined, true)]
    const TABLE = [
      { id: 324, name: 'Frostbite', isDebuff: true },
      { id: 31, name: 'Confused', isDebuff: true },
      { id: 198, name: 'Striking Moment', isDebuff: false },
    ]
    const box = (rows: [string, string][], buffIds: number[] = []) => ({ title: 'T', itemIds: [726], projectileIds: [], buffIds, rows: rows.map(([label, value]) => ({ label, value })) })
    const frost: [string, string][] = [['Debuff', 'Frostbite'], ['Debuff tooltip', 'x'], ['Chance', '100%'], ['Duration', '7 seconds']]

    it('one registry debuff with verified dps + chance + duration rows → modifiers.dot', () => {
      expect(deriveDot(box(frost, [324]), ['Frostbite'], BUFFS, TABLE)).toMatchObject({ kind: 'dot', dot: { buffId: 'frostbite', chancePct: 100, durationTicks: 420 } })
      // a granted buff ID (Buff IDs table type "Buff") is not an inflicted debuff
      expect(deriveDot(box(frost, [198, 324]), ['Frostbite'], BUFFS, TABLE)).toMatchObject({ kind: 'dot' })
    })

    it('a debuff without damage over time adds nothing (stays a reviewed screen flag)', () => {
      expect(deriveDot(box([['Debuff', 'Confused'], ['Chance', '100%'], ['Duration', '3 seconds']], [31]), ['Confused'], BUFFS, TABLE)).toEqual({ kind: 'no-dot', names: ['Confused'] })
      expect(deriveDot(undefined, [], BUFFS, TABLE)).toEqual({ kind: 'none' })
    })

    it('never guesses: unverified dps, unknown buffs, several debuffs, missing/odd rows, disagreeing sources', () => {
      expect(deriveDot(box([['Debuff', "Betsy's Curse"]]), ["Betsy's Curse"], BUFFS, TABLE)).toMatchObject({ kind: 'fail', reason: expect.stringContaining('unverified') })
      expect(deriveDot(box([], [999]), [], BUFFS, TABLE)).toMatchObject({ kind: 'fail', reason: expect.stringContaining('not in the buff registry') })
      expect(deriveDot(box(frost), ['Frostbite', 'Confused'], BUFFS, TABLE)).toMatchObject({ kind: 'fail', reason: expect.stringContaining('several debuffs') })
      expect(deriveDot(box([['Debuff', 'Frostbite'], ['Chance', '33.33%'], ['Duration', '7 seconds']]), [], BUFFS, TABLE)).toMatchObject({ kind: 'fail', reason: expect.stringContaining('chance') })
      expect(deriveDot(box([], [324]), ['Frostbite'], BUFFS, TABLE)).toMatchObject({ kind: 'fail', reason: expect.stringContaining('no chance and duration') })
      expect(deriveDot(box(frost, [31]), [], BUFFS, TABLE)).toMatchObject({ kind: 'fail' })
    })

    it('buildLabParams: a derived DoT resolves the inflicts-debuff data flag; an underivable damaging debuff is a limitation', () => {
      const STAFF2 = weapon(726, 'Frost Staff', { tags: ['wands'], damageClass: 'magic', manaCost: 12 })
      const html = (rows: [string, string][]) => page(726, 'The Frost Staff is a Hardmode wand.', {}, ['Internal Buff ID: 324']).replace('<div class="section ids">', `<table>${rows.map(([l, v]) => `<tr><th>${l}</th><td>${v}</td></tr>`).join('')}</table><div class="section ids">`)
      const spec = (rows: [string, string][]) => ({ w: STAFF2, stats: { useStyle: 5, shoot: 359, shootSpeed: 16 }, html: html(rows) })
      const input = (rows: [string, string][]) => ({ ...fixture([spec(rows)], [], { 359: { extraUpdates: 0, penetrate: 1 } }), buffs: BUFFS, buffTable: TABLE, rows: new Map([[726, { debuffs: 'Frostbite' }]]) })
      const out = buildLabParams(input(frost))
      expect(out.decisions[0]).toMatchObject({ method: 'derived', modifiers: { dot: { buffId: 'frostbite', chancePct: 100, durationTicks: 420 } } })
      expect(out.weapons[0].labBehavior).toMatchObject({ kind: 'archetype', modifiers: { dot: { buffId: 'frostbite' } } })
      expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true, requiresBuffIds: ['frostbite'] })
      const odd = buildLabParams(input([['Debuff', 'Frostbite'], ['Chance', '1/3'], ['Duration', '7 seconds']]))
      expect(odd.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'dot-underivable' })
    })
  })

  it('bow-gun: single shot / no spread / ammo unchanged only on a clean screen; counts need a quote', () => {
    expect(buildLabParams(fixture([bowSpec()])).weapons[0].labBehavior).toEqual({
      kind: 'archetype',
      params: { archetype: 'bow-gun', ammoClass: 'wooden-arrow', projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true },
    })
    const multi = bowSpec('The Wooden Bow fires three arrows at once.')
    expect(buildLabParams(fixture([multi])).decisions[0].reasonKey).toBe('flagged')
    const entry = (n: number): LabParamsEntry => ({
      itemId: 39,
      name: 'Wooden Bow',
      decision: 'archetype',
      archetype: 'bow-gun',
      projectilesPerUse: n,
      spreadDegrees: 0,
      evidence: [{ page: 'Wooden Bow', quote: 'The Wooden Bow fires three arrows at once.' }],
      why: 'test',
    })
    expect(buildLabParams(fixture([multi], [entry(3)])).weapons[0].labBehavior).toMatchObject({ params: { projectilesPerUse: 3 } })
    expect(() => buildLabParams(fixture([multi], [entry(4)]))).toThrow(/projectile count 4/)
  })

  it('magic-bolt: velocity from shootSpeed × (1 + extraUpdates), pierce from penetrate', () => {
    const out = buildLabParams(fixture([staffSpec()], [], { 121: { extraUpdates: 1, penetrate: 3 } }))
    expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'magic-bolt', projectilesPerUse: 1, spreadDegrees: 0, projectile: { velocityTps: 45, pierce: 2 } } })
  })

  it('magic-bolt velocity is cross-checked against the infobox effective velocity', () => {
    const withVelocity = (v: string) => ({ ...staffSpec(), html: page(739, 'The Amethyst Staff is a pre-Hardmode wand.').replace('<div class="section ids">', `<table><tr><th>Velocity</th><td>${v}</td></tr></table><div class="section ids">`) })
    expect(buildLabParams(fixture([withVelocity('12 (effective)')], [], { 121: { extraUpdates: 1, penetrate: 1 } })).decisions[0].method).toBe('derived')
    expect(buildLabParams(fixture([withVelocity('6')], [], { 121: { extraUpdates: 1, penetrate: 1 } })).decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'velocity-mismatch' })
  })

  it('magic-bolt residual pierce / lifetime must be stated by a quote (the article overrides Projectileinfo)', () => {
    const lead = 'The Amethyst Staff fires a bolt which can pierce once and automatically dissipates after 5 seconds.'
    const entry = (over: Partial<Extract<LabParamsEntry, { decision: 'archetype' }>>): LabParamsEntry => ({
      itemId: 739,
      name: 'Amethyst Staff',
      decision: 'archetype',
      archetype: 'magic-bolt',
      evidence: [{ page: 'Amethyst Staff', quote: lead }],
      why: 'test',
      ...over,
    })
    const out = buildLabParams(fixture([staffSpec(STAFF, lead)], [entry({ pierce: 1, lifetimeTicks: 300 })], PROJ))
    expect(out.weapons[0].labBehavior).toMatchObject({ params: { projectile: { velocityTps: 22.5, pierce: 1, lifetimeTicks: 300 } } })
    expect(() => buildLabParams(fixture([staffSpec(STAFF, lead)], [entry({ pierce: 2 })], PROJ))).toThrow(/pierce of 2/)
    expect(() => buildLabParams(fixture([staffSpec(STAFF, lead)], [entry({ lifetimeTicks: 600 })], PROJ))).toThrow(/lifetime of 600/)
    expect(() => buildLabParams(fixture([staffSpec(STAFF, lead)], [entry({ inheritsAmmoProjectile: true })], PROJ))).toThrow(/no ammo/)
  })

  it('guard contract: pipeline-rule fields are left to the validate downgrade; other guard refusals become limitations now', () => {
    const sword = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], autoReuse: undefined, _prov: prov(['autoReuse']) })
    const kept = buildLabParams(fixture([swordSpec(sword)]))
    expect(kept.weapons[0].labBehavior.kind).toBe('archetype')
    expect(kept.decisions[0].pipelineBlocked).toEqual(['autoReuse'])
    expect(downgradeUnverifiedArchetype(kept.weapons[0]).warning?.code).toBe('W_LAB_DOWNGRADE')
    const staff = weapon(739, 'Amethyst Staff', { tags: ['wands'], damageClass: 'magic', manaCost: 7, autoReuse: undefined, _prov: prov(['autoReuse']) })
    const refused = buildLabParams(fixture([staffSpec(staff)], [], PROJ))
    expect(refused.weapons[0].labBehavior).toMatchObject({ kind: 'limitation', reason: 'required simulation parameter unverified: autoReuse' })
    expect(refused.decisions[0].reasonKey).toBe('guard:unverified-required-field')
  })

  it('weapons outside the four families are untouched', () => {
    const yoyo = weapon(3278, 'Wooden Yoyo', { tags: ['yoyos'] })
    const input = fixture([swordSpec()])
    const out = buildLabParams({ ...input, weapons: [...input.weapons, yoyo] })
    expect(out.weapons[1]).toBe(yoyo)
    expect(out.decisions).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Contract over the committed dataset
// ---------------------------------------------------------------------------------------------

const DATA_DIR = join(import.meta.dirname, '../../src/data')
const emitted = existsSync(join(DATA_DIR, 'weapons.detail.json'))

describe.runIf(emitted)('emitted Lab params (src/data) honor the sim guard contract (B37)', () => {
  const weapons = JSON.parse(readFileSync(join(DATA_DIR, 'weapons.detail.json'), 'utf8')) as Weapon[]
  const items = JSON.parse(readFileSync(join(DATA_DIR, 'items.detail.json'), 'utf8')) as Item[]
  const buffs = JSON.parse(readFileSync(join(DATA_DIR, 'buffs.json'), 'utf8')) as Buff[]
  const archetyped = weapons.filter((w) => w.labBehavior.kind === 'archetype')

  it('every archetype weapon passes the ArchetypeParams schema and src/sim assessWeapon', () => {
    expect(archetyped.length).toBeGreaterThan(0)
    for (const w of archetyped) {
      if (w.labBehavior.kind !== 'archetype') continue
      expect(ArchetypeParams.safeParse(w.labBehavior.params).success, w.name).toBe(true)
      expect(assessWeapon(w), w.name).toMatchObject({ simulable: true })
    }
  })

  it('a sample per archetype runs in the engine and damages the default dummy', () => {
    const byArchetype = new Map<string, Weapon[]>()
    for (const w of archetyped) if (w.labBehavior.kind === 'archetype') byArchetype.set(w.labBehavior.params.archetype, [...(byArchetype.get(w.labBehavior.params.archetype) ?? []), w])
    expect([...byArchetype.keys()].length).toBeGreaterThan(0)
    for (const list of byArchetype.values()) {
      for (const w of [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]) {
        const lab = w.labBehavior
        const ammo = lab.kind === 'archetype' && lab.params.archetype === 'bow-gun' ? items.find((i) => i.ammoStats?.ammoClass === (lab.params as { ammoClass: string }).ammoClass && i.ammoStats.damage !== undefined) : undefined
        const created = createLabSim({ weapon: w, buffs, ...(ammo ? { ammo } : {}), seed: 7 })
        if (!created.ok) throw new Error(`${w.name}: ${JSON.stringify(created.refusal)}`)
        created.sim.setInput({ attacking: true, aim: null })
        created.sim.step(600)
        expect(created.sim.snapshot().stats.totalDamage, w.name).toBeGreaterThan(0)
      }
    }
  })

  it('B49: every modeled param resolves to a ratified convention; swing always lists its own, thrust its B46 reach unless stated (B56); nothing else is modeled', () => {
    for (const w of weapons) {
      const modeled = w._prov.modeledFields ?? []
      if (w.labBehavior.kind !== 'archetype') {
        expect(modeled, w.name).toEqual([])
        continue
      }
      const archetype = w.labBehavior.params.archetype
      for (const path of modeled) expect(modelingConventionFor(archetype, path)?.ruling, `${w.name} ${path}`).toMatch(/^AMENDMENTS-010 B4[467]$/)
      if (archetype === 'swing-melee') expect(modeled).toEqual(['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles'])
      if (archetype === 'thrust') expect([[], ['labBehavior.params.reachTiles']], w.name).toContainEqual(modeled) // [] = the article-stated range (B56)
      if (archetype === 'bow-gun' && modeled.length > 0) expect(w.labBehavior.params.spreadDegrees, w.name).toBe(10)
    }
  })

  it('every DoT modifier names a registry buff with a verified damage per second (B48(c))', () => {
    for (const w of archetyped) {
      const dot = w.labBehavior.kind === 'archetype' ? w.labBehavior.modifiers?.dot : undefined
      if (!dot) continue
      expect(buffs.find((b) => b.id === dot.buffId)?.dot?.dps, w.name).toBeGreaterThan(0)
      expect(assessWeapon(w)).toMatchObject({ simulable: true, requiresBuffIds: [dot.buffId] })
    }
  })
})
