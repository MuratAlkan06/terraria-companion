/**
 * Local persistence module (ADR D6, DATA_SCHEMA_SPEC §4b/§8).
 *
 * - Namespaced keys `tc.v1.<domain>`, versioned envelope `{ v, savedAt, gameVersion, data }`.
 * - Reads run the domain's migration chain, then a strict parse.
 * - Corrupt or unmigratable payloads are moved to `tc.quarantine.<domain>.<ISO>` —
 *   set aside, never silently deleted.
 * - Writes are a single atomic `setItem`; failures throw `StorageQuotaError` so callers
 *   can keep state in memory and warn.
 * - P7-S2: one decoder (`decodeEnvelope`) serves every read — load, import, a restore attempt — so an
 *   imported or restored payload is accepted exactly when a later load would accept it. Set-aside copies
 *   and data changed outside a store are announced on the ./events bus (stores refresh live).
 *
 * Registered: `settings` (P1), `recent` (P2-S3), `progress` (P5-S1), `checklists` (P6-S8, A7),
 * `favorites` (P7-S1), `readiness` (P5-S6/S7, Feature A AC4), `builds` (P4-S2, the loadout builder's
 * saved builds), `plans` (P6-S5/S6, Feature B's acquisition plans).
 */
import { meta } from '../data/meta'
import { defaultBackend, stuckKeys } from './backend'
import { buildsDomain, type BuildsData } from './builds'
import { checklistsDomain, type ChecklistsData } from './checklists'
import { emitStorage } from './events'
import { favoritesDomain, type FavoritesData } from './favorites'
import { plansDomain, type PlansData } from './plans'
import { progressDomain, type ProgressData } from './progress'
import { readinessDomain, type ReadinessSetup } from './readiness'
import { recentDomain, type RecentData } from './recent'
import { settingsDomain, type SettingsData } from './settings'
import type { DomainDef, Envelope, LoadResult, StorageBackend } from './types'

export type { Envelope, LoadResult, StorageBackend } from './types'

/** Domain key -> current data shape. Extend as later slices add domains. */
interface DomainDataMap {
  settings: SettingsData
  recent: RecentData
  progress: ProgressData
  checklists: ChecklistsData
  favorites: FavoritesData
  readiness: ReadinessSetup
  builds: BuildsData
  plans: PlansData
}

export type DomainKey = keyof DomainDataMap
export type DomainData<K extends DomainKey> = DomainDataMap[K]

const DOMAINS: { [K in DomainKey]: DomainDef<DomainDataMap[K]> } = {
  settings: settingsDomain,
  recent: recentDomain,
  progress: progressDomain,
  checklists: checklistsDomain,
  favorites: favoritesDomain,
  readiness: readinessDomain,
  builds: buildsDomain,
  plans: plansDomain,
}

/** Every domain, in the order the data page lists them. */
export const DOMAIN_KEYS: readonly DomainKey[] = ['settings', 'progress', 'builds', 'plans', 'readiness', 'checklists', 'favorites', 'recent']

export const isDomainKey = (value: unknown): value is DomainKey => typeof value === 'string' && Object.hasOwn(DOMAINS, value)

/** The schema version `saveDomain` writes for `domain` (the newest this app reads). */
export const domainVersion = (domain: DomainKey): number => DOMAINS[domain].version

export const storageKey = (domain: DomainKey): string => `tc.v1.${domain}`
export const QUARANTINE_PREFIX = 'tc.quarantine.'
export const quarantineKey = (domain: DomainKey, at: Date): string =>
  `${QUARANTINE_PREFIX}${domain}.${at.toISOString()}`

export class StorageQuotaError extends Error {
  readonly domain: DomainKey
  constructor(domain: DomainKey, cause: unknown) {
    super(`Could not save "${domain}" to local storage`, { cause })
    this.name = 'StorageQuotaError'
    this.domain = domain
  }
}

const ENVELOPE_KEYS = ['v', 'savedAt', 'gameVersion', 'data'] as const

function readEnvelope(parsed: unknown): Envelope<unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('envelope: expected an object')
  }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((k) => keys.includes(k))) {
    throw new TypeError('envelope: expected exactly { v, savedAt, gameVersion, data }')
  }
  const { v, savedAt, gameVersion, data } = record
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new TypeError('envelope.v: expected positive int')
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) {
    throw new TypeError('envelope.savedAt: expected ISO date-time')
  }
  if (typeof gameVersion !== 'string') throw new TypeError('envelope.gameVersion: expected string')
  return { v, savedAt, gameVersion, data }
}

/**
 * Why a stored (or imported) payload couldn't be read: not JSON at all, not the envelope this app writes,
 * written by a newer version of the app (a newer schema than this build knows), or data that fails the
 * domain's strict parse (after its migrations).
 */
export type DecodeFailure =
  | { kind: 'json'; message: string }
  | { kind: 'envelope'; message: string }
  | { kind: 'future-version'; message: string; version: number; supported: number }
  | { kind: 'invalid'; message: string; version: number }

export type Decoded<T> =
  | { ok: true; data: T; v: number; savedAt: string; gameVersion: string }
  | { ok: false; failure: DecodeFailure }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The read path every caller shares (loadDomain, the import, a restore attempt): `value` (a parsed
 * envelope) through the version check, the domain's migration chain, then its strict parse. Pure — it
 * never touches storage. `v` is the envelope's own version (older than current = migrated on read).
 */
export function decodeEnvelope<K extends DomainKey>(domain: K, value: unknown): Decoded<DomainData<K>> {
  const def: DomainDef<DomainData<K>> = DOMAINS[domain]
  let envelope: Envelope<unknown>
  try {
    envelope = readEnvelope(value)
  } catch (error) {
    return { ok: false, failure: { kind: 'envelope', message: messageOf(error) } }
  }
  if (envelope.v > def.version) {
    return { ok: false, failure: { kind: 'future-version', message: `envelope.v ${envelope.v} is newer than supported v${def.version}`, version: envelope.v, supported: def.version } }
  }
  try {
    const migrated = def.migrations.slice(envelope.v - 1).reduce((data, migrate) => migrate(data), envelope.data)
    return { ok: true, data: def.parse(migrated), v: envelope.v, savedAt: envelope.savedAt, gameVersion: envelope.gameVersion }
  } catch (error) {
    return { ok: false, failure: { kind: 'invalid', message: messageOf(error), version: envelope.v } }
  }
}

/** `decodeEnvelope` over stored text (a JSON syntax error is its own failure kind). */
export function decodeRaw<K extends DomainKey>(domain: K, raw: string): Decoded<DomainData<K>> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return { ok: false, failure: { kind: 'json', message: messageOf(error) } }
  }
  return decodeEnvelope(domain, value)
}

/** A free `tc.quarantine.<domain>.<ISO>` key at or after `now` (never overwrites an earlier copy). */
export function freeQuarantineKey(backend: StorageBackend, domain: DomainKey, now: Date): string {
  let at = now.getTime()
  let key = quarantineKey(domain, new Date(at))
  while (backend.getItem(key) !== null) key = quarantineKey(domain, new Date(++at))
  return key
}

function quarantine(
  backend: StorageBackend,
  domain: DomainKey,
  raw: string,
  reason: unknown,
  now: Date,
): LoadResult<never> {
  const key = storageKey(domain)
  try {
    const target = freeQuarantineKey(backend, domain, now)
    backend.setItem(target, raw)
    backend.removeItem(key)
    console.warn(`[storage] "${key}" could not be read and was set aside under "${target}".`, reason)
    emitStorage({ type: 'quarantine', domain }, backend)
    return { kind: 'quarantined', key: target }
  } catch {
    // Could not copy it aside: leave the original untouched rather than lose it.
    console.warn(`[storage] "${key}" could not be read; left in place (quarantine copy failed).`, reason)
    stuckKeys(backend).add(key)
    emitStorage({ type: 'quarantine', domain }, backend)
    return { kind: 'quarantined', key }
  }
}

export function loadDomain<K extends DomainKey>(
  domain: K,
  backend: StorageBackend | null = defaultBackend(),
  now: Date = new Date(),
): LoadResult<DomainData<K>> {
  if (!backend) return { kind: 'empty' }

  let raw: string | null
  try {
    raw = backend.getItem(storageKey(domain))
  } catch {
    return { kind: 'empty' }
  }
  if (raw === null) return { kind: 'empty' }

  const decoded = decodeRaw(domain, raw)
  if (!decoded.ok) return quarantine(backend, domain, raw, decoded.failure, now)
  const current = DOMAINS[domain].version
  return decoded.v < current ? { kind: 'loaded', data: decoded.data, migratedFrom: decoded.v } : { kind: 'loaded', data: decoded.data }
}

export function saveDomain<K extends DomainKey>(
  domain: K,
  data: DomainData<K>,
  backend: StorageBackend | null = defaultBackend(),
  now: Date = new Date(),
): void {
  const def: DomainDef<DomainData<K>> = DOMAINS[domain]
  const envelope: Envelope<DomainData<K>> = {
    v: def.version,
    savedAt: now.toISOString(),
    gameVersion: meta.gameVersion,
    // Validate before writing: never persist a payload we could not read back.
    data: def.parse(data),
  }
  if (!backend) throw new StorageQuotaError(domain, new Error('localStorage unavailable'))
  try {
    backend.setItem(storageKey(domain), JSON.stringify(envelope))
  } catch (cause) {
    throw new StorageQuotaError(domain, cause)
  }
}
