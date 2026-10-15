/**
 * Validate stage (ADR-001 D2, DATA_SCHEMA_SPEC §7c): merged + derived collections →
 * strict-parsed collections, or build-failing errors (§6). On success also produces the
 * dataset's gaps.json and meta.json (§7d). Fetch/parse/merge/emit are separate stages.
 *
 * Order:
 *  1. manifest (+ partial-dataset inputs: item universe, pending collections, stage gaps)
 *  2. §2.1-3 Lab downgrade on raw weapons (pre-parse; unverified sim inputs → limitation)
 *  3. strict schema parse of every record (E_SCHEMA) — stops here on failure
 *  4. §7a-10 ammo classes: E_DANGLING_REF once items are produced; A1 warning + downgrade while pending
 *  5. integrity, graph, §7a-13 fixtures (when the graph is produced), suggestion gating, the P5 boss
 *     curation gate (manifest.bossPages), the P6-S0 item closure (manifest.itemClosure), list⊂detail,
 *     search docs, the P3-S13 Weapon Lab coverage gate (labCoverage.ts, AMENDMENTS-016 B115)
 *  6. gaps + meta
 */
import type * as z from 'zod'
import type { GapEntry, Gaps, Meta } from '../../src/schemas'
import {
  COLLECTIONS,
  DatasetManifest,
  ITEM_UNIVERSE_FILE,
  ItemUniverse,
  MANIFEST_FILE,
  parseCollections,
  STAGE_GAPS_FILE,
  StageGaps,
  type CollectionKey,
  type Dataset,
  type RawDataset,
} from './dataset'
import { checkItemClosure } from './closure'
import { checkBossCuration } from './curation'
import type { PipelineError, PipelineWarning } from './errors'
import { checkFixtures } from './fixtures'
import { checkGraph } from './graph'
import { checkIntegrity, type RefScope } from './integrity'
import { checkLabCoverage, LAB_COVERAGE_PINS } from './labCoverage'
import { checkAmmoClasses, downgradeUnverifiedArchetype } from './labDowngrade'
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

const schemaError = (file: string, message: string, zodIssues: readonly z.core.$ZodIssue[] = []): PipelineError => ({
  code: 'E_SCHEMA',
  ref: `file:${file}`,
  zodIssues,
  message: `file:${file}: ${message}`,
})

/** Builds the partial-dataset reference scope from the manifest (dataset.ts header). */
function partialScope(raw: RawDataset, manifest: DatasetManifest, errors: PipelineError[]): RefScope {
  const pending = new Set<CollectionKey>(manifest.partial?.pending ?? [])
  for (const key of pending) {
    const value = raw.collections[key]
    if (Array.isArray(value) ? value.length > 0 : value !== undefined) {
      errors.push(schemaError(COLLECTIONS[key].file, `collection "${key}" is declared pending in ${MANIFEST_FILE} but has records`))
    }
  }
  if (manifest.partial?.itemUniverse === undefined) {
    if (raw.itemUniverse !== undefined) errors.push(schemaError(ITEM_UNIVERSE_FILE, `present but not declared in ${MANIFEST_FILE} partial.itemUniverse`))
    return { pending }
  }
  const universe = ItemUniverse.safeParse(raw.itemUniverse)
  if (!universe.success) {
    errors.push(schemaError(ITEM_UNIVERSE_FILE, 'missing or invalid item universe', universe.error.issues))
    return { pending }
  }
  if (universe.data.source.rev !== manifest.iteminfo.rev) {
    errors.push(schemaError(ITEM_UNIVERSE_FILE, `universe rev ${universe.data.source.rev} != manifest iteminfo.rev ${manifest.iteminfo.rev}`))
  }
  return { pending, universe: new Set(universe.data.items.map((i) => i.id)) }
}

function stageGapEntries(raw: RawDataset, errors: PipelineError[]): GapEntry[] {
  if (raw.stageGaps === undefined) return []
  const parsed = StageGaps.safeParse(raw.stageGaps)
  if (parsed.success) return parsed.data
  errors.push(schemaError(STAGE_GAPS_FILE, 'invalid stage gap entries', parsed.error.issues))
  return []
}

export function validateDataset(raw: RawDataset, options: ValidateOptions = {}): ValidationResult {
  const now = options.now ?? new Date()
  const errors: PipelineError[] = []
  const warnings: PipelineWarning[] = []

  const manifest = DatasetManifest.safeParse(raw.manifest)
  if (!manifest.success) {
    errors.push(schemaError(MANIFEST_FILE, 'missing or invalid dataset manifest', manifest.error.issues))
  }
  const scope: RefScope = manifest.success ? partialScope(raw, manifest.data, errors) : { pending: new Set() }
  const stageGaps = stageGapEntries(raw, errors)

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

  const ammo = checkAmmoClasses(parsed.dataset.weapons, parsed.dataset.items, scope.pending.has('items'))
  warnings.push(...ammo.warnings)
  errors.push(...ammo.errors)
  const dataset: Dataset = { ...parsed.dataset, weapons: ammo.weapons }

  const integrity = checkIntegrity(dataset, scope)
  if (ammo.deferred.size > 0) {
    const items = integrity.deferred.get('items') ?? new Set<string>()
    for (const c of ammo.deferred) items.add(`ammoClass:${c}`)
    integrity.deferred.set('items', items)
  }
  for (const [key, refs] of integrity.deferred) {
    const sample = [...refs].slice(0, 5).join(', ')
    warnings.push({
      code: 'W_DEFERRED_REF',
      ref: `collection:${key}`,
      message: `${refs.size} distinct reference(s) into pending collection "${key}" deferred until it is produced (${sample}${refs.size > 5 ? ', …' : ''})`,
    })
  }
  errors.push(
    ...integrity.errors,
    ...checkGraph(dataset),
    ...(['bosses', 'nodes', 'edges'].some((k) => scope.pending.has(k as CollectionKey)) ? [] : checkFixtures(dataset, manifest.data.fixtures)),
    ...checkSuggestionGating(dataset),
    ...checkBossCuration(dataset, manifest.data.bossPages ?? [], stageGaps),
    ...(manifest.data.itemClosure ? checkItemClosure(dataset, stageGaps) : []),
    ...checkListDetail(raw.lists, dataset),
    ...(raw.searchDocs !== undefined ? checkSearchDocs(raw.searchDocs, dataset) : []),
    ...checkLabCoverage(dataset, { pins: LAB_COVERAGE_PINS[manifest.data.name] }).errors,
  )
  if (errors.length > 0) return { ok: false, errors, warnings }

  const gaps = buildGaps(dataset, now, stageGaps)
  const meta = buildMeta(dataset, manifest.data, gaps, now)
  return { ok: true, dataset, manifest: manifest.data, gaps, meta, warnings, errors: [] }
}

export { loadDatasetDir } from './dataset'
export { formatError, formatWarning } from './errors'
export type { PipelineError, PipelineWarning } from './errors'
