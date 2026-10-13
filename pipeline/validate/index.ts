/**
 * Validate stage (ADR-001 D2, DATA_SCHEMA_SPEC §7c): merged + derived collections →
 * strict-parsed collections, or build-failing errors (§6). On success also produces the
 * dataset's gaps.json and meta.json (§7d). Fetch/parse/merge/emit are separate stages.
 *
 * Order:
 *  1. manifest
 *  2. §2.1-3 Lab downgrade on raw weapons (pre-parse; unverified sim inputs → limitation)
 *  3. strict schema parse of every record (E_SCHEMA) — stops here on failure
 *  4. A1 rule 10 ammo downgrade (warning)
 *  5. integrity, graph, suggestion gating, list⊂detail, search docs
 *  6. gaps + meta
 */
import type { Gaps, Meta } from '../../src/schemas'
import { DatasetManifest, MANIFEST_FILE, parseCollections, type Dataset, type RawDataset } from './dataset'
import type { PipelineError, PipelineWarning } from './errors'
import { checkGraph } from './graph'
import { checkIntegrity } from './integrity'
import { downgradeUnmatchedAmmo, downgradeUnverifiedArchetype } from './labDowngrade'
import { checkListDetail } from './listDetail'
import { buildGaps, buildMeta } from './report'
import { checkSearchDocs } from './searchDocs'
import { checkSuggestionGating } from './suggestions'

export type ValidationResult =
  | { ok: true; dataset: Dataset; manifest: DatasetManifest; gaps: Gaps; meta: Meta; warnings: PipelineWarning[]; errors: [] }
  | { ok: false; errors: PipelineError[]; warnings: PipelineWarning[] }

export interface ValidateOptions {
  /** Timestamp for generatedAt fields (injectable for deterministic tests). */
  now?: Date
}

export function validateDataset(raw: RawDataset, options: ValidateOptions = {}): ValidationResult {
  const now = options.now ?? new Date()
  const errors: PipelineError[] = []
  const warnings: PipelineWarning[] = []

  const manifest = DatasetManifest.safeParse(raw.manifest)
  if (!manifest.success) {
    errors.push({
      code: 'E_SCHEMA',
      ref: `file:${MANIFEST_FILE}`,
      zodIssues: manifest.error.issues,
      message: `file:${MANIFEST_FILE}: missing or invalid dataset manifest`,
    })
  }

  const collections = { ...raw.collections }
  if (Array.isArray(collections.weapons)) {
    collections.weapons = collections.weapons.map((record: unknown) => {
      const { record: out, warning } = downgradeUnverifiedArchetype(record)
      if (warning) warnings.push(warning)
      return out
    })
  }

  const parsed = parseCollections(collections)
  errors.push(...parsed.errors)
  if (errors.length > 0 || !manifest.success) return { ok: false, errors, warnings }

  const ammo = downgradeUnmatchedAmmo(parsed.dataset.weapons, parsed.dataset.items)
  warnings.push(...ammo.warnings)
  const dataset: Dataset = { ...parsed.dataset, weapons: ammo.weapons }

  errors.push(
    ...checkIntegrity(dataset),
    ...checkGraph(dataset),
    ...checkSuggestionGating(dataset),
    ...checkListDetail(raw.lists, dataset),
    ...(raw.searchDocs !== undefined ? checkSearchDocs(raw.searchDocs, dataset) : []),
  )
  if (errors.length > 0) return { ok: false, errors, warnings }

  const gaps = buildGaps(dataset, now)
  const meta = buildMeta(dataset, manifest.data, gaps, now)
  return { ok: true, dataset, manifest: manifest.data, gaps, meta, warnings, errors: [] }
}

export { loadDatasetDir } from './dataset'
export { formatError, formatWarning } from './errors'
export type { PipelineError, PipelineWarning } from './errors'
