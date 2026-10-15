/**
 * Backups (P7-S2): one JSON file holding the chosen `tc.v1.*` domains, and reading one back.
 *
 * File format (versioned envelope; strict — any other shape is "not a backup"):
 *   { format: "terraria-companion-backup", v: 1, exportedAt, app, appVersion, gameVersion,
 *     domains: { <domain>: { v, savedAt, gameVersion, data } } }
 * Each domain entry is the ADR D6 envelope this app stores, re-encoded at the domain's current version
 * (its own savedAt and gameVersion kept). Nothing leaves the browser: the file is built in memory and the
 * page hands it to the browser as a download.
 *
 * Reading a backup validates every part with the decoder every load uses (decodeEnvelope: version check,
 * migrations, strict parse — the hand-written validators whose parity with the Zod `*V1/V2` schemas is
 * pinned in each domain's tests), so an imported part is accepted exactly when a later load would accept
 * it. A file of a newer backup format is rejected whole, saying so; a PART written by a newer app version
 * (or failing validation) is unreadable — applying the import sets it aside (tc.quarantine.*, the same
 * notice and actions as any other set-aside copy), never drops it silently. Domains this version doesn't
 * know are listed and skipped.
 *
 * Applying is per domain (merge / replace / skip — ./merge.ts), each saved through saveDomain; every
 * outcome is reported, including a part storage refused. A part whose merge or replace would leave the
 * data as it is (identical, or nothing new) is not written and is reported `changed: false` — only content
 * changes count as changes (AMENDMENTS-016 B125(a)). An unreadable part's set-aside copy records its origin
 * (the file's name and date, B125(b)). Stores refresh through the ./events bus.
 *
 * P7-S2b (AMENDMENTS-016 B123(a)): ONE build as text — its `#code:` line, encoded and read back through the
 * same load path (see "One build as text" below).
 */
import { meta } from '../data/meta'
import { resolveBackend } from './backend'
import type { SavedBuild } from './builds'
import { emitStorage } from './events'
import { decodeEnvelope, decodeRaw, DOMAIN_KEYS, domainVersion, isDomainKey, loadDomain, saveDomain, storageKey, type DecodeFailure, type Decoded, type DomainData, type DomainKey, type Envelope } from './index'
import { canMerge, canonicalJson, contentChanged, isEmptyData, mergeDomain, type MergeReport } from './merge'
import { setAside } from './quarantine'
import type { StorageBackend } from './types'

export { canonicalJson }

export const BACKUP_FORMAT = 'terraria-companion-backup'
/** The backup format this version writes and reads. */
export const BACKUP_VERSION = 1
/** Larger than anything this site can store in one browser (localStorage holds ~5 MB). */
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024

const FILE_KEYS = ['format', 'v', 'exportedAt', 'app', 'appVersion', 'gameVersion', 'domains'] as const

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  v: number
  exportedAt: string
  /** The app that wrote it (site name) and its version (package.json). */
  app: string
  appVersion: string
  /** The game data version the app was pinned to when it wrote the file (meta.json). */
  gameVersion: string
  domains: Partial<Record<DomainKey, Envelope<unknown>>>
}

/** Why a domain asked for wasn't put in the backup. */
export type ExportSkip = { domain: DomainKey; reason: 'nothing-saved' } | { domain: DomainKey; reason: 'unreadable'; failure: DecodeFailure }

export interface BackupBuild {
  file: BackupFile
  /** The file's text (pretty-printed). */
  json: string
  included: DomainKey[]
  skipped: ExportSkip[]
}

export interface BackupMeta {
  now?: Date
  app: string
  appVersion: string
  gameVersion: string
}

/** A backup of `domains` (DOMAIN_KEYS order) as stored on `backend`. Read-only: storage is never changed. */
export function createBackup(domains: readonly DomainKey[], meta: BackupMeta, backend?: StorageBackend | null): BackupBuild {
  const store = resolveBackend(backend)
  const now = meta.now ?? new Date()
  const file: BackupFile = { format: BACKUP_FORMAT, v: BACKUP_VERSION, exportedAt: now.toISOString(), app: meta.app, appVersion: meta.appVersion, gameVersion: meta.gameVersion, domains: {} }
  const included: DomainKey[] = []
  const skipped: ExportSkip[] = []
  for (const domain of DOMAIN_KEYS.filter((d) => domains.includes(d))) {
    let raw: string | null = null
    try {
      raw = store?.getItem(storageKey(domain)) ?? null
    } catch {
      raw = null
    }
    if (raw === null) {
      skipped.push({ domain, reason: 'nothing-saved' })
      continue
    }
    const decoded = decodeRaw(domain, raw)
    if (!decoded.ok) {
      skipped.push({ domain, reason: 'unreadable', failure: decoded.failure })
      continue
    }
    file.domains[domain] = { v: domainVersion(domain), savedAt: decoded.savedAt, gameVersion: decoded.gameVersion, data: decoded.data }
    included.push(domain)
  }
  return { file, json: `${JSON.stringify(file, null, 2)}\n`, included, skipped }
}

/** `terraria-companion-backup-YYYY-MM-DD.json` (the user's local date). */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${BACKUP_FORMAT}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

// ---------------------------------------------------------------------------------------------
// Reading a backup

export type BackupReadError =
  | { kind: 'empty' }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'not-json'; message: string }
  | { kind: 'not-backup'; message: string }
  /** A newer backup format: nothing in it is read. */
  | { kind: 'future-version'; version: number; supported: number }

export type BackupPart =
  | { domain: DomainKey; status: 'valid'; data: DomainData<DomainKey>; v: number; savedAt: string; gameVersion: string }
  | { domain: DomainKey; status: 'invalid'; raw: string; failure: DecodeFailure }

export interface BackupContents {
  /** The name of the file it was read from, when known (recorded with any part set aside from it). */
  fileName: string | null
  v: number
  exportedAt: string
  app: string
  appVersion: string
  gameVersion: string
  /** Known domains in DOMAIN_KEYS order. */
  parts: BackupPart[]
  /** Domain names this version doesn't know (skipped). */
  unknown: string[]
}

export type BackupRead = { ok: true; backup: BackupContents } | { ok: false; error: BackupReadError }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isIsoDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))

export function readBackup(text: string, fileName: string | null = null): BackupRead {
  const bytes = byteLength(text)
  if (bytes > BACKUP_MAX_BYTES) return { ok: false, error: { kind: 'too-large', bytes } }
  if (text.trim() === '') return { ok: false, error: { kind: 'empty' } }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: { kind: 'not-json', message: error instanceof Error ? error.message : String(error) } }
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) return { ok: false, error: { kind: 'not-backup', message: `format: expected "${BACKUP_FORMAT}"` } }
  const { v } = value
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, error: { kind: 'not-backup', message: 'v: expected a positive integer' } }
  // Checked before the shape: a newer format may have a different one.
  if (v > BACKUP_VERSION) return { ok: false, error: { kind: 'future-version', version: v, supported: BACKUP_VERSION } }
  const keys = Object.keys(value)
  const unexpected = keys.filter((k) => !(FILE_KEYS as readonly string[]).includes(k))
  const missing = FILE_KEYS.filter((k) => !keys.includes(k))
  if (unexpected.length > 0 || missing.length > 0) {
    return { ok: false, error: { kind: 'not-backup', message: [unexpected.length ? `unexpected ${unexpected.join(', ')}` : '', missing.length ? `missing ${missing.join(', ')}` : ''].filter(Boolean).join('; ') } }
  }
  const { exportedAt, app, appVersion, gameVersion, domains } = value
  if (!isIsoDate(exportedAt)) return { ok: false, error: { kind: 'not-backup', message: 'exportedAt: expected a date-time' } }
  if (typeof app !== 'string' || typeof appVersion !== 'string' || typeof gameVersion !== 'string') {
    return { ok: false, error: { kind: 'not-backup', message: 'app, appVersion, gameVersion: expected text' } }
  }
  if (!isRecord(domains)) return { ok: false, error: { kind: 'not-backup', message: 'domains: expected an object' } }

  const parts: BackupPart[] = []
  for (const domain of DOMAIN_KEYS) {
    if (!Object.hasOwn(domains, domain)) continue
    const entry = domains[domain]
    const decoded = decodeEnvelope(domain, entry)
    parts.push(decoded.ok ? { domain, status: 'valid', data: decoded.data, v: decoded.v, savedAt: decoded.savedAt, gameVersion: decoded.gameVersion } : { domain, status: 'invalid', raw: JSON.stringify(entry) ?? 'undefined', failure: decoded.failure })
  }
  const unknown = Object.keys(domains).filter((d) => !isDomainKey(d))
  return { ok: true, backup: { fileName, v, exportedAt, app, appVersion, gameVersion, parts, unknown } }
}

// ---------------------------------------------------------------------------------------------
// Applying a backup

export type ImportChoice = 'merge' | 'replace' | 'skip'

/** This browser's data for `domain` when it holds any (an unreadable payload there is set aside first, as on any load). */
export function currentDomainData<K extends DomainKey>(domain: K, backend?: StorageBackend | null): DomainData<K> | null {
  const loaded = loadDomain(domain, resolveBackend(backend))
  return loaded.kind === 'loaded' && !isEmptyData(domain, loaded.data) ? loaded.data : null
}

/**
 * The choice offered first: nothing here → take the file's; mergeable → merge (never loses anything
 * here); a single record already set here → keep it (replacing is the user's explicit pick).
 */
export function defaultChoice(domain: DomainKey, currentHasData: boolean): ImportChoice {
  if (!currentHasData) return 'replace'
  return canMerge(domain) ? 'merge' : 'skip'
}

/**
 * `changed` (imported / merged / replaced): whether this browser's data for the part is different now. False
 * when the result would equal what was here (identical data, an empty merge, an empty part into nothing) —
 * then nothing was written.
 */
export type ImportOutcome =
  /** Nothing was here: the file's data is now this browser's. */
  | { domain: DomainKey; outcome: 'imported'; changed: boolean }
  | { domain: DomainKey; outcome: 'merged'; report: MergeReport; changed: boolean }
  | { domain: DomainKey; outcome: 'replaced'; changed: boolean }
  | { domain: DomainKey; outcome: 'skipped' }
  /** Unreadable in the file: set aside under `key`, not imported. */
  | { domain: DomainKey; outcome: 'set-aside'; key: string; failure: DecodeFailure }
  /** Storage refused the write: nothing changed for this domain. */
  | { domain: DomainKey; outcome: 'failed'; message: string; failure?: DecodeFailure }

/**
 * Applies `backup` part by part with `choices` (absent = defaultChoice). Unreadable parts are always set
 * aside (never applied, never dropped). Returns one outcome per part, in DOMAIN_KEYS order.
 */
export function applyBackup(backup: BackupContents, choices: Partial<Record<DomainKey, ImportChoice>>, backend?: StorageBackend | null, now: Date = new Date()): ImportOutcome[] {
  const store = resolveBackend(backend)
  const outcomes: ImportOutcome[] = []
  const changed: DomainKey[] = []
  const origin = { kind: 'import', fileName: backup.fileName, exportedAt: backup.exportedAt } as const
  for (const part of backup.parts) {
    const { domain } = part
    if (part.status === 'invalid') {
      try {
        outcomes.push({ domain, outcome: 'set-aside', key: setAside(domain, part.raw, store, now, origin), failure: part.failure })
      } catch (error) {
        outcomes.push({ domain, outcome: 'failed', message: error instanceof Error ? error.message : String(error), failure: part.failure })
      }
      continue
    }
    const current = currentDomainData(domain, store)
    const choice = choices[domain] ?? defaultChoice(domain, current !== null)
    if (choice === 'skip') {
      outcomes.push({ domain, outcome: 'skipped' })
      continue
    }
    let data = part.data
    let report: MergeReport | null = null
    if (current !== null && choice === 'merge') {
      if (!canMerge(domain)) {
        // A caller bug (single records offer replace/keep only): keep this browser's record.
        outcomes.push({ domain, outcome: 'skipped' })
        continue
      }
      const merged = mergeDomain(domain, current, part.data)
      data = merged.data
      report = merged.report
    }
    // Only a content change is written and counted (B125(a)): an identical rewrite or an empty merge is not.
    const isChange = contentChanged(domain, current, data)
    const outcome: ImportOutcome = report ? { domain, outcome: 'merged', report, changed: isChange } : { domain, outcome: current === null ? 'imported' : 'replaced', changed: isChange }
    if (!isChange) {
      outcomes.push(outcome)
      continue
    }
    try {
      saveDomain(domain, data, store, now)
      outcomes.push(outcome)
      changed.push(domain)
    } catch (error) {
      outcomes.push({ domain, outcome: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }
  if (changed.length > 0) emitStorage({ type: 'changed', domains: changed }, store)
  return outcomes
}

/** One domain as stored, for the data page: size, last save, contents. Read-only (nothing is set aside here). */
export type StoredDomain =
  | { domain: DomainKey; state: 'none' }
  | { domain: DomainKey; state: 'readable'; bytes: number; savedAt: string; data: DomainData<DomainKey> }
  | { domain: DomainKey; state: 'unreadable'; bytes: number; failure: DecodeFailure }

export const byteLength = (text: string): number => new TextEncoder().encode(text).length

export function readStored(domain: DomainKey, backend?: StorageBackend | null): StoredDomain {
  let raw: string | null = null
  try {
    raw = resolveBackend(backend)?.getItem(storageKey(domain)) ?? null
  } catch {
    raw = null
  }
  if (raw === null) return { domain, state: 'none' }
  const decoded = decodeRaw(domain, raw)
  return decoded.ok ? { domain, state: 'readable', bytes: byteLength(raw), savedAt: decoded.savedAt, data: decoded.data } : { domain, state: 'unreadable', bytes: byteLength(raw), failure: decoded.failure }
}

/** Deletes one domain's saved data (the data page's Clear — the UI confirms first). Returns whether it was removed. */
export function clearDomain(domain: DomainKey, backend?: StorageBackend | null): boolean {
  const store = resolveBackend(backend)
  if (!store) return false
  try {
    store.removeItem(storageKey(domain))
  } catch {
    return false
  }
  emitStorage({ type: 'changed', domains: [domain] }, store)
  return true
}

// ---------------------------------------------------------------------------------------------
// One build as text (P7-S2b; ADR D6 export/import; AMENDMENTS-016 B123(a))
//
// A build's text is a readable block (written by the builder, src/app/routes/loadout/buildText.ts) ending
// in ONE `#code:` line — the only part an import reads:
//
//   #code: tcb.<v>.<payload>.<check>
//     tcb      this site's build code
//     v        the saved-build version it was written at (tc.v1.builds' version — 2, B106)
//     payload  base64url (no padding) of the UTF-8 canonical JSON (keys sorted, no spaces) of
//              { build: <the SavedBuild minus buildId, createdAt, updatedAt>, gameVersion }
//     check    FNV-1a 32-bit of "tcb.<v>.<payload>", 8 hex digits: a code cut short or changed says so
//              instead of importing something else
//
// Deterministic: the same build at the same game-data version always gives the same code. Reading one
// runs the load path (decodeEnvelope: version check, migrations, the strict parse whose Zod parity is
// pinned), so a code imports exactly when a load of that build would succeed (B123(b)).

/** A saved build without this browser's identity (its id and timestamps): what a build code carries. */
export type BuildRecord = Omit<SavedBuild, 'buildId' | 'createdAt' | 'updatedAt'>

export const BUILD_CODE_LINE = '#code:'
export const BUILD_CODE_TAG = 'tcb'

const LOCAL_FIELDS = ['buildId', 'createdAt', 'updatedAt'] as const
/** Stand-ins for the local fields while a build goes through the load path (never stored or shown). */
const STAND_IN = { buildId: 'imported', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' } as const
const CODE_PAYLOAD_KEYS = ['build', 'gameVersion'] as const

// canonicalJson (keys sorted, no whitespace) lives in ./merge (content comparisons) and is re-exported above.

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** FNV-1a 32-bit over ASCII text, as 8 hex digits: a build code's check over "tcb.<v>.<payload>". */
export const buildCodeCheck = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

/** One build through the load path (`v` = the version it claims); the build back without the stand-ins. */
function decodeBuild(v: number, gameVersion: string, build: Record<string, unknown>): Decoded<BuildRecord> {
  const local = LOCAL_FIELDS.filter((k) => Object.hasOwn(build, k))
  if (local.length > 0) return { ok: false, failure: { kind: 'invalid', message: `build: unexpected keys ${local.join(', ')}`, version: v } }
  const decoded = decodeEnvelope('builds', { v, savedAt: STAND_IN.createdAt, gameVersion, data: { builds: [{ ...build, ...STAND_IN }] } })
  if (!decoded.ok) return decoded
  const { buildId: _id, createdAt: _created, updatedAt: _updated, ...record } = decoded.data.builds[0]
  return { ok: true, data: record, v: decoded.v, savedAt: decoded.savedAt, gameVersion: decoded.gameVersion }
}

/** The record part of a saved build (drops its id and timestamps). */
export function buildRecordOf(build: SavedBuild | BuildRecord): BuildRecord {
  const { buildId: _id, createdAt: _created, updatedAt: _updated, ...record } = build as SavedBuild
  return record
}

/** Whether two builds hold the same thing (name, inputs, slots, markers) — their ids and dates aside. */
export const sameBuild = (a: SavedBuild | BuildRecord, b: SavedBuild | BuildRecord): boolean => canonicalJson(buildRecordOf(a)) === canonicalJson(buildRecordOf(b))

/**
 * The build code of `build` (without its `#code: ` lead). Validated first, like saveDomain: a build this
 * site couldn't read back throws instead of being encoded.
 */
export function encodeBuildCode(build: SavedBuild | BuildRecord, gameVersion: string = meta.gameVersion): string {
  const v = domainVersion('builds')
  const checked = decodeBuild(v, gameVersion, { ...buildRecordOf(build) })
  if (!checked.ok) throw new TypeError(`Not a valid build: ${checked.failure.message}`)
  const payload = toBase64Url(new TextEncoder().encode(canonicalJson({ build: checked.data, gameVersion })))
  const body = `${BUILD_CODE_TAG}.${v}.${payload}`
  return `${body}.${buildCodeCheck(body)}`
}

/** The `#code:` line of a build text. */
export const buildCodeLine = (code: string): string => `${BUILD_CODE_LINE} ${code}`

/** Why a pasted text isn't a build this version can read. */
export type BuildCodeError =
  | { kind: 'empty' }
  /** No `#code:` line (and not a bare code): not a build text from this site. */
  | { kind: 'no-code' }
  /** More than one different `#code:` line: which build is meant isn't clear. */
  | { kind: 'several-codes'; count: number }
  /** The code is cut short or changed (its shape, check, encoding or JSON doesn't hold). */
  | { kind: 'damaged' }
  /** Written by a newer version of the site (a newer saved-build version than this one reads). */
  | { kind: 'future-version'; version: number; supported: number }
  /** The code reads, but the build in it fails the checks every load runs. */
  | { kind: 'invalid'; failure: DecodeFailure }

export type BuildCodeRead = { ok: true; build: BuildRecord; v: number; gameVersion: string } | { ok: false; error: BuildCodeError }

const CODE_SHAPE = /^tcb\.(\d+)\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/

/**
 * Reads a pasted build text — the whole block or just its `#code:` line (a bare code too). Only the code
 * is read: the readable lines above it are for people. Pure; nothing is saved.
 */
export function readBuildText(text: string): BuildCodeRead {
  const fail = (error: BuildCodeError): BuildCodeRead => ({ ok: false, error })
  if (text.trim() === '') return fail({ kind: 'empty' })
  const lead = BUILD_CODE_LINE.toLowerCase()
  const codes = [
    ...new Set(
      text
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().startsWith(lead))
        .map((line) => line.slice(lead.length).replace(/\s+/g, '')),
    ),
  ]
  if (codes.length > 1) return fail({ kind: 'several-codes', count: codes.length })
  const bare = text.trim().replace(/\s+/g, '')
  const token = codes[0] ?? (bare.startsWith(`${BUILD_CODE_TAG}.`) ? bare : undefined)
  if (token === undefined || !token.startsWith(`${BUILD_CODE_TAG}.`)) return fail({ kind: 'no-code' })
  // The version first: a newer code may differ in everything after it.
  const version = /^tcb\.(\d+)\./.exec(token)
  const v = version ? Number(version[1]) : NaN
  if (!Number.isSafeInteger(v) || v < 1) return fail({ kind: 'damaged' })
  const supported = domainVersion('builds')
  if (v > supported) return fail({ kind: 'future-version', version: v, supported })
  const shape = CODE_SHAPE.exec(token)
  if (!shape || buildCodeCheck(`${BUILD_CODE_TAG}.${shape[1]}.${shape[2]}`) !== shape[3]) return fail({ kind: 'damaged' })
  const bytes = fromBase64Url(shape[2])
  if (!bytes) return fail({ kind: 'damaged' })
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail({ kind: 'damaged' })
  }
  const invalid = (message: string) => fail({ kind: 'invalid', failure: { kind: 'invalid', message, version: v } })
  if (!isRecord(value)) return invalid('code: expected an object')
  const keys = Object.keys(value)
  if (keys.length !== CODE_PAYLOAD_KEYS.length || !CODE_PAYLOAD_KEYS.every((k) => keys.includes(k))) return invalid('code: expected exactly { build, gameVersion }')
  if (typeof value.gameVersion !== 'string') return invalid('code.gameVersion: expected text')
  if (!isRecord(value.build)) return invalid('code.build: expected an object')
  const decoded = decodeBuild(v, value.gameVersion, value.build)
  if (!decoded.ok) return fail({ kind: 'invalid', failure: decoded.failure })
  return { ok: true, build: decoded.data, v, gameVersion: value.gameVersion }
}
