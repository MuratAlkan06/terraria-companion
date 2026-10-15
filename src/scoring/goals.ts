/**
 * Goal scoring components for ONE build (SCORING_SPEC §5.1, §5.3 "Single build ⇒ components-only",
 * §5.4; PRD P4-S3 AC2 profile). Pure TypeScript. Five components, each with its formula, raw inputs
 * and what wasn't counted:
 *
 *   estDamage    EDO = (perHit × (1 + Σdamage%/100) + Σdamage-flat) × hitsPerSec × speedFactor × critFactorTotal
 *                speedFactor = 1 + (Σattack-speed% + Σmelee-speed%·[melee])/100; critFactorTotal = 1 + (4 + crit + Σcrit%)/100
 *                (1 for summon / classless). Target-agnostic (defense 0). Bonuses count when they apply to the
 *                WEAPON's own class — what the game applies them to (the readiness checker's rule, B94(6)).
 *   defense      Σ piece defense + Σ defense-flat; damage reduction is a separate figure, never merged.
 *   mobility     movement-speed and flight points (flight = max of wing flight time and flight effects, 0.1/tick)
 *                + named uncounted mobility specials.
 *   survivability defense + 2·DR% + 2·life regeneration + 0.25·max life.
 *   classSynergy matched / (matched + mismatched) × 100 over numeric STAT_POINTS (absolute, 0–100); every
 *                mismatch itemized.
 *
 * No composite: GoalFit exists only across ≥ 2 compared builds (§5.3). Each component carries the
 * goal's weight for display. A component that can't be computed is excluded with its reason (§1.3).
 */
import type { Accessory, ArmorPiece, ArmorSet, Goal, Item, LoadoutClass, StatEffect, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { BASE_CRIT_PCT, DPP_ASSUMPTIONS, GOAL_COMPONENTS, GOAL_WEIGHTS, SCORING_CONSTANTS_VERSION, type GoalComponent } from './constants'
import { builderAssumption, profileAssumption, profileCopy } from './builderCopy'
import { appliesTo, effectPoints, isSummonStaff, statTotal, sumPoints, weaponProfile } from './proxies'
import { FIELD_WORD, effectPhrase, oneDecimal, whole, type AssumptionText } from './readinessCopy'
import { INFORMATIONAL, UNCOUNTED_MOBILITY, DASH_TEXT } from './readiness'

/** One source of effects in the build (an armor piece, the active set bonus, an accessory, a potion's buffs). */
export interface BuildSource {
  name: string
  kind: 'armor' | 'set' | 'accessory' | 'potion'
  effects: readonly StatEffect[]
  /** Verified wing flight time (accessories with wingStats). */
  wingTicks?: number
}

export interface BuildSources {
  cls: LoadoutClass
  goal: Goal
  main?: Weapon
  /** The ammo the main weapon fires in this build (verified damage). */
  ammo?: { name: string; damage: number }
  pieces: readonly ArmorPiece[]
  set?: { set: ArmorSet; variant: ArmorSet['variants'][number] }
  accessories: readonly Accessory[]
  potions: readonly { item: Item; effects: readonly StatEffect[] }[]
}

export interface ProfileComponent {
  id: GoalComponent
  label: string
  /** undefined = excluded (see `excluded`). */
  value?: number
  text: string
  unit: string
  /** The goal's GOAL_WEIGHTS entry for this component (display only: no composite for one build). */
  weight: number
  formulaText?: string
  notes: string[]
  /** Real effects named, not scored: where from, and the verbatim wiki text. */
  uncounted: { from: string; text: string }[]
  excluded?: string
  /** Its EstimateLabel key (B108(d) M11: every computed profile figure is an estimate). */
  estimate?: ProfileEstimate
}

/** The profile figures' EstimateLabel keys (B108(d) M11). */
export type ProfileEstimate = 'edo' | 'defense' | 'mobility' | 'survivability' | 'synergy'

export interface BuildProfile {
  goal: Goal
  constantsVersion: number
  components: ProfileComponent[]
  synergy: { matched: number; mismatched: number; mismatches: { name: string; phrases: string[] }[] }
  setBonus?: { setId: string; name: string; text: string }
  /** AssumptionsTip content per figure's EstimateLabel. */
  estimates: Partial<Record<ProfileEstimate, AssumptionText[]>>
}

const known = <T>(record: unknown, path: string): T | undefined => {
  const view = getField(record, path)
  return view.status === 'verified' || view.status === 'editorial' ? (view.value as T) : undefined
}

const fmt = (n: number) => String(Number(n.toFixed(2)))

/** The effect sources of a build: pieces, the active set bonus, accessories (with wing flight), potions. */
export function buildSources(src: BuildSources): BuildSource[] {
  const out: BuildSource[] = []
  for (const piece of src.pieces) out.push({ name: piece.name, kind: 'armor', effects: known<StatEffect[]>(piece, 'effects') ?? [] })
  if (src.set) out.push({ name: src.set.set.name, kind: 'set', effects: src.set.variant.setBonus })
  for (const acc of src.accessories) {
    const wing = known<number>(acc, 'wingStats.flightTimeTicks')
    out.push({ name: acc.name, kind: 'accessory', effects: known<StatEffect[]>(acc, 'effects') ?? [], ...(wing !== undefined ? { wingTicks: wing } : {}) })
  }
  for (const p of src.potions) out.push({ name: p.item.name, kind: 'potion', effects: p.effects })
  return out
}

/** Class-synergy points (§5.1(5)) over the sources: |points| of each numeric effect, matched when it applies to `cls`. */
export function synergyOf(sources: readonly BuildSource[], cls: LoadoutClass): BuildProfile['synergy'] {
  let matched = 0
  let mismatched = 0
  const mismatches: { name: string; phrases: string[] }[] = []
  for (const src of sources) {
    const phrases: string[] = []
    for (const e of src.effects) {
      if (e.kind !== 'stat' || (e.stat === 'flight-time-ticks' && src.wingTicks !== undefined)) continue
      const pts = Math.abs(sumPoints(effectPoints(e, cls)))
      if (pts === 0) continue
      if (appliesTo(e, cls)) matched += pts
      else {
        mismatched += pts
        phrases.push(effectPhrase(e))
      }
    }
    if (src.wingTicks !== undefined) matched += 0.1 * Math.max(src.wingTicks, statTotal(src.effects, 'flight-time-ticks', 'hybrid'))
    if (phrases.length > 0) mismatches.push({ name: src.name, phrases })
  }
  return { matched, mismatched, mismatches }
}

/** Mobility points (§5.1(3)): movement points of the effects that apply, plus flight (max of wings and flight effects per source). */
function mobilityOf(sources: readonly BuildSource[], cls: LoadoutClass): { move: number; flight: number } {
  let move = 0
  let flight = 0
  for (const src of sources) {
    for (const e of src.effects) {
      if (e.kind !== 'stat' || !appliesTo(e, cls)) continue
      if (e.stat === 'flight-time-ticks') {
        if (src.wingTicks === undefined) flight += effectPoints(e, cls).mob
        continue
      }
      move += effectPoints(e, cls).mob
    }
    if (src.wingTicks !== undefined) flight += 0.1 * Math.max(src.wingTicks, statTotal(src.effects, 'flight-time-ticks', cls))
  }
  return { move, flight }
}

const isMobilitySpecial = (text: string) =>
  !INFORMATIONAL.test(text) && (DASH_TEXT.test(text) || UNCOUNTED_MOBILITY.dodge.test(text) || UNCOUNTED_MOBILITY.flight.test(text) || UNCOUNTED_MOBILITY.jump.test(text))

/** scoreBuild (SCORING_SPEC §5.1, components only — §5.3 single build). */
export function scoreBuild(src: BuildSources): BuildProfile {
  const sources = buildSources(src)
  const all = sources.flatMap((s) => s.effects)
  const weights = GOAL_WEIGHTS[src.goal]
  const weightOf = (id: GoalComponent) => weights[GOAL_COMPONENTS.indexOf(id)]
  const components: ProfileComponent[] = []
  const estimates: BuildProfile['estimates'] = {}

  // (1) estDamage
  const dmg: ProfileComponent = { id: 'estDamage', label: profileCopy.label.estDamage, text: '', unit: profileCopy.unit.estDamage, weight: weightOf('estDamage'), notes: [], uncounted: [] }
  if (!src.main) dmg.excluded = profileCopy.excluded.noWeapon
  else if (isSummonStaff(src.main)) dmg.excluded = profileCopy.excluded.summonStaff
  else {
    const profile = weaponProfile(src.main)
    if (!profile.ok) dmg.excluded = profileCopy.excluded.weaponUnknown([...new Set(profile.missing.map((f) => FIELD_WORD[f] ?? f))].join(' and '))
    else {
      const wc = profile.damageClass
      const perHit = profile.damage + (src.ammo?.damage ?? 0)
      const pct = statTotal(all, 'damage-pct', wc)
      const flat = statTotal(all, 'damage-flat', wc)
      const speed = 1 + (statTotal(all, 'attack-speed-pct', wc) + (wc === 'melee' ? statTotal(all, 'melee-speed-pct', 'melee') : 0)) / 100
      const crit = profile.critApplies ? 1 + (BASE_CRIT_PCT + profile.critPct + statTotal(all, 'crit-pct', wc)) / 100 : 1
      const value = (perHit * (1 + pct / 100) + flat) * profile.hitsPerSec * speed * crit
      dmg.value = value
      dmg.text = oneDecimal(value)
      dmg.estimate = 'edo'
      dmg.formulaText = profileCopy.edo(
        src.ammo ? `(${profile.damage} + ${src.ammo.damage})` : String(perHit),
        fmt(1 + pct / 100),
        flat !== 0 ? ` + ${fmt(flat)}` : '',
        fmt(profile.hitsPerSec),
        fmt(speed),
        fmt(crit),
        oneDecimal(value),
      )
      estimates.edo = [builderAssumption.dppBase(DPP_ASSUMPTIONS), builderAssumption.edoBonuses(), builderAssumption.edoFormula(dmg.formulaText)]
    }
  }
  if (dmg.excluded) dmg.text = ''
  components.push(dmg)

  // (2) defense — Σ piece defense + Σ defense-flat; DR apart
  let pieceDefense = 0
  const defenseNotes: string[] = []
  for (const piece of src.pieces) {
    const d = known<number>(piece, 'defense')
    if (d === undefined) defenseNotes.push(profileCopy.pieceUnknown(piece.name))
    else pieceDefense += d
  }
  const flatDefense = statTotal(all, 'defense-flat', 'hybrid')
  const defense = pieceDefense + flatDefense
  const dr = statTotal(all, 'damage-reduction-pct', 'hybrid')
  if (dr !== 0) defenseNotes.push(profileCopy.damageReduction(dr))
  components.push({
    id: 'defense',
    label: profileCopy.label.defense,
    value: defense,
    text: whole(defense),
    unit: profileCopy.unit.defense,
    weight: weightOf('defense'),
    formulaText: profileCopy.defense(whole(pieceDefense), whole(flatDefense), whole(defense)),
    notes: defenseNotes,
    uncounted: [],
    estimate: 'defense',
  })

  // (3) mobility
  const mob = mobilityOf(sources, src.cls)
  const mobility = mob.move + mob.flight
  components.push({
    id: 'mobility',
    label: profileCopy.label.mobility,
    value: mobility,
    text: profileCopy.points(mobility),
    unit: profileCopy.unit.mobility,
    weight: weightOf('mobility'),
    formulaText: profileCopy.mobility(profileCopy.points(mob.move), profileCopy.points(mob.flight), profileCopy.points(mobility)),
    estimate: 'mobility',
    notes: [],
    uncounted: sources.flatMap((s) => s.effects.filter((e): e is Extract<StatEffect, { kind: 'special' }> => e.kind === 'special' && isMobilitySpecial(e.text)).map((e) => ({ from: s.name, text: e.text }))),
  })

  // (4) survivability
  const regen = statTotal(all, 'life-regen', 'hybrid')
  const life = statTotal(all, 'max-life-flat', 'hybrid')
  const surv = defense + 2 * dr + 2 * regen + 0.25 * life
  components.push({
    id: 'survivability',
    label: profileCopy.label.survivability,
    value: surv,
    text: profileCopy.points(surv),
    unit: profileCopy.unit.survivability,
    weight: weightOf('survivability'),
    formulaText: profileCopy.survivability(whole(defense), fmt(dr), fmt(regen), fmt(life), profileCopy.points(surv)),
    notes: [],
    uncounted: [],
    estimate: 'survivability',
  })

  // (5) classSynergy
  const synergy = synergyOf(sources, src.cls)
  const total = synergy.matched + synergy.mismatched
  const syn: ProfileComponent = { id: 'classSynergy', label: profileCopy.label.classSynergy, text: '', unit: profileCopy.unit.classSynergy, weight: weightOf('classSynergy'), notes: [], uncounted: [] }
  if (total === 0) syn.excluded = profileCopy.excluded.noPoints
  else {
    syn.value = (synergy.matched / total) * 100
    syn.text = whole(syn.value)
    syn.formulaText = profileCopy.synergy(profileCopy.points(synergy.matched), profileCopy.points(total), whole(syn.value))
    syn.notes = synergy.mismatches.map((m) => profileCopy.mismatch(m.name, m.phrases))
    syn.estimate = 'synergy'
  }
  components.push(syn)

  // B108(d) M11: each computed figure's AssumptionsTip — what it counts, and its numbers
  const weightsTip = profileAssumption.weights(SCORING_CONSTANTS_VERSION)
  for (const c of components) {
    if (c.estimate === undefined || c.estimate === 'edo' || c.formulaText === undefined) continue
    const rule = c.estimate === 'defense' ? profileAssumption.defense() : c.estimate === 'mobility' ? profileAssumption.mobility() : c.estimate === 'survivability' ? profileAssumption.survivability() : profileAssumption.synergy()
    estimates[c.estimate] = [rule, profileAssumption.formula(c.formulaText), weightsTip]
  }

  return {
    goal: src.goal,
    constantsVersion: SCORING_CONSTANTS_VERSION,
    components,
    synergy,
    ...(src.set ? { setBonus: { setId: src.set.set.id, name: src.set.set.name, text: src.set.variant.setBonusText } } : {}),
    estimates,
  }
}
