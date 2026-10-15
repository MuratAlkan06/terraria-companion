/**
 * App-side data error taxonomy (DATA_SCHEMA_SPEC §6 "App"). Thrown by the data-access loaders
 * (§4a) and rendered by pages: ChunkLoadError → ErrorState with Retry, NotFoundError → styled
 * 404, DataValidationError → dev-only build/data drift, SchemaVersionError → app/data mismatch.
 */

/** A lazily imported data chunk (or public data file) failed to download or evaluate. */
export class ChunkLoadError extends Error {
  readonly file: string
  /**
   * True when the file is an ES-module chunk (dynamic import). Browsers cache a failed module
   * fetch for the life of the document, so retrying in place re-rejects: Retry must reload.
   * False for plain fetches (e.g. the sprite manifest), which can be retried in place.
   */
  readonly moduleImport: boolean
  constructor(file: string, cause: unknown, moduleImport = true) {
    super(`Could not load data file "${file}"`, { cause })
    this.name = 'ChunkLoadError'
    this.file = file
    this.moduleImport = moduleImport
  }
}

/** The requested record does not exist. `ref` is a TypedRef-style id, e.g. "i:999999". */
export class NotFoundError extends Error {
  readonly ref: string
  constructor(ref: string) {
    super(`No record found for "${ref}"`)
    this.name = 'NotFoundError'
    this.ref = ref
  }
}

/** Dev-only: a data file failed its Zod schema parse (never thrown in production builds). */
export class DataValidationError extends Error {
  readonly file: string
  readonly zodIssues: readonly unknown[]
  constructor(file: string, zodIssues: readonly unknown[]) {
    super(`Data file "${file}" failed schema validation (${zodIssues.length} issue(s))`)
    this.name = 'DataValidationError'
    this.file = file
    this.zodIssues = zodIssues
  }
}

/** meta.json was produced for a different data schema version than this app build reads. */
export class SchemaVersionError extends Error {
  readonly expected: number
  readonly found: unknown
  constructor(expected: number, found: unknown) {
    super(`Data schema version mismatch: app expects ${expected}, data has ${String(found)}`)
    this.name = 'SchemaVersionError'
    this.expected = expected
    this.found = found
  }
}
