/**
 * Curated overlay inputs (DATA_SCHEMA_SPEC §7c "merge": pipeline/overlays/*.json, schema-validated
 * incl. a mandatory wiki source). Overlay entries are hand-authored facts with a cited page;
 * their pipeline-only `match` keys map raw wiki tokens/notes onto registry slugs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as z from 'zod'
import { AttackPatternTag, Boss, Condition, EdgeType, IsoDate, ItemId, NpcId, PlainText, PlainText1, Slug, Stage, WorldEvil } from '../../src/schemas'

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
    })
    .optional(),
})
export type ConditionOverlayEntry = z.infer<typeof ConditionOverlayEntry>

export const ConditionsOverlay = z
  .strictObject({
    overlay: z.literal('conditions'),
    authoredAt: IsoDate,
    notes: z.array(z.string()),
    entries: z.array(ConditionOverlayEntry).min(1),
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

const BossOverlayEntry = z.strictObject({
  id: Slug,
  name: PlainText1,
  /** Wiki article = Cargo NPCs/Drops `_page` of the boss rows. */
  page: Page,
  /** Editorial stage tag (REQUIREMENTS §1 five-stage taxonomy) — emitted in editorialFields. */
  stage: Stage,
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

export const loadBossesOverlay = (dir = OVERLAY_DIR): BossesOverlay => BossesOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'bosses.json'), 'utf8')))
export const loadProgressionOverlay = (dir = OVERLAY_DIR): ProgressionOverlay => ProgressionOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'progression.json'), 'utf8')))
export const loadWithheldOverlay = (dir = OVERLAY_DIR): WithheldOverlay => WithheldOverlay.parse(JSON.parse(readFileSync(resolve(dir, 'withheld.json'), 'utf8')))

/** Every article an overlay cites as evidence (fetched by the sync plan, quote-checked by the build). */
export function evidencePages(b: BossesOverlay, p: ProgressionOverlay, w: WithheldOverlay): string[] {
  return [
    ...b.entries.flatMap((e) => [e.page, ...e.attackPatternTags.flatMap((t) => (t.page ? [t.page] : []))]),
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
}

export function conditionMatchers(overlay: ConditionsOverlay): ConditionMatchers {
  const m: ConditionMatchers = { station: new Map(), recipeNote: new Map(), dropNote: new Map() }
  for (const e of overlay.entries) {
    for (const t of e.match?.stations ?? []) m.station.set(t, e)
    for (const t of e.match?.recipeNotes ?? []) m.recipeNote.set(t, e)
    for (const t of e.match?.dropNotes ?? []) m.dropNote.set(t, e)
  }
  return m
}
