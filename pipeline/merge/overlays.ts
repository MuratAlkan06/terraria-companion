/**
 * Curated overlay inputs (DATA_SCHEMA_SPEC §7c "merge": pipeline/overlays/*.json, schema-validated
 * incl. a mandatory wiki source). Overlay entries are hand-authored facts with a cited page;
 * their pipeline-only `match` keys map raw wiki tokens/notes onto registry slugs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as z from 'zod'
import { Condition, IsoDate, PlainText1, Slug } from '../../src/schemas'

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
