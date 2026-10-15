/** Provenance + gap-entry helpers shared by the merge builders (DATA_SCHEMA_SPEC §2.1, §7d). */
import { GAME_VERSION, type GapEntry, type Prov, type ProvSource } from '../../src/schemas'
import { wikiPageUrl } from '../fetch/config'

/** "2026-10-13T02:44:35.795Z" → "2026-10-13" (UTC date of the fetch). */
export const isoDate = (isoDateTime: string): string => isoDateTime.slice(0, 10)

/**
 * `_prov` for an extracted record. `verified` is true only when nothing is listed AND no
 * cross-check failed (§2.1 rule 1); `crossCheckFailed` lets a record be unverified without a
 * listed field (e.g. two sources disagree on a required value that was kept).
 */
export function makeProv(sources: ProvSource[], unverifiedFields: readonly string[] = [], crossCheckFailed = false): Prov {
  const unique = new Map(sources.map((s) => [`${s.kind}|${s.url}`, s]))
  const fields = [...new Set(unverifiedFields)].sort()
  return {
    gameVersion: GAME_VERSION,
    sources: [...unique.values()],
    verified: fields.length === 0 && !crossCheckFailed,
    unverifiedFields: fields,
    editorialFields: [],
  }
}

export interface ModuleRev {
  title: string
  rev: number
  fetchedAt: string
}

export const moduleSource = (kind: 'iteminfo' | 'wiki-module', m: ModuleRev): ProvSource => ({
  kind,
  url: wikiPageUrl(m.title),
  rev: m.rev,
  fetchedAt: isoDate(m.fetchedAt),
})

/** Collects stage-level gap entries (rows that produced no record, cross-check findings). */
export class GapLog {
  readonly entries: GapEntry[] = []
  add(entry: GapEntry) {
    this.entries.push(entry)
  }
}
