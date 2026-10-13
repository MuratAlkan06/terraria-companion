/**
 * Dataset-level Meta + Gaps report (DATA_SCHEMA_SPEC §7d). Emitted by the pipeline as
 * `meta.json` / `gaps.json`. Expected data gaps are NOT errors — they downgrade records to
 * `verified:false` and appear here.
 */
import * as z from 'zod'
import { DATA_SCHEMA_VERSION, GAME_VERSION, IsoDateTime, TypedRef } from './common'

export const Meta = z.strictObject({
  gameVersion: z.literal(GAME_VERSION),
  dataSchemaVersion: z.literal(DATA_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  iteminfo: z.strictObject({ rev: z.int().positive(), syncedTo: z.string() }), // "1.4.5.7" caveat
  counts: z.record(z.string(), z.int().nonnegative()),
  license: z.string(),
  gapSummary: z.strictObject({
    total: z.int().nonnegative(),
    byKind: z.record(z.string(), z.int().nonnegative()),
  }),
})
export type Meta = z.infer<typeof Meta>

export const GapKind = z.enum([
  'missing-field',
  'source-mismatch',
  'sync-lag-1457',
  'missing-sprite',
  'count-reconciliation',
  'unverified-drop-rate',
  'gating-underived',
  'lab-limitation-default',
])
export type GapKind = z.infer<typeof GapKind>

export const GapEntry = z.strictObject({
  ref: TypedRef,
  field: z.string().optional(),
  kind: GapKind,
  detail: z.string().min(1),
  sources: z.array(z.url()),
})
export type GapEntry = z.infer<typeof GapEntry>

export const Gaps = z.strictObject({
  generatedAt: IsoDateTime,
  gameVersion: z.literal(GAME_VERSION),
  summary: z.strictObject({
    perEntity: z.record(
      z.string(),
      z.strictObject({
        total: z.int(),
        verified: z.int(),
        withUnverifiedFields: z.int(),
      }),
    ),
    labCoverage: z.strictObject({
      // P3-S13 coverage report source
      archetype: z.int(),
      customScenario: z.int(),
      limitation: z.int(),
      unhandled: z.literal(0), // schema itself enforces the gate
    }),
  }),
  entries: z.array(GapEntry),
})
export type Gaps = z.infer<typeof Gaps>
