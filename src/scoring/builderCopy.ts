/**
 * Loadout builder engine wording (SCORING_SPEC §4, §5.1, §8.4; PRD P4-S2; UX_SPEC §3.5, §8). Every
 * user-visible string the recommendation and the build profile emit is built here, so the copy
 * audit (src/scoring/copyAudit.ts) reads it whole. The rule: a pick is the highest-SCORING under the
 * stated weights and formulas — never "the best" — and each line says what it was compared on, among
 * how many, and what wasn't counted. No outcome, odds or forward-promise wording.
 *
 * Lines are Segments (src/scoring/readinessCopy.ts): items / bosses link, numbers carry the key of
 * their AssumptionsTip, Unknown renders through UnknownValue, wiki text is quoted verbatim.
 */
import type { DamageClass, Goal, LoadoutClass } from '../schemas'
import type { AccessoryQuota } from './constants'
import { CLASS_WORD, endQuote, list, num, oneDecimal, s, whole, type AssumptionText, type Segment } from './readinessCopy'

// --- words --------------------------------------------------------------------------------------

export const GOAL_WORD: Readonly<Record<Goal, string>> = {
  boss: 'boss fight',
  'max-damage': 'maximum damage',
  exploration: 'exploration',
  survivability: 'survivability',
  mobility: 'mobility',
  balanced: 'balanced',
}

export const QUOTA_WORD: Readonly<Record<AccessoryQuota, string>> = { off: 'offense', def: 'defense', mob: 'mobility', util: 'utility' }

/** Component words (Points keys and the armor score's terms). */
export const POINTS_WORD = { off: 'offense', def: 'defense', mob: 'mobility', surv: 'survivability' } as const

export const classWord = (cls: LoadoutClass | DamageClass): string => CLASS_WORD[cls]

/**
 * A weapon's kind (its tags[0]) in plain words, for the alt weapon's rationale ("a boomerang"). A tag
 * without an entry here (or no tag) is not named — the line then says only that the kinds differ.
 */
export const WEAPON_KIND: Readonly<Record<string, string>> = {
  broadswords: 'a broadsword',
  shortswords: 'a shortsword',
  spears: 'a spear',
  boomerangs: 'a boomerang',
  flails: 'a flail',
  yoyos: 'a yoyo',
  'projectile-melee': 'a melee weapon that shoots projectiles',
  'wall-piercing-weapons': 'a weapon that passes through walls',
  bows: 'a bow',
  repeaters: 'a repeater',
  guns: 'a gun',
  launchers: 'a launcher',
  wands: 'a wand',
  'magic-guns': 'a magic gun',
  'spell-books': 'a spell book',
  whips: 'a whip',
  explosives: 'an explosive',
}
export const weaponKind = (tag: string | undefined): string | undefined => (tag ? WEAPON_KIND[tag] : undefined)

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const count = (n: number, one: string, many: string) => `${whole(n)} ${plural(n, one, many)}`

/** A pool's size, owned-Unknown gear kept apart from the verified count (AMENDMENTS-016 B108(e) H3). */
export interface PoolSize {
  /** Verified obtainable at the builder's progress (availability "yes"). */
  verified: number
  /** Eligible only because the user marked them owned (availability Unknown, B69/Q2). */
  owned: number
}

/**
 * "the 40 melee weapons verified obtainable at your progress + 1 owned (unverified)": owned gear with
 * Unknown availability is never folded into the verified count.
 */
export function poolPhrase(n: PoolSize, one: string, many: string, verifiedWords: string | readonly Segment[] | ((count: number) => string) = 'verified obtainable at your progress'): Segment[] {
  if (n.verified === 0 && n.owned > 0) return s`the ${whole(n.owned)} owned (unverified) ${plural(n.owned, one, many)}`
  const words = typeof verifiedWords === 'function' ? verifiedWords(n.verified) : verifiedWords
  const base = s`the ${count(n.verified, one, many)} ${words}`
  return n.owned > 0 ? s`${base} + ${whole(n.owned)} owned (unverified)` : base
}

/** AMENDMENTS-016 B113(e): the verb agrees with the count ("the 1 buff potion … that grants"). */
const buffWords = (n: number) => `verified obtainable at your progress that ${n === 1 ? 'grants' : 'grant'} a buff not already in this loadout`

// --- per-pick rationale (1–2 lines, SCORING_SPEC §4.1–4.5) ------------------------------------------

/** B108 H2: the alt's relation to a pinned main that scores below it. */
const altAbovePin = 'It scores above your pick, which holds the main slot.'
/** B110: a pinned main without a score — nothing to compare the alt with. */
const altUnscoredPin = 'Your pick’s score is Unknown.'

export const rationale = {
  /** §4.1: "Highest estimated damage output of the N {class} weapons verified obtainable at your progress (est.)". */
  main: (n: PoolSize, cls: LoadoutClass) =>
    cls === 'summon'
      ? s`Highest estimated damage per second of ${poolPhrase(n, 'whip', 'whips')}.`
      : s`Highest estimated damage per second of ${poolPhrase(n, `${classWord(cls)} weapon`, `${classWord(cls)} weapons`)}.`,
  /**
   * §4.2: next-ranked with a different weapon type (its kind in plain words when known). `abovePin`
   * (B108 H2): the main slot holds your pick and this one scores above it — so it isn't "next-highest"
   * after the main; it's the highest-scoring of its kind, and the line says it outscores your pick.
   */
  altType: (kind: string | undefined, abovePin = false) =>
    abovePin
      ? kind
        ? s`Highest estimated damage per second from a different kind of weapon than your main one — this one is ${kind}. ${altAbovePin}`
        : s`Highest estimated damage per second from a different kind of weapon than your main one. ${altAbovePin}`
      : kind
        ? s`Next-highest estimated damage per second from a different kind of weapon than your main one — this one is ${kind} — as a second option.`
        : s`Next-highest estimated damage per second from a different kind of weapon than your main one, as a second option.`,
  altSameType: (abovePin = false) =>
    abovePin
      ? s`Highest estimated damage per second; no other kind of weapon is verified obtainable at your progress. ${altAbovePin}`
      : s`Next-highest estimated damage per second; no other kind of weapon is verified obtainable at your progress.`,
  /**
   * AMENDMENTS-016 B110 (queued nit): beside a pinned main whose score is Unknown the alt can't be
   * "next-highest" after it, nor said to outscore it — the line compares nothing with the pick.
   */
  altTypeUnscoredPin: (kind: string | undefined) =>
    kind
      ? s`Highest estimated damage per second from a different kind of weapon than your main one — this one is ${kind}. ${altUnscoredPin}`
      : s`Highest estimated damage per second from a different kind of weapon than your main one. ${altUnscoredPin}`,
  altSameTypeUnscoredPin: () => s`Highest estimated damage per second; no other kind of weapon is verified obtainable at your progress. ${altUnscoredPin}`,
  /** SCORING_SPEC §4.8 Surprise Me: a slot drawn at random from its legal pool — never ranked, never "the" pick. */
  random: (pool: readonly Segment[]) => s`Drawn at random by Surprise Me from ${pool} — not ranked by score.`,
  altHybrid: (weaponClass: string) => s`Highest estimated damage per second among the other classes’ weapons (this one is ${weaponClass}).`,
  /** §4.3 */
  armor: (n: PoolSize, goal: Goal) => s`Highest armor score under the ${GOAL_WORD[goal]} weights of ${poolPhrase(n, 'set', 'sets', 'for your class verified obtainable at your progress')}.`,
  /** §4.4 within the slot's quota category. */
  accessory: (n: PoolSize, quota: AccessoryQuota) =>
    s`Most counted ${QUOTA_WORD[quota]} points for your class of ${poolPhrase(n, `${QUOTA_WORD[quota]} accessory`, `${QUOTA_WORD[quota]} accessories`, 'still free for this slot')}.`,
  /**
   * §4.4 + B108(a): a 0-point pick, qualified by an unscored effect that isn't tied to another class.
   * The card names it "not scored" (empty beats zero only for other-class effects). Never "not scored
   * for your class": a class-less effect (regeneration, the time) isn't scored for any class.
   */
  accessorySpecial: (quota: AccessoryQuota, text: string) =>
    s`No ${QUOTA_WORD[quota]} accessory with counted points for your class is left for this slot. This one adds 0 counted points — its effect is not scored: ${endQuote(text)}`,
  /** §4.4: an in-quota pick with 0 points of its quota but counted points of another category. */
  accessoryOtherPoints: (quota: AccessoryQuota, points: string) =>
    s`No ${QUOTA_WORD[quota]} accessory with counted ${QUOTA_WORD[quota]} points for your class is left for this slot; this one counts ${num(points)} points in other categories.`,
  /** §4.4: unfillable quota → top any-category candidate (disclosed). */
  accessoryFallback: (quota: AccessoryQuota, points: string) =>
    s`No ${QUOTA_WORD[quota]} accessory qualifies for this slot, so this is the highest-scoring accessory of any category (${num(points)} counted points).`,
  /** §4.4: the fallback found only 0-point accessories (an unscored effect qualified it). */
  accessoryFallbackZero: (quota: AccessoryQuota, text: string) =>
    s`No ${QUOTA_WORD[quota]} accessory qualifies for this slot, and no accessory of any category with counted points for your class is left. This one adds 0 counted points — its effect is not scored: ${endQuote(text)}`,
  /** §4.5 ammo. */
  ammo: (n: PoolSize, ammoType: string, weapon: Segment) =>
    s`Highest damage of ${poolPhrase(n, 'kind', 'kinds', s`of ammo your ${weapon} fires (${ammoType}) verified obtainable at your progress`)}.`,
  /** §4.5 buffs. */
  buff: (n: PoolSize) => s`Most counted points for your class of ${poolPhrase(n, 'buff potion', 'buff potions', buffWords)}.`,
  /** §4.5 summon: by damage, not DPP. */
  summon: (n: PoolSize) => s`Highest base damage of ${poolPhrase(n, 'minion staff', 'minion staffs')}. Its attack rate varies by minion AI — not estimated.`,
  /** B69/Q2: owned upgrades unknown → eligible. */
  owned: () => s`You marked this as gear you own, so it counts although its availability is Unknown.`,
  /** A pin the recommendation can't make (not obtainable at your progress, or no candidate to compare). */
  pinned: () => s`Your pick, kept in place of the recommendation.`,
  /** H2: a pin scoring below the slot's top candidate. */
  pinnedBelow: () => s`Your pick, kept over higher-scoring alternatives.`,
  /** M3: a pin that IS the recommendation (a reopened build, or a swap back): the recommendation's own why follows. */
  pinnedSame: (why: readonly Segment[]) => s`Your pick, and also the recommendation. ${why}`,
  /** M3: a pin tied with the slot's top candidate, which the §4.6 tie-break order would put here instead. */
  pinnedTied: (top: Segment) => s`Your pick. It scores the same as ${top}, which the fixed tie-break order would put here.`,
  minionNote: () => s`Its attack rate varies by minion AI — not estimated.`,
  /** Ties (the §4.6 total order decided): shown as alternatives. Accessories rank an unscored effect first (§4.4). */
  tied: (others: readonly Segment[][], accessory = false) =>
    s`Same score as ${list(others, 'and')}; a fixed tie-break order (${accessory ? 'an unscored effect first, then ' : ''}fewer boss gates, lower rarity, lower item ID) put this one first.`,
}

/** §4.8: the legal list a Surprise Me pick was drawn from, in words ("the 40 melee weapons verified obtainable at your progress"). */
export const drawnFrom = {
  main: (n: PoolSize, cls: LoadoutClass) => (cls === 'summon' ? poolPhrase(n, 'whip', 'whips') : poolPhrase(n, `${classWord(cls)} weapon`, `${classWord(cls)} weapons`)),
  alt: (n: PoolSize, cls: LoadoutClass) =>
    cls === 'hybrid'
      ? poolPhrase(n, 'weapon of another class', 'weapons of another class')
      : cls === 'summon'
        ? poolPhrase(n, 'other whip', 'other whips')
        : poolPhrase(n, `other ${classWord(cls)} weapon`, `other ${classWord(cls)} weapons`),
  armor: (n: PoolSize) => poolPhrase(n, 'set', 'sets', 'for your class verified obtainable at your progress'),
  accessory: (n: PoolSize) => poolPhrase(n, 'accessory', 'accessories', 'verified obtainable at your progress and still free for this slot'),
  ammo: (n: PoolSize, ammoType: string, weapon: Segment) => poolPhrase(n, 'kind', 'kinds', s`of ammo your ${weapon} fires (${ammoType}) verified obtainable at your progress`),
  buff: (n: PoolSize) => poolPhrase(n, 'buff potion', 'buff potions', buffWords),
  summon: (n: PoolSize) => poolPhrase(n, 'minion staff', 'minion staffs'),
}

// --- empty slots ("No verified option at this stage", UX_SPEC flow (c)) --------------------------------

export const empty = {
  main: (cls: LoadoutClass) =>
    cls === 'summon'
      ? s`No verified option at this stage: no whip is verified obtainable at your progress with the stats to estimate it.`
      : s`No verified option at this stage: no ${classWord(cls)} weapon is verified obtainable at your progress with the stats to estimate it.`,
  altNoMain: () => s`No alternative without a main weapon.`,
  altNone: () => s`No other weapon is verified obtainable at your progress for this class.`,
  altHybridNone: () => s`No weapon of another class is verified obtainable at your progress.`,
  armor: () => s`No verified option at this stage: no complete armor set for your class is verified obtainable at your progress with known stats.`,
  /** B108(a) empty beats zero: no accessory left whose points or unscored effects fit this class. */
  accessory: () => s`No accessory with a scored benefit for this class at this stage is left for this slot — empty rather than filled with one that does nothing for your class.`,
  ammo: (ammoType: string, weapon: Segment) =>
    s`No ammo your ${weapon} fires (${ammoType}) is verified obtainable at your progress with a verified damage value, so it is scored without ammo.`,
  buff: () => s`No further buff potion with counted points for your class is verified obtainable at your progress.`,
  summon: () => s`No minion staff is verified obtainable at your progress with a verified damage value.`,
  /** A slot kept empty by a swap or a saved build (the engine can't tell which): neutral wording. */
  pinnedEmpty: () => s`Kept empty — not filled by the recommendation.`,
  noAmmoNeeded: (hasMain: boolean) => (hasMain ? s`Your main weapon doesn’t fire ammo.` : s`No main weapon, so no ammo.`),
  demonHeart: (gate: Segment) => s`The Demon Heart slot opens after you defeat ${gate} (Expert and Master: the Demon Heart comes from its Treasure Bag).`,
}

// --- pool disclosure (SCORING_SPEC §3 "always rendered") ---------------------------------------------

export interface DisclosureCounts {
  /** Verified obtainable (availability "yes"). */
  eligible: number
  /** Eligible only as owned gear with Unknown availability — never folded into `eligible` (B108 H3). */
  owned: number
  unknown: number
  gated: number
  unverified: number
  unqualified: number
  /** Behind the other world's evil boss (B97a). */
  otherWorld: number
  /** Needing the other world type's condition, e.g. a Crimson world in a Corruption world (B108(b)). */
  otherWorldCondition: number
}

/**
 * "Scored from N candidates verified obtainable at your progress. Left out: …" — one clause per
 * reason, nothing hidden. `otherWorldName` names the world type the left-out items need ("Crimson world").
 */
export function disclosure(c: DisclosureCounts, cls: LoadoutClass, otherWorldName?: string): Segment[] {
  const parts: Segment[][] = []
  if (c.unknown > 0) parts.push(s`${whole(c.unknown)} with Unknown availability`)
  if (c.gated > 0) parts.push(s`${whole(c.gated)} behind a boss outside your progress`)
  if (c.unverified > 0) parts.push(s`${whole(c.unverified)} without the verified stats to score`)
  if (c.unqualified > 0) parts.push(s`${whole(c.unqualified)} with no counted benefit for your ${classWord(cls)} class`)
  if (c.otherWorld > 0) parts.push(s`${whole(c.otherWorld)} that ${plural(c.otherWorld, 'needs', 'need')} the other world’s evil boss`)
  if (c.otherWorldCondition > 0) parts.push(s`${whole(c.otherWorldCondition)} that ${plural(c.otherWorldCondition, 'needs', 'need')} a ${otherWorldName ?? 'world of the other evil'}`)
  const lead =
    c.owned > 0
      ? s`Scored from ${count(c.eligible + c.owned, 'candidate', 'candidates')}: ${whole(c.eligible)} verified obtainable at your progress + ${whole(c.owned)} owned (unverified).`
      : s`Scored from ${count(c.eligible, 'candidate', 'candidates')} verified obtainable at your progress.`
  if (parts.length === 0) return lead
  const joined: Segment[] = []
  parts.forEach((p, i) => joined.push(...(i > 0 ? s`; ${p}` : p)))
  return s`${lead} Left out: ${joined}.`
}

// --- score breakdown labels + formulas ------------------------------------------------------------------

export const scoreLabel = {
  dpp: 'Estimated damage per second',
  armor: (goal: Goal) => `Armor score (${GOAL_WORD[goal]} weights)`,
  accessory: (quota: AccessoryQuota) => (quota === 'def' ? 'Counted defense and survivability points' : quota === 'util' ? 'Counted points (utility: all kinds)' : `Counted ${QUOTA_WORD[quota]} points`),
  accessoryAny: 'Counted points (any category)',
  buff: 'Counted points for your class',
  damage: 'Base damage',
  ammoDamage: 'Ammo damage',
}

export const formula = {
  /** §2.2: perHit × hitsPerSec × critFactor. */
  dpp: (perHit: string, hitsPerSec: string, crit: string, total: string) => `${perHit} damage per hit × ${hitsPerSec} hits per second × ${crit} for critical hits ≈ ${total} per second`,
  perHitWithAmmo: (weapon: number, ammo: number) => `${weapon} + ${ammo} ammo`,
  /** §4.3: Σ weight × component. */
  weighted: (terms: readonly { weight: number; value: string; word: string }[], total: string) =>
    `${terms.map((t) => `${weightText(t.weight)} × ${t.value} ${t.word}`).join(' + ')} = ${total}`,
  sum: (parts: readonly string[], total: string, word: string) => (parts.length === 0 ? `0 ${word}` : `${parts.join(' + ')} = ${total} ${word}`),
  damage: (damage: number) => `${damage} base damage`,
}

/** GOAL_WEIGHTS as written in the spec (0.45, 0.1). */
export const weightText = (w: number): string => String(Number(w.toFixed(2)))

export const term = {
  pieceDefense: 'Armor defense (pieces)',
  effectDefense: 'Defense from effects',
  offense: 'Offense points',
  defenseTerm: 'Defense',
  mobility: 'Mobility points',
  survivability: 'Survivability points',
  damagePerHit: 'Damage per hit',
  hitsPerSecond: 'Hits per second',
  critFactor: 'Critical hits (average)',
  flight: (secs: string) => `Flight time (${secs} s)`,
}

/** Effects named in a breakdown but not adding to it. */
export const notScored = {
  special: 'Not scored (effects this site doesn’t model)',
  mismatch: (cls: LoadoutClass) => `Doesn’t apply to your ${classWord(cls)} class`,
  uncountedKind: 'Stat kinds without a weight in this version',
}

// --- B101a qualifiers (mirrors src/app/routes/db/compare/compareCopy.ts, pinned equal by the loadout UI tests) ---

export const QUALIFIER_CLICK_THROW = 'one click per throw'
export const QUALIFIER_CLICK_ATTACK = 'one click per attack'
export const qualifierUsage = (perSecond: string) => `uses ${perSecond}/s`
export const QUALIFIER_EXPLOSIVE = 'blast and fuse not counted'
export function dppQualifier(parts: readonly string[]): string {
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// --- assumptions (AssumptionsTip content) -----------------------------------------------------------------

export const builderAssumption = {
  dppBase: (dpp: string): AssumptionText => ({ id: 'dpp-base', title: 'Same formula for every weapon', detail: dpp }),
  dppFormula: (formulaText: string): AssumptionText => ({ id: 'dpp-formula', title: 'This weapon’s numbers', detail: `${formulaText}.` }),
  dppRate: (cadence: string, cadenceTicks: number, shots: number, hitsPerSec: string): AssumptionText => ({
    id: 'dpp-rate',
    title: 'Hits per second',
    detail:
      shots > 1
        ? `${shots} shots per use, one use every ${cadence}: ${shots} × 60 ÷ ${cadenceTicks} = ${hitsPerSec}.`
        : `One hit per use, one use every ${cadence}: 60 ÷ ${cadenceTicks} = ${hitsPerSec}.`,
  }),
  cadence: (useAnimation: number, autoswing: boolean, delay: number) =>
    `${useAnimation} ticks${autoswing ? ' − 1 (melee auto-reuse swings a tick sooner)' : ''}${delay > 0 ? ` + ${delay} reuse delay` : ''}`,
  dppCrit: (pct: number): AssumptionText => ({ id: 'dpp-crit', title: 'Critical hits', detail: `Taken as an average: ${pct}% chance (the universal 4% plus the weapon’s own) of double damage.` }),
  dppCritNone: (summon: boolean, source?: string): AssumptionText => ({
    id: 'dpp-crit',
    title: 'Critical hits',
    detail: summon ? 'Summon damage doesn’t crit by the weapon’s own chance, so none are added.' : 'Classless damage never deals critical hits, so none are added.',
    ...(source ? { sourceUrl: source } : {}),
  }),
  ammoWith: (ammo: string, damage: number): AssumptionText => ({
    id: 'dpp-ammo',
    title: 'Ammo',
    detail: `Each shot adds the ${damage} damage of ${ammo}, the highest-damage ammo of its type verified obtainable at your progress (or the one in this loadout).`,
  }),
  /** SCORING_SPEC §2.2: "scored without ammo — no ammo with verified availability". */
  ammoWithout: (): AssumptionText => ({ id: 'dpp-ammo', title: 'Scored without ammo', detail: 'Scored without ammo — no ammo with verified availability and damage. In-game, each shot adds the damage of the ammo it fires.' }),
  clicks: (cadenceTicks: number): AssumptionText => ({
    id: 'dpp-clicks',
    title: 'No auto-reuse',
    detail: `Assumes a click every ${cadenceTicks} ticks — it has no auto-reuse, so holding attack doesn’t repeat it.`,
  }),
  usage: (perSecond: string): AssumptionText => ({ id: 'dpp-usage', title: 'Used up as you use it', detail: `Each use spends one from the stack, so attacking at this rate uses ${perSecond} per second.` }),
  explosive: (): AssumptionText => ({
    id: 'dpp-explosive',
    title: 'Blast and fuse not counted',
    detail: 'Counted as one hit on one target when it’s used. The blast hitting every enemy in its area, and the fuse’s delay before it goes off, aren’t in this estimate.',
  }),
  proxy: (): AssumptionText => ({
    id: 'dpp-proxy',
    title: 'A proxy, not a simulation',
    detail: 'Computed from verified stats alone, so every weapon gets the same treatment. The Weapon Lab’s browser simulation measures differently and can show other figures.',
  }),
  /** §5.1 estDamage with the build's bonuses. */
  edoBonuses: (): AssumptionText => ({
    id: 'edo-bonuses',
    title: 'Your gear’s bonuses',
    detail:
      'Damage, critical strike chance and attack speed from this loadout’s armor, set bonus, accessories and potions — the ones that apply to the weapon’s own class. Potion buffs are taken as active. No target defense: the figure is the same for every target.',
  }),
  edoFormula: (formulaText: string): AssumptionText => ({ id: 'edo-formula', title: 'This build’s numbers', detail: `${formulaText}.` }),
}

/** M11 (B108(d)): the AssumptionsTip of each non-damage profile figure (SCORING_SPEC §5.1). */
export const profileAssumption = {
  formula: (formulaText: string): AssumptionText => ({ id: 'profile-formula', title: 'This build’s numbers', detail: `${formulaText}.` }),
  defense: (): AssumptionText => ({
    id: 'profile-defense',
    title: 'Listed defense only',
    detail:
      'The armor pieces’ defense plus flat defense from this loadout’s set bonus, accessories and potions (potions taken as active). Damage reduction is listed apart, never merged in. Reforges, buffs outside this loadout and situational effects aren’t counted.',
  }),
  mobility: (): AssumptionText => ({
    id: 'profile-mobility',
    title: 'Movement and flight as points',
    detail:
      '1 point per % of movement speed from effects that apply to your class, and 0.1 point per tick of flight (the longer of wing flight time and flight effects). Dashes, jumps and other movement effects are named, not scored.',
  }),
  survivability: (): AssumptionText => ({
    id: 'profile-survivability',
    title: 'An editorial blend',
    detail:
      'Defense + 2 × damage reduction % + 2 × life regeneration + 0.25 × max life, with this site’s editorial weights. Only life regeneration stated as a number counts; effects worded in the wiki text (“Slowly regenerates life”) are named under the figure, not scored. Healing, dodges and immunities aren’t counted.',
  }),
  synergy: (): AssumptionText => ({
    id: 'profile-synergy',
    title: 'Counted points that fit your class',
    detail: 'The share of this loadout’s counted stat points (by size) that apply to your class, out of 100. Effects that aren’t scored don’t enter it.',
  }),
  weights: (version: number): AssumptionText => ({ id: 'profile-weights', title: `Weights v${version} — editorial constants`, detail: 'Points per stat are this site’s editorial choices; they aren’t game data.' }),
}

/**
 * The Step 3 bars' reference figures (PRD P4-S3 AC2; AMENDMENTS-016 B113a): the highest figure the search
 * finds among gear verified obtainable at the user's stage — never "the best", never the loadout itself.
 */
export const referenceAssumption = {
  found: (stageWord: string, damage: boolean): AssumptionText => ({
    id: 'reference-found',
    title: 'The highest found at your stage',
    detail:
      `Found by trying the gear verified obtainable at ${stageWord} for your class and difficulty, with the builder’s own slots and rules (one armor set, no repeated accessory, one pair of wings, up to 3 potions with different buffs). ` +
      'Your goal, your picks, Surprise Me and gear you marked owned don’t change it; gear behind a boss outside your progress doesn’t count. ' +
      (damage
        ? 'Each weapon is tried with gear chosen for it step by step, so a hand-picked loadout can occasionally go past it.'
        : 'A loadout with gear you own or fixed outside that pool can go past it.'),
  }),
  gear: (parts: readonly string[]): AssumptionText => ({ id: 'reference-gear', title: 'The gear that reaches it', detail: `${parts.join(' ')} Swapping these into your loadout fills the bar.` }),
  weapon: (name: string, ammo?: string) => (ammo ? `Weapon: ${name}, firing ${ammo}.` : `Weapon: ${name}.`),
  armor: (name: string) => `Armor: ${name}.`,
  accessories: (names: readonly string[]) => `Accessories: ${names.join(', ')}.`,
  potions: (names: readonly string[]) => `Potions: ${names.join(', ')}.`,
  formula: (formulaText: string): AssumptionText => ({ id: 'reference-formula', title: 'Its numbers', detail: `${formulaText}.` }),
}

/** Build-level assumptions (Step 3 lists them; SCORING_SPEC §2.4, B69). */
export const buildAssumption = {
  progress: (stageWord: string, virtual: readonly string[], marked: number): AssumptionText => {
    const markedText =
      marked === 0 ? 'No boss is marked defeated on the boss map.' : marked === 1 ? 'The 1 boss marked defeated on the boss map counts too.' : `The ${whole(marked)} bosses marked defeated on the boss map count too.`
    return {
      id: 'progress',
      title: 'Your progress: stage plus the boss map',
      detail:
        virtual.length > 0
          ? `Your stage (${stageWord}) is taken as a hypothesis: the bosses it implies — ${listText(virtual)} — count as defeated. ${markedText} Optional bosses are never assumed.`
          : `Your stage (${stageWord}) implies no defeated bosses on its own. ${markedText} Optional bosses are never assumed.`,
    }
  },
  availability: (): AssumptionText => ({
    id: 'availability',
    title: 'What counts as obtainable',
    detail:
      'An item is recommended only when every boss it needs is in your progress. Items whose availability is Unknown are never recommended — except gear you marked as owned. Requirements like biomes, events or time of day are shown as chips, not checked.',
  }),
  worldEvil: (): AssumptionText => ({
    id: 'world-evil',
    title: 'World evil bosses',
    detail: 'The Eater of Worlds and the Brain of Cthulhu count only once marked defeated on the boss map — a stage never assumes them.',
  }),
  target: (boss: string): AssumptionText => ({
    id: 'target',
    title: `Preparing for ${boss}`,
    detail: `${boss} and the fights it opens are not taken as defeated by your stage, so their gear sits in the “After you defeat …” lists instead of the loadout.`,
  }),
  demonHeart: (source: string): AssumptionText => ({
    id: 'demon-heart',
    title: 'Demon Heart used',
    detail: 'The Demon Heart slot exists only after you use a Demon Heart (from the Wall of Flesh’s Treasure Bag, Expert and Master Mode). The builder assumes you have.',
    sourceUrl: source,
  }),
  potions: (): AssumptionText => ({ id: 'potions', title: 'Potions active', detail: 'Buff potions are taken as active for their points and the build profile.' }),
  ownedUnknown: (): AssumptionText => ({ id: 'owned-unknown', title: 'Gear you own', detail: 'Items you marked as owned count as obtainable even when their availability is Unknown. Owned items behind a boss outside your progress stay gated.' }),
  weights: (version: number, keywordsVersion: number): AssumptionText => ({
    id: 'weights',
    title: `Weights v${version} — editorial constants`,
    detail: `Points per stat and the goal weights are this site’s editorial choices, versioned so a change is always visible. They rank candidates; they aren’t game data. Effects that aren’t scored are tied to a class by an editorial keyword list (v${keywordsVersion}): an accessory whose only effects belong to another class doesn’t fill a slot.`,
  }),
  /** B108(b): the world evil chosen leaves the other world type's items out of play. */
  worldType: (worldName: string, otherName: string): AssumptionText => ({
    id: 'world-type',
    title: `World type: ${worldName}`,
    detail: `Items that need a ${otherName}, and gear behind the other world’s evil boss, can’t be obtained in your world, so they are never suggested; each slot’s “Left out” line counts them.`,
  }),
}

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// --- notices (pins that don't fit) ---------------------------------------------------------------------

export const pinNotice = {
  notFit: (what: string) => s`${what} doesn’t fit its slot, so the slot keeps its recommendation.`,
  duplicate: (what: string) => s`${what} is already in another accessory slot, so it isn’t placed twice.`,
  secondWings: (what: string) => s`${what} would be a second pair of wings, so it isn’t placed.`,
  noSlot: (what: string, slot: number, difficulty: string) => s`${what} sits in accessory slot ${slot}, which ${difficulty} Mode doesn’t have, so it isn’t placed.`,
  demonHeartClosed: (what: string, gate: string) => s`${what} sits in the Demon Heart slot, which opens after you defeat ${gate}, so it isn’t placed.`,
  ammoMismatch: (what: string) => s`${what} isn’t fired by the weapon in that slot, so the slot keeps its recommendation.`,
}

// --- §4.7 gated track -------------------------------------------------------------------------------------

export const gatedCopy = {
  alternative: (item: Segment) => s`Obtainable now: ${item}.`,
  noAlternative: () => s`No verified obtainable alternative at this stage.`,
  score: (value: string, label: string) => `${value} ${label.toLowerCase()}`,
}

// --- profile (§5.1, components only for one build) ----------------------------------------------------

export const profileCopy = {
  label: {
    estDamage: 'Estimated damage per second',
    defense: 'Defense',
    mobility: 'Mobility',
    survivability: 'Survivability',
    classSynergy: 'Class synergy',
  },
  unit: { estDamage: 'per second', defense: 'defense', mobility: 'points', survivability: 'points', classSynergy: 'of 100' },
  edo: (perHit: string, pct: string, flat: string, hits: string, speed: string, crit: string, total: string) =>
    `(${perHit} × ${pct}${flat}) damage per hit × ${hits} hits per second × ${speed} attack speed × ${crit} for critical hits ≈ ${total} per second`,
  defense: (pieces: string, flat: string, total: string) => `${pieces} from armor pieces + ${flat} from effects = ${total}`,
  mobility: (move: string, flight: string, total: string) => `${move} movement speed points + ${flight} flight points = ${total}`,
  survivability: (defense: string, dr: string, regen: string, life: string, total: string) =>
    `${defense} defense + 2 × ${dr}% damage reduction + 2 × ${regen} counted life regeneration + 0.25 × ${life} max life = ${total}`,
  synergy: (matched: string, total: string, value: string) => `${matched} of ${total} counted stat points apply to your class: ${value} of 100`,
  damageReduction: (pct: number) => `Damage reduction ${pct}% is listed apart, not merged into defense.`,
  excluded: {
    noWeapon: 'No main weapon in this build, so there is no damage estimate.',
    summonStaff: 'The main weapon summons minions; their attack rate varies by minion AI — not estimated.',
    weaponUnknown: (fields: string) => `The main weapon’s ${fields} ${fields.includes(' and ') ? 'are' : 'is'} Unknown, so there is no damage estimate.`,
    noPoints: 'No counted stat points in this build, so class synergy isn’t computed.',
  },
  /** M11 (B108(d)): every profile figure carries an "est." chip; what each estimates, for screen readers and the tip heading. */
  estimateContext: {
    edo: 'estimated damage per second with your gear',
    defense: 'defense total of this loadout',
    mobility: 'mobility points of this loadout',
    survivability: 'survivability points of this loadout',
    synergy: 'class synergy of this loadout',
  },
  pieceUnknown: (name: string) => `${name}: defense Unknown, left out of the total`,
  setActive: (name: string) => `Set bonus active: ${name}`,
  mismatch: (item: string, phrases: readonly string[]) => `${item}: ${phrases.join(', ')}`,
  points: (n: number) => oneDecimal(n),
}

// --- goal fit across compared builds (SCORING_SPEC §5.3, §5.4; PRD P4-S4 AC1/AC2) ---------------------------

/**
 * The comparison's wording: a goal fit exists only across ≥ 2 builds and only relative to them — it is
 * never a rating of a loadout on its own, and nothing here names one build as ahead of another.
 */
export const comparisonCopy = {
  /** A build's weighted sum — only inside "How was this scored?" (AMENDMENTS-016 B113b). */
  fitLabel: 'Weighted sum',
  /** "100 × 35 ÷ (35 + 20) = 63.6": a figure's share of the compared builds' figures (B113b — no build pinned at 100). */
  share: (raw: string, parts: readonly string[], value: string) => `100 × ${raw} ÷ (${parts.join(' + ')}) = ${value}`,
  /** Every build has 0 of it: its share would divide by 0 (flagged, §5.3). */
  zeroMax: (label: string) => `${label}: 0 in every compared build, so each gets 0.`,
  /** Symmetric exclusion (§5.3): uncomputable for one build ⇒ left out for all. */
  dropped: (label: string) => `${label}: left out for every build, because it can’t be computed for at least one of them.`,
  /** "(0.25 × 63.6 + 0.2 × 45.1) ÷ 0.45 = 55.4". */
  fitFormula: (terms: readonly { weight: string; scaled: string }[], weightSum: string, total: string) =>
    `(${terms.map((t) => `${t.weight} × ${t.scaled}`).join(' + ')}) ÷ ${weightSum} = ${total}`,
  /** B113b: the two weighted sums' difference, worded with the builds' names ("58.8 (saved) − 41.2 (this draft) = +17.6"). */
  differenceFormula: (second: string, secondName: string, first: string, firstName: string, signed: string) => `${second} (${secondName}) − ${first} (${firstName}) = ${signed}`,
  same: 'same',
  firstBuild: 'first build',
  secondBuild: 'second build',
  noFit: 'No figure can be computed for every build, so there is no difference to state.',
  estimateContext: (goal: string) => `difference under the ${goal} weights, between these two builds only`,
}

/** AssumptionsTip content of a goal-fit difference (SCORING_SPEC §5.3, §5.4; AMENDMENTS-016 B113b). */
export const comparisonAssumption = {
  relative: (): AssumptionText => ({
    id: 'fit-relative',
    title: 'Between these two builds only',
    detail:
      'Each figure is split between the two builds in proportion to their values (their two shares add up to 100), weighted by the goal and added up per build; the difference is one sum minus the other. Beside another build, the same loadout gets another difference; on its own it has none.',
  }),
  weights: (goal: Goal, version: number): AssumptionText => ({
    id: 'fit-weights',
    title: `The ${GOAL_WORD[goal]} weights, v${version}`,
    detail: 'The goal weights are this site’s editorial choices, versioned so a change is always visible. They aren’t game data.',
  }),
  figures: (): AssumptionText => ({
    id: 'fit-figures',
    title: 'The figures are estimates',
    detail: 'Every figure behind it is the loadout profile’s own estimate, with the same assumptions: no target defense, potions taken as active, effects that aren’t scored left out.',
  }),
  formula: (text: string): AssumptionText => ({ id: 'fit-formula', title: 'This build’s numbers', detail: `${text}.` }),
}

/** What each piece of gear adds (PRD P4-S3 AC1 "each item's contribution"; SCORING_SPEC §2.3 points). */
export const contributionCopy = {
  defense: (n: string) => `${n} defense`,
  points: (n: string, word: string) => `${n} ${word} points`,
  otherClass: (n: string) => `${n} points for another class, not counted`,
  unscored: (n: number) => (n === 1 ? '1 effect not scored' : `${whole(n)} effects not scored`),
  nothing: 'adds no counted points',
}
