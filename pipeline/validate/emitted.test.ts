/* CI guard for the committed app dataset (src/data): it validates as a partial dataset, its
 * committed meta.json/gaps.json are current, and every emitted data file is within the
 * ADR-001 D7 300 KB gzip budget; the committed sprite manifest matches the weapons and sprite
 * binaries stay out of git (A10). Skipped only if no dataset has been emitted yet. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getField, SpriteManifest, STAGE_ORDER, type Boss, type Buff, type DropSource, type Item, type ProgressionEdge, type ProgressionNode, type SearchDoc, type Weapon } from '../../src/schemas'
import { THUMBNAIL_MIN_BYTES } from '../emit/thumbnail'
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

  it('public/sprites/manifest.json lists exactly the weapon + boss + ammo item sprite paths, with wiki provenance (D3/A10)', () => {
    const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(REPO, 'public/sprites/manifest.json'), 'utf8')))
    const weapons = JSON.parse(readFileSync(join(DATA_DIR, 'weapons.detail.json'), 'utf8')) as Weapon[]
    const bosses = JSON.parse(readFileSync(join(DATA_DIR, 'bosses.json'), 'utf8')) as Boss[]
    const items = JSON.parse(readFileSync(join(DATA_DIR, 'items.detail.json'), 'utf8')) as Item[]
    expect([...weapons, ...bosses, ...items].flatMap((r) => (r.sprite ? [r.sprite] : [])).sort()).toEqual(manifest.files.map((f) => f.path).sort())
    for (const b of bosses) if (b.sprite) expect(manifest.files.find((f) => f.path === b.sprite)?.ref).toBe(`boss:${b.id}`)
    for (const i of items) if (i.sprite) expect(manifest.files.find((f) => f.path === i.sprite)?.ref).toBe(`i:${i.id}`)
    expect(manifest.fallbackMode).toBe(false)
  })

  it('B30: every sprite file over 100 KB lists a ≤ 128 px whole-number-downscaled PNG thumbnail (the 3 heavy boss GIFs)', () => {
    const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(REPO, 'public/sprites/manifest.json'), 'utf8')))
    const heavy = manifest.files.filter((f) => f.bytes > THUMBNAIL_MIN_BYTES)
    expect(heavy.map((f) => f.ref).sort()).toEqual(['boss:empress-of-light', 'boss:moon-lord', 'boss:wall-of-flesh'])
    for (const f of manifest.files) {
      if (f.bytes <= THUMBNAIL_MIN_BYTES) {
        expect(f.thumbnail, f.path).toBeUndefined()
        continue
      }
      const t = f.thumbnail!
      expect(t.path).toBe(f.path.replace('/sprites/', '/sprites/thumbs/').replace(/\.gif$/, '.png'))
      expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(128)
      const n = Math.ceil(f.width / t.width)
      expect([t.width, t.height]).toEqual([Math.ceil(f.width / n), Math.ceil(f.height / n)])
    }
  })

  describe('P2-S7 ammo + buffs + pipeline debts (B22, B31)', () => {
    const read = <T,>(f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as T
    const weapons = read<Weapon[]>('weapons.detail.json')
    const items = read<Item[]>('items.detail.json')
    const buffs = read<Buff[]>('buffs.json')

    it('§7a-10: every weapon ammo class is matched by ≥1 ammo record; Snowball is a weapon carrying ammoStats', () => {
      const classes = new Set([...items, ...weapons].flatMap((r) => (r.ammoStats ? [r.ammoStats.ammoClass] : [])))
      for (const w of weapons) if (w.ammoClass) expect(classes.has(w.ammoClass), `${w.name} ${w.ammoClass}`).toBe(true)
      expect(weapons.find((w) => w.id === 949)?.ammoStats).toMatchObject({ ammoClass: 'snowball', damage: 8 })
      expect(items.every((i) => i.category === 'ammo' && i.ammoStats)).toBe(true)
    })

    it('B2 spot checks: Musket Ball 2×, High Velocity Bullet 8×; a rocket and a dart carry no multiplier of their own', () => {
      const byId = (id: number) => items.find((i) => i.id === id)!
      expect(byId(97).ammoStats).toEqual({ ammoClass: 'musket-ball', damage: 7, velocityBonusTps: 15, velocityMultiplier: 2, knockback: 2 })
      expect(byId(1302).ammoStats?.velocityMultiplier).toBe(8)
      expect(byId(771).ammoStats).toEqual({ ammoClass: 'rocket-i', damage: 40, velocityBonusTps: 0, knockback: 4 })
      expect(getField(byId(1310), 'ammoStats.velocityMultiplier')).toEqual({ status: 'not-applicable' })
      expect(getField(byId(23), 'ammoStats.damage')).toEqual({ status: 'unverified' }) // Gel: no damage of its own
    })

    it('buffs: potion stat effects and enemy DoT are structured; Ironskin +8 defense, On Fire! 4 HP/s', () => {
      const buff = (id: string) => buffs.find((b) => b.id === id)!
      expect(buff('ironskin')).toMatchObject({ gameBuffId: 5, isDebuff: false, effects: [{ kind: 'stat', stat: 'defense-flat', value: 8 }] })
      expect(buff('on-fire')).toMatchObject({ gameBuffId: 24, isDebuff: true, dot: { dps: 4 } })
      expect(items.find((i) => i.id === 353)?.buffGrants).toEqual([{ buffId: 'tipsy', durationTicks: 7200 }]) // Ale
    })

    it('B22: Wall of Flesh unlocks Early Hardmode — Breaker Blade and every WoF-gated record are early-hm or later', () => {
      const { nodes } = read<{ nodes: ProgressionNode[] }>('progression.json')
      expect(nodes.find((n) => n.id === 'wall-of-flesh')).toMatchObject({ stage: 'late-prehm', unlocksStage: 'early-hm' })
      expect(weapons.find((w) => w.id === 426)).toMatchObject({ name: 'Breaker Blade', stage: 'early-hm' })
      const wofGated = [...weapons, ...items].filter((r) => r.gatedBy?.bosses.includes('wall-of-flesh'))
      expect(wofGated.length).toBeGreaterThan(0)
      for (const r of wofGated) expect(STAGE_ORDER[r.stage!] >= STAGE_ORDER['early-hm'], r.name).toBe(true)
    })

    it('B31: list records and search docs carry their record\'s own wikiUrl', () => {
      const detail = new Map([...weapons, ...items].map((r) => [r.id, r.wikiUrl]))
      for (const file of ['weapons.list.json', 'items.list.json']) for (const r of read<{ id: number; wikiUrl: string }[]>(file)) expect(r.wikiUrl, `${file} i:${r.id}`).toBe(detail.get(r.id))
      expect(read<SearchDoc[]>('search-docs.json').every((d) => d.wikiUrl?.startsWith('https://terraria.wiki.gg/wiki/'))).toBe(true)
    })
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
