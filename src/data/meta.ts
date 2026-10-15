/**
 * Dataset metadata accessor: a synchronous, typed view of the subset of `meta.json` the shell
 * bundle needs (game version, schema version, generation date, license).
 *
 * `meta.json` is emitted by the pipeline in the full `Meta` shape (DATA_SCHEMA_SPEC §7d), strict-parsed
 * against the Zod `Meta` schema (src/schemas/meta.ts) when it is written; the async data-access
 * contract is `loadMeta()` (src/data-access). The game version string lives ONLY in meta.json
 * (ADR D1) — components must read it from here, never hard-code it.
 */
import rawMeta from './meta.json'

export interface DatasetMeta {
  /** Pinned game version, e.g. "1.4.5.8" (ADR D1). */
  gameVersion: string
  dataSchemaVersion: number
  /** ISO-8601 date-time the metadata was generated (or hand-authored, for the stub). */
  generatedAt: string
  license: string
  /** True only for the P1 hand-authored stub; absent in pipeline output. */
  stub?: boolean
}

export const meta: DatasetMeta = rawMeta

/** "2026-10-12T00:00:00Z" -> "2026-10-12" (UTC calendar date, locale-independent). */
export function formatGeneratedDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return match ? match[1] : iso
}
