/**
 * "Recently viewed" recording (UX_SPEC §4a: a detail visit is recorded to `tc.v1.recent`).
 * The homepage RecentRail (P2-S5) reads the same domain. Recording is best-effort: a storage
 * failure never breaks the page that triggered it.
 */
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { EMPTY_RECENT, withVisit, type RecentData } from '../storage/recent'

export type RecordResult = { saved: true; data: RecentData } | { saved: false; error: unknown }

/**
 * Prepends `ref` (deduped, max 20). An unreadable stored list is quarantined by loadDomain
 * (set aside, not deleted) and a fresh list is started.
 */
export function recordRecentVisit(
  ref: string,
  backend?: StorageBackend | null,
  now: Date = new Date(),
): RecordResult {
  try {
    const current = loadDomain('recent', backend)
    const data = withVisit(current.kind === 'loaded' ? current.data : EMPTY_RECENT, ref, now)
    saveDomain('recent', data, backend, now)
    return { saved: true, data }
  } catch (error) {
    console.warn('[recent] Visit not recorded on this device.', error)
    return { saved: false, error }
  }
}
