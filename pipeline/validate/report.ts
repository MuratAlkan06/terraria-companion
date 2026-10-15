/**
 * gaps.json + meta.json for a validated dataset (DATA_SCHEMA_SPEC §7d). Both are strict-parsed
 * against the shared schemas before they are returned.
 */
import { DATA_SCHEMA_VERSION, GAME_VERSION, Gaps, Meta, type GapEntry, type GapKind, type Prov } from '../../src/schemas'
import { COLLECTION_KEYS, recordRef, type CollectionKey, type Dataset, type DatasetManifest } from './dataset'

/** Wiki text license (ADR-001 D3, verified CC BY-NC-SA 4.0). */
export const DATA_LICENSE = 'CC BY-NC-SA 4.0'

function gapKind(key: CollectionKey, field: string): GapKind {
  if (field === 'gatedBy' || field.startsWith('gatedBy.')) return 'gating-underived'
  if (key === 'drops' && field.startsWith('rates')) return 'unverified-drop-rate'
  return 'missing-field'
}

/** GapEntry.ref must be a TypedRef; edges have none, so they are filed under their `from` node. */
function gapRef(key: CollectionKey, record: Record<string, unknown>): { ref: string; fieldPrefix: string } {
  if (key === 'edges') return { ref: `node:${String(record.from)}`, fieldPrefix: `edges(${String(record.to)}:${String(record.type)}).` }
  return { ref: recordRef(key, record), fieldPrefix: '' }
}

/**
 * gaps.json = stage gap entries (parse/merge/cross-check findings no record carries, e.g.
 * excluded Cargo rows — stage-gaps.json) + one entry per listed unverified field + Lab defaults.
 */
export function buildGaps(ds: Dataset, now: Date, stageEntries: readonly GapEntry[] = []): Gaps {
  const entries: GapEntry[] = [...stageEntries]
  const perEntity: Gaps['summary']['perEntity'] = {}
  for (const key of COLLECTION_KEYS) {
    const records = ds[key] as unknown as readonly (Record<string, unknown> & { _prov: Prov })[]
    perEntity[key] = {
      total: records.length,
      verified: records.filter((r) => r._prov.verified).length,
      withUnverifiedFields: records.filter((r) => r._prov.unverifiedFields.length > 0).length,
    }
    for (const record of records) {
      const { ref, fieldPrefix } = gapRef(key, record)
      const sources = [...new Set(record._prov.sources.map((s) => s.url))]
      for (const field of record._prov.unverifiedFields) {
        entries.push({
          ref,
          field: `${fieldPrefix}${field}`,
          kind: gapKind(key, field),
          detail: `${field} is unverified (absent + listed in _prov.unverifiedFields); renders as Unknown`,
          sources,
        })
      }
    }
  }
  const lab = { archetype: 0, customScenario: 0, limitation: 0 }
  for (const w of ds.weapons) {
    if (w.labBehavior.kind === 'archetype') lab.archetype += 1
    else if (w.labBehavior.kind === 'custom-scenario') lab.customScenario += 1
    else {
      lab.limitation += 1
      entries.push({
        ref: `i:${w.id}`,
        field: 'labBehavior',
        kind: 'lab-limitation-default',
        detail: `Weapon Lab limitation: ${w.labBehavior.reason}`,
        sources: [...new Set([w.labBehavior.sourceUrl, ...w._prov.sources.map((s) => s.url)])],
      })
    }
  }
  return Gaps.parse({
    generatedAt: now.toISOString(),
    gameVersion: GAME_VERSION,
    summary: { perEntity, labCoverage: { ...lab, unhandled: 0 } },
    entries,
  })
}

export function buildMeta(ds: Dataset, manifest: DatasetManifest, gaps: Gaps, now: Date): Meta {
  const byKind: Record<string, number> = {}
  for (const e of gaps.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  return Meta.parse({
    gameVersion: GAME_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    iteminfo: manifest.iteminfo,
    counts: Object.fromEntries(COLLECTION_KEYS.map((k) => [k, ds[k].length])),
    license: DATA_LICENSE,
    gapSummary: { total: gaps.entries.length, byKind },
  })
}
