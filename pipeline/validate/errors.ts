/**
 * Pipeline error taxonomy for the validate stage (DATA_SCHEMA_SPEC §6). Build-failing.
 *
 * Mapping of §7a rules without a dedicated §6 code (documented so it stays consistent):
 * derived↔source consistency failures (Boss/Enemy.dropIds, ArmorSet↔piece back-refs and
 * helmet/variant bijection, Accessory combinedFrom/upgradesTo, Item.isStation,
 * Boss↔Node symmetry, EoW/BoC alternative-route pairing, acquisition ids pointing at a
 * record for a different item) are reported as E_DANGLING_REF — each is a concrete
 * (fromRef, field, toRef) reference that does not hold. Self-loops are E_GRAPH_CYCLE;
 * duplicate edge triples and duplicate helmets/variants are E_DUPLICATE_ID; §7a-12
 * conditional-field rules are schema refinements and surface as E_SCHEMA.
 *
 * Expected data gaps are NOT errors: they become `verified:false` + gaps.json entries.
 */
import type * as z from 'zod'

export type PipelineError =
  | { code: 'E_SCHEMA'; ref: string; zodIssues: readonly z.core.$ZodIssue[]; message: string }
  | { code: 'E_DANGLING_REF'; fromRef: string; field: string; toRef: string; message: string }
  | { code: 'E_DUPLICATE_ID'; ref: string; collection: string; message: string }
  | { code: 'E_GRAPH_CYCLE'; path: readonly string[]; message: string }
  | { code: 'E_SUGGESTION_GATING'; bossId: string; itemRef: string; message: string }
  | { code: 'E_LIST_DETAIL_DRIFT'; file: string; ref: string; field?: string; message: string }
  | { code: 'E_UNVERIFIED_VALUE_EMITTED'; ref: string; field: string; message: string }

export type PipelineErrorCode = PipelineError['code']

/** Non-fatal findings. Lab downgrades are also recorded as gaps.json entries. */
export interface PipelineWarning {
  code: 'W_LAB_DOWNGRADE' | 'W_AMMO_CLASS_UNMATCHED'
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
