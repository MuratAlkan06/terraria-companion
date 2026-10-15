/**
 * `tc.v1.checklists` domain (AMENDMENTS-001 A7, DATA_SCHEMA_SPEC §8a `ChecklistsV1`): the checked
 * entries of every interactive checklist, keyed by checklist id — `boss:<slug>:prep` (boss-page prep
 * checklists, P5-S2) and `guide:<slug>` (guide checklists, P6-S8/S9) — each value the checked entry
 * ids. Unknown keys are kept as stored: one checklist never drops another's progress.
 *
 * Hand-written strict validator (same pattern as ./progress.ts) so the storage module never pulls
 * Zod into a bundle; src/app/routes/bosses/prepChecklist.test.ts asserts parity with the Zod
 * `ChecklistsV1`. Owners write through read-merge-write (replace only their own key), so the boss
 * prep store and the guides store never drop each other's checklists.
 */
import type { DomainDef } from './types'

export interface ChecklistsData {
  byKey: Record<string, string[]>
}

export const EMPTY_CHECKLISTS: ChecklistsData = { byKey: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseChecklists(input: unknown): ChecklistsData {
  if (!isRecord(input)) throw new TypeError('checklists: expected an object')
  const unexpected = Object.keys(input).filter((k) => k !== 'byKey')
  if (unexpected.length > 0) throw new TypeError(`checklists: unexpected keys ${unexpected.join(', ')}`)
  const { byKey } = input
  if (!isRecord(byKey)) throw new TypeError('checklists.byKey: expected an object')
  const out: Record<string, string[]> = {}
  for (const [key, ids] of Object.entries(byKey)) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      throw new TypeError(`checklists.byKey.${key}: expected an array of entry ids`)
    }
    out[key] = [...ids]
  }
  return { byKey: out }
}

/** `data` with `entryId` checked (true) or unchecked (false) in checklist `key`; empty lists are dropped. */
export function withEntry(data: ChecklistsData, key: string, entryId: string, checked: boolean): ChecklistsData {
  const current = data.byKey[key] ?? []
  const next = checked ? (current.includes(entryId) ? current : [...current, entryId]) : current.filter((id) => id !== entryId)
  const byKey = { ...data.byKey }
  if (next.length > 0) byKey[key] = next
  else delete byKey[key]
  return { byKey }
}

export const checklistsDomain: DomainDef<ChecklistsData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseChecklists,
}
