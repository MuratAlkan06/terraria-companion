/* CI guard for the committed app dataset (src/data): it validates as a partial dataset, its
 * committed meta.json/gaps.json are current, and every emitted data file is within the
 * ADR-001 D7 300 KB gzip budget; the committed sprite manifest matches the weapons and sprite
 * binaries stay out of git (A10). Skipped only if no dataset has been emitted yet. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getField, SpriteManifest, STAGE_ORDER, type Accessory, type ArmorPiece, type ArmorSet, type Boss, type Buff, type DropSource, type Item, type ProgressionEdge, type ProgressionNode, type SearchDoc, type Weapon } from '../../src/schemas'
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

  it('public/sprites/manifest.json lists exactly the weapon + boss + ammo item + armor + accessory sprite paths, with wiki provenance (D3/A10)', () => {
    const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(REPO, 'public/sprites/manifest.json'), 'utf8')))
    const weapons = JSON.parse(readFileSync(join(DATA_DIR, 'weapons.detail.json'), 'utf8')) as Weapon[]
    const bosses = JSON.parse(readFileSync(join(DATA_DIR, 'bosses.json'), 'utf8')) as Boss[]
    const items = JSON.parse(readFileSync(join(DATA_DIR, 'items.detail.json'), 'utf8')) as Item[]
    const equipment = [...(JSON.parse(readFileSync(join(DATA_DIR, 'armor.detail.json'), 'utf8')) as ArmorPiece[]), ...(JSON.parse(readFileSync(join(DATA_DIR, 'accessories.detail.json'), 'utf8')) as Accessory[])]
    expect([...weapons, ...bosses, ...items, ...equipment].flatMap((r) => (r.sprite ? [r.sprite] : [])).sort()).toEqual(manifest.files.map((f) => f.path).sort())
    for (const b of bosses) if (b.sprite) expect(manifest.files.find((f) => f.path === b.sprite)?.ref).toBe(`boss:${b.id}`)
    for (const i of [...items, ...equipment]) if (i.sprite) expect(manifest.files.find((f) => f.path === i.sprite)?.ref).toBe(`i:${i.id}`)
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

  describe('P2-S8 armor + armor sets + accessories (AMENDMENTS-001 A2: set bijection, tinkering symmetry, spot-checks)', () => {
    const read = <T,>(f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as T
    const armor = read<ArmorPiece[]>('armor.detail.json')
    const sets = read<ArmorSet[]>('armor-sets.json')
    const accessories = read<Accessory[]>('accessories.detail.json')
    const piece = new Map(armor.map((p) => [p.id, p]))
    const acc = (id: number) => accessories.find((a) => a.id === id)!
    const set = (id: string) => sets.find((x) => x.id === id)!

    it('§7a-6: every set is 1..N helmets + one chest + one legs with matching slots and back-refs; variants ⇄ helmets bijective', () => {
      expect(sets.length).toBeGreaterThan(0)
      for (const s of sets) {
        expect(s.variants.map((v) => v.helmetId).sort(), s.id).toEqual([...s.pieces.helmets].sort())
        expect(new Set(s.pieces.helmets).size, s.id).toBe(s.pieces.helmets.length)
        for (const id of s.pieces.helmets) expect(piece.get(id), `${s.id} i:${id}`).toMatchObject({ slot: 'head', setId: s.id })
        expect(piece.get(s.pieces.chest), s.id).toMatchObject({ slot: 'chest', setId: s.id })
        expect(piece.get(s.pieces.legs), s.id).toMatchObject({ slot: 'legs', setId: s.id })
      }
      for (const p of armor.filter((x) => x.setId)) {
        const s = set(p.setId!)
        expect([...s.pieces.helmets, s.pieces.chest, s.pieces.legs], p.name).toContain(p.id)
      }
    })

    it('§7a-7: combinedFrom and upgradesTo are exact inverses over the emitted accessories', () => {
      const forward = accessories.flatMap((a) => a.combinedFrom.map((f) => `${f}>${a.id}`)).sort()
      const backward = accessories.flatMap((a) => a.upgradesTo.map((t) => `${a.id}>${t}`)).sort()
      expect(forward.length).toBeGreaterThan(0)
      expect(forward).toEqual(backward)
    })

    it('B7: no equipment record carries maxStack; B31: list records carry their record\'s own wikiUrl', () => {
      for (const r of [...armor, ...accessories]) expect(r, r.name).not.toHaveProperty('maxStack')
      const detail = new Map([...armor, ...accessories].map((r) => [r.id, r.wikiUrl]))
      for (const file of ['armor.list.json', 'accessories.list.json']) for (const r of read<{ id: number; wikiUrl: string }[]>(file)) expect(r.wikiUrl, `${file} i:${r.id}`).toBe(detail.get(r.id))
    })

    // Spot-checks: every value below was compared side by side with the rendered wiki article by
    // `npm run pipeline:spotcheck` (pipeline/spotcheck/cases.json, P2-S8 cases) on 2026-10-13.
    it('spot-check Hallowed armor: four class-variant helmets; the Hood segment adds +2 minions; Defense totals 31 / 35 / 50 / 27', () => {
      const h = set('hallowed-armor')
      expect(h.pieces).toEqual({ helmets: [553, 558, 559, 4873], chest: 551, legs: 552 })
      expect(h.variants.map((v) => [v.helmetId, v.class])).toEqual([[553, 'ranged'], [558, 'magic'], [559, 'melee'], [4873, 'summon']])
      expect(h.variants.find((v) => v.helmetId === 4873)?.setBonus).toEqual([expect.objectContaining({ kind: 'special', text: 'Become immune after striking an enemy' }), { kind: 'stat', stat: 'minion-slots', value: 2 }])
      const total = (helmet: number) => [helmet, h.pieces.chest, h.pieces.legs].reduce((n, id) => n + (piece.get(id)?.defense ?? NaN), 0)
      expect([558, 553, 559, 4873].map(total)).toEqual([31, 35, 50, 27])
      expect(h._prov.editorialFields).toEqual(['variants.0.class', 'variants.1.class', 'variants.2.class', 'variants.3.class'])
    })

    it('spot-check mixed bonuses: Chlorophyte Mask = leaf crystal special + 5% damage reduction; Spectre Hood = −40% magic damage + its quoted remainder', () => {
      expect(set('chlorophyte-armor').variants.find((v) => v.helmetId === 1001)?.setBonus).toEqual([
        { kind: 'special', text: 'Summons a powerful leaf crystal to shoot at nearby enemies', simulated: false, sourceUrl: 'https://terraria.wiki.gg/wiki/Chlorophyte_armor' },
        { kind: 'stat', stat: 'damage-reduction-pct', value: 5 },
      ])
      const hood = set('spectre-armor').variants.find((v) => v.helmetId === 1503)!
      expect(hood.setBonus[0]).toEqual({ kind: 'stat', stat: 'damage-pct', value: -40, scope: 'magic' })
      expect(hood.setBonusText).toBe('Reduces Magic damage by 40% and converts it to healing force\nMagic damage done to enemies heals the player with lowest health')
    })

    it('spot-check hybrid / withheld sets: Frost armor is class "other" by quoted ruling; Beetle armor is withheld with a gap, its pieces setless', () => {
      expect(set('frost-armor').variants).toEqual([expect.objectContaining({ helmetId: 684, class: 'other' })])
      expect(sets.find((s) => s.id === 'beetle-armor')).toBeUndefined()
      for (const id of [2199, 2200, 2201, 2202]) expect(piece.get(id)?.setId, `i:${id}`).toBeUndefined()
      const gaps = read<{ entries: { ref: string; kind: string }[] }>('gaps.json').entries
      expect(gaps).toContainEqual(expect.objectContaining({ ref: 'set:beetle-armor', kind: 'count-reconciliation' }))
    })

    it('spot-check Ankh Shield chain both directions (Tinkerer\'s Workshop recipes)', () => {
      expect(acc(1613)).toMatchObject({ name: 'Ankh Shield', combinedFrom: [397, 1612], upgradesTo: [] })
      expect(acc(1613).effects[0]).toEqual({ kind: 'stat', stat: 'defense-flat', value: 5 })
      expect(acc(1612)).toMatchObject({ name: 'Ankh Charm', combinedFrom: [901, 902, 903, 904, 5354], upgradesTo: [1613] })
      expect(acc(397).upgradesTo).toContain(1613)
      for (const id of [901, 902, 903, 904, 5354]) expect(acc(id).upgradesTo, `i:${id}`).toContain(1612)
    })

    it('spot-check wings: Celestial Starboard 180 ticks + hover, Fledgling Wings 25 ticks without hover; vertical speed Unknown', () => {
      expect(acc(4954).wingStats).toEqual({ flightTimeTicks: 180, hover: true })
      expect(acc(4978).wingStats).toEqual({ flightTimeTicks: 25, hover: false })
      expect(getField(acc(4954), 'wingStats.verticalSpeedTps')).toEqual({ status: 'unverified' })
    })

    it('spot-check honest Unknown: Razortip has no transcribed game text → effects / categories Unknown, never invented', () => {
      const razortip = acc(6160)
      expect(razortip.effects).toEqual([])
      expect(getField(razortip, 'effects').status).toBe('unverified')
      expect(getField(razortip, 'categories').status).toBe('unverified')
    })

    it('spot-check structured accessory stat: Worm Scarf reduces damage taken by 17% (agrees with Equipinfo endurance)', () => {
      expect(acc(3224)).toMatchObject({ name: 'Worm Scarf', categories: ['defense'], effects: [{ kind: 'stat', stat: 'damage-reduction-pct', value: 17 }] })
      expect(acc(3224)._prov.sources).toContainEqual(expect.objectContaining({ kind: 'cargo:Equipinfo' }))
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
