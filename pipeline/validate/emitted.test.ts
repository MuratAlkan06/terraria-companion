/* CI guard for the committed app dataset (src/data): it validates as a partial dataset, its
 * committed meta.json/gaps.json are current, and every emitted data file is within the
 * ADR-001 D7 300 KB gzip budget; the committed sprite manifest matches the weapons and sprite
 * binaries stay out of git (A10). Skipped only if no dataset has been emitted yet. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpriteManifest, STAGE_ORDER, type Boss, type DropSource, type ProgressionEdge, type ProgressionNode, type SearchDoc, type Weapon } from '../../src/schemas'
import { DATA_CHUNK_BUDGET_GZ, gzSize } from '../emit/write'
import { loadDatasetDir } from './dataset'
import { formatError } from './errors'
import { checkFixtures, REQUIREMENTS_BOSSES } from './fixtures'
import { requiredGateUpstream } from './graph'
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

  it('public/sprites/manifest.json lists exactly the weapon + boss sprite paths, with wiki provenance (D3/A10)', () => {
    const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(REPO, 'public/sprites/manifest.json'), 'utf8')))
    const weapons = JSON.parse(readFileSync(join(DATA_DIR, 'weapons.detail.json'), 'utf8')) as Weapon[]
    const bosses = JSON.parse(readFileSync(join(DATA_DIR, 'bosses.json'), 'utf8')) as Boss[]
    expect([...weapons, ...bosses].flatMap((r) => (r.sprite ? [r.sprite] : [])).sort()).toEqual(manifest.files.map((f) => f.path).sort())
    for (const b of bosses) if (b.sprite) expect(manifest.files.find((f) => f.path === b.sprite)?.ref).toBe(`boss:${b.id}`)
    expect(manifest.fallbackMode).toBe(false)
  })

  it('sprite binaries are gitignored; only the manifest is tracked (A10)', () => {
    const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n')
    expect(ignore).toContain('public/sprites/*')
    expect(ignore).toContain('!public/sprites/manifest.json')
  })

  describe('P2-S6 boss + progression dataset (PRD P2-S6 AC1–AC4, §7a-13 as hard tests)', () => {
    const read = <T,>(f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as T
    const bosses = read<Boss[]>('bosses.json')
    const { nodes, edges } = read<{ nodes: ProgressionNode[]; edges: ProgressionEdge[] }>('progression.json')
    const node = (id: string) => nodes.find((n) => n.id === id)

    it('AC1: every REQUIREMENTS §6 boss is a record with a boss node; EoW/BoC are world-evil alternatives; events/milestones are nodes', () => {
      expect(bosses.map((b) => b.id).sort()).toEqual([...REQUIREMENTS_BOSSES].sort())
      for (const id of REQUIREMENTS_BOSSES) expect(node(id)).toMatchObject({ kind: 'boss', bossId: id })
      expect(bosses.find((b) => b.id === 'eater-of-worlds')?.worldEvil).toBe('corruption')
      expect(bosses.find((b) => b.id === 'brain-of-cthulhu')?.worldEvil).toBe('crimson')
      expect(edges).toContainEqual(expect.objectContaining({ from: 'eater-of-worlds', to: 'brain-of-cthulhu', type: 'alternative-route' }))
      for (const id of ['hardmode', 'all-mechanical-bosses']) expect(node(id)?.kind).toBe('milestone')
      for (const id of ['goblin-army', 'pirate-invasion', 'solar-eclipse', 'frost-moon', 'pumpkin-moon', 'martian-madness', 'celestial-pillars']) expect(node(id)?.kind).toBe('event')
      // B12: the nodes the conditions registry points at exist
      for (const id of ['wall-of-flesh', 'plantera', 'golem', 'moon-lord', 'all-mechanical-bosses']) expect(node(id)).toBeDefined()
    })

    it('AC2: every edge is typed and carries a wiki sourceUrl + a note quoted from it', () => {
      for (const e of edges) {
        expect(['required-gate', 'recommended-next', 'optional', 'alternative-route', 'early-challenge-possible']).toContain(e.type)
        expect(e.sourceUrl).toMatch(/^https:\/\/terraria\.wiki\.gg\/wiki\//)
        expect(e.note?.length).toBeGreaterThan(11)
        expect(e._prov.sources).toContainEqual(expect.objectContaining({ kind: 'curated', overlay: 'progression', url: e.sourceUrl, rev: expect.any(Number) }))
      }
      for (const t of ['required-gate', 'recommended-next', 'optional', 'alternative-route', 'early-challenge-possible']) expect(edges.some((e) => e.type === t), t).toBe(true)
    })

    it('AC3: Wall of Flesh gates Hardmode; Plantera requires all three mechanical bosses; Deerclops and Queen Bee are optional', () => {
      expect(edges).toContainEqual(expect.objectContaining({ from: 'wall-of-flesh', to: 'hardmode', type: 'required-gate' }))
      const upstream = requiredGateUpstream(nodes, edges).get('plantera')
      for (const m of ['the-twins', 'the-destroyer', 'skeletron-prime']) expect(upstream?.has(m), m).toBe(true)
      for (const id of ['deerclops', 'queen-bee']) {
        expect(edges.filter((e) => e.from === id && e.type === 'required-gate')).toEqual([])
        expect(edges.some((e) => e.to === id && e.type === 'optional')).toBe(true)
      }
      expect(checkFixtures({ bosses, nodes, edges })).toEqual([])
    })

    it('§7a-13 checks fail on a broken graph (E_FIXTURE)', () => {
      const noMech = edges.filter((e) => !(e.from === 'the-twins' && e.to === 'all-mechanical-bosses'))
      expect(checkFixtures({ bosses, nodes, edges: noMech }).map((e) => e.message)).toEqual([expect.stringContaining('no required-gate path the-twins -> plantera')])
      const deerGate = [...edges, { ...edges[0], from: 'deerclops', to: 'wall-of-flesh', type: 'required-gate' as const }]
      expect(checkFixtures({ bosses, nodes, edges: deerGate })).toEqual([expect.objectContaining({ code: 'E_FIXTURE', name: 'deerclops-queen-bee-optional' })])
    })

    it('stages never decrease along a required-gate edge', () => {
      for (const e of edges.filter((x) => x.type === 'required-gate')) {
        const [from, to] = [node(e.from), node(e.to)]
        expect(STAGE_ORDER[to!.stage] >= STAGE_ORDER[from!.stage], `${e.from} -> ${e.to}`).toBe(true)
      }
    })

    it('AC4: every boss is in the search docs', () => {
      const docs = read<SearchDoc[]>('search-docs.json')
      for (const b of bosses) expect(docs).toContainEqual(expect.objectContaining({ id: `boss:${b.id}`, name: b.name, type: 'boss', stage: b.stage }))
    })

    it('B12: no drop keeps a pending bossId; boss dropIds are exactly the attributed drops', () => {
      const drops = read<DropSource[]>('drops.json')
      expect(drops.filter((d) => d._prov.unverifiedFields.includes('source.bossId'))).toEqual([])
      const attributed = drops.filter((d) => d.source.bossId).length
      expect(bosses.reduce((n, b) => n + b.dropIds.length, 0)).toBe(attributed)
      expect(read<{ partial: { pending: string[] } }>('dataset.json').partial.pending).not.toEqual(expect.arrayContaining(['bosses']))
    })

    it('B19: Pretty Mirror acquisition is withheld (Unknown + source-mismatch gap)', () => {
      const mirror = read<Weapon[]>('weapons.detail.json').find((w) => w.id === 5577)!
      expect(mirror.acquisition).toEqual([])
      expect(mirror._prov.unverifiedFields).toContain('acquisition')
      const gaps = read<{ entries: { ref: string; field?: string; kind: string }[] }>('gaps.json').entries
      expect(gaps).toContainEqual(expect.objectContaining({ ref: 'i:5577', field: 'acquisition', kind: 'source-mismatch' }))
    })
  })

  it('meta.json keeps the shape the app footer reads', () => {
    expect(meta).toMatchObject({ gameVersion: '1.4.5.8', dataSchemaVersion: 1, license: 'CC BY-NC-SA 4.0' })
    expect(meta).not.toHaveProperty('stub')
  })
})
