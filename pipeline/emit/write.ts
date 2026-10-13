/**
 * Emit stage helpers (DATA_SCHEMA_SPEC §7c "emit", ADR-001 D7). Collection files are written as
 * a JSON array with ONE RECORD PER LINE — compact for the bundle, diff-friendly in git. Every
 * emitted data file is checked against the 300 KB gzip budget (E_BUDGET).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { PipelineError } from '../validate/errors'

export const DATA_CHUNK_BUDGET_GZ = 300 * 1024

export function serializeRecords(records: readonly unknown[]): string {
  if (records.length === 0) return '[]\n'
  return `[\n${records.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`
}

export const serializeObject = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export interface EmittedFile {
  file: string
  bytes: number
  gzBytes: number
}

export function gzSize(content: string): number {
  return gzipSync(Buffer.from(content, 'utf8'), { level: 9 }).length
}

/** Budget check over in-memory file contents (before anything is written). */
export function checkBudgets(files: ReadonlyMap<string, string>, budget = DATA_CHUNK_BUDGET_GZ): { sizes: EmittedFile[]; errors: PipelineError[] } {
  const sizes: EmittedFile[] = []
  const errors: PipelineError[] = []
  for (const [file, content] of files) {
    const gzBytes = gzSize(content)
    sizes.push({ file, bytes: Buffer.byteLength(content, 'utf8'), gzBytes })
    if (gzBytes > budget) errors.push({ code: 'E_BUDGET', file, gzBytes, message: `${file}: ${(gzBytes / 1024).toFixed(1)} KB gz exceeds the ${budget / 1024} KB data-chunk budget (ADR-001 D7) — shard it` })
  }
  return { sizes, errors }
}

/**
 * Writes `files` into `dir`, removing stale pipeline-owned JSON files that this run no longer
 * produces (only names in `owned`; app files such as meta.ts are never touched).
 */
export function writeFiles(dir: string, files: ReadonlyMap<string, string>, owned: (file: string) => boolean): void {
  mkdirSync(dir, { recursive: true })
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (owned(f) && !files.has(f)) rmSync(join(dir, f))
  }
  for (const [file, content] of files) writeFileSync(join(dir, file), content)
}
