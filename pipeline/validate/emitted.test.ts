/* CI guard for the committed app dataset (src/data): it validates as a partial dataset, its
 * committed meta.json/gaps.json are current, and every emitted data file is within the
 * ADR-001 D7 300 KB gzip budget; the committed sprite manifest matches the weapons and sprite
 * binaries stay out of git (A10). Skipped only if no dataset has been emitted yet. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpriteManifest, type Weapon } from '../../src/schemas'
import { DATA_CHUNK_BUDGET_GZ, gzSize } from '../emit/write'
import { loadDatasetDir } from './dataset'
import { formatError } from './errors'
import { validateDataset } from './index'

const DATA_DIR = join(import.meta.dirname, '../../src/data')
const REPO = join(import.meta.dirname, '../..')
const emitted = existsSync(join(DATA_DIR, 'dataset.json'))

describe.runIf(emitted)('emitted dataset (src/data)', () => {
  const loaded = loadDatasetDir(DATA_DIR)
  const meta = JSON.parse(readFileSync(join(DATA_DIR, 'meta.json'), 'utf8')) as { generatedAt: string }

  it('validates, and committed meta.json + gaps.json equal the recomputed reports', () => {
    expect(loaded.errors).toEqual([])
    const result = validateDataset(loaded.raw, { now: new Date(meta.generatedAt) })
    if (!result.ok) throw new Error(result.errors.slice(0, 20).map(formatError).join('\n'))
    expect(result.meta).toEqual(meta)
    expect(result.gaps).toEqual(JSON.parse(readFileSync(join(DATA_DIR, 'gaps.json'), 'utf8')))
    expect(result.manifest.partial?.itemUniverse).toBe('item-universe.json')
  })

  it('keeps every data file within the 300 KB gzip budget (ADR-001 D7)', () => {
    for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
      expect(gzSize(readFileSync(join(DATA_DIR, file), 'utf8')), file).toBeLessThanOrEqual(DATA_CHUNK_BUDGET_GZ)
    }
  })

  it('public/sprites/manifest.json lists exactly the weapon sprite paths, with wiki provenance (D3/A10)', () => {
    const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(REPO, 'public/sprites/manifest.json'), 'utf8')))
    const weapons = JSON.parse(readFileSync(join(DATA_DIR, 'weapons.detail.json'), 'utf8')) as Weapon[]
    expect(weapons.flatMap((w) => (w.sprite ? [w.sprite] : [])).sort()).toEqual(manifest.files.map((f) => f.path).sort())
    expect(manifest.fallbackMode).toBe(false)
  })

  it('sprite binaries are gitignored; only the manifest is tracked (A10)', () => {
    const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n')
    expect(ignore).toContain('public/sprites/*')
    expect(ignore).toContain('!public/sprites/manifest.json')
  })

  it('meta.json keeps the shape the app footer reads', () => {
    expect(meta).toMatchObject({ gameVersion: '1.4.5.8', dataSchemaVersion: 1, license: 'CC BY-NC-SA 4.0' })
    expect(meta).not.toHaveProperty('stub')
  })
})
