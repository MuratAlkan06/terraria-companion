/** Versioned persistence envelope (ADR D6, DATA_SCHEMA_SPEC §8a). */
export interface Envelope<T> {
  v: number
  savedAt: string
  gameVersion: string
  data: T
}

/** Per-domain definition: current version, migration chain, strict parser. */
export interface DomainDef<T> {
  /** Current schema version written by saveDomain. */
  version: number
  /** `migrations[i]` migrates payload data from v(i+1) to v(i+2). Length must be version - 1. */
  migrations: ReadonlyArray<(prev: unknown) => unknown>
  /** Strict parse of the current-version data; throws on any mismatch. */
  parse: (data: unknown) => T
}

/** Minimal Storage surface so the engine is swappable (ADR D6) and testable. */
export type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type LoadResult<T> =
  | { kind: 'loaded'; data: T; migratedFrom?: number }
  | { kind: 'quarantined'; key: string }
  | { kind: 'empty' }
