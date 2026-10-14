/**
 * Local persistence module (ADR D6, DATA_SCHEMA_SPEC §4b/§8).
 *
 * - Namespaced keys `tc.v1.<domain>`, versioned envelope `{ v, savedAt, gameVersion, data }`.
 * - Reads run the domain's migration chain, then a strict parse.
 * - Corrupt or unmigratable payloads are moved to `tc.quarantine.<domain>.<ISO>` —
 *   set aside, never silently deleted.
 * - Writes are a single atomic `setItem`; failures throw `StorageQuotaError` so callers
 *   can keep state in memory and warn.
 *
 * Registered: `settings` (P1), `recent` (P2-S3), `progress` (P5-S1). Later slices add their
 * domains to `DOMAINS` (builds, favorites, plans, readiness, checklists).
 */
import { meta } from '../data/meta'
import { progressDomain, type ProgressData } from './progress'
import { recentDomain, type RecentData } from './recent'
import { settingsDomain, type SettingsData } from './settings'
import type { DomainDef, Envelope, LoadResult, StorageBackend } from './types'

export type { Envelope, LoadResult, StorageBackend } from './types'

/** Domain key -> current data shape. Extend as later slices add domains. */
interface DomainDataMap {
  settings: SettingsData
  recent: RecentData
  progress: ProgressData
}

export type DomainKey = keyof DomainDataMap
export type DomainData<K extends DomainKey> = DomainDataMap[K]

const DOMAINS: { [K in DomainKey]: DomainDef<DomainDataMap[K]> } = {
  settings: settingsDomain,
  recent: recentDomain,
  progress: progressDomain,
}

export const storageKey = (domain: DomainKey): string => `tc.v1.${domain}`
export const quarantineKey = (domain: DomainKey, at: Date): string =>
  `tc.quarantine.${domain}.${at.toISOString()}`

export class StorageQuotaError extends Error {
  readonly domain: DomainKey
  constructor(domain: DomainKey, cause: unknown) {
    super(`Could not save "${domain}" to local storage`, { cause })
    this.name = 'StorageQuotaError'
    this.domain = domain
  }
}

/** localStorage, or null when unavailable (SSR/tests, privacy modes that throw on access). */
function defaultBackend(): StorageBackend | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const ENVELOPE_KEYS = ['v', 'savedAt', 'gameVersion', 'data'] as const

function readEnvelope(raw: string): Envelope<unknown> {
  const parsed: unknown = JSON.parse(raw)
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

function quarantine(
  backend: StorageBackend,
  domain: DomainKey,
  raw: string,
  reason: unknown,
  now: Date,
): LoadResult<never> {
  const key = storageKey(domain)
  const target = quarantineKey(domain, now)
  try {
    backend.setItem(target, raw)
    backend.removeItem(key)
    console.warn(`[storage] "${key}" could not be read and was set aside under "${target}".`, reason)
    return { kind: 'quarantined', key: target }
  } catch {
    // Could not copy it aside: leave the original untouched rather than lose it.
    console.warn(`[storage] "${key}" could not be read; left in place (quarantine copy failed).`, reason)
    return { kind: 'quarantined', key }
  }
}

export function loadDomain<K extends DomainKey>(
  domain: K,
  backend: StorageBackend | null = defaultBackend(),
  now: Date = new Date(),
): LoadResult<DomainData<K>> {
  if (!backend) return { kind: 'empty' }
  const def: DomainDef<DomainData<K>> = DOMAINS[domain]

  let raw: string | null
  try {
    raw = backend.getItem(storageKey(domain))
  } catch {
    return { kind: 'empty' }
  }
  if (raw === null) return { kind: 'empty' }

  try {
    const envelope = readEnvelope(raw)
    if (envelope.v > def.version) {
      throw new RangeError(`envelope.v ${envelope.v} is newer than supported v${def.version}`)
    }
    const migrated = def.migrations.slice(envelope.v - 1).reduce((data, migrate) => migrate(data), envelope.data)
    const data = def.parse(migrated)
    return envelope.v < def.version ? { kind: 'loaded', data, migratedFrom: envelope.v } : { kind: 'loaded', data }
  } catch (reason) {
    return quarantine(backend, domain, raw, reason, now)
  }
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
