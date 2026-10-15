/**
 * Set-aside copies (ADR D6 quarantine; UX_SPEC §5.6; AMENDMENTS-016 B108/B109 queue → P7-S2): listing
 * them, putting one back (Try restore), and deleting one for good (Discard — the UI confirms first).
 *
 * A copy lives under `tc.quarantine.<domain>.<ISO>` exactly as it was stored (raw text). A "stuck" copy is
 * one the storage module couldn't copy aside (storage full): it is still at the domain's own key.
 *
 * Origin (AMENDMENTS-016 B125(b)): a copy is either this browser's own data that failed to load (stored
 * bare, as above — every copy written before origins existed reads as this) or an unreadable part of an
 * imported backup file, stored wrapped with where it came from:
 *   { format: "terraria-companion-set-aside", v: 1, origin: { kind: "import", fileName, exportedAt }, raw }
 * so a file's bad part is never shown as damage to this browser's data. `raw` is the part's text.
 *
 * Restoring re-reads the copy through the same decoder as every load (decodeRaw), so it succeeds exactly
 * when a load would accept it — e.g. after an app update that added the migration it needed. A copy that
 * still can't be read stays set aside. When the domain holds data saved since, the caller picks merge
 * (./merge.ts rule: this browser's versions win) or replace — the result says what each would do; a merge
 * that had to keep this browser's version of something keeps the copy too, so nothing in it is lost unseen.
 * A restore that would leave the data as it is (an identical copy, an empty merge) writes nothing and says
 * so (`changed: false`, B125(a)).
 */
import { listKeys, resolveBackend, stuckKeys } from './backend'
import { emitStorage } from './events'
import { decodeRaw, freeQuarantineKey, isDomainKey, loadDomain, QUARANTINE_PREFIX, saveDomain, storageKey, type DecodeFailure, type DomainData, type DomainKey } from './index'
import { canMerge, contentChanged, isEmptyData, mergeDomain, type MergeMode, type MergeReport } from './merge'
import type { StorageBackend } from './types'

/** Where a set-aside copy came from: this browser's own saved data, or a part of an imported backup file. */
export type QuarantineOrigin = { kind: 'local' } | { kind: 'import'; fileName: string | null; exportedAt: string }

export const LOCAL_ORIGIN: QuarantineOrigin = { kind: 'local' }
export const SET_ASIDE_FORMAT = 'terraria-companion-set-aside'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const hasExactly = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k))

/** The text stored for a copy: bare for this browser's own data, wrapped with its origin for an imported part. */
export function wrapCopy(raw: string, origin: QuarantineOrigin): string {
  return origin.kind === 'local' ? raw : JSON.stringify({ format: SET_ASIDE_FORMAT, v: 1, origin, raw })
}

/** A stored copy's text and origin: anything that isn't exactly the v1 wrapper is a local copy, as stored. */
export function unwrapCopy(stored: string): { raw: string; origin: QuarantineOrigin } {
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return { raw: stored, origin: LOCAL_ORIGIN }
  }
  if (isRecord(value) && hasExactly(value, ['format', 'v', 'origin', 'raw']) && value.format === SET_ASIDE_FORMAT && value.v === 1 && typeof value.raw === 'string') {
    const o = value.origin
    if (isRecord(o) && hasExactly(o, ['kind', 'fileName', 'exportedAt']) && o.kind === 'import' && (o.fileName === null || typeof o.fileName === 'string') && typeof o.exportedAt === 'string' && !Number.isNaN(Date.parse(o.exportedAt))) {
      return { raw: value.raw, origin: { kind: 'import', fileName: o.fileName, exportedAt: o.exportedAt } }
    }
  }
  return { raw: stored, origin: LOCAL_ORIGIN }
}

export interface QuarantineRecord {
  /** The key holding the copy: `tc.quarantine.<domain>.<ISO>`, or the domain's own key when stuck. */
  key: string
  domain: DomainKey
  /** When it was set aside (ISO), from the key; null for a stuck copy. */
  at: string | null
  /** The copy's text (an imported part's, unwrapped). */
  raw: string
  /** Where it came from (B125(b)). */
  origin: QuarantineOrigin
  /** Couldn't be copied aside: it is still at the domain's own key. */
  stuck: boolean
}

/** The copy at `key` (a set-aside key, unwrapped; or a stuck domain key, as stored), or null when it is gone. */
function readCopy(store: StorageBackend, key: string, domain: DomainKey): { raw: string; origin: QuarantineOrigin } | null {
  const stored = store.getItem(key)
  if (stored === null) return null
  return key === storageKey(domain) ? { raw: stored, origin: LOCAL_ORIGIN } : unwrapCopy(stored)
}

/** `tc.quarantine.<domain>.<ISO>` → its parts, or null for any other key. */
export function parseQuarantineKey(key: string): { domain: DomainKey; at: string } | null {
  if (!key.startsWith(QUARANTINE_PREFIX)) return null
  const rest = key.slice(QUARANTINE_PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot < 1) return null
  const domain = rest.slice(0, dot)
  const at = rest.slice(dot + 1)
  if (!isDomainKey(domain) || Number.isNaN(Date.parse(at))) return null
  return { domain, at }
}

/**
 * Every set-aside copy on `backend`, oldest first, then any stuck payload still in place; null when the
 * backend can't list its keys.
 */
export function listQuarantine(backend?: StorageBackend | null): QuarantineRecord[] | null {
  const store = resolveBackend(backend)
  const keys = listKeys(store)
  if (!store || keys === null) return null
  const records: QuarantineRecord[] = []
  for (const key of keys) {
    const parsed = parseQuarantineKey(key)
    if (!parsed) continue
    const copy = readCopy(store, key, parsed.domain)
    if (copy !== null) records.push({ key, domain: parsed.domain, at: parsed.at, raw: copy.raw, origin: copy.origin, stuck: false })
  }
  records.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.key.localeCompare(b.key))
  const stuck = stuckKeys(store)
  for (const key of [...stuck]) {
    const domain = domainOfCopy(key)
    const raw = domain ? store.getItem(key) : null
    // Only while it is still unreadable: once it reads (or is gone) it is no longer a set-aside copy.
    if (domain && raw !== null && !decodeRaw(domain, raw).ok) records.push({ key, domain, at: null, raw, origin: LOCAL_ORIGIN, stuck: true })
    else stuck.delete(key)
  }
  return records
}

/** The domain a copy's key belongs to (set-aside or stuck), or null. */
export function domainOfCopy(key: string): DomainKey | null {
  const parsed = parseQuarantineKey(key)
  if (parsed) return parsed.domain
  const domain = key.startsWith('tc.v1.') ? key.slice('tc.v1.'.length) : ''
  return isDomainKey(domain) ? domain : null
}

/**
 * Writes `raw` aside under a free `tc.quarantine.<domain>.<ISO>` key without touching the domain's own
 * data (an import's unreadable part — pass its `origin`). Returns the key; throws if storage refuses the write.
 */
export function setAside(domain: DomainKey, raw: string, backend?: StorageBackend | null, now: Date = new Date(), origin: QuarantineOrigin = LOCAL_ORIGIN): string {
  const store = resolveBackend(backend)
  if (!store) throw new Error('localStorage unavailable')
  const key = freeQuarantineKey(store, domain, now)
  store.setItem(key, wrapCopy(raw, origin))
  emitStorage({ type: 'quarantine', domain }, store)
  return key
}

/** Deletes a copy for good (the UI confirms first). Returns false if it was already gone or couldn't be removed. */
export function discardQuarantine(key: string, backend?: StorageBackend | null): boolean {
  const store = resolveBackend(backend)
  const domain = domainOfCopy(key)
  if (!store || !domain) return false
  try {
    if (store.getItem(key) === null) return false
    store.removeItem(key)
  } catch {
    return false
  }
  stuckKeys(store).delete(key)
  emitStorage({ type: 'quarantine', domain }, store)
  // A stuck copy sat at the domain's own key: its store reads the (now empty) domain again.
  if (key === storageKey(domain)) emitStorage({ type: 'changed', domains: [domain] }, store)
  return true
}

/** What restoring a copy would meet: can it be read now, and does the domain hold data to merge with? */
export type RestoreCheck =
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'unreadable'; failure: DecodeFailure }
  | { ok: true; domain: DomainKey; v: number; currentHasData: boolean; mergeable: boolean }

export function checkRestore(key: string, backend?: StorageBackend | null): RestoreCheck {
  const store = resolveBackend(backend)
  const domain = domainOfCopy(key)
  const copy = store && domain ? readCopy(store, key, domain) : null
  if (!store || !domain || copy === null) return { ok: false, reason: 'gone' }
  const decoded = decodeRaw(domain, copy.raw)
  if (!decoded.ok) return { ok: false, reason: 'unreadable', failure: decoded.failure }
  const current = key === storageKey(domain) ? null : currentData(domain, store)
  return { ok: true, domain, v: decoded.v, currentHasData: current !== null, mergeable: canMerge(domain) }
}

export type RestoreResult =
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'unreadable'; failure: DecodeFailure }
  /**
   * The domain holds data saved since: the caller must choose merge (where possible) or replace. Carries
   * both sides and what a merge would do, so each choice can state its effect (B125(f)).
   */
  | { ok: false; reason: 'needs-choice'; mergeable: boolean; current: DomainData<DomainKey>; incoming: DomainData<DomainKey>; merge: MergeReport | null }
  | { ok: false; reason: 'save-failed'; message: string }
  /** `changed`: whether the domain's data is different now (false: identical, or nothing new — nothing written). */
  | { ok: true; domain: DomainKey; how: 'restored' | 'merged' | 'replaced'; report?: MergeReport; changed: boolean; keptCopy: boolean }

/** The domain's current data when it holds something (an unreadable payload there is set aside first, as on any load). */
function currentData<K extends DomainKey>(domain: K, store: StorageBackend): DomainData<K> | null {
  const loaded = loadDomain(domain, store)
  return loaded.kind === 'loaded' && !isEmptyData(domain, loaded.data) ? loaded.data : null
}

/**
 * Puts the copy at `key` back as its domain's data. `mode` is needed only when the domain holds data
 * saved since (see `checkRestore`); without it the result asks for a choice and nothing changes.
 */
export function restoreQuarantine(key: string, mode: MergeMode | null, backend?: StorageBackend | null, now: Date = new Date()): RestoreResult {
  const store = resolveBackend(backend)
  const domain = domainOfCopy(key)
  const copy = store && domain ? readCopy(store, key, domain) : null
  if (!store || !domain || copy === null) return { ok: false, reason: 'gone' }
  const decoded = decodeRaw(domain, copy.raw)
  if (!decoded.ok) return { ok: false, reason: 'unreadable', failure: decoded.failure }

  if (key === storageKey(domain)) {
    // A stuck copy that reads now is simply the domain's data again: its store re-reads it.
    stuckKeys(store).delete(key)
    emitStorage({ type: 'changed', domains: [domain] }, store)
    emitStorage({ type: 'quarantine', domain }, store)
    return { ok: true, domain, how: 'restored', changed: true, keptCopy: false }
  }

  const current = currentData(domain, store)
  let data = decoded.data
  let how: 'restored' | 'merged' | 'replaced' = 'restored'
  let report: MergeReport | undefined
  if (current !== null) {
    const mergeable = canMerge(domain)
    if (mode === null || (mode === 'merge' && !mergeable)) {
      return { ok: false, reason: 'needs-choice', mergeable, current, incoming: decoded.data, merge: mergeable ? mergeDomain(domain, current, decoded.data).report : null }
    }
    if (mode === 'merge') {
      const merged = mergeDomain(domain, current, decoded.data)
      data = merged.data
      report = merged.report
      how = 'merged'
    } else how = 'replaced'
  }
  // Nothing different (an identical copy, an empty merge): nothing is written (B125(a)).
  const changed = contentChanged(domain, current, data)
  if (changed) {
    try {
      saveDomain(domain, data, store, now)
    } catch (error) {
      return { ok: false, reason: 'save-failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  // Anything in the copy that wasn't applied (this browser's version kept) keeps the copy set aside.
  const keptCopy = report !== undefined && report.kept > 0
  if (!keptCopy) {
    try {
      store.removeItem(key)
    } catch {
      // Restored but the copy couldn't be removed: it stays listed; harmless.
    }
  }
  if (changed) emitStorage({ type: 'changed', domains: [domain] }, store)
  emitStorage({ type: 'quarantine', domain }, store)
  return { ok: true, domain, how, ...(report ? { report } : {}), changed, keptCopy }
}
