/**
 * `tc.v1.recent` domain (DATA_SCHEMA_SPEC §8a `RecentV1`): the last entities the user opened,
 * most recent first, at most 20, one entry per ref.
 *
 * Hand-written strict validator (same pattern as ./settings.ts) so the eager storage module never
 * pulls Zod into the initial bundle; storage.test.ts asserts parity with the Zod `RecentV1` schema.
 */
import type { DomainDef } from './types'

export const RECENT_MAX = 20

export interface RecentEntry {
  /** TypedRef, e.g. "i:4956". */
  ref: string
  /** ISO-8601 date-time (UTC, "Z"). */
  viewedAt: string
}

export interface RecentData {
  entries: RecentEntry[]
}

export const EMPTY_RECENT: RecentData = { entries: [] }

/** Mirrors `TypedRef` in src/schemas/common.ts. */
const TYPED_REF = /^(i:\d+|(set|boss|node|buff|grp|scn|cond|enemy):[a-z0-9-]+|(rcp|drop):[a-z0-9-]+)$/
/** Zod `z.iso.datetime()` default: UTC "Z", optional fractional seconds. */
const ISO_DATETIME_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/

function expectExactKeys(record: Record<string, unknown>, keys: readonly string[], where: string): void {
  const actual = Object.keys(record)
  const unexpected = actual.filter((k) => !keys.includes(k))
  if (unexpected.length > 0) throw new TypeError(`${where}: unexpected keys ${unexpected.join(', ')}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseRecent(input: unknown): RecentData {
  if (!isRecord(input)) throw new TypeError('recent: expected an object')
  expectExactKeys(input, ['entries'], 'recent')
  const { entries } = input
  if (!Array.isArray(entries)) throw new TypeError('recent.entries: expected an array')
  if (entries.length > RECENT_MAX) throw new TypeError(`recent.entries: at most ${RECENT_MAX} entries`)
  return {
    entries: entries.map((entry, index) => {
      const where = `recent.entries[${index}]`
      if (!isRecord(entry)) throw new TypeError(`${where}: expected an object`)
      expectExactKeys(entry, ['ref', 'viewedAt'], where)
      const { ref, viewedAt } = entry
      if (typeof ref !== 'string' || !TYPED_REF.test(ref)) throw new TypeError(`${where}.ref: expected a TypedRef`)
      if (typeof viewedAt !== 'string' || !ISO_DATETIME_Z.test(viewedAt) || Number.isNaN(Date.parse(viewedAt))) {
        throw new TypeError(`${where}.viewedAt: expected an ISO date-time`)
      }
      return { ref, viewedAt }
    }),
  }
}

/** Moves `ref` to the front (deduped) with a fresh timestamp; keeps at most RECENT_MAX entries. */
export function withVisit(data: RecentData, ref: string, now: Date): RecentData {
  const rest = data.entries.filter((entry) => entry.ref !== ref)
  return { entries: [{ ref, viewedAt: now.toISOString() }, ...rest].slice(0, RECENT_MAX) }
}

export const recentDomain: DomainDef<RecentData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseRecent,
}
