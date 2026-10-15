/**
 * The emit stage's directory handling (pipeline/emit/write.ts): a rebuild removes only stale files the pipeline
 * owns. build.ts's `owned` predicate names dataset .json files only (the collection/list/manifest names and the
 * item-shard pattern), so `f.endsWith('.json')` below is the widest it can be — and src/data's hand-written files,
 * the LICENSE.md data-license pointer (ADR-001 D3, AMENDMENTS-016 B127) and meta.ts, survive every rebuild.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFiles } from './write'

const DATA_DIR = join(import.meta.dirname, '../../src/data')
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('writeFiles (emit stage)', () => {
  it('removes stale owned files, writes the new set, and leaves files it does not own alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-emit-'))
    dirs.push(dir)
    for (const f of ['LICENSE.md', 'meta.ts', 'items.detail.9.json', 'meta.json']) writeFileSync(join(dir, f), 'old')
    writeFiles(dir, new Map([['meta.json', '{}\n']]), (f) => f.endsWith('.json'))
    expect(readdirSync(dir).sort()).toEqual(['LICENSE.md', 'meta.json', 'meta.ts'])
  })

  it('src/data keeps its LICENSE.md pointer beside the datasets — not a .json, so no owned name can claim it', () => {
    expect(existsSync(join(DATA_DIR, 'LICENSE.md'))).toBe(true)
    expect(readdirSync(DATA_DIR).filter((f) => !f.endsWith('.json')).sort()).toEqual(['LICENSE.md', 'meta.ts'])
  })
})
