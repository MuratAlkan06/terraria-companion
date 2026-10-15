/* P3-S0 Weapon Lab params: B36, derivation formulas, article screen, overlay rules, guard contract — on
 * synthetic records shaped like the 2026-10-13 sync — plus the contract over the emitted src/data. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArchetypeParams, Buff, modelingConventionFor, Prov, simRequiredWeaponFields, Weapon, type Archetype, type Item, type SpriteManifestFile } from '../../src/schemas'
import { assessWeapon, createLabSim, IMPLEMENTED_ARCHETYPES, type WeaponAssessment } from '../../src/sim'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import { parseItemTable } from '../parse/infobox'
import type { Iteminfo } from '../parse/iteminfo'
import type { Projectileinfo } from '../parse/projectileinfo'
import { blockingUnverifiedFields, downgradeUnverifiedArchetype } from '../validate/labDowngrade'
import { Evidence } from './evidence'
import {
  ammoExplosiveReason,
  CONTACT_AI_CLASSES,
  FAMILY_REASON,
  missingSentence,
  PENDING_FAMILIES,
  roundHalfEvenTicks,
  statedFuse,
  statedHitCap,
  statedIntervalTicks,
  statedSummonRate,
  statesTickRate,
  statesTiles,
  THROWN_FLAIL_REASON,
  WHIP_ARC_DEGREES,
} from './labFamilies'
import {
  behaviorText,
  buildLabParams,
  chancePctOf,
  deriveDot,
  durationTicksOf,
  familyOf,
  infoboxDebuffs,
  labFamilyPages,
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
import { LAB_DEFAULT_REASON } from './weapons'

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

  it('P3-S11: a classless weapon’s listed critPct (Unknown, B17) does not downgrade it — the wiki: classless damage never crits; any other class still does', () => {
    const bomb = weapon(166, 'Bomb', {
      damageClass: 'other',
      critPct: undefined,
      shootSpeedTps: 18.75,
      labBehavior: { kind: 'archetype', params: { archetype: 'explosive-aoe', blastRadiusTiles: 4, trigger: 'timed', fuseTicks: 180, falloff: 'none' } },
    })
    const blocked = (w: Weapon, fields: string[]) => downgradeUnverifiedArchetype({ ...w, _prov: { ...w._prov, verified: false, unverifiedFields: fields } })
    expect(blocked(bomb, ['critPct']).warning).toBeUndefined()
    expect(blocked(bomb, ['critPct', 'damage']).warning?.message).toContain('required simulation parameter unverified: damage')
    expect(blocked({ ...bomb, damageClass: 'ranged' }, ['critPct']).warning?.code).toBe('W_LAB_DOWNGRADE')
    expect(blockingUnverifiedFields('explosive-aoe', ['critPct', 'knockback'], 'other')).toEqual(['knockback'])
    expect(blockingUnverifiedFields('explosive-aoe', ['critPct', 'knockback'])).toEqual(['critPct', 'knockback']) // class unknown: still required
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
    // remaining-archetype families
    expect(familyOf(['yoyos', 'projectile-melee'])).toBe('returning')
    expect(familyOf(['whips'])).toBe('whip')
    expect(familyOf(['sentry-summon-items'])).toBe('minion-sentry')
    expect(familyOf(['launchers'])).toBe('explosive-aoe')
    expect(familyOf(['projectile-melee'])).toBeUndefined()
  })
  it('piercing-beam has no wiki category: the held-beam data signal, only outside every category family', () => {
    expect(familyOf([], { channel: true, magic: true })).toBe('piercing-beam')
    expect(familyOf([], { channel: true, ranged: true })).toBe('piercing-beam')
    expect(familyOf(['magic-guns'], { channel: true, magic: true })).toBe('magic-bolt') // the category family wins
    expect(familyOf([], { channel: true, melee: true })).toBeUndefined()
    expect(familyOf([], { channel: false, magic: true })).toBeUndefined()
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
    // AMENDMENTS-013 B67: plain present tense, no forward promise
    expect(out.decisions[0].reason).toBe('Not simulated: the wiki describes behavior beyond a plain broadsword swing (extra effects on hit) that has not been reviewed for the Lab.')
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

  it('a limitation card’s "What it does in-game" is behavior: never the tooltip’s flavor quote; a reviewed article sentence fills a flavor-only card', () => {
    const entry: LabParamsEntry = { itemId: 4, name: 'Iron Broadsword', decision: 'limitation', reason: 'Its swing creates a slash projectile.', evidence: [{ page: 'Iron Broadsword', quote: 'The Iron Broadsword is a pre-Hardmode broadsword.' }], why: 'x' }
    const lead = 'The Iron Broadsword is a pre-Hardmode broadsword. It fires a beam of light at the cursor.'
    const build = (w: Weapon, sentences: unknown[] = [], spec = swordSpec(w, lead), entries: LabParamsEntry[] = [entry]) => {
      const input = fixture([spec], entries)
      return buildLabParams({ ...input, overlay: LabParamsOverlay.parse({ ...input.overlay, inGameBehavior: sentences }) })
    }
    const flavorOnly = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], behaviorText: "'Greetings, programs!'" })
    const mixed = weapon(4, 'Iron Broadsword', { tags: ['broadswords'], behaviorText: "Fires a beam\n'Greetings, programs!'" })
    // the flavor line is dropped: behavior lines stay; flavor alone leaves the wiki pointer (the card: "No verified description yet.")
    expect(build(mixed).weapons[0].labBehavior).toMatchObject({ kind: 'limitation', inGameBehavior: 'Fires a beam' })
    expect(build(flavorOnly).weapons[0].labBehavior).toMatchObject({ kind: 'limitation', inGameBehavior: 'See the Iron Broadsword wiki page for its in-game behavior.' })
    // a reviewed, quote-checked sentence of the weapon's own article fills the flavor-only card (curated provenance)
    const sentence = { itemId: 4, name: 'Iron Broadsword', page: 'Iron Broadsword', quote: 'It fires a beam of light at the cursor.' }
    const filled = build(flavorOnly, [sentence]).weapons[0]
    expect(filled.labBehavior).toMatchObject({ kind: 'limitation', inGameBehavior: 'It fires a beam of light at the cursor.', reason: 'Its swing creates a slash projectile.' })
    expect(filled._prov.editorialFields).toEqual(['labBehavior'])
    expect(filled._prov.sources.some((s) => s.kind === 'curated' && s.overlay === 'lab-params')).toBe(true)
    // …checked like every quote, and only where it is needed
    expect(() => build(flavorOnly, [{ ...sentence, quote: 'It shoots rainbows at everything.' }])).toThrow(/quote not found verbatim/)
    expect(() => build(flavorOnly, [{ ...sentence, page: 'Broadswords' }])).toThrow(/own article/)
    expect(() => build(flavorOnly, [{ ...sentence, name: 'Gold Broadsword' }])).toThrow(/name/)
    expect(() => build(mixed, [sentence])).toThrow(/not needed — its tooltip describes its behavior/)
    // a simulated weapon (a plain broadsword: derived params) has no limitation card to fill
    expect(() => build(SWORD, [{ ...sentence, quote: 'The Iron Broadsword is a pre-Hardmode broadsword.' }], swordSpec(SWORD), [])).toThrow(/not needed — the weapon has no limitation card/)
    expect(() => build(flavorOnly, [{ ...sentence, itemId: 9999 }])).toThrow(/no emitted weapon/)
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

  it('weapons outside every family are untouched', () => {
    const zenith = weapon(4956, 'Zenith', { tags: ['projectile-melee'] })
    const input = fixture([swordSpec()])
    const out = buildLabParams({ ...input, weapons: [...input.weapons, zenith] })
    expect(out.weapons[1]).toBe(zenith)
    expect(out.decisions).toHaveLength(1)
  })

  it('a weapon in no family honors a reviewed limitation entry (same evidence standard); never an archetype entry', () => {
    const grenade = weapon(168, 'Grenade', { damageClass: 'ranged' }) // tags []: no weapon-type category
    const fuse = 'A thrown Grenade will bounce slightly and roll until it either hits a valid target or 3 seconds have elapsed, after which it will explode.'
    const spec = { w: grenade, stats: { useStyle: 1, shoot: 30 }, html: page(168, `The Grenade is an explosive consumable ranged weapon. ${fuse}`) }
    const entry: LabParamsEntry = { itemId: 168, name: 'Grenade', decision: 'limitation', reason: "A consumable explosive — the Lab doesn't model explosions.", evidence: [{ page: 'Grenade', quote: fuse }], why: 'no category' }
    const out = buildLabParams(fixture([swordSpec(), spec], [entry]))
    expect(out.weapons[1].labBehavior).toMatchObject({ kind: 'limitation', reason: entry.reason, sourceUrl: grenade.wikiUrl })
    expect(out.weapons[1]._prov.editorialFields).toEqual(['labBehavior'])
    expect(out.weapons[1]._prov.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'wiki-article', rev: 100 }), expect.objectContaining({ kind: 'curated', overlay: 'lab-params', rev: 100 })]),
    )
    expect(out.decisions.map((d) => d.name)).toEqual(['Iron Broadsword']) // outside every family: no coverage decision
    // The same standard as every entry: verbatim on the cached revision, the weapon's own article cited, the name checked.
    expect(() => buildLabParams(fixture([spec], [{ ...entry, evidence: [{ page: 'Grenade', quote: 'a quote that is not on the page' }] }]))).toThrow(/quote not found verbatim/)
    expect(() => buildLabParams(fixture([swordSpec(), spec], [{ ...entry, evidence: [{ page: 'Iron Broadsword', quote: 'The Iron Broadsword is a pre-Hardmode broadsword.' }] }]))).toThrow(/own article/)
    expect(() => buildLabParams(fixture([spec], [{ ...entry, name: 'Sticky Grenade' }]))).toThrow(/name/)
    // No family to parameterize, nothing to record extras on.
    expect(() => buildLabParams(fixture([spec], [{ itemId: 168, name: 'Grenade', decision: 'archetype', archetype: 'explosive-aoe', evidence: entry.evidence, why: 'x' }]))).toThrow(/only a limitation entry/)
    expect(() => buildLabParams(fixture([spec], [{ ...entry, bounceCount: 1 }]))).toThrow(/no Lab family/)
    // Without an entry it keeps the default card, untouched.
    expect(buildLabParams(fixture([spec])).weapons[0]).toBe(grenade)
  })
})

// ---------------------------------------------------------------------------------------------
// Remaining-archetype families (merge/labFamilies.ts)
// ---------------------------------------------------------------------------------------------

describe('remaining-archetype families: quote / table helpers', () => {
  it('stated values: tiles, exact vs average intervals, beam hit rate, fuse sentence', () => {
    expect(statesTiles('a chain that can extend up to 9.4 tiles.', 9.4)).toBe(true)
    expect(statesTiles('within a 4-tile radius', 4)).toBe(true)
    expect(statesTiles('within a 14-tile radius', 4)).toBe(false)
    expect(statedIntervalTicks('The Frost Hydra fires Frost Blasts at a rate of once per second.')).toEqual({ ticks: 60, average: false })
    expect(statedIntervalTicks('fired at a rate of once every 0.75 seconds on average')).toEqual({ ticks: 45, average: true })
    expect(statedIntervalTicks('The Terraprisma attacks once every 0.67 seconds.')).toBeUndefined() // not whole ticks
    expect(statedIntervalTicks('meaning they can hit for up to 12 times per second')).toEqual({ ticks: 5, average: false })
    expect(statesTickRate('The beams inflict 5 ticks of global invincibility frames on hit', 5)).toBe(true)
    expect(statesTickRate('deals damage at a rate of every 10 ticks or six times per second', 10)).toBe(true)
    expect(statedFuse('The Bomb is an explosive that explodes 3 seconds after being thrown. The explosion breaks…')).toEqual({ ticks: 180, quote: 'The Bomb is an explosive that explodes 3 seconds after being thrown' })
    expect(statedFuse('It has a fuse timer of 3 seconds')).toBeUndefined()
  })
  it('AMENDMENTS-013 B63 P-2 rounding: decimal seconds × 60, half-to-even, on the stated digits (no float error decides)', () => {
    expect(roundHalfEvenTicks('1.13')).toEqual({ ticks: 68, exact: false }) // 67.8 (Imp Staff)
    expect(roundHalfEvenTicks('0.67')).toEqual({ ticks: 40, exact: false }) // 40.2 (Terraprisma)
    expect(roundHalfEvenTicks('2.67')).toEqual({ ticks: 160, exact: false }) // 160.2 (Ballista)
    expect(roundHalfEvenTicks('0.45')).toEqual({ ticks: 27, exact: true })
    expect(roundHalfEvenTicks('0.125')).toEqual({ ticks: 8, exact: false }) // 7.5 → the even tick
    expect(roundHalfEvenTicks('0.375')).toEqual({ ticks: 22, exact: false }) // 22.5 → the even tick
    expect(roundHalfEvenTicks('1')).toEqual({ ticks: 60, exact: true })
  })
  it('statedSummonRate: the one base-rate sentence; exact = whole ticks and not an average; caps, conditions and several values are no rate', () => {
    expect(statedSummonRate('The Imp attacks with an average rate of fire of once every 1.13 seconds.')).toMatchObject({ seconds: '1.13', ticks: 68, exact: false })
    expect(statedSummonRate("The UFO's lasers are fired instantaneously at a rate of once every 0.45 seconds on average.")).toMatchObject({ ticks: 27, exact: false }) // whole ticks, but an average
    expect(statedSummonRate('The Forbidden Ruin has a random cooldown ranging from 1.75 seconds to 1.92 seconds between firing Forbidden Bolts, meaning it fires once every 1.83 seconds on average.')).toMatchObject({ seconds: '1.83', ticks: 110, exact: false })
    expect(statedSummonRate('The Frost Hydra fires Frost Blasts at a rate of once per second.')).toMatchObject({ ticks: 60, exact: true })
    expect(statedSummonRate('The Explosive Trap has a cooldown of 1.5 seconds after attacking.')).toMatchObject({ ticks: 90, exact: true })
    expect(statedSummonRate('The Foxparks minion shoots fireballs at enemies once every 0.7 seconds, while the Trusty Foxparks minion shoots fireballs once every 0.5 seconds.')).toBe('ambiguous')
    expect(statedSummonRate('It attacks once every 0.5 seconds. Its other form attacks once every 0.75 seconds.')).toBe('ambiguous')
    expect(statedSummonRate('Each spider minion has an internal hit cooldown of 0.33 seconds, meaning it can hit an enemy up to 3 times per second.')).toBeUndefined()
    expect(statedSummonRate('If the player is wearing the set, it attacks once every 0.5 seconds.')).toBeUndefined()
    expect(statedSummonRate('Once every three attacks, it briefly stops in place.')).toBeUndefined()
  })
  it('statedHitCap: the immunity-frame count (never a "-1 tick"); not binding where the article says so', () => {
    expect(statedHitCap('The Baby Slime minion applies 12 ticks of static invincibility frames upon hitting an enemy, meaning it can hit up to five times per second.')).toMatchObject({ ticks: 12 })
    expect(statedHitCap('The Vampire Frog minion applies 10 ticks of static immunity frames upon hitting an enemy.')).toMatchObject({ ticks: 10 })
    expect(statedHitCap('The Terraprisma applies -1 tick of local immunity frames upon hitting an enemy.')).toBeUndefined()
    expect(statedHitCap('Whips apply −1 ticks of local invincibility frames on hit.')).toBeUndefined()
    expect(statedHitCap('The Raven minion applies 10 ticks of local invincibility frames upon hitting an enemy, although in practice this does not come into play due to the internal hit cooldown mentioned above.')).toEqual({
      notBinding: expect.stringContaining('does not come into play'),
    })
  })
  it('missing params read as plain sentences; source disagreements are named as such', () => {
    expect(missingSentence(['attackRateTicks', 'sentryRangeTiles'])).toBe('The wiki states no exact attack rate or targeting radius for it.')
    expect(missingSentence(['throwRangeTiles'], ['throwRangeTiles'])).toBe('The wiki sources disagree on its throw range.')
    expect(missingSentence(['aiClass', 'attackRateTicks'])).toBe('The wiki states no exact attack rate for it; its attack style is not classified from the wiki.')
  })
  it('overview list tables: header colspans expanded, item IDs from the name cell', () => {
    const html = '<table class="terraria"><tr><th colspan="2">Name</th><th>Range<br/><small>(tiles)</small></th><th>Tag damage</th><th>Multihit penalty</th></tr><tr><td></td><td><a>Leather Whip</a>Internal Item ID: 4672</td><td>11</td><td>4</td><td>50%</td></tr><tr><td rowspan="2">x</td><td>y</td><td>1</td><td>2</td><td>3</td></tr></table>'
    expect(parseItemTable(html, 'Range (tiles)')).toEqual([{ itemIds: [4672], cells: { Name: '', 'Range (tiles)': '11', 'Tag damage': '4', 'Multihit penalty': '50%' } }])
    expect(parseItemTable(html, 'Reach (tiles)')).toEqual([])
  })
  it('the sync plan fetches the held-beam signal family articles (outside every category family)', () => {
    const tree: CategoryTree = { roots: [], categories: new Map([['Category:Yoyos', { pages: ['Wooden Yoyo'], subcats: [] }]]), pages: ['Wooden Yoyo'], fetchedAt: FETCHED }
    const rows: CargoRow[] = [
      { _page: 'Wooden Yoyo', itemid: '3278', type: 'weapon' },
      { _page: 'Last Prism', itemid: '3541', type: 'weapon' },
      { _page: 'Zenith', itemid: '4956', type: 'weapon' },
    ]
    const items = new Map([
      [3541, { id: 3541, internalName: 'LastPrism', stats: { channel: true, magic: true } }],
      [4956, { id: 4956, internalName: 'Zenith', stats: { channel: false, melee: true } }],
    ]) as unknown as Iteminfo['items']
    expect(labFamilyPages(tree, rows, { items })).toEqual(['Last Prism', 'Wooden Yoyo'])
    expect(labFamilyPages(tree, rows)).toEqual(['Wooden Yoyo'])
  })
})

describe('remaining-archetype families: buildLabParams', () => {
  const withArticles = (input: LabBuildInput, extra: Article[]): LabBuildInput => {
    const articles = new Map(input.articles)
    for (const a of extra) articles.set(a.title, a)
    return { ...input, articles, evidence: new Evidence(articles) }
  }
  const infoboxRows = (html: string, rows: [string, string][]) => html.replace('<div class="section ids">', `<table>${rows.map(([l, v]) => `<tr><th>${l}</th><td>${v}</td></tr>`).join('')}</table><div class="section ids">`)
  const accept = (archetype: Archetype) => (): WeaponAssessment => ({ simulable: true, archetype, requiresAmmoClass: null, requiresBuffIds: [] })
  /** The registry minus `archetype`: the PENDING path for a family the sim now implements (P3-S6/S7 shipped returning + piercing-beam). */
  const pendingWithout = (archetype: Archetype) => ({ implemented: IMPLEMENTED_ARCHETYPES.filter((a) => a !== archetype) })

  const YOYO = weapon(3278, 'Wooden Yoyo', { tags: ['yoyos'], damage: 9 })
  const yoyoSpec = (reach = '8.125 tiles') => ({ w: YOYO, stats: { useStyle: 5, shoot: 541, shootSpeed: 16, noMelee: true, channel: true }, html: infoboxRows(page(3278, 'The Wooden Yoyo is a pre-Hardmode yoyo.', {}, ['Internal Projectile ID: 541']), [['Reach', reach]]) })
  const YOYO_PROJ = { 541: { name: 'Wooden Yoyo', penetrate: -1, extraUpdates: 0 } }
  const YOYO_PARAMS = { archetype: 'returning', variant: 'yoyo', throwRangeTiles: 8.125, returnMode: 'tethered', control: 'cursor-follow' }

  it('PENDING INTERPRETER: complete params are recorded, the weapon is emitted as a limitation naming what the Lab does not model', () => {
    // B61 flip: P3-S6/S7 registered returning + piercing-beam, P3-S9/S10 minion-sentry + whip, P3-S11 explosive-aoe — every family now
    expect(PENDING_FAMILIES.filter((f) => IMPLEMENTED_ARCHETYPES.includes(f))).toEqual(['returning', 'whip', 'minion-sentry', 'explosive-aoe', 'piercing-beam'])
    const out = buildLabParams({ ...fixture([yoyoSpec()], [], YOYO_PROJ), ...pendingWithout('returning') })
    expect(out.decisions[0]).toMatchObject({ family: 'returning', variant: 'yoyo', method: 'derived', pending: true, reasonKey: 'pending-interpreter', params: YOYO_PARAMS })
    expect(out.decisions[0].derivation.join(' ')).toContain('the item infobox "Reach" row')
    expect(out.weapons[0].labBehavior).toMatchObject({ kind: 'limitation', reason: "The Lab doesn't model tethered yoyo control." })
    expect(out.weapons[0]._prov.modeledFields).toBeUndefined()
    expect(out.weapons[0]._prov.sources.some((x) => x.url.endsWith('/Yoyos'))).toBe(true) // the family rule quotes back the reason
    expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: false, refusal: { reason: 'limitation' } })
  })

  it('once the sim implements the archetype, the same build emits the recorded params (no pipeline change)', () => {
    const out = buildLabParams({ ...fixture([yoyoSpec()], [], YOYO_PROJ), implemented: [...IMPLEMENTED_ARCHETYPES, 'returning'], assess: accept('returning') })
    expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: YOYO_PARAMS })
    expect(out.decisions[0]).toMatchObject({ method: 'derived', archetype: 'returning' })
    expect(out.decisions[0].pending).toBeUndefined()
  })

  it('B61 flip (P3-S6/S7): with the real registry and the real guard, the recorded returning params are emitted and simulate', () => {
    const yoyo = { ...yoyoSpec(), w: { ...YOYO, shootSpeedTps: 60 } }
    const out = buildLabParams(fixture([yoyo], [], YOYO_PROJ))
    expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: YOYO_PARAMS })
    expect(out.decisions[0]).toMatchObject({ method: 'derived', archetype: 'returning' })
    expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true, archetype: 'returning' })
    expect(createLabSim({ weapon: out.weapons[0] }).ok).toBe(true)
    // a reviewed / incomplete limitation of an implemented family drops the family sentence: it names only what is not modeled
    const missing = buildLabParams(fixture([boomSpec('The Wooden Boomerang is a boomerang with a range of 50 tiles.')], [], BOOM_PROJ))
    expect(missing.weapons[0].labBehavior).toMatchObject({ kind: 'limitation', reason: 'Not simulated: the wiki states no throw range for it.' })
  })

  it('yoyo: an infobox reach the Yoyos list table contradicts is withheld (named as a disagreement, never picked)', () => {
    const table = article('Yoyos', `<div class="mw-parser-output"><p>${RULE_QUOTES.yoyoThrown.quote} ${RULE_QUOTES.yoyoString.quote}</p><table class="terraria"><tr><th colspan="2">Name</th><th>Reach (tiles)[2]</th></tr><tr><td></td><td>Wooden Yoyo Internal Item ID: 3278</td><td>9</td></tr></table></div>`)
    const out = buildLabParams({ ...withArticles(fixture([yoyoSpec()], [], YOYO_PROJ), [table]), ...pendingWithout('returning') })
    expect(out.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'incomplete', missing: ['throwRangeTiles'], conflicts: ['throwRangeTiles'] })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model tethered yoyo control. The wiki sources disagree on its throw range." })
    const agrees = buildLabParams({ ...withArticles(fixture([yoyoSpec('9 tiles')], [], YOYO_PROJ), [table]), ...pendingWithout('returning') })
    expect(agrees.decisions[0]).toMatchObject({ pending: true, params: { throwRangeTiles: 9 } })
  })

  const BOOM = weapon(284, 'Wooden Boomerang', { tags: ['boomerangs'], damage: 10 })
  const boomSpec = (lead: string) => ({ w: BOOM, stats: { useStyle: 1, shoot: 52, shootSpeed: 6.5, noMelee: true }, html: page(284, lead) })
  const BOOM_PROJ = { 52: { name: 'Wooden Boomerang', penetrate: -1 } }

  it('boomerang: the "maximum range" sentence is the throw range (B56 extraction, verbatim-checked); none stated → missing, never guessed', () => {
    const out = buildLabParams({ ...fixture([boomSpec('The Wooden Boomerang is a boomerang. This results in having a maximum range of roughly 13.64 tiles.')], [], BOOM_PROJ), ...pendingWithout('returning') })
    expect(out.decisions[0]).toMatchObject({ pending: true, params: { archetype: 'returning', variant: 'boomerang', throwRangeTiles: 13.64, returnMode: 'auto-return', control: 'fire-and-forget' } })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model thrown weapons that fly out and return to the player." })
    // another range (homing radius, despawn distance) is not the throw range
    const other = buildLabParams({ ...fixture([boomSpec('The Wooden Boomerang is a boomerang with a range of 50 tiles.')], [], BOOM_PROJ), ...pendingWithout('returning') })
    expect(other.decisions[0]).toMatchObject({ reasonKey: 'incomplete', missing: ['throwRangeTiles'] })
    expect(other.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model thrown weapons that fly out and return to the player. The wiki states no throw range for it." })
  })

  it('flails: held = thrown flail (not expressible); launched flail range from a reviewed quote that states it', () => {
    const thrown = weapon(5011, 'Mace', { tags: ['flails'], damage: 18 })
    const out = buildLabParams(fixture([{ w: thrown, stats: { useStyle: 5, shoot: 947, noMelee: true, channel: true }, html: page(5011, 'The Mace is a pre-Hardmode flail.') }], [], { 947: { name: 'Mace' } }))
    expect(out.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'thrown-flail' })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: THROWN_FLAIL_REASON })
    const knife = weapon(1325, 'Chain Knife', { tags: ['flails'], damage: 12 })
    const lead = 'When used, it fires a knife attached to a chain that can extend up to 9.4 tiles.'
    const spec = { w: knife, stats: { useStyle: 5, shoot: 273, noMelee: true }, html: page(1325, lead) }
    const entry = (n: number): LabParamsEntry => ({ itemId: 1325, name: 'Chain Knife', decision: 'archetype', archetype: 'returning', throwRangeTiles: n, evidence: [{ page: 'Chain Knife', quote: lead }], why: 'test' })
    const launched = buildLabParams({ ...fixture([spec], [entry(9.4)], { 273: { name: 'Chain Knife' } }), ...pendingWithout('returning') })
    expect(launched.decisions[0]).toMatchObject({ method: 'overlay', pending: true, params: { variant: 'flail', throwRangeTiles: 9.4, returnMode: 'auto-return' } })
    expect(launched.weapons[0]._prov.editorialFields).toEqual(['labBehavior'])
    expect(() => buildLabParams(fixture([spec], [entry(12)], { 273: { name: 'Chain Knife' } }))).toThrow(/range of 12 tiles/)
  })

  const WHIP = weapon(4672, 'Leather Whip', { tags: ['whips'], damageClass: 'summon', critPct: undefined, behaviorText: '4 summon tag damage\n10% summon tag critical strike chance' })
  const whipsPage = (range: string, tag: string) =>
    article('Whips', `<div class="mw-parser-output"><p>${['whipArc', 'whipMultihit', 'whipTag'].map((k) => RULE_QUOTES[k as keyof typeof RULE_QUOTES].quote).join(' ')}</p><table class="terraria"><tr><th colspan="2">Name</th><th>Range<br/><small>(tiles)</small></th><th>Tag damage</th><th>On-hit effect</th><th>Multihit penalty</th></tr><tr><td></td><td>Leather Whip Internal Item ID: 4672</td><td>${range}</td><td>${tag}</td><td><ul><li>10% tag critical chance</li></ul></td><td>50%</td></tr></table></div>`)
  // the tooltip's "summon tag damage" trips the high-recall screen (spawns "summon"): a reviewed entry clears it, as in the overlay
  const whipEntry: LabParamsEntry = { itemId: 4672, name: 'Leather Whip', decision: 'archetype', archetype: 'whip', evidence: [{ page: 'Leather Whip', quote: 'The Leather Whip is a whip.' }], why: 'tag damage is the whip archetype' }
  const whipInput = (range = '11', tag = '4') => withArticles(fixture([{ w: WHIP, stats: { useStyle: 1, shoot: 841, noMelee: true }, html: page(4672, 'The Leather Whip is a whip.') }], [whipEntry], { 841: { name: 'Leather Whip' } }), [whipsPage(range, tag)])

  it('whip: range / tag damage / tag crit / multihit penalty are stated (list table + tooltip); the arc is the B63 P-1 convention (180° forward, modeled)', () => {
    const out = buildLabParams({ ...whipInput(), ...pendingWithout('whip') })
    expect(buildLabParams({ ...whipInput(), overlay: LabParamsOverlay.parse({ overlay: 'lab-params', authoredAt: '2026-10-13', notes: [], entries: [] }) }).decisions[0]).toMatchObject({ reasonKey: 'flagged', reason: expect.stringContaining('creates other projectiles or entities') })
    expect(out.decisions[0]).toMatchObject({
      family: 'whip',
      method: 'overlay',
      pending: true,
      params: { archetype: 'whip', arcDegrees: WHIP_ARC_DEGREES, rangeTiles: 11, tagDamageFlat: 4, tagCritPct: 10, falloffPerTarget: 0.5 },
      modeled: ['labBehavior.params.arcDegrees'],
    })
    expect(WHIP_ARC_DEGREES).toBe(180)
    expect(modelingConventionFor('whip', 'labBehavior.params.arcDegrees')).toMatchObject({ id: 'whip-arc', ruling: 'AMENDMENTS-013 B63 P-1', always: true })
    expect(out.decisions[0].derivation.join(' ')).toContain('modeling convention AMENDMENTS-013 B63 P-1')
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model whip swings or the tag bonus they give to minion damage." })
    expect(out.weapons[0]._prov.modeledFields).toBeUndefined() // a limitation until the whip interpreter ships
    // once it ships, the same build emits the arc as a labeled modeled value (B49)
    const shipped = buildLabParams({ ...whipInput(), implemented: [...IMPLEMENTED_ARCHETYPES, 'whip'], assess: accept('whip') })
    expect(shipped.weapons[0].labBehavior).toMatchObject({ kind: 'archetype', params: { arcDegrees: 180 } })
    expect(shipped.weapons[0]._prov.modeledFields).toEqual(['labBehavior.params.arcDegrees'])
    // tooltip vs table disagreement: withheld, named as such (the arc stays modeled)
    const clash = buildLabParams(whipInput('11', '5'))
    expect(clash.decisions[0]).toMatchObject({ reasonKey: 'incomplete', missing: ['tagDamageFlat'], conflicts: ['tagDamageFlat'], modeled: ['labBehavior.params.arcDegrees'] })
    expect(clash.weapons[0].labBehavior).toMatchObject({ reason: 'Not simulated: the wiki sources disagree on its tag damage.' }) // whips are simulated: no family sentence
  })

  it('B61 flip (P3-S10): with the real registry and the real guard, the recorded whip params are emitted and simulate (B64: a summon weapon needs no critPct)', () => {
    const out = buildLabParams(whipInput())
    expect(out.weapons[0].critPct).toBeUndefined()
    expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'whip', arcDegrees: 180, rangeTiles: 11, tagDamageFlat: 4, tagCritPct: 10, falloffPerTarget: 0.5 } })
    expect(out.weapons[0]._prov.modeledFields).toEqual(['labBehavior.params.arcDegrees'])
    expect(out.decisions[0]).toMatchObject({ method: 'overlay', archetype: 'whip' })
    expect(out.decisions[0].pending).toBeUndefined()
    expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true, archetype: 'whip' })
    const created = createLabSim({ weapon: out.weapons[0] })
    expect(created.ok && created.sim.approximations.map((a) => a.id)).toEqual(expect.arrayContaining(['whip-arc', 'whip-swing', 'whip-tag']))
  })

  const minionW = (over: Partial<Weapon> = {}) => weapon(1309, 'Slime Staff', { tags: ['minion-summon-items'], damageClass: 'summon', critPct: undefined, ...over })
  const minionHtml = (lead: string) => page(1309, lead)
  const SLIME_PROJ = { 266: { name: 'Baby Slime', minion: true, minionSlots: 1 } }
  const minionEntry = (over: Partial<Extract<LabParamsEntry, { decision: 'archetype' }>>, quote: string): LabParamsEntry => ({ itemId: 1309, name: 'Slime Staff', decision: 'archetype', archetype: 'minion-sentry', evidence: [{ page: 'Slime Staff', quote }], why: 'test', ...over })

  it('minion: slotCost = Projectileinfo minionSlots; aiClass from a reviewed quote; an exact rate the article states is stated (not modeled)', () => {
    const lead = 'It bounces towards enemies, dealing contact damage. The Baby Slime attacks once every 0.5 seconds.'
    const spec = { w: minionW(), stats: { useStyle: 1, shoot: 266 }, html: minionHtml(lead) }
    const bare = buildLabParams(fixture([spec], [], SLIME_PROJ))
    expect(bare.decisions[0]).toMatchObject({ variant: 'minion', reasonKey: 'incomplete', partial: { slotCost: 1, attackRateTicks: 30 }, missing: ['aiClass'] })
    expect(bare.decisions[0].modeled).toBeUndefined() // 0.5 s = 30 whole ticks, not an average: game data
    const out = buildLabParams({ ...fixture([spec], [minionEntry({ aiClass: 'ground-melee', attackRateTicks: 30 }, lead)], SLIME_PROJ), ...pendingWithout('minion-sentry') })
    expect(out.decisions[0]).toMatchObject({ method: 'overlay', pending: true, params: { archetype: 'minion-sentry', variant: 'minion', slotCost: 1, aiClass: 'ground-melee', attackRateTicks: 30 } })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model summoned minions." })
    // B61 flip (P3-S9): the real registry + guard emit the same params, simulable (B64: no critPct needed)
    const flipped = buildLabParams(fixture([spec], [minionEntry({ aiClass: 'ground-melee', attackRateTicks: 30 }, lead)], SLIME_PROJ))
    expect(flipped.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'minion-sentry', variant: 'minion', slotCost: 1, aiClass: 'ground-melee', attackRateTicks: 30 } })
    expect(assessWeapon(flipped.weapons[0])).toMatchObject({ simulable: true, archetype: 'minion-sentry' })
    expect(createLabSim({ weapon: flipped.weapons[0] }).ok).toBe(true)
    expect(() => buildLabParams(fixture([spec], [minionEntry({ aiClass: 'ranged-shot' }, lead)], SLIME_PROJ))).toThrow(/ranged-shot behavior/)
    const avg = 'It bounces towards enemies, dealing contact damage. It attacks once every 0.5 seconds on average.'
    expect(() => buildLabParams(fixture([{ ...spec, html: minionHtml(avg) }], [minionEntry({ aiClass: 'ground-melee', attackRateTicks: 30 }, avg)], SLIME_PROJ))).toThrow(
      /is an average — an average is modeled \(AMENDMENTS-013 B63 P-2\) only from the article's own rate sentence/,
    )
  })

  it('B63 P-2: an average / non-whole-tick rate the article states → rounded half-to-even, modeled (a qualified modeledFields entry)', () => {
    const lead = 'It bounces towards enemies, dealing contact damage. The Baby Slime attacks with an average rate of fire of once every 1.13 seconds.'
    const spec = { w: minionW(), stats: { useStyle: 1, shoot: 266 }, html: minionHtml(lead) }
    const input = () => fixture([spec], [minionEntry({ aiClass: 'ground-melee' }, lead)], SLIME_PROJ)
    const out = buildLabParams({ ...input(), ...pendingWithout('minion-sentry') })
    expect(out.decisions[0]).toMatchObject({ pending: true, params: { aiClass: 'ground-melee', attackRateTicks: 68 }, modeled: ['labBehavior.params.attackRateTicks#summon-average-rate'] })
    expect(out.decisions[0].derivation.join(' ')).toContain('1.13 s × 60 rounded half-to-even (modeling convention AMENDMENTS-013 B63 P-2')
    // P-2 and P-3 share the path: the entry names its convention; an unqualified entry never resolves (no wrong label)
    expect(modelingConventionFor('minion-sentry', 'labBehavior.params.attackRateTicks#summon-average-rate')).toMatchObject({ ruling: 'AMENDMENTS-013 B63 P-2' })
    expect(modelingConventionFor('minion-sentry', 'labBehavior.params.attackRateTicks')).toBeUndefined()
    const shipped = buildLabParams({ ...input(), implemented: [...IMPLEMENTED_ARCHETYPES, 'minion-sentry'], assess: accept('minion-sentry') })
    expect(shipped.weapons[0]._prov.modeledFields).toEqual(['labBehavior.params.attackRateTicks#summon-average-rate'])
    expect(Prov.safeParse(shipped.weapons[0]._prov).success).toBe(true)
  })

  it('B63 P-3: a contact minion stating only its immunity frames → that cap, an UPPER BOUND (modeled); never a ranged minion, nor frames the article says do not apply', () => {
    // the rendered footnote marker ("12 ticks[6] of") is not prose: the extracted sentence is checked without it
    const capHtml = 'The Baby Slime minion applies 12 ticks<sup class="reference"><a href="#cite_note-6">[6]</a></sup> of static invincibility frames upon hitting an enemy.'
    const quote = 'It bounces towards enemies, dealing contact damage.'
    const spec = { w: minionW(), stats: { useStyle: 1, shoot: 266 }, html: minionHtml(`${quote} ${capHtml}`) }
    const out = buildLabParams({ ...fixture([spec], [minionEntry({ aiClass: 'ground-melee' }, quote)], SLIME_PROJ), ...pendingWithout('minion-sentry') })
    expect(out.decisions[0]).toMatchObject({ pending: true, params: { aiClass: 'ground-melee', attackRateTicks: 12 }, modeled: ['labBehavior.params.attackRateTicks#summon-hit-cap'] })
    // emitted (B61 flip), the upper bound carries its labeled caveat into the Lab's assumptions (B63 P-3)
    const emitted = buildLabParams(fixture([spec], [minionEntry({ aiClass: 'ground-melee' }, quote)], SLIME_PROJ)).weapons[0]
    expect(emitted._prov.modeledFields).toEqual(['labBehavior.params.attackRateTicks#summon-hit-cap'])
    const hitCap = createLabSim({ weapon: emitted })
    expect(hitCap.ok && hitCap.sim.approximations.find((a) => a.id === 'summon-hit-cap')?.detail).toContain('maximum rate; actual depends on minion AI pathing')
    expect(out.decisions[0].derivation.join(' ')).toContain('an UPPER BOUND — maximum rate; actual depends on minion AI pathing')
    expect(modelingConventionFor('minion-sentry', 'labBehavior.params.attackRateTicks#summon-hit-cap')).toMatchObject({ ruling: 'AMENDMENTS-013 B63 P-3' })
    expect(CONTACT_AI_CLASSES).toEqual(['melee-contact', 'ground-melee', 'hover-strike'])
    // a ranged minion's immunity frames bound its projectiles, not how often it attacks
    const shoots = 'It shoots fireballs at enemies.'
    const ranged = buildLabParams(fixture([{ ...spec, html: minionHtml(`${shoots} ${capHtml}`) }], [minionEntry({ aiClass: 'ranged-shot' }, shoots)], SLIME_PROJ))
    expect(ranged.decisions[0]).toMatchObject({ reasonKey: 'incomplete', missing: ['attackRateTicks'], candidates: { attackRateTicks: expect.stringContaining('contact minions only') } })
    // the article says the frames are not the limit (Raven Staff): not applied, stays missing
    const notBinding = 'The Baby Slime minion applies 10 ticks of local invincibility frames upon hitting an enemy, although in practice this does not come into play due to the internal hit cooldown mentioned above.'
    const raven = buildLabParams(fixture([{ ...spec, html: minionHtml(`${quote} ${notBinding}`) }], [minionEntry({ aiClass: 'ground-melee' }, quote)], SLIME_PROJ))
    expect(raven.decisions[0]).toMatchObject({ reasonKey: 'incomplete', missing: ['attackRateTicks'], candidates: { attackRateTicks: expect.stringContaining('B63 P-3 not applied') } })
    expect(raven.decisions[0].modeled).toBeUndefined()
  })

  it('sentry: one sentry slot (rule quote); a Manhattan-distance range is not a radius (B63 P-4 rejected: stays missing)', () => {
    const w = weapon(1572, 'Staff of the Frost Hydra', { tags: ['sentry-summon-items'], damageClass: 'summon', critPct: undefined })
    const lead = 'It fires Frost Blasts towards enemies. The Frost Hydra can target enemies within a Manhattan distance of 62.5 tiles. The Frost Hydra fires Frost Blasts at a rate of once per second.'
    const spec = { w, stats: { useStyle: 1, shoot: 308, sentry: true }, html: page(1572, lead) }
    const entry: LabParamsEntry = { itemId: 1572, name: 'Staff of the Frost Hydra', decision: 'archetype', archetype: 'minion-sentry', aiClass: 'ranged-shot', attackRateTicks: 60, evidence: [{ page: 'Staff of the Frost Hydra', quote: lead }], why: 'test' }
    const out = buildLabParams(fixture([spec], [entry], { 308: { name: 'Frost Hydra', sentry: true } }))
    expect(out.decisions[0]).toMatchObject({ variant: 'sentry', reasonKey: 'incomplete', missing: ['sentryRangeTiles'], partial: { slotCost: 1, attackRateTicks: 60 }, candidates: { sentryRangeTiles: expect.stringContaining('Manhattan distance 62.5') } })
    // sentries are simulated (P3-S9): the card names only what is missing
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: 'Not simulated: the wiki states no targeting radius for it.' })
    const pending = buildLabParams({ ...fixture([spec], [entry], { 308: { name: 'Frost Hydra', sentry: true } }), ...pendingWithout('minion-sentry') })
    expect(pending.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model stationary sentries. The wiki states no targeting radius for it." })
    expect(() => buildLabParams(fixture([spec], [{ ...entry, sentryRangeTiles: 62.5 }], { 308: { name: 'Frost Hydra', sentry: true } }))).toThrow(/Manhattan distance is not a radius/)
  })

  const BOMB = weapon(166, 'Bomb', { tags: ['explosives'], damageClass: 'other', damage: undefined, critPct: undefined, knockback: undefined, _prov: prov(['critPct', 'damage', 'knockback']) })
  const bombLead = 'The Bomb is an explosive that explodes 3 seconds after being thrown. The explosion breaks nearly all blocks within a 4-tile radius. The explosion also deals 100 damage to all enemies, critters, and players in the radius, but not NPCs.'
  const bombEntry = (over: Partial<Extract<LabParamsEntry, { decision: 'archetype' }>> = {}): LabParamsEntry => ({
    itemId: 166,
    name: 'Bomb',
    decision: 'archetype',
    archetype: 'explosive-aoe',
    blastRadiusTiles: 4,
    falloff: 'none',
    evidence: [{ page: 'Bomb', quote: bombLead }],
    why: 'test',
    ...over,
  })

  it('explosive: fuse from the article sentence; radius + uniform damage from reviewed quotes; unverified core fields are named in the reason', () => {
    const spec = { w: BOMB, stats: { useStyle: 1, shoot: 28, consumable: true }, html: page(166, bombLead) }
    // the pending path (a registry without the interpreter): a classless explosive's Unknown critPct is not sim-required (P3-S11)
    const out = buildLabParams({ ...fixture([spec], [bombEntry()], { 28: { name: 'Bomb' } }), ...pendingWithout('explosive-aoe') })
    expect(out.decisions[0]).toMatchObject({ pending: true, pipelineBlocked: ['damage', 'knockback'], params: { archetype: 'explosive-aoe', blastRadiusTiles: 4, trigger: 'timed', fuseTicks: 180, falloff: 'none' } })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: "The Lab doesn't model explosions. Its damage and knockback are unverified in the wiki data." })
    expect(() => buildLabParams(fixture([spec], [bombEntry({ blastRadiusTiles: 5 })], { 28: { name: 'Bomb' } }))).toThrow(/blast radius of 5 tiles/)
    expect(() => buildLabParams(fixture([spec], [bombEntry({ trigger: 'timed', fuseTicks: 240 })], { 28: { name: 'Bomb' } }))).toThrow(/may not override/)
    expect(out.decisions[0].modeled).toEqual([]) // a stated radius: game data, no B63 P-5
    // a launcher fires ammunition: the blast comes from the ammo
    const launcher = weapon(759, 'Rocket Launcher', { tags: ['launchers'], damageClass: 'ranged', ammoClass: 'rocket-i', shootSpeedTps: 18.75 })
    const fired = buildLabParams(fixture([{ w: launcher, stats: { useStyle: 5, shoot: 134, useAmmo: 771 }, html: page(759, 'The Rocket Launcher is a launcher.') }], [], { 134: { name: 'Rocket I' } }))
    expect(fired.decisions[0]).toMatchObject({ reasonKey: 'ammo-explosive', reason: "Launchers get their explosion from the rocket ammo, which the Lab doesn't model." })
    expect(fired.weapons[0].labBehavior).toMatchObject({ reason: "Launchers get their explosion from the rocket ammo, which the Lab doesn't model." })
    // Plain words (design review P3-S4/S5 M5): no pipeline terms; a non-rocket launcher names its own ammo generically.
    expect(ammoExplosiveReason('nail')).toBe("This launcher gets its explosion from the ammo it fires, which the Lab doesn't model.")
    for (const c of ['rocket-i', 'nail', undefined]) expect(ammoExplosiveReason(c)).not.toMatch(/parameters|ammunition/)
  })

  it('B61 flip (P3-S11): with the real registry and the real guard, a thrown explosive whose damage + knockback verify is emitted and simulates (its Unknown classless critPct is not needed); one with an unverified core field is kept for the validate downgrade', () => {
    const verified = { ...BOMB, damage: 100, knockback: 8, shootSpeedTps: 18.75, _prov: prov(['critPct']) }
    const spec = { w: verified, stats: { useStyle: 1, shoot: 28, consumable: true }, html: page(166, bombLead) }
    const out = buildLabParams(fixture([spec], [bombEntry()], { 28: { name: 'Bomb' } }))
    expect(out.decisions[0].pending).toBeUndefined()
    expect(out.decisions[0]).toMatchObject({ method: 'overlay', archetype: 'explosive-aoe' })
    expect(out.weapons[0].labBehavior).toEqual({ kind: 'archetype', params: { archetype: 'explosive-aoe', blastRadiusTiles: 4, trigger: 'timed', fuseTicks: 180, falloff: 'none' } })
    expect(out.weapons[0].critPct).toBeUndefined()
    expect(assessWeapon(out.weapons[0])).toMatchObject({ simulable: true, archetype: 'explosive-aoe' })
    const created = createLabSim({ weapon: out.weapons[0] })
    expect(created.ok && created.sim.approximations.map((a) => a.id)).toEqual(expect.arrayContaining(['explosive-fuse', 'blast-area', 'classless-crit']))
    // damage / knockback still Unknown: params kept, the validate stage downgrades it (visibly) — never emitted as simulable
    const unverified = buildLabParams(fixture([{ ...spec, w: { ...BOMB, shootSpeedTps: 18.75 } }], [bombEntry()], { 28: { name: 'Bomb' } }))
    expect(unverified.decisions[0]).toMatchObject({ archetype: 'explosive-aoe', pipelineBlocked: ['damage', 'knockback'] })
    expect(unverified.decisions[0].pending).toBeUndefined()
  })

  it('B63 P-5: a square damage area → its inscribed circle (radius = half the side), modeled; from the own article or a reviewed quote', () => {
    const DYN = weapon(167, 'Dynamite', { tags: ['explosives'], damageClass: 'other', damage: undefined, critPct: undefined, knockback: undefined, _prov: prov(['critPct', 'damage', 'knockback']) })
    const square = 'The explosion also deals 250 damage to all enemies, critters, and players (but not NPCs) within 7.8 tiles horizontally and vertically of the Dynamite.'
    const lead = `Dynamite is an explosive that explodes 5 seconds after being thrown. ${square}`
    const spec = { w: DYN, stats: { useStyle: 1, shoot: 29, consumable: true }, html: page(167, lead) }
    const entry: LabParamsEntry = { itemId: 167, name: 'Dynamite', decision: 'archetype', archetype: 'explosive-aoe', falloff: 'none', evidence: [{ page: 'Dynamite', quote: square }], why: 'test' }
    const out = buildLabParams({ ...fixture([spec], [entry], { 29: { name: 'Dynamite' } }), ...pendingWithout('explosive-aoe') })
    expect(out.decisions[0]).toMatchObject({ pending: true, params: { archetype: 'explosive-aoe', blastRadiusTiles: 7.8, trigger: 'timed', fuseTicks: 300, falloff: 'none' }, modeled: ['labBehavior.params.blastRadiusTiles'] })
    expect(out.decisions[0].derivation.join(' ')).toMatch(/blast radius 7\.8 tiles = half the side of the stated square damage area \(7\.8 tiles each way → a 15\.6-tile square; its inscribed circle — modeling convention AMENDMENTS-013 B63 P-5/)
    expect(modelingConventionFor('explosive-aoe', 'labBehavior.params.blastRadiusTiles')).toMatchObject({ id: 'square-blast-radius', ruling: 'AMENDMENTS-013 B63 P-5' })
    // a variant whose own article only says it "functions like Dynamite": the reviewed quote supplies the square
    const STICKY = weapon(2896, 'Sticky Dynamite', { tags: ['explosives'], damageClass: 'other', damage: undefined, critPct: undefined, knockback: undefined, _prov: prov(['critPct', 'damage', 'knockback']) })
    const like = 'Sticky Dynamite functions like Dynamite, but sticks to surfaces.'
    const stickySpec = { w: STICKY, stats: { useStyle: 1, shoot: 470, consumable: true }, html: page(2896, like) }
    const stickyEntry: LabParamsEntry = { itemId: 2896, name: 'Sticky Dynamite', decision: 'archetype', archetype: 'explosive-aoe', trigger: 'timed', fuseTicks: 300, falloff: 'none', evidence: [{ page: 'Sticky Dynamite', quote: like }, { page: 'Dynamite', quote: 'Dynamite is an explosive that explodes 5 seconds after being thrown.' }, { page: 'Dynamite', quote: square }], why: 'test' }
    const sticky = buildLabParams({ ...fixture([spec, stickySpec], [entry, stickyEntry], { 29: { name: 'Dynamite' }, 470: { name: 'Sticky Dynamite' } }), ...pendingWithout('explosive-aoe') })
    expect(sticky.decisions[1]).toMatchObject({ pending: true, params: { blastRadiusTiles: 7.8 }, modeled: ['labBehavior.params.blastRadiusTiles'] })
    expect(sticky.decisions[1].derivation.join(' ')).toContain('(reviewed overlay quote)')
  })

  it('piercing-beam (signal family): channel beam with a quoted hit rate; a held weapon whose projectile is not itself is not a beam', () => {
    const prism = weapon(3541, 'Last Prism', { damageClass: 'magic', manaCost: 12 })
    const lead = 'The beams inflict 5 ticks of global invincibility frames on hit.'
    const spec = { w: prism, stats: { useStyle: 5, shoot: 633, channel: true, magic: true }, html: page(3541, lead) }
    const entry: LabParamsEntry = { itemId: 3541, name: 'Last Prism', decision: 'archetype', archetype: 'piercing-beam', tickRateTicks: 5, evidence: [{ page: 'Last Prism', quote: lead }], why: 'test' }
    const out = buildLabParams({ ...fixture([spec], [entry], { 633: { name: 'Last Prism' } }), ...pendingWithout('piercing-beam') })
    expect(out.decisions[0]).toMatchObject({ family: 'piercing-beam', variant: 'beam', pending: true, params: { archetype: 'piercing-beam', mode: 'channel-beam', tickRateTicks: 5 } })
    expect(out.weapons[0].labBehavior).toMatchObject({ reason: FAMILY_REASON.beam })
    const medusa = buildLabParams(fixture([{ ...spec, stats: { ...spec.stats, shoot: 535 } }], [], { 535: { name: 'Medusa Ray' } }))
    expect(medusa.decisions[0]).toMatchObject({ reasonKey: 'not-beam', reason: expect.stringContaining('"Medusa Ray" is not the held weapon') })
  })

  it('recorded extras: bounce counts are quote-checked on limitation entries; a weapon needing bounce is never an archetype entry', () => {
    const lead = 'It fires a fireball that can bounce off blocks up to five times.'
    const entry = (n: number): LabParamsEntry => ({ itemId: 739, name: 'Amethyst Staff', decision: 'limitation', reason: 'Its fireball bounces — the Lab does not model bouncing.', bounceCount: n, evidence: [{ page: 'Amethyst Staff', quote: lead }], why: 'test' })
    const out = buildLabParams(fixture([staffSpec(STAFF, lead)], [entry(5)], PROJ))
    expect(out.decisions[0]).toMatchObject({ method: 'limitation', reasonKey: 'overlay', recorded: { bounceCount: 5 } })
    expect(() => buildLabParams(fixture([staffSpec(STAFF, lead)], [entry(4)], PROJ))).toThrow(/bounce count of 4/)
    const yoyoEntry: LabParamsEntry = { itemId: 3278, name: 'Wooden Yoyo', decision: 'archetype', archetype: 'returning', bounceCount: 2, evidence: [{ page: 'Wooden Yoyo', quote: 'The Wooden Yoyo is a pre-Hardmode yoyo.' }], why: 'test' }
    expect(() => buildLabParams(fixture([yoyoSpec()], [yoyoEntry], YOYO_PROJ))).toThrow(/limitation entry that records them/)
    // the original four families take none of the new residuals
    const bowEntry: LabParamsEntry = { itemId: 39, name: 'Wooden Bow', decision: 'archetype', archetype: 'bow-gun', throwRangeTiles: 5, evidence: [{ page: 'Wooden Bow', quote: 'The Wooden Bow fires three arrows at once.' }], why: 'test' }
    expect(() => buildLabParams(fixture([bowSpec('The Wooden Bow fires three arrows at once.')], [bowEntry]))).toThrow(/takes no throwRangeTiles/)
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

  it('B49: every modeled param resolves to a ratified convention; swing and whip always list their own, thrust its B46 reach unless stated (B56), a summon at most its rate (B63 P-2 / P-3), an explosive at most its radius (B63 P-5); nothing else is modeled', () => {
    for (const w of weapons) {
      const modeled = w._prov.modeledFields ?? []
      if (w.labBehavior.kind !== 'archetype') {
        expect(modeled, w.name).toEqual([])
        continue
      }
      const archetype = w.labBehavior.params.archetype
      for (const path of modeled) expect(modelingConventionFor(archetype, path)?.ruling, `${w.name} ${path}`).toMatch(/^AMENDMENTS-010 B4[467]$|^AMENDMENTS-013 B63 P-[1235]$/)
      if (archetype === 'swing-melee') expect(modeled).toEqual(['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles'])
      if (archetype === 'whip') expect(modeled, w.name).toEqual(['labBehavior.params.arcDegrees']) // B63 P-1, every whip
      if (archetype === 'minion-sentry') expect([[], ['labBehavior.params.attackRateTicks#summon-average-rate'], ['labBehavior.params.attackRateTicks#summon-hit-cap']], w.name).toContainEqual(modeled)
      if (archetype === 'thrust') expect([[], ['labBehavior.params.reachTiles']], w.name).toContainEqual(modeled) // [] = the article-stated range (B56)
      if (archetype === 'bow-gun' && modeled.length > 0) expect(w.labBehavior.params.spreadDegrees, w.name).toBe(10)
      if (archetype === 'explosive-aoe') expect([[], ['labBehavior.params.blastRadiusTiles']], w.name).toContainEqual(modeled) // [] = an article-stated radius
    }
  })

  it('remaining-archetype families: a member is a limitation while its archetype has no interpreter, else params the guard accepts or a limitation (B61); no forward promise', () => {
    const familyOfTag: Record<string, Archetype> = {
      boomerangs: 'returning',
      flails: 'returning',
      yoyos: 'returning',
      whips: 'whip',
      'minion-summon-items': 'minion-sentry',
      'sentry-summon-items': 'minion-sentry',
      explosives: 'explosive-aoe',
      launchers: 'explosive-aoe',
    }
    const members = weapons.filter((w) => w.tags.some((t) => t in familyOfTag))
    if (!members.some((w) => w.labBehavior.kind === 'archetype')) return // dataset predates the remaining-family interpreters
    let emitted = 0
    for (const w of members) {
      const lab = w.labBehavior
      const archetype = familyOfTag[w.tags.find((t) => t in familyOfTag) as string]
      if (!IMPLEMENTED_ARCHETYPES.includes(archetype)) expect(lab.kind, w.name).toBe('limitation')
      if (lab.kind === 'archetype') {
        emitted++
        expect(lab.params.archetype, w.name).toBe(archetype)
        expect(assessWeapon(w).simulable, w.name).toBe(true)
      }
      if (lab.kind === 'limitation') expect(lab.reason, w.name).not.toMatch(/\byet\b|\bsoon\b|will be|coming|parameters have not been assigned/i)
    }
    // the B61 flip: registering an interpreter emitted that family's recorded params (returning P3-S7; minion-sentry + whip P3-S9/S10; explosive-aoe P3-S11)
    for (const archetype of ['returning', 'minion-sentry', 'whip', 'explosive-aoe'] as const) {
      expect(members.some((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === archetype), archetype).toBe(true)
    }
    expect(emitted).toBe(members.filter((w) => w.labBehavior.kind === 'archetype').length)
  })

  it('AMENDMENTS-013 B67: no emitted limitation reason makes a forward promise — family, reviewed, specific and the default card alike', () => {
    const promise = /\byet\b|\bsoon\b|will be|coming|parameters have not been assigned/i
    expect(LAB_DEFAULT_REASON).not.toMatch(promise)
    const reasons = weapons.flatMap((w) => (w.labBehavior.kind === 'limitation' ? [[w.name, w.labBehavior.reason] as const] : []))
    expect(reasons.length).toBeGreaterThan(0)
    for (const [name, reason] of reasons) expect(reason, name).not.toMatch(promise)
    // the default card (weapons in no Lab family) is among them
    expect(weapons.filter((w) => familyOf(w.tags) === undefined && w.labBehavior.kind === 'limitation' && w.labBehavior.reason === LAB_DEFAULT_REASON).length).toBeGreaterThan(0)
  })

  it('weapons in no family: a reviewed limitation entry is emitted with its own reason (editorial); the rest keep the default card', () => {
    const overlay = LabParamsOverlay.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../overlays/lab-params.json'), 'utf8')))
    const byId = new Map(overlay.entries.map((e) => [e.itemId, e]))
    const reviewed = weapons.filter((w) => ['Grenade', 'Star Cannon', 'Blowpipe', 'Flamethrower', 'Snowball Cannon'].includes(w.name))
    if (!reviewed.some((w) => byId.has(w.id))) return // dataset predates the ruling
    expect(reviewed).toHaveLength(5)
    for (const w of reviewed) {
      const entry = byId.get(w.id)
      expect(familyOf(w.tags), w.name).toBeUndefined() // no weapon-type category
      expect(entry?.decision, w.name).toBe('limitation')
      expect(w.labBehavior, w.name).toMatchObject({ kind: 'limitation', reason: entry?.decision === 'limitation' ? entry.reason : '' })
      expect(w._prov.editorialFields, w.name).toContain('labBehavior')
      expect(w._prov.sources.some((s) => s.kind === 'curated' && s.overlay === 'lab-params'), w.name).toBe(true)
    }
    // Category-less weapons without an entry keep the default card.
    const others = weapons.filter((w) => familyOf(w.tags) === undefined && !byId.has(w.id) && w.labBehavior.kind === 'limitation')
    expect(others.length).toBeGreaterThan(0)
    for (const w of others) expect(w._prov.editorialFields, w.name).not.toContain('labBehavior')
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
