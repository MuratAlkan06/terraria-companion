/**
 * Display rules shared by the armor and accessory pages (PRD P6-S1/S2; DATA_SCHEMA_SPEC §2.3 StatEffect, §2.5).
 * Pure and Zod-free. Stat effects are read as the data states them — signed values in the kind's own unit
 * (`*-pct` integer percent, `*-ticks` game ticks, `*-flat` the game's unit) — and never re-derived:
 *
 * - a stat effect's words come from the builder's own phrasing (`effectPhrase`, src/scoring/readinessCopy.ts),
 *   so a piece reads the same on its page as in a loadout tooltip;
 * - a total (a full set, P6-S1 AC2) adds the stated values of one kind and scope; nothing else is combined;
 * - a "special" effect is wiki text the data keeps as text: quoted, with its source, never turned into a number.
 */
import type { DamageClass, StatEffect, StatKind } from '../../../../schemas'
import { CLASS_LABELS } from '../weapons/weaponDisplay'
import { ticksWithSeconds } from '../../../../scoring/readinessCopy'

type Unit = 'pct' | 'flat' | 'ticks'

/**
 * Every stat kind: its label and unit, in display order within groups that follow PRD P6-S1 AC1's own words
 * (defense, class bonuses / damage, movement, regen + mana, summon). Keyed by StatKind, so a new kind fails
 * typecheck until it has a label here.
 */
const STAT_INFO: Readonly<Record<StatKind, { label: string; unit: Unit; group: StatGroup }>> = {
  'defense-flat': { label: 'Defense', unit: 'flat', group: 'defense' },
  'damage-reduction-pct': { label: 'Damage reduction', unit: 'pct', group: 'defense' },
  'max-life-flat': { label: 'Max life', unit: 'flat', group: 'defense' },
  'life-regen': { label: 'Life regeneration', unit: 'flat', group: 'defense' },
  'potion-cooldown-pct': { label: 'Healing potion cooldown', unit: 'pct', group: 'defense' },
  'lava-immunity-ticks': { label: 'Lava immunity', unit: 'ticks', group: 'defense' },
  'aggro-flat': { label: 'Aggro', unit: 'flat', group: 'defense' },
  'damage-pct': { label: 'Damage', unit: 'pct', group: 'offense' },
  'damage-flat': { label: 'Damage', unit: 'flat', group: 'offense' },
  'crit-pct': { label: 'Critical strike chance', unit: 'pct', group: 'offense' },
  'melee-speed-pct': { label: 'Melee speed', unit: 'pct', group: 'offense' },
  'attack-speed-pct': { label: 'Attack speed', unit: 'pct', group: 'offense' },
  'armor-penetration-flat': { label: 'Armor penetration', unit: 'flat', group: 'offense' },
  'knockback-pct': { label: 'Knockback', unit: 'pct', group: 'offense' },
  'melee-scale-pct': { label: 'Melee weapon size', unit: 'pct', group: 'offense' },
  'ammo-save-pct': { label: 'Ammo saving', unit: 'pct', group: 'offense' },
  'move-speed-pct': { label: 'Movement speed', unit: 'pct', group: 'movement' },
  'jump-boost': { label: 'Jump height', unit: 'flat', group: 'movement' },
  'flight-time-ticks': { label: 'Flight time', unit: 'ticks', group: 'movement' },
  'max-mana-flat': { label: 'Max mana', unit: 'flat', group: 'mana' },
  'mana-cost-pct': { label: 'Mana cost', unit: 'pct', group: 'mana' },
  'mana-regen': { label: 'Mana regeneration', unit: 'flat', group: 'mana' },
  'minion-slots': { label: 'Minion slots', unit: 'flat', group: 'summon' },
  'sentry-slots': { label: 'Sentry slots', unit: 'flat', group: 'summon' },
  'whip-range-pct': { label: 'Whip range', unit: 'pct', group: 'summon' },
  'whip-speed-pct': { label: 'Whip speed', unit: 'pct', group: 'summon' },
  'tag-effect-slots': { label: 'Whip tag slots', unit: 'flat', group: 'summon' },
  'minion-knockback': { label: 'Minion knockback', unit: 'flat', group: 'summon' },
  'mining-speed-pct': { label: 'Mining speed', unit: 'pct', group: 'other' },
  'fishing-power-flat': { label: 'Fishing power', unit: 'flat', group: 'other' },
  'tile-reach-flat': { label: 'Tile reach', unit: 'flat', group: 'other' },
}

export type StatGroup = 'defense' | 'offense' | 'movement' | 'mana' | 'summon' | 'other'

/** Group headings, in page order. */
export const STAT_GROUPS: readonly { id: StatGroup; label: string }[] = [
  { id: 'defense', label: 'Defense and survival' },
  { id: 'offense', label: 'Damage and class bonuses' },
  { id: 'movement', label: 'Movement' },
  { id: 'mana', label: 'Mana' },
  { id: 'summon', label: 'Minions and whips' },
  { id: 'other', label: 'Other' },
]

const KIND_ORDER = Object.keys(STAT_INFO) as StatKind[]
const SCOPE_ORDER: readonly (DamageClass | undefined)[] = [undefined, 'melee', 'ranged', 'magic', 'summon', 'other']

export const statGroup = (stat: StatKind): StatGroup => STAT_INFO[stat].group

/** "Melee damage", "Defense", "Ranged critical strike chance" (a scope other than "other" leads the label). */
export function statLabel(stat: StatKind, scope?: DamageClass): string {
  const label = STAT_INFO[stat].label
  return scope && scope !== 'other' ? `${CLASS_LABELS[scope]} ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label
}

/** A signed amount in the kind's unit: "+16%", "−14%", "+2", "+420 ticks (7 seconds)" (ticks with seconds, like the wings). */
export function statAmount(stat: StatKind, value: number): string {
  const sign = value < 0 ? '−' : '+'
  const n = Math.abs(value)
  const unit = STAT_INFO[stat].unit
  return unit === 'pct' ? `${sign}${n}%` : unit === 'ticks' ? `${sign}${ticksWithSeconds(n)}` : `${sign}${n}`
}

/** Stable key of a stat line: kind + scope. */
export const statKey = (stat: StatKind, scope?: DamageClass): string => (scope ? `${stat}:${scope}` : stat)

/** Sorts stat lines by group, kind and scope (the order of STAT_INFO / SCOPE_ORDER). */
export function compareStatLines(a: { stat: StatKind; scope?: DamageClass }, b: { stat: StatKind; scope?: DamageClass }): number {
  return KIND_ORDER.indexOf(a.stat) - KIND_ORDER.indexOf(b.stat) || SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope)
}

export type StatEffectOf = Extract<StatEffect, { kind: 'stat' }>
export type SpecialEffectOf = Extract<StatEffect, { kind: 'special' }>

export const isStat = (e: StatEffect): e is StatEffectOf => e.kind === 'stat'
export const isSpecial = (e: StatEffect): e is SpecialEffectOf => e.kind === 'special'

/** Damage classes in the app's order (filters, badges). */
export const CLASS_ORDER: readonly DamageClass[] = ['melee', 'ranged', 'magic', 'summon', 'other']

/** A class list's words: "Melee", "Melee + ranged" (one hybrid variant), "Classless" for "other". */
export function classWords(classes: readonly DamageClass[]): string {
  const words = [...classes].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b)).map((c) => (c === 'other' ? 'Classless' : CLASS_LABELS[c]))
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(' + ')
}

/** A class's own label for badges / filters ("Classless" for "other"). */
export const classLabel = (c: DamageClass): string => (c === 'other' ? 'Classless' : CLASS_LABELS[c])
