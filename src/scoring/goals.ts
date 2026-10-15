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
 * No composite for ONE build: GoalFit exists only across ≥ 2 compared builds (§5.3, `compareLoadouts`
 * below, P4-S4). Each component carries the goal's weight for display. A component that can't be
 * computed is excluded with its reason (§1.3). `contributions` itemizes what each piece of gear adds
 * (PRD P4-S3 AC1).
 */
import type { Accessory, ArmorPiece, ArmorSet, DamageClass, Goal, Item, LoadoutClass, StatEffect, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { BASE_CRIT_PCT, DPP_ASSUMPTIONS, GOAL_COMPONENTS, GOAL_WEIGHTS, SCORING_CONSTANTS_VERSION, type GoalComponent } from './constants'
import { builderAssumption, comparisonAssumption, comparisonCopy, profileAssumption, profileCopy, weightText } from './builderCopy'
import { addPoints, appliesTo, effectPoints, isSummonStaff, statTotal, sumPoints, weaponProfile, ZERO_POINTS, type Points, type WeaponProfile } from './proxies'
import { FIELD_WORD, effectPhrase, oneDecimal, whole, type AssumptionText } from './readinessCopy'
import { INFORMATIONAL, UNCOUNTED_MOBILITY, DASH_TEXT } from './readiness'

/** One source of effects in the build (an armor piece, the active set bonus, an accessory, a potion's buffs). */
export interface BuildSource {
  name: string
  kind: 'armor' | 'set' | 'accessory' | 'potion'
  /** The item (armor piece, accessory, potion); a set bonus has its set's id instead. */
  id?: number
  setId?: string
  effects: readonly StatEffect[]
  /** Verified wing flight time (accessories with wingStats). */
  wingTicks?: number
  /** An armor piece's own verified defense. */
  defense?: number
}

/** What one piece of gear adds to the build (PRD P4-S3 AC1), in STAT_POINTS for the build's class. */
export interface Contribution {
  name: string
  kind: BuildSource['kind']
  /** The item it comes from (a set bonus: `setId`). */
  id?: number
  setId?: string
  /** Counted points of the effects that apply to the build's class (wing flight included as mobility). */
  points: Points
  /** An armor piece's own defense (verified). */
  defense?: number
  /** Points of effects that apply only to another class (not counted; synergy itemizes them). */
  otherClass: number
  /** Effects named but not scored (verbatim wiki text elsewhere). */
  unscored: number
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
  /** What each piece of gear adds, in source order (pieces, set bonus, accessories, potions). */
  contributions: Contribution[]
}

const known = <T>(record: unknown, path: string): T | undefined => {
  const view = getField(record, path)
  return view.status === 'verified' || view.status === 'editorial' ? (view.value as T) : undefined
}

const fmt = (n: number) => String(Number(n.toFixed(2)))

/** The effect sources of a build: pieces, the active set bonus, accessories (with wing flight), potions. */
export function buildSources(src: BuildSources): BuildSource[] {
  const out: BuildSource[] = []
  for (const piece of src.pieces) {
    const defense = known<number>(piece, 'defense')
    out.push({ name: piece.name, kind: 'armor', id: piece.id, effects: known<StatEffect[]>(piece, 'effects') ?? [], ...(defense !== undefined ? { defense } : {}) })
  }
  if (src.set) out.push({ name: src.set.set.name, kind: 'set', setId: src.set.set.id, effects: src.set.variant.setBonus })
  for (const acc of src.accessories) {
    const wing = known<number>(acc, 'wingStats.flightTimeTicks')
    out.push({ name: acc.name, kind: 'accessory', id: acc.id, effects: known<StatEffect[]>(acc, 'effects') ?? [], ...(wing !== undefined ? { wingTicks: wing } : {}) })
  }
  for (const p of src.potions) out.push({ name: p.item.name, kind: 'potion', id: p.item.id, effects: p.effects })
  return out
}

/** §5.1 estDamage's gear terms for a weapon of class `wc`: damage %, flat damage, attack speed % (+ melee speed for melee), crit %. */
export interface OffenseTerms {
  pct: number
  flat: number
  speed: number
  crit: number
}

/** The gear terms `effects` add for a weapon of class `wc` (the bonuses that apply to the weapon's own class, B94(6)). */
export function offenseTerms(effects: readonly StatEffect[], wc: DamageClass): OffenseTerms {
  return {
    pct: statTotal(effects, 'damage-pct', wc),
    flat: statTotal(effects, 'damage-flat', wc),
    speed: statTotal(effects, 'attack-speed-pct', wc) + (wc === 'melee' ? statTotal(effects, 'melee-speed-pct', 'melee') : 0),
    crit: statTotal(effects, 'crit-pct', wc),
  }
}

/** EDO (§5.1(1)) of a weapon profile with its ammo damage and the gear's summed terms — the one formula scoreBuild uses. */
export function edoValue(profile: WeaponProfile, ammoDamage: number, t: OffenseTerms): number {
  const crit = profile.critApplies ? 1 + (BASE_CRIT_PCT + profile.critPct + t.crit) / 100 : 1
  return ((profile.damage + ammoDamage) * (1 + t.pct / 100) + t.flat) * profile.hitsPerSec * (1 + t.speed / 100) * crit
}

/**
 * One source's part of the additive figures (§5.1(2)–(4): defense, mobility and survivability are sums
 * over the build's sources). The Step 3 bars' references (src/scoring/references.ts) search with it.
 */
export function sourceFigures(src: BuildSource, cls: LoadoutClass): { defense: number; mobility: number; survivability: number } {
  const e = src.effects
  const defense = (src.defense ?? 0) + statTotal(e, 'defense-flat', 'hybrid')
  const mob = mobilityOf([src], cls)
  const survivability = defense + 2 * statTotal(e, 'damage-reduction-pct', 'hybrid') + 2 * statTotal(e, 'life-regen', 'hybrid') + 0.25 * statTotal(e, 'max-life-flat', 'hybrid')
  return { defense, mobility: mob.move + mob.flight, survivability }
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

/**
 * What one source adds for class `cls` (PRD P4-S3 AC1): the points of its effects that apply (wing flight
 * as mobility, the longer of wing flight time and flight effects — §5.1(3)'s rule), its own defense
 * (armor pieces), the points it carries for another class only, and how many effects aren't scored.
 */
export function contributionOf(src: BuildSource, cls: LoadoutClass): Contribution {
  let points = ZERO_POINTS
  let otherClass = 0
  let unscored = 0
  for (const e of src.effects) {
    if (e.kind !== 'stat') {
      unscored++
      continue
    }
    if (e.stat === 'flight-time-ticks' && src.wingTicks !== undefined) continue
    const p = effectPoints(e, cls)
    if (appliesTo(e, cls)) points = addPoints(points, p)
    else otherClass += Math.abs(sumPoints(p))
  }
  if (src.wingTicks !== undefined) points = addPoints(points, { ...ZERO_POINTS, mob: 0.1 * Math.max(src.wingTicks, statTotal(src.effects, 'flight-time-ticks', cls)) })
  return {
    name: src.name,
    kind: src.kind,
    ...(src.id !== undefined ? { id: src.id } : {}),
    ...(src.setId !== undefined ? { setId: src.setId } : {}),
    points,
    ...(src.defense !== undefined ? { defense: src.defense } : {}),
    otherClass,
    unscored,
  }
}

const isMobilitySpecial = (text: string) =>
  !INFORMATIONAL.test(text) && (DASH_TEXT.test(text) || UNCOUNTED_MOBILITY.dodge.test(text) || UNCOUNTED_MOBILITY.flight.test(text) || UNCOUNTED_MOBILITY.jump.test(text))

/**
 * AMENDMENTS-016 B113(e) M4: unscored life effects (wiki text such as "Slowly regenerates life") — named
 * under survivability, so "2 × 0 counted life regeneration" never reads as "no regeneration at all".
 */
const SURVIVABILITY_SPECIAL = /\bregenerat\w*|\bregen\b|\blife\b|\bheal(?:s|ing)?\b/i
const isSurvivabilitySpecial = (text: string) => !INFORMATIONAL.test(text) && SURVIVABILITY_SPECIAL.test(text)

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
      const perHit = profile.damage + (src.ammo?.damage ?? 0)
      const terms = offenseTerms(all, profile.damageClass)
      const { pct, flat } = terms
      const speed = 1 + terms.speed / 100
      const crit = profile.critApplies ? 1 + (BASE_CRIT_PCT + profile.critPct + terms.crit) / 100 : 1
      const value = edoValue(profile, src.ammo?.damage ?? 0, terms)
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
    uncounted: sources.flatMap((s) => s.effects.filter((e): e is Extract<StatEffect, { kind: 'special' }> => e.kind === 'special' && isSurvivabilitySpecial(e.text)).map((e) => ({ from: s.name, text: e.text }))),
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
    contributions: sources.map((s) => contributionOf(s, src.cls)),
  }
}

// --- comparing builds (SCORING_SPEC §5.3, §5.4; PRD P4-S4 AC1 / AC2; AMENDMENTS-016 B113b) ------------------

/** One component of one compared build. */
export interface ComparedComponent {
  id: GoalComponent
  label: string
  unit: string
  /** The build's own figure (undefined: not computed for this build — see the profile's `excluded`). */
  raw?: number
  text: string
  /** Left out for EVERY build (symmetric exclusion): uncomputable for at least one. */
  dropped: boolean
  /** Its share of the compared builds' figures, 0–100. Undefined when dropped. */
  scaled?: number
  scaledText?: string
  /** How `scaled` was found ("100 × 35 ÷ (35 + 20) = 63.6"). */
  scaledFormula?: string
  /** The goal's GOAL_WEIGHTS entry. */
  weight: number
  /** weight × scaled (undefined when dropped). */
  contribution?: number
}

export interface ComparedBuild {
  components: ComparedComponent[]
  /**
   * The build's weighted sum (§5.3 GoalFit) — present only for ≥ 2 builds with at least one included
   * component. B113b: shown only inside "How was this scored?"; the comparison leads with the difference.
   */
  fit?: { value: number; text: string; formulaText: string }
}

/** AMENDMENTS-016 B113b: two builds' weighted sums as ONE signed difference (the second build's − the first's). */
export interface GoalDifference {
  value: number
  /** |value| at one decimal ("24.4"); "" when it rounds to 0 (`sign` 0: "same"). */
  text: string
  /** 1: the second build's sum is higher; −1: the first's; 0: the same at one decimal. */
  sign: -1 | 0 | 1
  formulaText: string
  assumptions: AssumptionText[]
}

/** SCORING_SPEC §5.4 ScoreBreakdown data for a comparison: per build, no verdict slot exists. */
export interface GoalComparison {
  goal: Goal
  constantsVersion: number
  builds: ComparedBuild[]
  /** Exactly two builds, both with a weighted sum: how far apart they are under the goal (B113b). */
  difference?: GoalDifference
  /** Left out for every build (symmetric exclusion, disclosed). */
  dropped: { id: GoalComponent; label: string }[]
  /** Figures that are 0 in every build: each scales to 0 (flagged, §5.3). */
  zeroMax: { id: GoalComponent; label: string }[]
}

/** A figure written without its sign, for the share formula's denominator ("−4.5" → "4.5"). */
const unsigned = (text: string) => text.replace(/^[−-]/, '')

/**
 * compareLoadouts (SCORING_SPEC §5.3 as ruled by AMENDMENTS-016 B113b): each figure — class synergy too —
 * is split between the compared builds in proportion to their values, share_k(b) = 100 · raw_k(b) / Σ |raw_k|
 * (Σ 0 ⇒ all 0, flagged), so no build is pinned at 100 for being the larger (the "100.0 anchor" is gone:
 * two builds' shares of a figure add up to 100); a component uncomputable for ANY build drops for ALL; each
 * build's weighted sum = Σ included w·share / Σ included w. Two builds ⇒ one signed difference (second −
 * first), "same" when it rounds to 0. One build ⇒ components only. Pure arithmetic over the profiles — the
 * same goal weights for every build, whatever goal each was made for. `names` word the difference's formula.
 */
export function compareLoadouts(profiles: readonly BuildProfile[], goal: Goal, names: readonly string[] = []): GoalComparison {
  const weights = GOAL_WEIGHTS[goal]
  const comparing = profiles.length >= 2
  const dropped: GoalComparison['dropped'] = []
  const zeroMax: GoalComparison['zeroMax'] = []
  const scale = new Map<GoalComponent, { total: number; parts: string[] }>()
  for (const id of GOAL_COMPONENTS) {
    const all = profiles.map((p) => p.components.find((c) => c.id === id))
    const label = all.find((c) => c)?.label ?? id
    if (all.some((c) => c?.value === undefined)) {
      dropped.push({ id, label })
      continue
    }
    const total = all.reduce((acc, c) => acc + Math.abs(c?.value as number), 0)
    if (total <= 0 && comparing) zeroMax.push({ id, label })
    // each build's figure written the way its own build writes it ("15" defense, "42.5" points); a build's own comes first
    scale.set(id, { total, parts: all.map((c) => unsigned(c?.text ?? '')) })
  }
  const builds = profiles.map((p, b): ComparedBuild => {
    const components = GOAL_COMPONENTS.map((id): ComparedComponent => {
      const c = p.components.find((x) => x.id === id)
      const weight = weights[GOAL_COMPONENTS.indexOf(id)]
      const base: ComparedComponent = { id, label: c?.label ?? id, unit: c?.unit ?? '', ...(c?.value !== undefined ? { raw: c.value } : {}), text: c?.text ?? '', dropped: !scale.has(id), weight }
      const sc = scale.get(id)
      if (!comparing || !sc || c?.value === undefined) return base
      const scaled = sc.total <= 0 ? 0 : (100 * c.value) / sc.total
      return {
        ...base,
        scaled,
        scaledText: oneDecimal(scaled),
        scaledFormula: sc.total <= 0 ? comparisonCopy.zeroMax(base.label) : comparisonCopy.share(c.text, [sc.parts[b], ...sc.parts.filter((_, j) => j !== b)], oneDecimal(scaled)),
        contribution: weight * scaled,
      }
    })
    if (!comparing) return { components }
    const included = components.filter((c) => c.scaled !== undefined)
    const weightSum = included.reduce((acc, c) => acc + c.weight, 0)
    if (included.length === 0 || weightSum <= 0) return { components }
    const value = included.reduce((acc, c) => acc + (c.contribution as number), 0) / weightSum
    const formulaText = comparisonCopy.fitFormula(
      included.map((c) => ({ weight: weightText(c.weight), scaled: c.scaledText as string })),
      weightText(weightSum),
      oneDecimal(value),
    )
    return { components, fit: { value, text: oneDecimal(value), formulaText } }
  })
  const [first, second] = builds.map((b) => b.fit)
  const difference = profiles.length === 2 && first && second ? differenceOf(first, second, goal, names) : undefined
  return { goal, constantsVersion: SCORING_CONSTANTS_VERSION, builds, ...(difference ? { difference } : {}), dropped, zeroMax }
}

function differenceOf(first: NonNullable<ComparedBuild['fit']>, second: NonNullable<ComparedBuild['fit']>, goal: Goal, names: readonly string[]): GoalDifference {
  const value = second.value - first.value
  // stated from the sums as written (one decimal each), so "57.4 − 42.6" never reads "= +14.7"
  const shown = Number(second.text.replace(/,/g, '')) - Number(first.text.replace(/,/g, ''))
  const abs = oneDecimal(Math.abs(shown))
  const sign: GoalDifference['sign'] = Number(abs.replace(/,/g, '')) === 0 ? 0 : shown > 0 ? 1 : -1
  const signed = sign === 0 ? comparisonCopy.same : `${sign > 0 ? '+' : '−'}${abs}`
  const formulaText = comparisonCopy.differenceFormula(second.text, names[1] ?? comparisonCopy.secondBuild, first.text, names[0] ?? comparisonCopy.firstBuild, signed)
  return {
    value,
    text: sign === 0 ? '' : abs,
    sign,
    formulaText,
    assumptions: [comparisonAssumption.relative(), comparisonAssumption.formula(formulaText), comparisonAssumption.figures(), comparisonAssumption.weights(goal, SCORING_CONSTANTS_VERSION)],
  }
}
