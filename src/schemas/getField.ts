/**
 * Shared field accessor (DATA_SCHEMA_SPEC §2.1 rule 5, §4a "Field read").
 *
 *   getField(record, dotPath) => { status, value? }
 *
 * | value at path | listed in _prov.unverifiedFields | listed in editorialFields | status           |
 * |---------------|----------------------------------|---------------------------|------------------|
 * | absent        | yes                              | –                         | "unverified"     |
 * | absent        | no                               | –                         | "not-applicable" |
 * | present       | no                               | yes                       | "editorial"      |
 * | present       | no                               | no                        | "verified"       |
 * | present       | yes (forbidden at emit)          | –                         | "unverified", value withheld |
 *
 * A listed path also covers its descendants ("statsByDifficulty.master" covers
 * "statsByDifficulty.master.hp"). Numeric segments index arrays ("variants.0.class").
 * Never throws; an unknown/malformed path reads as not-applicable.
 *
 * UI contract: "unverified" renders "Unknown" (P2-S3); "not-applicable" omits the row;
 * "editorial" is labeled "editorial guidance". Sim contract: only "verified" values are
 * consumable — the pipeline downgrades Lab behavior otherwise (§2.1 rule 3).
 */

export type FieldStatus = 'verified' | 'unverified' | 'not-applicable' | 'editorial'

export interface FieldView {
  status: FieldStatus
  /** Present only for "verified" and "editorial". */
  value?: unknown
}

interface ProvLists {
  unverifiedFields: readonly string[]
  editorialFields: readonly string[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function stringList(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
}

function provLists(record: unknown): ProvLists {
  const prov = isObject(record) ? record._prov : undefined
  if (!isObject(prov)) return { unverifiedFields: [], editorialFields: [] }
  return { unverifiedFields: stringList(prov.unverifiedFields), editorialFields: stringList(prov.editorialFields) }
}

/** Resolves a dot-path on plain data (own properties only). `undefined` when any segment is missing. */
export function resolvePath(record: unknown, dotPath: string): unknown {
  if (dotPath === '') return undefined
  let current: unknown = record
  for (const segment of dotPath.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number(segment)]
    } else if (isObject(current)) {
      if (!Object.hasOwn(current, segment)) return undefined
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** True when `path` equals a listed path or is a descendant of one. */
export function isCoveredBy(listed: readonly string[], path: string): boolean {
  return listed.some((p) => p !== '' && (path === p || path.startsWith(`${p}.`)))
}

export function getField(record: unknown, dotPath: string): FieldView {
  const { unverifiedFields, editorialFields } = provLists(record)
  // Listed-as-unverified wins even if a value leaked through: the sim/UI must never consume it.
  if (isCoveredBy(unverifiedFields, dotPath)) return { status: 'unverified' }
  const value = resolvePath(record, dotPath)
  if (value === undefined) return { status: 'not-applicable' }
  if (isCoveredBy(editorialFields, dotPath)) return { status: 'editorial', value }
  return { status: 'verified', value }
}
