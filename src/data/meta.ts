/**
 * Dataset metadata accessor.
 *
 * P1 ships a hand-authored stub `meta.json` (AMENDMENTS-001 A8) marked `stub: true`.
 * P2's pipeline replaces it with the full `Meta` shape (DATA_SCHEMA_SPEC §7d); the
 * Zod schema and `loadMeta()` data-access contract arrive with that slice. Until then
 * this is a typed view of the subset the shell needs. The game version string lives
 * ONLY in meta.json (ADR D1) — components must read it from here, never hard-code it.
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
