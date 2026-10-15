/**
 * Readiness wording (SCORING_SPEC §6, §8.4; PRD §9 Feature A AC3; UX_SPEC §8). Every user-visible
 * string the readiness engine emits is built here, so the copy audit reads it whole: factor lines say
 * what in the loadout makes the fight easier or harder and why — juxtapositions, met / unmet needs,
 * gaps — never how the fight will go (no outcome, odds, verdict or time-to-defeat wording). "After you
 * defeat {X}" and "marked defeated" are the tracking terms (§8.4 exemption).
 *
 * Lines are SEGMENTS, not flat strings: a number carries the key of its AssumptionsTip (rendered as an
 * EstimateLabel right after it), items / bosses / sets link to their pages, condition slugs render as
 * requirement chips, Unknown renders through UnknownValue, and `quote` is verbatim wiki text (shown in
 * quotation marks, excluded from the audit of our own words).
 */
import type { DamageClass, StatEffect, StatKind } from '../schemas'
import type { Availability } from './candidates'
import type { ClassChoice } from './proxies'

export type EstimateKey = 'dps' | 'perMinute' | 'blocked' | 'contact' | 'synergy'

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'num'; text: string; estimate?: EstimateKey }
  | { kind: 'item'; text: string; id: number; availability?: Availability }
  | { kind: 'boss'; text: string; id: string }
  | { kind: 'set'; text: string; id: string }
  | { kind: 'cond'; text: string; id: string }
  | { kind: 'unknown'; text: 'Unknown'; field: string; sourceUrl?: string }
  | { kind: 'quote'; text: string }

type Part = Segment | readonly Segment[] | string | number

/** Tagged template → segments; adjacent text merges. */
export function s(strings: TemplateStringsArray, ...parts: Part[]): Segment[] {
  const out: Segment[] = []
  const text = (t: string) => {
    if (t === '') return
    const last = out[out.length - 1]
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t }
    else out.push({ kind: 'text', text: t })
  }
  const push = (p: Part) => {
    if (typeof p === 'string' || typeof p === 'number') text(String(p))
    else if (Array.isArray(p)) for (const seg of p as readonly Segment[]) push(seg)
    else if ((p as Segment).kind === 'text') text((p as Segment).text)
    else out.push(p as Segment)
  }
  strings.forEach((str, i) => {
    text(str)
    if (i < parts.length) push(parts[i])
  })
  return out
}

/** The plain text of segments (the copy audit and summaries read this). */
export const plain = (segments: readonly Segment[]): string => segments.map((seg) => seg.text).join('')

/** Our own words only: verbatim wiki quotes removed (the audit of OUR copy). */
export const ownWords = (segments: readonly Segment[]): string => segments.map((seg) => (seg.kind === 'quote' ? ' ' : seg.text)).join('')

/** "A", "A and B", "A, B and C". */
export function list(items: readonly (readonly Segment[])[], conjunction = 'and'): Segment[] {
  if (items.length === 0) return []
  if (items.length === 1) return [...items[0]]
  const head = items.slice(0, -1)
  const out: Segment[] = []
  head.forEach((item, i) => {
    out.push(...item)
    if (i < head.length - 1) out.push({ kind: 'text', text: ', ' })
  })
  return s`${out} ${conjunction} ${items[items.length - 1]}`
}

/** "Plantera’s", "The Twins’", "Angel Wings’": a name ending in s takes the bare apostrophe. */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`)
/** A linked name followed by its possessive ending. */
export const poss = (seg: Segment): Segment[] => [seg, { kind: 'text', text: /s$/i.test(seg.text) ? '’' : '’s' }]

/**
 * Bosses whose name is grammatically plural ("The Twins charge at you", "The Twins have … HP"). No data
 * field carries grammatical number, and a trailing "s" doesn't tell (the Eater of Worlds is one boss),
 * so this is a display set keyed by boss id (AMENDMENTS-015 B96c).
 */
export const PLURAL_BOSS_IDS: ReadonlySet<string> = new Set(['the-twins'])
export const isPluralBoss = (boss: Segment): boolean => boss.kind === 'boss' && PLURAL_BOSS_IDS.has(boss.id)
/** The verb (or pronoun) form that agrees with a boss segment. */
export const agree = (boss: Segment, one: string, many: string): string => (isPluralBoss(boss) ? many : one)

export const num = (text: string, estimate?: EstimateKey): Segment => ({ kind: 'num', text, ...(estimate ? { estimate } : {}) })
export const quote = (text: string): Segment => ({ kind: 'quote', text })
/** Verbatim text already ending in sentence punctuation (inside any closing quote or bracket). */
const ENDS_SENTENCE = /[.!?…]['"’”)\]]*\s*$/
/** A quote that ends our sentence: the full stop follows the closing mark unless the wiki text has its own. */
export const endQuote = (text: string): Segment[] => (ENDS_SENTENCE.test(text) ? [quote(text)] : [quote(text), { kind: 'text', text: '.' }])
export const unknown = (field: string, sourceUrl?: string): Segment => ({ kind: 'unknown', text: 'Unknown', field, ...(sourceUrl ? { sourceUrl } : {}) })

// --- number formats ---------------------------------------------------------------------------------

export const oneDecimal = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const whole = (n: number): string => Math.round(n).toLocaleString('en-US')
/** Up to 2 decimals without float noise (0.75, 0.5, 1). */
export const factor = (n: number): string => String(Number(n.toFixed(2)))
export const seconds = (ticks: number): string => oneDecimal(ticks / 60)

// --- labels -----------------------------------------------------------------------------------------

export const CLASS_WORD: Readonly<Record<ClassChoice, string>> = {
  melee: 'melee',
  ranged: 'ranged',
  magic: 'magic',
  summon: 'summon',
  other: 'classless',
  hybrid: 'hybrid',
}

export const DIFFICULTY_WORD = { classic: 'Classic', expert: 'Expert', master: 'Master' } as const

export const FACTOR_TITLES = {
  damage: 'Damage fit',
  defense: 'Defense & survivability',
  mobility: 'Mobility vs. attack patterns',
  synergy: 'Synergy',
  preparation: 'Preparation',
} as const

const scoped = (scope: DamageClass | undefined) => (scope && scope !== 'other' ? `${CLASS_WORD[scope]} ` : '')
const plural = (v: number, one: string, many: string) => (Math.abs(v) === 1 ? one : many)

/** A stat effect in words: "+15% ranged damage", "+8 defense", "−14% mana cost". */
const STAT_PHRASE: Readonly<Record<StatKind, (v: number, scope: DamageClass | undefined) => string>> = {
  'damage-pct': (v, sc) => `${v}% ${scoped(sc)}damage`,
  'damage-flat': (v, sc) => `${v} ${scoped(sc)}damage`,
  'crit-pct': (v, sc) => `${v}% ${scoped(sc)}critical strike chance`,
  'melee-speed-pct': (v) => `${v}% melee speed`,
  'attack-speed-pct': (v, sc) => `${v}% ${scoped(sc)}attack speed`,
  'defense-flat': (v) => `${v} defense`,
  'damage-reduction-pct': (v) => `${v}% damage reduction`,
  'move-speed-pct': (v) => `${v}% movement speed`,
  'jump-boost': () => 'jump height',
  'flight-time-ticks': (v) => `${v} ticks of flight time`,
  'life-regen': (v) => `${v} life regeneration`,
  'max-life-flat': (v) => `${v} max life`,
  'max-mana-flat': (v) => `${v} max mana`,
  'mana-cost-pct': (v) => `${v}% mana cost`,
  'mana-regen': (v) => `${v} mana regeneration`,
  'minion-slots': (v) => `${v} ${plural(v, 'minion slot', 'minion slots')}`,
  'sentry-slots': (v) => `${v} ${plural(v, 'sentry slot', 'sentry slots')}`,
  'whip-range-pct': (v) => `${v}% whip range`,
  'mining-speed-pct': (v) => `${v}% mining speed`,
  'aggro-flat': (v) => `${v} aggro`,
  'fishing-power-flat': (v) => `${v} fishing power`,
  'ammo-save-pct': (v) => `${v}% ammo saving`,
  'knockback-pct': (v) => `${v}% knockback`,
  'tag-effect-slots': (v) => `${v} whip tag ${plural(v, 'slot', 'slots')}`,
  'lava-immunity-ticks': (v) => `${v} ticks of lava immunity`,
  'melee-scale-pct': (v) => `${v}% melee weapon size`,
  'tile-reach-flat': (v) => `${v} tiles of reach`,
  'potion-cooldown-pct': (v) => `${v}% healing potion cooldown`,
  'armor-penetration-flat': (v) => `${v} armor penetration`,
  'minion-knockback': (v) => `${v} minion knockback`,
  'whip-speed-pct': (v) => `${v}% whip speed`,
}

export function effectPhrase(effect: Extract<StatEffect, { kind: 'stat' }>, scope = effect.scope): string {
  const sign = effect.value < 0 ? '−' : '+'
  return `${sign}${STAT_PHRASE[effect.stat](Math.abs(effect.value), scope)}`
}

/** Field paths → words, for "its … is Unknown" lines. */
export const FIELD_WORD: Readonly<Record<string, string>> = {
  damageClass: 'damage class',
  damage: 'damage',
  useTimeTicks: 'use time',
  useAnimationTicks: 'use time',
  critPct: 'critical strike chance',
  autoReuse: 'auto-reuse',
  reuseDelayTicks: 'reuse delay',
  ammoClass: 'ammo type',
}

// --- F1 Damage fit ----------------------------------------------------------------------------------

export const f1 = {
  noWeapon: () => s`No main weapon is in your loadout, so damage fit isn’t estimated.`,
  weaponNotCounted: (weapon: Segment) => s`Your main weapon, ${weapon}, isn’t counted (see “Not counted”), so damage fit isn’t estimated.`,
  missingFromData: (id: number) => s`Your main weapon (item #${id}) isn’t in this version’s data, so damage fit isn’t estimated.`,
  summonStaff: (weapon: Segment) => s`Your ${weapon} summons minions or sentries; their attack rate varies by minion AI, so no damage estimate is made.`,
  fieldsUnknown: (weapon: Segment, fields: readonly Segment[][]) => s`Your ${poss(weapon)} ${list(fields)} ${fields.length === 1 ? 'is' : 'are'} not verified, so no damage estimate is made.`,
  /** `dps` is a num segment that carries its unit ("189.7/s"), so the "est." chip follows the whole figure. */
  estimate: (weapon: Segment, dps: Segment, boss: Segment, defense: number) => s`Your ${weapon} is estimated at ${dps} after ${poss(boss)} ${defense} defense.`,
  estimateNoDefense: (weapon: Segment, dps: Segment) => s`Your ${weapon} is estimated at ${dps}.`,
  defenseUnknown: (boss: Segment, difficulty: string, marker: Segment) => s`${poss(boss)} defense on ${difficulty} is ${marker}, so this estimate leaves defense out.`,
  perMinute: (total: Segment, boss: Segment, hp: string, difficulty: string) => s`Sustained for a full minute that totals ~${total}; ${boss} ${agree(boss, 'has', 'have')} ${hp} HP on ${difficulty}.`,
  hpUnknown: (boss: Segment, difficulty: string, marker: Segment) => s`${poss(boss)} health on ${difficulty} is ${marker}, so there’s no health figure to set beside the estimate.`,
  floor: (boss: Segment, weapon: Segment) => s`${poss(boss)} defense cuts each hit of your ${weapon} to the 1-damage minimum.`,
  ammoIncluded: (ammo: Segment, damage: number) => s`Each hit includes your ${poss(ammo)} ${damage} damage.`,
  ammoDamageUnknown: (ammo: Segment, marker: Segment) => s`Your ${poss(ammo)} damage is ${marker}, so the estimate is scored without ammo.`,
  noAmmo: (weapon: Segment) => s`Scored without ammo: none of your ammo fits your ${weapon}.`,
  uncounted: (weapon: Segment, behavior: string) => s`Not counted in this estimate: ${weapon} — ${endQuote(behavior)}`,
}

// --- F2 Defense & survivability ---------------------------------------------------------------------

export const f2 = {
  defense: (defense: number, blocked: Segment, difficulty: string, f: number) =>
    s`Your equipment adds ${defense} defense, which blocks an estimated ${blocked} per hit on ${difficulty} (${defense} × ${factor(f)}).`,
  noDefense: () => s`Your loadout adds no defense.`,
  pieceDefenseUnknown: (piece: Segment, marker: Segment) => s`${poss(piece)} defense is ${marker}, so it isn’t in that total.`,
  contact: (boss: Segment, difficulty: string, contact: number, after: Segment) => s`${poss(boss)} contact damage on ${difficulty} is ${contact}; after your defense, about ${after} per touch.`,
  contactUnknown: (boss: Segment, difficulty: string, version: string, marker: Segment) =>
    s`${poss(boss)} contact damage on ${difficulty} is ${marker} (not verified for Terraria ${version}), so this factor covers your defense only.`,
  damageReduction: (pct: number) => s`Your gear reduces damage taken by ${pct}%, listed apart from defense, not merged into it.`,
  extras: (phrases: readonly string[]) => s`Also on your gear: ${list(phrases.map((p) => s`${p}`))}.`,
  lifeNotTracked: () => s`Your max life isn’t tracked here, so this factor covers your equipment only.`,
}

// --- F3 Mobility vs. attack patterns -----------------------------------------------------------------

/** What each curated attack pattern does, as a verb phrase after the boss's name: [one boss, a plural name]. */
export const TAG_PHRASE = {
  charges: ['charges at you', 'charge at you'],
  dashes: ['dashes at you', 'dash at you'],
  flies: ['flies', 'fly'],
  'projectile-spam': ['fires projectile barrages', 'fire projectile barrages'],
  'homing-projectiles': ['fires homing projectiles', 'fire homing projectiles'],
  'ground-bound': ['stays on the ground', 'stay on the ground'],
  burrows: ['burrows through the ground', 'burrow through the ground'],
  teleports: ['teleports', 'teleport'],
  'despawn-leash': ['can despawn', 'can despawn'],
  'enrage-mechanic': ['can enrage', 'can enrage'],
  'multi-phase': ['fights in more than one phase', 'fight in more than one phase'],
  'summons-adds': ['summons minions', 'summon minions'],
  'inflicts-debuffs': ['inflicts debuffs', 'inflict debuffs'],
  'high-contact-damage': ['deals high contact damage', 'deal high contact damage'],
} as const satisfies Record<string, readonly [string, string]>

type Tag = keyof typeof TAG_PHRASE
const opener = (boss: Segment, tag: Tag) => s`${boss} ${agree(boss, TAG_PHRASE[tag][0], TAG_PHRASE[tag][1])}.`

export const f3 = {
  tagsUnknown: (boss: Segment, marker: Segment) => s`${poss(boss)} attack patterns are ${marker}, so mobility isn’t compared.`,
  dodgeByDash: (boss: Segment, tag: Tag, item: Segment) => s`${opener(boss, tag)} Your ${item} gives you a dash.`,
  dodgeBySpeed: (boss: Segment, tag: Tag, pct: number, threshold: number) =>
    s`${opener(boss, tag)} Your gear adds ${pct}% movement speed, at or above the ${threshold}% this checker counts for getting out of the way.`,
  dodgeShort: (boss: Segment, tag: Tag, pct: number, threshold: number) =>
    s`${opener(boss, tag)} Your gear has no dash and adds ${pct}% movement speed, under the ${threshold}% this checker counts for getting out of the way.`,
  flightMet: (boss: Segment, item: Segment, secs: string, threshold: string) => s`${opener(boss, 'flies')} Your ${item} gives ${secs} s of flight, at or above the ${threshold} s this checker counts.`,
  flightShort: (boss: Segment, item: Segment, secs: string, threshold: string) => s`${opener(boss, 'flies')} Your ${item} gives ${secs} s of flight, under the ${threshold} s this checker counts.`,
  flightNone: (boss: Segment) => s`${opener(boss, 'flies')} Nothing in your loadout gives flight.`,
  flightUnknown: (boss: Segment, tag: Tag, item: Segment, marker: Segment) => s`${opener(boss, tag)} Your ${poss(item)} flight time is ${marker}.`,
  repositionMet: (boss: Segment, tag: Tag, means: readonly Segment[][]) => s`${opener(boss, tag)} Your gear gives you ${list(means)} to reposition with.`,
  repositionShort: (boss: Segment, tag: Tag, pct: number, threshold: number, flight: string) =>
    s`${opener(boss, tag)} Your gear has no dash and no flight of ${flight} s or more, and adds ${pct}% movement speed, under the ${threshold}% this checker counts for repositioning.`,
  dodgeUncounted: (boss: Segment, tag: Tag, pct: number, item: Segment, text: string) =>
    s`${opener(boss, tag)} Your gear adds ${pct}% counted movement speed; ${poss(item)} ${quote(text)} isn’t counted, so this checker can’t tell whether it covers this.`,
  flightUncounted: (boss: Segment, item: Segment, text: string) => s`${opener(boss, 'flies')} ${poss(item)} ${quote(text)} has no verified flight time, so this checker can’t tell.`,
  repositionUncounted: (boss: Segment, tag: Tag, pct: number, item: Segment, text: string) =>
    s`${opener(boss, tag)} Your gear adds ${pct}% counted movement speed; ${poss(item)} ${quote(text)} isn’t counted, so this checker can’t tell whether it covers this.`,
  meansDash: (item: Segment) => s`a dash (${item})`,
  meansSpeed: (pct: number) => s`${pct}% movement speed`,
  meansFlight: (item: Segment, secs: string) => s`${secs} s of flight (${item})`,
  noGearStat: (boss: Segment, tag: Tag) => s`${opener(boss, tag)} This checker reads no gear stat for it; the boss page has the wiki’s tips.`,
  despawn: (boss: Segment) => s`${opener(boss, 'despawn-leash')} The boss page says when.`,
  phases: (boss: Segment) => s`${opener(boss, 'multi-phase')} The stats this checker uses are ${agree(boss, 'its', 'their')} first form’s.`,
  enrage: (boss: Segment) => s`${opener(boss, 'enrage-mechanic')} The boss page says what sets it off; this checker can’t tell whether your plan avoids it.`,
  adds: (boss: Segment) => s`${opener(boss, 'summons-adds')} The estimate under Damage fit counts one target only.`,
  debuffs: (boss: Segment) => s`${opener(boss, 'inflicts-debuffs')} Preparation lists your potions.`,
  contact: (boss: Segment) => s`${opener(boss, 'high-contact-damage')} See Defense & survivability.`,
}

// --- F4 Synergy ---------------------------------------------------------------------------------------

export const f4 = {
  weaponMatch: (weapon: Segment, cls: string) => s`Your ${weapon} is a ${cls} weapon, matching your class.`,
  weaponMismatch: (weapon: Segment, weaponClass: string, cls: string) => s`Your ${weapon} is a ${weaponClass} weapon; bonuses for ${cls} don’t apply to it.`,
  weaponClassless: (weapon: Segment) => s`Your ${weapon} deals classless damage: only bonuses without a class apply to it.`,
  weaponHybrid: (weapon: Segment, weaponClass: string) => s`Your ${weapon} is a ${weaponClass} weapon; with your class set to hybrid, every class’s bonuses count as matching.`,
  weaponClassUnknown: (weapon: Segment, marker: Segment) => s`Your ${poss(weapon)} damage class is ${marker}.`,
  /** `counted`: the bonus's numbers count with the rest of the gear — all of it, part of it (some is unmodeled), or none (named only). */
  setActive: (set: Segment, bonus: string, counted: 'all' | 'some' | 'none') =>
    s`Your ${set} set bonus is active: ${endQuote(bonus)} ${counted === 'all' ? 'Its numbers count with the rest of your gear.' : counted === 'some' ? 'Its numbers count with the rest of your gear; the rest isn’t modeled.' : 'It’s named here, not scored.'}`,
  setInactive: (set: Segment, missing: readonly Segment[], count: number) => s`Your ${set} set bonus is inactive: ${missing} ${count === 1 ? 'is' : 'are'} missing.`,
  setMissingHelmet: (set: Segment) => s`a ${set} helmet`,
  setMixed: () => s`Your armor pieces come from different sets, so no set bonus is active.`,
  mismatch: (item: Segment, phrases: readonly string[], cls: string) => s`${poss(item)} ${list(phrases.map((p) => s`${p}`))} ${phrases.length === 1 ? 'doesn’t' : 'don’t'} apply to your ${cls} class.`,
  points: (matched: Segment, total: string, cls: string) => s`${matched} of ${total} counted stat points on your gear apply to your ${cls} class.`,
  noPoints: () => s`None of your gear’s effects are counted stat points.`,
  uncounted: (item: Segment, texts: readonly string[]) =>
    s`Not counted (effects this checker doesn’t model): ${item} — ${list(texts.map((t, i) => (i === texts.length - 1 ? endQuote(t) : [quote(t)])))}`,
  upgrades: (item: Segment, into: readonly Segment[][]) => s`${item} combines into ${list(into, 'or')} at a Tinkerer’s Workshop.`,
  effectsUnknown: (item: Segment, marker: Segment) => s`${poss(item)} effects are ${marker}, so they aren’t counted.`,
}

// --- F5 Preparation -----------------------------------------------------------------------------------

export const f5 = {
  ammoFits: (ammo: Segment, weapon: Segment) => s`Your loadout includes ${ammo}, which your ${weapon} fires.`,
  ammoMissing: (weapon: Segment, ammoType: string) => s`Your ${weapon} fires ${ammoType}, and none is in your loadout.`,
  ammoUnused: (ammo: Segment) => s`Your ${ammo} isn’t fired by your weapons.`,
  ammoTypeUnknown: (weapon: Segment, marker: Segment) => s`Your ${poss(weapon)} ammo type is ${marker}.`,
  noBuffs: () => s`No buff potions are in your loadout.`,
  buffs: (entries: readonly Segment[][]) => s`Your potions: ${list(entries)}.`,
  buffEntry: (potion: Segment, phrases: readonly string[]) => (phrases.length > 0 ? s`${potion} (${phrases.join(', ')})` : s`${potion} (not modeled here)`),
  buffEffectsUnknown: (potion: Segment, marker: Segment) => s`${poss(potion)} buff effects are ${marker}, so they aren’t counted.`,
  healing: (entries: readonly Segment[][]) => s`Your loadout includes ${list(entries)}.`,
  healingEntry: (potion: Segment, amount: number) => s`${potion}, which restores ${amount} health`,
  noHealing: () => s`No potion in your loadout restores health.`,
  healingUnknown: (potion: Segment, marker: Segment) => s`${poss(potion)} healing is ${marker}.`,
  mana: (potion: Segment, amount: number) => s`${potion} restores ${amount} mana.`,
  summonSlot: (staff: Segment) => s`Your summon slot holds ${staff}; minion damage isn’t estimated, since attack rate varies by minion AI.`,
  summonEmpty: () => s`Your summon slot is empty.`,
  bossSummon: (boss: Segment, items: readonly Segment[][], text: string) =>
    items.length > 0
      ? s`${boss} ${agree(boss, 'is', 'are')} summoned with ${list(items, 'or')}: ${endQuote(text)}`
      : s`How ${boss} ${agree(boss, 'is', 'are')} summoned: ${endQuote(text)}`,
  bossConditions: (boss: Segment, chips: readonly Segment[]) => s`${poss(boss)} summon conditions: ${chips}`,
  bossSummonUnknown: (boss: Segment, marker: Segment) => s`How ${boss} ${agree(boss, 'is', 'are')} summoned is ${marker}.`,
  /** The summon input's words in "From N of M inputs · Unknown: …". */
  summonInput: (boss: Segment) => `how ${boss.text} ${agree(boss, 'is', 'are')} summoned`,
  prep: (boss: Segment, steps: number, done: number | undefined) =>
    done === undefined ? s`${poss(boss)} page has a curated prep checklist of ${steps} steps.` : s`${poss(boss)} page has a curated prep checklist of ${steps} steps; you’ve checked ${done}.`,
  prepUnknown: (boss: Segment, marker: Segment) => s`${poss(boss)} prep checklist is ${marker}.`,
}

// --- Improve My Build (P5-S7) --------------------------------------------------------------------------

export const improve = {
  weaponTitle: 'Main weapon',
  weaponTarget: (boss: Segment) => s`Compared on estimated damage per second against ${boss}.`,
  armorTitle: 'Armor set',
  armorTarget: () => s`Compared on armor defense (the set bonus’s defense included).`,
  accessoryTitle: 'Accessory',
  accessoryTarget: (cls: string) => s`Compared on counted stat points that apply to your ${cls} class.`,
  potionTitle: 'Buff potion',
  potionTarget: (cls: string) => s`Compared on counted stat points that apply to your ${cls} class.`,
  healingTitle: 'Healing potion',
  healingTarget: () => s`Your loadout has no healing potion; these restore the most health.`,

  weapon: (dps: Segment, current: Segment | undefined) => (current ? s`${dps}, up from ${current}.` : s`${dps}; no estimate exists for your current main weapon.`),
  scoredWithoutAmmo: () => s`Scored without ammo: none of your ammo fits it.`,
  armor: (defense: number, current: number) => s`${defense} defense, up from ${current}.`,
  accessory: (points: Segment, phrases: readonly string[], replaces: Segment | undefined, current: string) =>
    replaces
      ? s`${points} points (${phrases.join(', ')}), up from ${current} for ${replaces}.`
      : s`${points} points (${phrases.join(', ')}) for an empty accessory slot.`,
  potion: (points: Segment, phrases: readonly string[]) => s`${points} points (${phrases.join(', ')}).`,
  healing: (amount: number) => s`Restores ${amount} health.`,

  emptyWeapon: () => s`No weapon verified obtainable with the bosses you’ve marked improves on your current estimate.`,
  emptyWeaponNoEstimate: () => s`No weapon verified obtainable with the bosses you’ve marked has an estimate to compare.`,
  emptyArmor: () => s`No armor set verified obtainable with the bosses you’ve marked has more defense than yours.`,
  armorPartlyUnknown: () => s`Your current armor’s defense is partly Unknown, so no set can be shown to improve on it.`,
  emptyAccessory: () => s`No accessory verified obtainable with the bosses you’ve marked adds more counted points than what it would replace.`,
  accessoriesFull: () => s`Every accessory slot holds an item with effects this checker doesn’t model or doesn’t count, so none is offered as a replacement.`,
  emptyPotion: () => s`No buff potion verified obtainable with the bosses you’ve marked adds counted points you don’t already have.`,
  emptyHealing: () => s`No healing potion is verified obtainable with the bosses you’ve marked.`,

  /**
   * One short list, one clause per reason (AMENDMENTS-015 B96d: no run-on). `gatedNotListed`: gated
   * upgrades past the cut (gated ones are listed nearest boss first, B94(5)); `gatedListed`: how many are;
   * `otherWorld`: left out because they need the other world's evil boss, named (B97a).
   */
  disclosure: (
    unknownCount: number,
    unverifiedCount: number,
    cappedCount: number,
    boss: Segment,
    gatedNotListed = 0,
    gatedListed = 0,
    otherWorld: { count: number; bosses: readonly Segment[] } = { count: 0, bosses: [] },
  ) => {
    const parts: Segment[][] = []
    const one = (n: number) => n === 1
    if (unknownCount > 0) parts.push(s`${unknownCount} with Unknown availability`)
    if (unverifiedCount > 0) parts.push(s`${unverifiedCount} without the verified stats to compare`)
    if (cappedCount > 0) parts.push(s`${cappedCount} that ${one(cappedCount) ? 'needs' : 'need'} ${boss} or a fight ${agree(boss, 'it opens', 'they open')}`)
    if (otherWorld.count > 0) {
      const named = otherWorld.bosses.length > 0 ? s` (${list(otherWorld.bosses.map((b) => [b]), 'or')})` : []
      parts.push(s`${otherWorld.count} that ${one(otherWorld.count) ? 'needs' : 'need'} the other world’s evil boss${named}`)
    }
    if (gatedNotListed > 0) parts.push(s`${gatedNotListed} more gated ${one(gatedNotListed) ? 'upgrade' : 'upgrades'} beyond the ${gatedListed} listed`)
    const joined: Segment[] = []
    parts.forEach((p, i) => joined.push(...(i > 0 ? s`; ${p}` : p)))
    return parts.length > 0 ? s`Not shown: ${joined}.` : []
  },
}

// --- owned items whose usual sources are gated (AMENDMENTS-015 B94(1); SCORING_SPEC §6) -----------------

export const owned = {
  /** Info tone: ownership is the user's ground truth, so the items count; the gate is said, not applied. */
  gated: (items: readonly Segment[][], gates: readonly Segment[][]) =>
    items.length === 1
      ? s`${items[0]} is counted because it’s in your loadout; its usual sources open after you defeat ${list(gates)}, not marked defeated on the boss map.`
      : s`${list(items)} are counted because they’re in your loadout; their usual sources open after you defeat ${list(gates)}, not marked defeated on the boss map.`,
}

// --- not counted / analysis-level ----------------------------------------------------------------------

export const notCounted = {
  demonHeart: (item: Segment, gate: Segment) => s`${item} — in the Demon Heart slot, which opens after you defeat ${gate}.`,
  duplicate: (item: Segment) => s`${item} — already equipped in another slot.`,
  wrongSlot: (item: Segment) => s`${item} — doesn’t fit that slot.`,
  missingFromData: (id: number) => s`Item #${id} — not in this version’s data.`,
}

/** What each estimate is, for screen readers and the AssumptionsTip heading (UX_SPEC §8). */
export const ESTIMATE_CONTEXT: Readonly<Record<EstimateKey, string>> = {
  dps: 'estimated damage per second',
  perMinute: 'one-minute damage total',
  blocked: 'damage blocked per hit',
  contact: 'contact damage after defense',
  synergy: 'class-matching stat points',
}

/** One AssumptionsTip entry (same shape as src/components/assumptions.ts). */
export interface AssumptionText {
  id: string
  title: string
  detail: string
  sourceUrl?: string
}

export const assumptionText = {
  dppBase: (dpp: string): AssumptionText => ({ id: 'dpp-base', title: 'Base damage rate', detail: dpp }),
  bossDefense: (source: string): AssumptionText => ({
    id: 'boss-defense',
    title: 'Then the boss’s defense',
    detail: 'Half the boss’s defense on the chosen difficulty comes off each hit, rounded down, with a 1-damage minimum. Critical hits are applied as an average, not rolled.',
    sourceUrl: source,
  }),
  bossDefenseUnknown: (): AssumptionText => ({
    id: 'boss-defense',
    title: 'Boss defense left out',
    detail: 'The boss’s defense on the chosen difficulty is Unknown, so this estimate uses none.',
  }),
  bonuses: (): AssumptionText => ({
    id: 'bonuses',
    title: 'Your bonuses',
    detail: 'Damage, critical strike chance and attack speed from your counted armor, set bonus, accessories and potions — the ones that apply to the weapon’s class. Potion buffs are taken as active.',
  }),
  ammo: (ammo: string, damage: number): AssumptionText => ({ id: 'ammo', title: 'Ammo', detail: `Each hit adds ${possessive(ammo)} ${damage} damage.` }),
  noAmmo: (): AssumptionText => ({ id: 'ammo', title: 'Ammo', detail: 'Scored without ammo — no compatible ammo in your loadout.' }),
  minute: (): AssumptionText => ({
    id: 'minute',
    title: 'A full minute',
    detail: 'The per-second estimate times 60, with no pauses, misses or movement. It is set beside the boss’s health for scale only.',
  }),
  playerDefense: (source: string): AssumptionText => ({
    id: 'player-defense',
    title: 'Defense rule',
    detail: 'Each point of your defense blocks 0.5 damage per hit in Classic, 0.75 in Expert and 1 in Master.',
    sourceUrl: source,
  }),
  equipmentOnly: (): AssumptionText => ({
    id: 'equipment-only',
    title: 'Equipment only',
    detail: 'Defense from your counted armor, accessories and potions. Reforges and other buffs aren’t included.',
  }),
  rounding: (source: string): AssumptionText => ({
    id: 'rounding',
    title: 'Rounding',
    detail: 'Damage after defense is rounded down and is at least 1.',
    sourceUrl: source,
  }),
  pointWeights: (version: number): AssumptionText => ({
    id: 'point-weights',
    title: `Point weights (editorial, v${version})`,
    detail:
      'Each numeric effect is worth points: 1 per % of damage, critical strike chance or attack speed; 2 per flat damage; 1 per % of movement speed; 0.1 per tick of flight; 2 per defense; 4 per % of damage reduction; 2 per life regeneration; 0.25 per max life; 0.1 per max mana; 1 per % of mana cost reduction; 1 per mana regeneration; 20 per minion slot; 10 per sentry slot; 0.5 per % of whip range. Critical strike chance counts 0 for summon.',
  }),
  pointsUncounted: (): AssumptionText => ({
    id: 'points-uncounted',
    title: 'Not counted',
    detail: 'Effects this checker doesn’t model count 0, as do stat kinds without a weight in this version.',
  }),
  pointsMatching: (): AssumptionText => ({
    id: 'points-matching',
    title: 'Matching your class',
    detail: 'An effect matches when it names no class or names yours. Mana kinds count as magic, melee speed as melee, and minion, sentry and whip kinds as summon.',
  }),
}

/** Analysis-level assumptions (shown once beside the factors). */
export const analysisAssumption = {
  trackedOnly: (): AssumptionText => ({
    id: 'tracked-only',
    title: 'Availability follows the boss map',
    detail: 'An item counts as available only when every boss it needs is marked defeated on the boss map. Your selected stage assumes nothing.',
  }),
  ownedGated: (): AssumptionText => ({
    id: 'owned-gated',
    title: 'Gated items, counted',
    detail: 'An item in your loadout whose usual sources need a boss you haven’t marked defeated is still counted, because you put it in your loadout. Its factor names the boss.',
  }),
  demonHeartClosed: (): AssumptionText => ({
    id: 'demon-heart-closed',
    title: 'Demon Heart slot taken as closed',
    detail: 'Until the Wall of Flesh is marked defeated on the boss map, the Demon Heart slot is taken as not open, so an accessory in it is left out of every factor.',
  }),
  ownedUnknown: (): AssumptionText => ({
    id: 'owned-unknown',
    title: 'Unknown availability, counted',
    detail: 'An item whose availability isn’t verified is counted because you put it in your loadout.',
  }),
  potionsActive: (): AssumptionText => ({ id: 'potions-active', title: 'Potions active', detail: 'Your potions’ buffs are taken as active for the whole fight.' }),
  demonHeart: (source: string): AssumptionText => ({
    id: 'demon-heart',
    title: 'Demon Heart used',
    detail: 'The Demon Heart slot exists only after you use a Demon Heart (from the Wall of Flesh’s Treasure Bag, Expert and Master Mode). This checker can’t see that, so it assumes you have.',
    sourceUrl: source,
  }),
}
