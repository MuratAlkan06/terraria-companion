/**
 * Pipeline error taxonomy for the validate stage (DATA_SCHEMA_SPEC §6, AMENDMENTS-002 B6).
 * Build-failing.
 *
 * Two distinct reference failure kinds (B6):
 * - E_DANGLING_REF{fromRef, field, toRef}: a reference does not resolve (missing record,
 *   wrong record type/slot, acquisition id pointing at a record for a different item,
 *   helmet/variant bijection gaps).
 * - E_DERIVED_MISMATCH{ref, field}: a pipeline-DERIVED field disagrees with its source of
 *   truth — Boss/Enemy.dropIds, ArmorPiece.setId ⇄ ArmorSet.pieces back-refs, Accessory
 *   combinedFrom/upgradesTo (tinkering symmetry), Item.isStation, Boss↔Node symmetry and
 *   worldEvil agreement, EoW/BoC alternative-route pairing.
 * Self-loops are E_GRAPH_CYCLE; duplicate edge triples and duplicate helmets/variants are
 * E_DUPLICATE_ID; §7a-12 conditional-field rules are schema refinements and surface as E_SCHEMA.
 *
 * Expected data gaps are NOT errors: they become `verified:false` + gaps.json entries.
 */
import type * as z from 'zod'

export type PipelineError =
  | { code: 'E_SCHEMA'; ref: string; zodIssues: readonly z.core.$ZodIssue[]; message: string }
  | { code: 'E_DANGLING_REF'; fromRef: string; field: string; toRef: string; message: string }
  | { code: 'E_DERIVED_MISMATCH'; ref: string; field: string; message: string }
  | { code: 'E_DUPLICATE_ID'; ref: string; collection: string; message: string }
  | { code: 'E_GRAPH_CYCLE'; path: readonly string[]; message: string }
  | { code: 'E_SUGGESTION_GATING'; bossId: string; itemRef: string; message: string }
  | { code: 'E_LIST_DETAIL_DRIFT'; file: string; ref: string; field?: string; message: string }
  | { code: 'E_UNVERIFIED_VALUE_EMITTED'; ref: string; field: string; message: string }
  | { code: 'E_BUDGET'; file: string; gzBytes: number; message: string }
  /** §7a-13: a named progression fixture fact does not hold (P2-S6 AC3 as data tests). */
  | { code: 'E_FIXTURE'; name: string; message: string }
  /** AMENDMENTS-001 A1 P5 gate: a boss whose page ships lacks a curated minimum (validate/curation.ts). */
  | { code: 'E_BOSS_CURATION'; bossId: string; field: string; message: string }

export type PipelineErrorCode = PipelineError['code']

/**
 * Non-fatal findings. Lab downgrades are also recorded as gaps.json entries. W_DEFERRED_REF
 * reports references into collections a partial dataset declares as `pending` (not produced
 * yet) — counted and listed, never silently accepted.
 */
export interface PipelineWarning {
  code: 'W_LAB_DOWNGRADE' | 'W_AMMO_CLASS_UNMATCHED' | 'W_DEFERRED_REF'
  ref: string
  message: string
}

export const danglingRef = (fromRef: string, field: string, toRef: string, detail: string): PipelineError => ({
  code: 'E_DANGLING_REF',
  fromRef,
  field,
  toRef,
  message: `${fromRef} ${field} -> ${toRef}: ${detail}`,
})

export const derivedMismatch = (ref: string, field: string, detail: string): PipelineError => ({
  code: 'E_DERIVED_MISMATCH',
  ref,
  field,
  message: `${ref} ${field}: ${detail}`,
})

export const duplicateId = (collection: string, ref: string, detail: string): PipelineError => ({
  code: 'E_DUPLICATE_ID',
  collection,
  ref,
  message: `${ref} in ${collection}: ${detail}`,
})

/** One line per error: `[CODE] message`; E_SCHEMA adds one indented line per Zod issue. */
export function formatError(error: PipelineError): string {
  const head = `[${error.code}] ${error.message}`
  if (error.code !== 'E_SCHEMA') return head
  const issues = error.zodIssues.map((i) => `    at ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
  return [head, ...issues].join('\n')
}

export function formatWarning(warning: PipelineWarning): string {
  return `[${warning.code}] ${warning.ref}: ${warning.message}`
}
