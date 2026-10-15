/**
 * Curated overlay inputs (DATA_SCHEMA_SPEC §7c "merge": pipeline/overlays/*.json, schema-validated
 * incl. a mandatory wiki source). Overlay entries are hand-authored facts with a cited page;
 * their pipeline-only `match` keys map raw wiki tokens/notes onto registry slugs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as z from 'zod'
import { AttackPatternTag, Boss, Condition, DamageClass, Difficulty, EdgeType, IsoDate, ItemId, NpcId, PlainText, PlainText1, Slug, Stage, StatKind, WorldEvil } from '../../src/schemas'

export const OVERLAY_DIR = resolve(import.meta.dirname, '..', 'overlays')

const ConditionOverlayEntry = z.strictObject({
  id: Slug,
  name: PlainText1,
  kind: Condition.shape.kind,
  satisfiedByNode: Slug.optional(),
  wikiTitle: z.string().min(1),
  description: PlainText1,
  match: z
    .strictObject({
      stations: z.array(z.string().min(1)).optional(),
      recipeNotes: z.array(z.string().min(1)).optional(),
      dropNotes: z.array(z.string().min(1)).optional(),
      /**
       * Group captions of a boss article's rendered drop list ("Only in Corrupt worlds"): every item
       * listed under the caption drops only under this condition (parse/dropCaptions.ts). Cargo Drops
       * rows do not carry these captions.
       */
      dropCaptions: z.array(z.string().min(1)).optional(),
      /**
       * P6-S0 (AMENDMENTS-004 B20): condition labels of the "Fishing catches" article (its World status /
       * generic definitions, or a biome definition whose requirement is this condition — the Dungeon's
       * "Skeletron is defeated") that a catch row's route requires (merge/fishing.ts).
       */
      fishingConditions: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  /**
   * AMENDMENTS-016 B140(a)/B141: verbatim quotes (checked against the cached article revision,
   * merge/evidence.ts) that define the condition; their revisions join the emitted condition's _prov.
   */
  evidence: z.array(z.strictObject({ page: z.string().min(1), quote: PlainText.min(12) })).min(1).optional(),
})
export type ConditionOverlayEntry = z.infer<typeof ConditionOverlayEntry>

/**
 * AMENDMENTS-014 B68 / AMENDMENTS-015 B78: a reviewed EXHAUSTIVE group of non-node conditions — every
 * world satisfies at least one member (the world evil is Corruption or Crimson), so an either-or over
 * the group is always satisfiable (merge/gating.ts "Either-or conditions"). Pipeline-only, quote-backed.
 */
const ExhaustiveConditionGroup = z.strictObject({
  conditions: z.array(Slug).min(2),
  page: z.string().min(1),
  quote: PlainText.min(12),
  why: z.string().min(1),
})
export type ExhaustiveConditionGroup = z.infer<typeof ExhaustiveConditionGroup>

/**
 * AMENDMENTS-016 B141: the reviewed world-location / world-state conditions that RIDE ALONG on a route
 * without making it gated — any fresh character can satisfy them (walk to the Cavern layer, break a
 * world's first Shadow Orb), so a route free of boss/progression gates that carries them is still the
 * §7b minimum (merge/gating.ts "Ride-along conditions"). Progression-type conditions never qualify.
 * Pipeline-only, not emitted.
 */
const RideAlongConditions = z.strictObject({ conditions: z.array(Slug).min(1), why: z.string().min(1) })

export const ConditionsOverlay = z
  .strictObject({
    overlay: z.literal('conditions'),
    authoredAt: IsoDate,
    notes: z.array(z.string()),
    entries: z.array(ConditionOverlayEntry).min(1),
    exhaustive: z.array(ExhaustiveConditionGroup).optional(),
    rideAlong: RideAlongConditions.optional(),
  })
  .superRefine((o, ctx) => {
    const ids = new Set<string>()
    const keys = new Map<string, string>()
    for (const e of o.entries) {
      if (ids.has(e.id)) ctx.addIssue({ code: 'custom', message: `duplicate condition id "${e.id}"` })
      ids.add(e.id)
      for (const [kind, list] of Object.entries(e.match ?? {})) {
        for (const token of list ?? []) {
          const key = `${kind}:${token}`
          const owner = keys.get(key)
          if (owner) ctx.addIssue({ code: 'custom', message: `match ${key} claimed by both "${owner}" and "${e.id}"` })
          keys.set(key, e.id)
        }
      }
    }
    for (const g of o.exhaustive ?? []) {
      for (const c of g.conditions) {
        const entry = o.entries.find((e) => e.id === c)
        if (!entry) ctx.addIssue({ code: 'custom', message: `exhaustive group: unknown condition "${c}"` })
        else if (entry.satisfiedByNode) ctx.addIssue({ code: 'custom', message: `exhaustive group: "${c}" maps to a progression node — only non-node conditions can form an either-or group` })
      }
      if (new Set(g.conditions).size !== g.conditions.length) ctx.addIssue({ code: 'custom', message: 'exhaustive group: duplicate condition' })
    }
    const ride = o.rideAlong?.conditions ?? []
    for (const c of ride) {
      const entry = o.entries.find((e) => e.id === c)
      if (!entry) ctx.addIssue({ code: 'custom', message: `rideAlong: unknown condition "${c}"` })
      else if (entry.satisfiedByNode) ctx.addIssue({ code: 'custom', message: `rideAlong: "${c}" maps to a progression node — progression-type conditions always gate (B141)` })
    }
    if (new Set(ride).size !== ride.length) ctx.addIssue({ code: 'custom', message: 'rideAlong: duplicate condition' })
  })
export type ConditionsOverlay = z.infer<typeof ConditionsOverlay>

export function loadConditionsOverlay(dir = OVERLAY_DIR): ConditionsOverlay {
  return ConditionsOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'conditions.json'), 'utf8')))
}

// ---------------------------------------------------------------------------------------------
// P2-S6 overlays. Every curated claim is a VERBATIM QUOTE from a cited wiki article (`page`); the
// build checks each quote against the cached article revision (merge/evidence.ts) and fails when
// it is not there — no curated sentence can drift from, or go beyond, its source.
// ---------------------------------------------------------------------------------------------

/** A verbatim excerpt of the cited article's rendered text (whitespace/typographic quotes normalized). */
const Quote = PlainText.min(12)
const Page = z.string().min(1)

/** A Cargo NPCs row on the boss's page: npc id + the row's name note ("Wall of Flesh Mouth"; absent = no note). */
const NpcRowRef = z.strictObject({ npcId: NpcId, variant: z.string().min(1).optional() })
export type NpcRowRef = z.infer<typeof NpcRowRef>

// ---------------------------------------------------------------------------------------------
// P5 curated boss fields (AMENDMENTS-001 A1 staging; enforced by the E_BOSS_CURATION gate for the
// bosses whose pages ship — src/schemas/bossPages.ts). Each field is EITHER authored entries, every
// one backed by a verbatim quote of its cited page (checked against the cached revision like every
// overlay quote), OR a reasoned honest gap: the field is emitted Unknown (absent + listed) and the
// reason becomes a gaps.json `missing-field` entry. An absent field is simply not curated (the
// P2-S6 staging state) — the gate rejects that for a boss with a page.
// ---------------------------------------------------------------------------------------------

/**
 * Copy that promises a fight's outcome (PRD §9 honesty: no outcome language). Strategy quotes and
 * checklist lines are rejected when they match; the wiki says plenty without it.
 */
export const OUTCOME_PROMISE =
  /\b(guarantee[sd]?|impossible to die|can(?:not|'t) (?:die|lose)|will (?:win|die)|win the fight|kill (?:it|him|her) in seconds|trivial|easy win)\b/i

/** One prep-checklist step: our short wording; the quote is its evidence (not emitted). */
const BossPrepEntry = z.strictObject({
  /** The checklist line shown to the user (editorial; must say no more than the quote). */
  text: PlainText1.max(140),
  /** Items the step names: display names resolved through Module:Iteminfo/data (exact, unambiguous). */
  items: z.array(z.string().min(1)).min(1).optional(),
  page: Page,
  quote: Quote,
})
export type BossPrepEntry = z.infer<typeof BossPrepEntry>

/** One strategy: the quote itself is emitted as the text (curated text can only repeat the wiki). */
const BossStrategyEntry = z.strictObject({
  class: DamageClass.optional(),
  difficulty: Difficulty.optional(),
  page: Page,
  quote: Quote,
  /** Pipeline-only reviewer rationale (why the class / difficulty tag applies); required with a tag. */
  why: z.string().min(1).optional(),
})
export type BossStrategyEntry = z.infer<typeof BossStrategyEntry>

/** Suggested per-class equipment; every item must pass E_SUGGESTION_GATING (validate, §7a-5). */
const BossGearEntry = z.strictObject({
  class: DamageClass,
  /** Display names → Module:Iteminfo/data IDs (exact, unambiguous). */
  weapons: z.array(z.string().min(1)).min(1),
  armorSets: z.array(Slug),
  accessories: z.array(z.string().min(1)),
  buffs: z.array(Slug),
  note: PlainText1.optional(),
  page: Page,
  quote: Quote,
})
export type BossGearEntry = z.infer<typeof BossGearEntry>

/** A reasoned honest gap (emitted Unknown + a `missing-field` gap entry carrying the reason). */
const CurationGap = z.strictObject({ gap: PlainText.min(20) })
export type CurationGap = z.infer<typeof CurationGap>

export const isCurationGap = (v: unknown): v is CurationGap => typeof v === 'object' && v !== null && !Array.isArray(v) && 'gap' in v

/**
 * Honest partial gear (P5-S3): one class whose suggested gear is Unknown while other classes have
 * authored entries. SuggestedEquipment needs ≥ 1 weapon per entry, so a class with no weapon both
 * recommended by a quote and verified obtainable before the fight has no entry: it is emitted as
 * `suggestedEquipment.<class>` listed in unverifiedFields (absent → Unknown) + a `missing-field` gap
 * on that path carrying the reason.
 */
const BossGearClassGap = z.strictObject({ class: DamageClass.exclude(['other']), gap: PlainText.min(20) })
export type BossGearClassGap = z.infer<typeof BossGearClassGap>

export const isGearClassGap = (v: BossGearEntry | BossGearClassGap): v is BossGearClassGap => 'gap' in v

/** The three A1-staged list fields an overlay entry may curate (attackPatternTags are quoted tags, above). */
export const CURATED_BOSS_FIELDS = ['prepChecklist', 'strategies', 'suggestedEquipment'] as const
export type CuratedBossField = (typeof CURATED_BOSS_FIELDS)[number]

const BossOverlayEntry = z.strictObject({
  id: Slug,
  name: PlainText1,
  /** Wiki article = Cargo NPCs/Drops `_page` of the boss rows. */
  page: Page,
  /** Editorial stage tag (REQUIREMENTS §1 five-stage taxonomy) — emitted in editorialFields. */
  stage: Stage,
  /** AMENDMENTS-005 B22: stage-transition gates only (wall-of-flesh → early-hm); editorial, emitted on the boss node. */
  unlocksStage: Stage.optional(),
  worldEvil: WorldEvil.optional(),
  /** Representative NPC row: location environment, sprite and (unless statsUnknown) stats. */
  primary: NpcRowRef,
  /** Sprite row when it differs from `primary` (e.g. the whole Wall of Flesh). */
  sprite: NpcRowRef.optional(),
  /** Why boss-level stats cannot come from one NPC row (multi-part bosses) → stats Unknown. */
  statsUnknown: PlainText1.optional(),
  summon: z.strictObject({
    /** Item display names, resolved to IDs through Module:Iteminfo/data (exact, unambiguous). */
    items: z.array(z.string().min(1)),
    conditions: z.array(Slug),
    quote: Quote,
  }),
  /** Absent = the article states no time rule → location.time Unknown. */
  time: z.strictObject({ value: Boss.shape.location.shape.time.unwrap(), quote: Quote }).optional(),
  /** A1 staging: only tags with a verbatim behavior quote; editorial. */
  attackPatternTags: z.array(z.strictObject({ tag: AttackPatternTag, quote: Quote, page: Page.optional() })),
  /** P5 curated fields (see above): entries, or `{ gap }`; absent = not curated. */
  prepChecklist: z.union([z.array(BossPrepEntry).min(1), CurationGap]).optional(),
  strategies: z.union([z.array(BossStrategyEntry).min(1), CurationGap]).optional(),
  /** Entries (+ per-class gaps for classes without one, see BossGearClassGap), or a whole-field `{ gap }`. */
  suggestedEquipment: z.union([z.array(z.union([BossGearEntry, BossGearClassGap])).min(1), CurationGap]).optional(),
})
export type BossOverlayEntry = z.infer<typeof BossOverlayEntry>

export const BossesOverlay = z
  .strictObject({ overlay: z.literal('bosses'), authoredAt: IsoDate, notes: z.array(z.string()), entries: z.array(BossOverlayEntry).min(1) })
  .superRefine((o, ctx) => {
    for (const key of ['id', 'page'] as const) {
      const seen = new Set<string>()
      for (const e of o.entries) {
        if (seen.has(e[key])) ctx.addIssue({ code: 'custom', message: `duplicate boss ${key} "${e[key]}"` })
        seen.add(e[key])
      }
    }
    for (const e of o.entries) {
      const tags = e.attackPatternTags.map((t) => t.tag)
      if (new Set(tags).size !== tags.length) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": duplicate attack pattern tag` })
      if (Array.isArray(e.prepChecklist)) {
        // Checklist entry ids derive from the text (persisted check-offs, A7), so texts are unique per boss.
        const texts = e.prepChecklist.map((p) => p.text.toLowerCase())
        if (new Set(texts).size !== texts.length) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": duplicate prep checklist text` })
        for (const p of e.prepChecklist) {
          if (OUTCOME_PROMISE.test(p.text)) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": prep checklist text promises an outcome: "${p.text}"` })
        }
      }
      if (Array.isArray(e.suggestedEquipment)) {
        const entries = e.suggestedEquipment.filter((g) => !isGearClassGap(g))
        const gapClasses = e.suggestedEquipment.filter(isGearClassGap).map((g) => g.class)
        if (entries.length === 0) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": suggestedEquipment has per-class gaps only; declare the whole field as { gap } instead` })
        if (new Set(gapClasses).size !== gapClasses.length) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": duplicate per-class gear gap` })
        for (const cls of gapClasses) {
          if (entries.some((g) => g.class === cls)) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": class "${cls}" has gear entries and a gear gap` })
        }
      }
      if (Array.isArray(e.strategies)) {
        const quotes = e.strategies.map((s) => s.quote)
        if (new Set(quotes).size !== quotes.length) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": duplicate strategy quote` })
        for (const s of e.strategies) {
          if ((s.class || s.difficulty) && !s.why) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": a class/difficulty-tagged strategy needs a reviewer \`why\`: "${s.quote}"` })
          if (OUTCOME_PROMISE.test(s.quote)) ctx.addIssue({ code: 'custom', message: `boss "${e.id}": strategy quote promises an outcome: "${s.quote}"` })
        }
      }
    }
  })
export type BossesOverlay = z.infer<typeof BossesOverlay>

const ProgressionNodeEntry = z.strictObject({ id: Slug, kind: z.enum(['event', 'milestone']), name: PlainText1, stage: Stage, page: Page })
const ProgressionEdgeEntry = z.strictObject({
  from: Slug,
  to: Slug,
  type: EdgeType,
  page: Page,
  /** Emitted as the edge note; must occur verbatim in `page`. */
  quote: Quote,
  /** Pipeline-only reviewer rationale (how the quote supports this edge type); not emitted. */
  why: z.string().min(1).optional(),
})

export const ProgressionOverlay = z.strictObject({
  overlay: z.literal('progression'),
  authoredAt: IsoDate,
  notes: z.array(z.string()),
  /** Event + milestone nodes; boss nodes are generated 1:1 from the bosses overlay. */
  nodes: z.array(ProgressionNodeEntry).min(1),
  edges: z.array(ProgressionEdgeEntry).min(1),
})
export type ProgressionOverlay = z.infer<typeof ProgressionOverlay>

/**
 * AMENDMENTS-004 B19: wiki self-conflicts the pipeline cannot detect by cross-checking two
 * numeric sources. The named field is withheld (Unknown + source-mismatch gap), never resolved by
 * picking a side. `cargoTag` is the conflicting Cargo Items tag; when it disappears the conflict was
 * resolved upstream and the build fails so the entry gets removed (no stale withholding).
 */
export const WithheldOverlay = z.strictObject({
  overlay: z.literal('withheld'),
  authoredAt: IsoDate,
  notes: z.array(z.string()),
  entries: z.array(
    z.strictObject({
      itemId: ItemId,
      field: z.enum(['acquisition']),
      ruling: z.string().min(1),
      detail: PlainText1,
      cargoTag: z.string().min(1),
      evidence: z.array(z.strictObject({ page: Page, quote: Quote })).min(1),
    }),
  ),
})
export type WithheldOverlay = z.infer<typeof WithheldOverlay>

/**
 * P2-S7 buffs overlay (overlays/buffs.json): the curated loadout-potion members of the buff registry
 * plus explicit effect classifications. Every effect is a verbatim quote of the buff's article; a stat
 * effect's quote must contain its number (and scope word) — checked by merge/buffs.ts.
 */
const EffectQuote = PlainText.min(8)
const BuffEffectEntry = z.union([
  z.strictObject({ stat: StatKind, value: z.number(), scope: DamageClass.optional(), quote: EffectQuote }),
  z.strictObject({ special: EffectQuote }),
])
export type BuffEffectEntry = z.infer<typeof BuffEffectEntry>

export const BuffsOverlay = z
  .strictObject({
    overlay: z.literal('buffs'),
    authoredAt: IsoDate,
    notes: z.array(z.string()),
    entries: z.array(z.strictObject({ name: PlainText1, effects: z.array(BuffEffectEntry).min(1) })).min(1),
  })
  .superRefine((o, ctx) => {
    const seen = new Set<string>()
    for (const e of o.entries) {
      if (seen.has(e.name)) ctx.addIssue({ code: 'custom', message: `duplicate buff "${e.name}"` })
      seen.add(e.name)
    }
  })
export type BuffsOverlay = z.infer<typeof BuffsOverlay>

export const loadBuffsOverlay = (dir = OVERLAY_DIR): BuffsOverlay => BuffsOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'buffs.json'), 'utf8')))

/**
 * P3-S0 Weapon Lab params overlay (overlays/lab-params.json): the RESIDUAL decisions for weapons whose
 * archetype params the derivation (merge/labParams.ts) cannot settle from the data modules + article
 * screen alone. Param semantics are binding as documented in src/sim/README.md (AMENDMENTS-008 B37).
 * - `archetype`: the screen flagged the weapon, a reviewer read its article and confirms it fits the
 *   archetype; supplies the per-weapon params no data module carries (bow-gun: projectilesPerUse,
 *   spreadDegrees or slightSpread, inheritsAmmoProjectile; magic-bolt: projectilesPerUse, spreadDegrees,
 *   pierce, lifetimeTicks, damageMultiplierPct). Every residual value must be stated by one of the
 *   entry's quotes (checked).
 * - `limitation`: the article documents behavior the archetype params cannot express; `reason` is the
 *   emitted (user-facing) limitation reason, backed by the quotes.
 * Remaining-archetype families (merge/labFamilies.ts): an `archetype` entry may carry the residuals a
 * reviewed quote states — returning throwRangeTiles; minion-sentry aiClass / attackRateTicks /
 * sentryRangeTiles; explosive-aoe blastRadiusTiles / trigger / fuseTicks / falloff; piercing-beam
 * tickRateTicks — and is needed whenever it supplies one (even on a clean screen). Any entry may record
 * bounceCount / chainTargets (limitation entries only) / tickRateTicks for later (quote-checked, never
 * emitted). For these families a limitation `reason` describes only the weapon-specific blocker; the
 * build prefixes the family sentence while the archetype has no sim interpreter.
 * Every quote is checked verbatim against the cached article revision (merge/evidence.ts).
 */
const LabQuote = z.strictObject({ page: Page, quote: Quote })
const LabEntryBase = {
  itemId: ItemId,
  /** Must equal the weapon's name (guards against item-ID typos). */
  name: PlainText1,
  evidence: z.array(LabQuote).min(1),
  /** Pipeline-only reviewer rationale (not emitted). */
  why: z.string().min(1),
  /**
   * RECORDED for later (P3-S0 remaining-archetype slice): cross-cutting modifier values whose sim
   * stubs throw NotImplemented (bounce, chain) — quote-checked, reported, never emitted. A weapon that
   * needs them stays a limitation with that specific reason.
   */
  bounceCount: z.int().positive().optional(),
  chainTargets: z.int().min(2).optional(),
  /**
   * piercing-beam: the beam's hit interval (ticks) a quote states. On an archetype entry it is the
   * channel-beam residual; on a limitation entry it is recorded for later.
   */
  tickRateTicks: z.int().positive().optional(),
}
const LabArchetypeEntry = z.strictObject({
  ...LabEntryBase,
  decision: z.literal('archetype'),
  archetype: z.enum(['swing-melee', 'thrust', 'bow-gun', 'magic-bolt', 'returning', 'whip', 'minion-sentry', 'explosive-aoe', 'piercing-beam']),
  /** returning (boomerang / launched flail): the range a quote states in tiles (a yoyo's comes from its infobox). */
  throwRangeTiles: z.number().positive().optional(),
  /** minion-sentry: the curated AI class — the quote must show the class's evidence (labFamilies AI_CLASS_EVIDENCE). */
  aiClass: z.enum(['melee-contact', 'ranged-shot', 'hover-strike', 'ground-melee']).optional(),
  /** minion-sentry: the attack interval a quote states exactly (an average needs a ruling). */
  attackRateTicks: z.int().positive().optional(),
  /** minion-sentry (sentries): the targeting radius a quote states (a Manhattan distance needs a ruling). */
  sentryRangeTiles: z.number().positive().optional(),
  /** explosive-aoe: values a quote states (radius in tiles; "explodes N seconds after"; uniform damage = falloff none). */
  blastRadiusTiles: z.number().positive().optional(),
  trigger: z.enum(['impact', 'timed']).optional(),
  fuseTicks: z.int().positive().optional(),
  falloff: z.enum(['none', 'linear']).optional(),
  projectilesPerUse: z.int().positive().optional(),
  spreadDegrees: z.number().min(0).optional(),
  inheritsAmmoProjectile: z.boolean().optional(),
  /** magic-bolt only: overrides the Projectileinfo-derived pierce (B37: extra targets after the first). */
  pierce: z.union([z.int().nonnegative(), z.literal('infinite')]).optional(),
  /** magic-bolt only: the projectile lifetime the article states. */
  lifetimeTicks: z.int().positive().optional(),
  /**
   * bow-gun guns only — AMENDMENTS-010 B47: the article says the gun fires at a "slight" / "small" spread
   * and states no angle → spreadDegrees = 10, a labeled modeling convention (listed in _prov.modeledFields).
   */
  slightSpread: z.literal(true).optional(),
  /** magic-bolt only — AMENDMENTS-010 B48(b): the bolt deals this % of the weapon's damage (quoted). */
  damageMultiplierPct: z.int().positive().optional(),
})
const LabLimitationEntry = z.strictObject({ ...LabEntryBase, decision: z.literal('limitation'), reason: PlainText1 })
export const LabParamsEntry = z.discriminatedUnion('decision', [LabArchetypeEntry, LabLimitationEntry])
export type LabParamsEntry = z.infer<typeof LabParamsEntry>

/**
 * A reviewed "What it does in-game" text for a Lab limitation card whose tooltip has no behavior line
 * (only its flavor-text quote, or nothing — UX_SPEC §8 wants verified BEHAVIOR text): a verbatim
 * excerpt (whole sentences) of the weapon's own article, checked against the cached revision like
 * every quote. Display text only — never a param, never the limitation's reason. The build rejects an
 * entry that is not needed (a simulated weapon, or a tooltip that already describes the behavior).
 */
const LabBehaviorSentence = z.strictObject({ itemId: ItemId, name: PlainText1, page: Page, quote: Quote })
export type LabBehaviorSentence = z.infer<typeof LabBehaviorSentence>

export const LabParamsOverlay = z
  .strictObject({
    overlay: z.literal('lab-params'),
    authoredAt: IsoDate,
    notes: z.array(z.string()),
    entries: z.array(LabParamsEntry),
    inGameBehavior: z.array(LabBehaviorSentence).optional(),
  })
  .superRefine((o, ctx) => {
    for (const list of [o.entries, o.inGameBehavior ?? []]) {
      const seen = new Set<number>()
      for (const e of list) {
        if (seen.has(e.itemId)) ctx.addIssue({ code: 'custom', message: `duplicate lab-params entry for item ${e.itemId}` })
        seen.add(e.itemId)
      }
    }
  })
export type LabParamsOverlay = z.infer<typeof LabParamsOverlay>

export const loadLabParamsOverlay = (dir = OVERLAY_DIR): LabParamsOverlay => LabParamsOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'lab-params.json'), 'utf8')))

/** Every article the lab-params overlay cites (fetched by the sync plan, quote-checked by the build). */
export const labEvidencePages = (o: LabParamsOverlay): string[] => [...o.entries.flatMap((e) => e.evidence.map((x) => x.page)), ...(o.inGameBehavior ?? []).map((e) => e.page)]

/**
 * P2-S8 armor-sets overlay (overlays/armor-sets.json): the RESIDUAL decisions the set derivation
 * (merge/armor.ts) cannot settle from Cargo Items + the set article's infobox alone. Every entry is
 * keyed by the set article (Cargo `_page` of the set row) and backed by verbatim quotes of that
 * article (checked against the cached revision, merge/evidence.ts):
 * - `classes`: the damage class of a helmet variant whose pieces / set bonus name several classes
 *   (hybrid sets) — the reviewer's ruling, quoted; emitted as an editorial field.
 * - `withhold`: the set cannot be expressed by the ArmorSet schema (Rain armor: no set bonus); its
 *   pieces are emitted without setId — listed Unknown — and a gap records why.
 * - `chests` (P6 fix round): the set article hosts several alternative chests (Beetle armor) — the
 *   reviewer confirms, quoted, that any one of them completes the set; the build checks every chest is
 *   named by a quote. Whether the bonus is keyed by the chest is DERIVED from the Set Bonus segments.
 * - `combination` (P6 fix round): a set whose pieces live on their own articles (Wizard set: one of
 *   two hats + one of eight robes, no legs piece). The member names are checked against the set
 *   article's own set-pieces table (name, item ID, body slot) and the emitted pieces; `legs.quote`
 *   backs "no legs piece — any legs keep the bonus".
 * Top-level `unrecorded` (P6 fix round): a piece the wiki ties to a set the dataset cannot record
 * (Ultrabright Helmet: interchangeable into two sets, but setId names one) — its setId is listed
 * Unknown with the quotes, never shown as "no set".
 */
const ArmorSetEntry = z.strictObject({
  page: Page,
  /**
   * `class` = the single ArmorSet variant class ("other" for hybrids and class-less sets); `classes`
   * (AMENDMENTS-011 B52) = the hybrid's damage classes the quote names ("melee/ranged" → melee, ranged;
   * "mage" → magic; "summoner" → summon) — absent = [class]. A hybrid list must equal the variant's
   * stat class signals (merge/armor.ts checks both the quote and the data).
   */
  classes: z.array(z.strictObject({ helmet: PlainText1, class: DamageClass, classes: z.array(DamageClass.exclude(['other'])).min(2).optional(), quote: Quote })).optional(),
  withhold: z.strictObject({ reason: PlainText1, quote: Quote }).optional(),
  chests: z.strictObject({ quotes: z.array(Quote).min(1) }).optional(),
  combination: z
    .strictObject({
      helmets: z.array(PlainText1).min(1),
      chests: z.array(PlainText1).min(1),
      quotes: z.array(Quote).min(1),
      legs: z.strictObject({ quote: Quote }),
    })
    .optional(),
  /** Pipeline-only reviewer rationale (not emitted). */
  why: z.string().min(1),
})
export type ArmorSetEntry = z.infer<typeof ArmorSetEntry>

const UnrecordedMembership = z.strictObject({ piece: PlainText1, reason: PlainText1, evidence: z.array(z.strictObject({ page: Page, quote: Quote })).min(1) })

export const ArmorSetsOverlay = z
  .strictObject({ overlay: z.literal('armor-sets'), authoredAt: IsoDate, notes: z.array(z.string()), entries: z.array(ArmorSetEntry), unrecorded: z.array(UnrecordedMembership) })
  .superRefine((o, ctx) => {
    const seen = new Set<string>()
    for (const e of o.entries) {
      if (seen.has(e.page)) ctx.addIssue({ code: 'custom', message: `duplicate armor-sets entry for "${e.page}"` })
      seen.add(e.page)
      if (!e.classes && !e.withhold && !e.chests && !e.combination) ctx.addIssue({ code: 'custom', message: `armor-sets entry "${e.page}" decides nothing (classes, withhold, chests or combination)` })
      if (e.withhold && (e.classes || e.chests || e.combination)) ctx.addIssue({ code: 'custom', message: `armor-sets entry "${e.page}": a withheld set takes no other ruling` })
      if (e.chests && e.combination) ctx.addIssue({ code: 'custom', message: `armor-sets entry "${e.page}": a combination set names its chests in \`combination\`` })
    }
    const pieces = new Set<string>()
    for (const u of o.unrecorded) {
      if (pieces.has(u.piece)) ctx.addIssue({ code: 'custom', message: `duplicate armor-sets unrecorded entry for "${u.piece}"` })
      pieces.add(u.piece)
    }
  })
export type ArmorSetsOverlay = z.infer<typeof ArmorSetsOverlay>

export const loadArmorSetsOverlay = (dir = OVERLAY_DIR): ArmorSetsOverlay => ArmorSetsOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'armor-sets.json'), 'utf8')))

/** Every article the armor-sets overlay cites (its set pages — already fetched as set articles — and the unrecorded memberships' evidence). */
export const armorSetEvidencePages = (o: ArmorSetsOverlay): string[] => [...o.entries.map((e) => e.page), ...o.unrecorded.flatMap((u) => u.evidence.map((x) => x.page))]

// ---------------------------------------------------------------------------------------------
// AMENDMENTS-014 B68 / AMENDMENTS-015 B78 gating expansion: reviewed acquisition sources the §7b
// derivation may use. Every entry is quote-backed (checked verbatim against the cached article
// revision, merge/evidence.ts); conditions are registry slugs (overlays/conditions.json).
// ---------------------------------------------------------------------------------------------

const EvidenceQuote = z.strictObject({ page: Page, quote: Quote })

/**
 * overlays/vendors.json — vendor NPC availability + shop-row availability mapping.
 * - `npcs`: NPCs whose availability is honestly derivable: their quoted move-in / appearance rule as
 *   registry conditions (none = no progression gate), plus "has one of these items" (`requiresAnyOf`,
 *   every listed name must occur on the NPC article) and "this NPC is present" (`requiresNpcs`).
 * - `unavailable`: every other vendor the wiki names, with the quoted reason its availability is not
 *   derivable (alternative bosses, NPC counts, random visits) — its purchase routes stay Unknown.
 * - `availability`: verbatim Availability cells of the NPC shop tables (parse/shops.ts) → conditions;
 *   an unmapped cell keeps the route's conditions Unknown. A mapping no shop row uses is stale.
 */
const VendorNpc = z.strictObject({
  npc: PlainText1,
  aliases: z.array(PlainText1).optional(),
  page: Page,
  conditions: z.array(Slug),
  evidence: z.array(EvidenceQuote).min(1),
  requiresAnyOf: z.strictObject({ quote: Quote, items: z.array(z.string().min(1)).min(1) }).optional(),
  requiresNpcs: z.strictObject({ quote: Quote, npcs: z.array(PlainText1).min(1) }).optional(),
  why: z.string().min(1),
})
export type VendorNpc = z.infer<typeof VendorNpc>
const VendorUnavailable = z.strictObject({ npc: PlainText1, aliases: z.array(PlainText1).optional(), page: Page, reason: PlainText1, quote: Quote })
export type VendorUnavailable = z.infer<typeof VendorUnavailable>
const VendorAvailability = z.strictObject({ text: z.string().min(1), conditions: z.array(Slug), why: z.string().min(1).optional() })

export const VendorsOverlay = z
  .strictObject({
    overlay: z.literal('vendors'),
    authoredAt: IsoDate,
    notes: z.array(z.string()),
    npcs: z.array(VendorNpc).min(1),
    unavailable: z.array(VendorUnavailable),
    availability: z.array(VendorAvailability).min(1),
  })
  .superRefine((o, ctx) => {
    const names = new Set<string>()
    for (const n of [...o.npcs, ...o.unavailable]) {
      for (const name of [n.npc, ...(n.aliases ?? [])]) {
        if (names.has(name)) ctx.addIssue({ code: 'custom', message: `vendors: NPC "${name}" listed twice` })
        names.add(name)
      }
    }
    const texts = new Set<string>()
    for (const a of o.availability) {
      if (texts.has(a.text)) ctx.addIssue({ code: 'custom', message: `vendors: availability text "${a.text}" mapped twice` })
      texts.add(a.text)
    }
  })
export type VendorsOverlay = z.infer<typeof VendorsOverlay>
export const loadVendorsOverlay = (dir = OVERLAY_DIR): VendorsOverlay => VendorsOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'vendors.json'), 'utf8')))

/**
 * overlays/containers.json — loot containers whose own gating is stated: `container` = the Cargo Drops
 * source name, `page` = the article its rows live on (seed-world pages reuse "Chest" and never match),
 * `conditions` = what opening it needs in progression terms (none = no gate).
 */
const ContainerEntry = z.strictObject({ container: PlainText1, page: Page, conditions: z.array(Slug), evidence: z.array(EvidenceQuote).min(1), why: z.string().min(1) })
export type ContainerEntry = z.infer<typeof ContainerEntry>
/** Loot a registered container holds only in some worlds (the chest tables' "(in worlds with Iron)"). */
const WorldSpecificLoot = z.strictObject({ item: z.string().min(1), conditions: z.array(Slug).min(1), page: Page, quote: Quote })
export const ContainersOverlay = z
  .strictObject({ overlay: z.literal('containers'), authoredAt: IsoDate, notes: z.array(z.string()), worldSpecificLoot: z.array(WorldSpecificLoot).optional(), entries: z.array(ContainerEntry).min(1) })
  .superRefine((o, ctx) => {
    const seen = new Set<string>()
    for (const e of o.entries) {
      const key = `${e.container}|${e.page}`
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `containers: "${key}" listed twice` })
      seen.add(key)
    }
  })
export type ContainersOverlay = z.infer<typeof ContainersOverlay>
export const loadContainersOverlay = (dir = OVERLAY_DIR): ContainersOverlay => ContainersOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'containers.json'), 'utf8')))

/**
 * overlays/gatherables.json — the curated gatherable base-material registry: items the world itself
 * yields with starting tools (mined, chopped, harvested, dropped by the slimes of a fresh world). Each
 * is a gate-free early pre-Hardmode route unless it names conditions; `quote` (verbatim on `page`)
 * is the evidence and becomes the emitted "other" acquisition text of an emitted item.
 */
const GatherableEntry = z.strictObject({
  item: z.string().min(1),
  page: Page,
  quote: Quote,
  /** Further quoted evidence that the source is available early (e.g. Gel: "from the beginning stages"). */
  support: z.array(EvidenceQuote).optional(),
  /** "Only while one of these items is in the inventory" (Seeds: a Blowpipe or Blowgun) — each named on `page`; minimum over their gating. */
  requiresAnyOf: z.array(z.string().min(1)).min(1).optional(),
  conditions: z.array(Slug),
  why: z.string().min(1),
})
export type GatherableEntry = z.infer<typeof GatherableEntry>
export const GatherablesOverlay = z
  .strictObject({ overlay: z.literal('gatherables'), authoredAt: IsoDate, notes: z.array(z.string()), entries: z.array(GatherableEntry).min(1) })
  .superRefine((o, ctx) => {
    const seen = new Set<string>()
    for (const e of o.entries) {
      if (seen.has(e.item)) ctx.addIssue({ code: 'custom', message: `gatherables: "${e.item}" listed twice` })
      seen.add(e.item)
    }
  })
export type GatherablesOverlay = z.infer<typeof GatherablesOverlay>
export const loadGatherablesOverlay = (dir = OVERLAY_DIR): GatherablesOverlay => GatherablesOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'gatherables.json'), 'utf8')))

/** Every article the B68/B78 overlays and the condition registry's B141 evidence cite (fetched by the sync plan, quote-checked by the build). */
export function acquisitionSourcePages(v: VendorsOverlay, c: ContainersOverlay, g: GatherablesOverlay, conditions: ConditionsOverlay): string[] {
  return [
    ...v.npcs.flatMap((n) => [n.page, ...n.evidence.map((e) => e.page)]),
    ...v.unavailable.map((n) => n.page),
    ...c.entries.flatMap((e) => e.evidence.map((x) => x.page)),
    ...(c.worldSpecificLoot ?? []).map((x) => x.page),
    ...g.entries.flatMap((e) => [e.page, ...(e.support ?? []).map((x) => x.page)]),
    ...(conditions.exhaustive ?? []).map((x) => x.page),
    ...conditions.entries.flatMap((e) => (e.evidence ?? []).map((x) => x.page)),
  ]
}

export const loadBossesOverlay = (dir = OVERLAY_DIR): BossesOverlay => BossesOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'bosses.json'), 'utf8')))
export const loadProgressionOverlay = (dir = OVERLAY_DIR): ProgressionOverlay => ProgressionOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'progression.json'), 'utf8')))
export const loadWithheldOverlay = (dir = OVERLAY_DIR): WithheldOverlay => WithheldOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'withheld.json'), 'utf8')))

/** Every article an overlay cites as evidence (fetched by the sync plan, quote-checked by the build). */
export function evidencePages(b: BossesOverlay, p: ProgressionOverlay, w: WithheldOverlay): string[] {
  const curatedPages = (e: BossOverlayEntry) =>
    CURATED_BOSS_FIELDS.flatMap((f) => {
      const v = e[f]
      return Array.isArray(v) ? v.flatMap((x) => ('page' in x ? [x.page] : [])) : []
    })
  return [
    ...b.entries.flatMap((e) => [e.page, ...e.attackPatternTags.flatMap((t) => (t.page ? [t.page] : [])), ...curatedPages(e)]),
    ...p.nodes.map((n) => n.page),
    ...p.edges.map((e) => e.page),
    ...w.entries.flatMap((e) => e.evidence.map((x) => x.page)),
  ]
}

/** Lookup tables from raw wiki tokens to condition slugs. */
export interface ConditionMatchers {
  station: Map<string, ConditionOverlayEntry>
  recipeNote: Map<string, ConditionOverlayEntry>
  dropNote: Map<string, ConditionOverlayEntry>
  dropCaption: Map<string, ConditionOverlayEntry>
  /** P6-S0: "Fishing catches" condition label → condition (merge/fishing.ts). */
  fishing: Map<string, ConditionOverlayEntry>
}

export function conditionMatchers(overlay: ConditionsOverlay): ConditionMatchers {
  const m: ConditionMatchers = { station: new Map(), recipeNote: new Map(), dropNote: new Map(), dropCaption: new Map(), fishing: new Map() }
  for (const e of overlay.entries) {
    for (const t of e.match?.stations ?? []) m.station.set(t, e)
    for (const t of e.match?.recipeNotes ?? []) m.recipeNote.set(t, e)
    for (const t of e.match?.dropNotes ?? []) m.dropNote.set(t, e)
    for (const t of e.match?.dropCaptions ?? []) m.dropCaption.set(t, e)
    for (const t of e.match?.fishingConditions ?? []) m.fishing.set(t, e)
  }
  return m
}
