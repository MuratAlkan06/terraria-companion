/* CI guard for the committed app dataset (src/data): it validates as a partial dataset, its
 * committed meta.json/gaps.json are current, and every emitted data file is within the
 * ADR-001 D7 300 KB gzip budget; the committed sprite manifest matches the weapons and sprite
 * binaries stay out of git (A10). Skipped only if no dataset has been emitted yet. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOSS_PAGE_IDS, getField, SpriteManifest, STAGE_ORDER, type Accessory, type ArmorPiece, type ArmorSet, type Boss, type Buff, type DropSource, type GapEntry, type Item, type ProgressionEdge, type ProgressionNode, type SearchDoc, type Weapon } from '../../src/schemas'
import { THUMBNAIL_MIN_BYTES } from '../emit/thumbnail'
import { DATA_CHUNK_BUDGET_GZ, gzSize } from '../emit/write'
import { loadDatasetDir } from './dataset'
import { formatError } from './errors'
import { checkFixtures, REQUIREMENTS_BOSSES } from './fixtures'
import { requiredGateUpstream } from './graph'
import { validateDataset } from './index'
import { GEAR_CLASSES, weaponNamesIn } from './curation'
import { checkSuggestionGating } from './suggestions'

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
      // B70: the items collection is ammo (with ammoStats) + the potion corpus (without)
      expect(items.every((i) => (i.category === 'ammo' && i.ammoStats) || (i.category === 'potion' && !i.ammoStats))).toBe(true)
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
      expect(h.variants.map((v) => v.classes)).toEqual([['ranged'], ['magic'], ['melee'], ['summon']]) // B52: single-class variants
      expect(h.variants.find((v) => v.helmetId === 4873)?.setBonus).toEqual([expect.objectContaining({ kind: 'special', text: 'Become immune after striking an enemy' }), { kind: 'stat', stat: 'minion-slots', value: 2 }])
      const total = (helmet: number) => [helmet, h.pieces.chest, h.pieces.legs].reduce((n, id) => n + (piece.get(id)?.defense ?? NaN), 0)
      expect([558, 553, 559, 4873].map(total)).toEqual([31, 35, 50, 27])
      expect(h._prov.editorialFields).toEqual(['variants.0.class', 'variants.0.classes', 'variants.1.class', 'variants.1.classes', 'variants.2.class', 'variants.2.classes', 'variants.3.class', 'variants.3.classes'])
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

    it('P5-S3 review audit: every bundled drop ("Grenade Launcher :+ Rocket I (50–149)") gives the primary its own quantity and the companion its stated amount, as separate records', () => {
      const drops = read<DropSource[]>('drops.json')
      const universe = read<{ items: { id: number; name?: string }[] }>('item-universe.json')
      const idOf = (name: string) => universe.items.find((i) => i.name === name)?.id as number
      // The 9 bundled custom cells of the Cargo Drops sync (20 rows): source → [primary, companion, companion amount].
      const BUNDLES: [string, string, string, { min: number; max: number }][] = [
        ['Pumpking', 'Candy Corn Rifle', 'Candy Corn', { min: 50, max: 100 }],
        ['Pumpking', "Jack 'O Lantern Launcher", "Explosive Jack 'O Lantern", { min: 25, max: 50 }],
        ['Crimson Heart', 'The Undertaker', 'Musket Ball', { min: 100, max: 100 }],
        ['Shadow Orb', 'Musket', 'Musket Ball', { min: 100, max: 100 }],
        ['Nailhead', 'Nail Gun', 'Nail', { min: 100, max: 200 }],
        ['Mourning Wood', 'Stake Launcher', 'Stake', { min: 30, max: 60 }],
        ['Golem', 'Stynger', 'Stynger Bolt', { min: 60, max: 99 }],
        ['Treasure Bag (Golem)', 'Stynger', 'Stynger Bolt', { min: 60, max: 99 }],
        ['Plantera (Second Form)', 'Grenade Launcher', 'Rocket I', { min: 50, max: 149 }],
        ['Treasure Bag (Plantera)', 'Grenade Launcher', 'Rocket I', { min: 50, max: 149 }],
      ]
      for (const [source, primary, companion, amount] of BUNDLES) {
        const of = (name: string) => drops.filter((d) => d.itemId === idOf(name) && d.source.npcName === source)
        expect(of(primary).length, `${source} → ${primary}`).toBeGreaterThan(0)
        for (const d of of(primary)) expect(d.quantity, `${source} → ${primary}`).toEqual({ min: 1, max: 1 })
        expect(of(companion).length, `${source} → ${companion}`).toBeGreaterThan(0)
        for (const d of of(companion)) {
          expect(d.quantity, `${source} → ${companion}`).toEqual(amount)
          // same chance as the primary: they drop together
          expect(d.rates, `${source} → ${companion}`).toEqual(of(primary)[0].rates)
        }
      }
      // the item at the centre of the finding: never a stack of rockets on the launcher, on the boss or the weapon page
      expect(drops.filter((d) => d.itemId === 758).map((d) => d.quantity)).toEqual([{ min: 1, max: 1 }, { min: 1, max: 1 }])
    })

    it('B19: Pretty Mirror acquisition is withheld (Unknown + source-mismatch gap)', () => {
      const mirror = read<Weapon[]>('weapons.detail.json').find((w) => w.id === 5577)!
      expect(mirror.acquisition).toEqual([])
      expect(mirror._prov.unverifiedFields).toContain('acquisition')
      const gaps = read<{ entries: { ref: string; field?: string; kind: string }[] }>('gaps.json').entries
      expect(gaps).toContainEqual(expect.objectContaining({ ref: 'i:5577', field: 'acquisition', kind: 'source-mismatch' }))
    })
  })

  describe('P5-S2/S3 boss pages: curated fields + the E_BOSS_CURATION gate (AMENDMENTS-001 A1)', () => {
    const read = <T,>(f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as T
    const bosses = read<Boss[]>('bosses.json')
    const stageGaps = read<GapEntry[]>('stage-gaps.json')
    const boss = (id: string) => bosses.find((b) => b.id === id) as Boss

    it('the dataset backs exactly the app\'s boss pages (manifest.bossPages = src/schemas/bossPages.ts)', () => {
      expect(read<{ bossPages?: string[] }>('dataset.json').bossPages).toEqual([...BOSS_PAGE_IDS])
    })

    it('every page boss carries tags, a checklist and strategies as curated fields; each line and quote cites a wiki page', () => {
      for (const id of BOSS_PAGE_IDS) {
        const b = boss(id)
        for (const field of ['attackPatternTags', 'prepChecklist', 'strategies'] as const) {
          expect(getField(b, field).status, `${id} ${field}`).toBe('editorial')
          expect((b[field] ?? []).length, `${id} ${field}`).toBeGreaterThan(0)
        }
        for (const entry of [...(b.prepChecklist ?? []), ...(b.strategies ?? [])]) {
          expect(entry.sourceUrl).toMatch(/^https:\/\/terraria\.wiki\.gg\/wiki\//)
          expect(b._prov.sources).toContainEqual(expect.objectContaining({ kind: 'curated', overlay: 'bosses', url: entry.sourceUrl }))
        }
        expect(new Set(b.prepChecklist?.map((p) => p.text.toLowerCase())).size).toBe(b.prepChecklist?.length)
      }
    })

    it('suggested gear: a whole-field Unknown only where no quoted tip names a weapon verified obtainable before the fight (B83b; the Eater of Worlds since the B70 gating expansion); elsewhere entries + per-class Unknowns covering every class', () => {
      const wholeField = ['eater-of-worlds']
      for (const id of BOSS_PAGE_IDS) {
        const b = boss(id)
        if (wholeField.includes(id)) {
          expect(getField(b, 'suggestedEquipment').status, id).toBe('unverified')
          expect(stageGaps).toContainEqual(expect.objectContaining({ ref: `boss:${id}`, field: 'suggestedEquipment', kind: 'missing-field' }))
          continue
        }
        expect(getField(b, 'suggestedEquipment').status, id).toBe('editorial')
        for (const cls of GEAR_CLASSES) {
          const field = `suggestedEquipment.${cls}`
          const entries = (b.suggestedEquipment ?? []).filter((g) => g.class === cls)
          if (entries.length > 0) {
            expect(getField(b, field).status, `${id} ${cls}`).toBe('not-applicable')
          } else {
            // honest partial: the class's own path is Unknown, with its reason in the stage gap log
            expect(getField(b, field).status, `${id} ${cls}`).toBe('unverified')
            expect(stageGaps).toContainEqual(expect.objectContaining({ ref: `boss:${id}`, field, kind: 'missing-field' }))
          }
        }
      }
    })

    it('gate check: removing a curated field from a page boss fails the build (E_BOSS_CURATION)', () => {
      const raw = structuredClone(loaded.raw)
      const eye = (raw.collections.bosses as Boss[]).find((b) => b.id === 'eye-of-cthulhu') as Boss
      delete eye.prepChecklist
      eye._prov.editorialFields = eye._prov.editorialFields.filter((f) => f !== 'prepChecklist')
      eye._prov.unverifiedFields = [...eye._prov.unverifiedFields, 'prepChecklist'].sort()
      const result = validateDataset(raw, { now: new Date(meta.generatedAt) })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([expect.objectContaining({ code: 'E_BOSS_CURATION', bossId: 'eye-of-cthulhu', field: 'prepChecklist' })])
    })

    it('gate check (P5-S3, the Hardmode list): a class left neither curated nor declared fails; a per-class Unknown goes stale once a quoted tip names a suggestable weapon of that class', () => {
      const run = (mutate: (plantera: Boss, raw: typeof loaded.raw) => void) => {
        const raw = structuredClone(loaded.raw)
        mutate((raw.collections.bosses as Boss[]).find((b) => b.id === 'plantera') as Boss, raw)
        return validateDataset(raw, { now: new Date(meta.generatedAt) })
      }
      // the melee class is neither an entry nor listed Unknown
      const uncovered = run((p) => {
        p._prov.unverifiedFields = p._prov.unverifiedFields.filter((f) => f !== 'suggestedEquipment.melee')
      })
      expect(uncovered.ok).toBe(false)
      expect(uncovered.errors).toEqual([expect.objectContaining({ code: 'E_BOSS_CURATION', bossId: 'plantera', field: 'suggestedEquipment.melee' })])
      // listed Unknown, but its reason dropped from the stage gap log
      const unexplained = run((_p, raw) => {
        raw.stageGaps = (raw.stageGaps as GapEntry[]).filter((g) => !(g.ref === 'boss:plantera' && g.field === 'suggestedEquipment.melee'))
      })
      expect(unexplained.errors).toEqual([expect.objectContaining({ code: 'E_BOSS_CURATION', bossId: 'plantera', field: 'suggestedEquipment.melee', message: expect.stringContaining('without a declared reason') })])
      // a quoted melee tip naming the Breaker Blade (Wall of Flesh drop, verified obtainable before Plantera) makes the melee Unknown stale
      const stale = run((p) => {
        p.strategies = [...(p.strategies ?? []), { class: 'melee', text: 'The Breaker Blade is a test sentence.', sourceUrl: p.wikiUrl }]
      })
      expect(stale.errors).toEqual([expect.objectContaining({ code: 'E_BOSS_CURATION', bossId: 'plantera', field: 'suggestedEquipment.melee', message: expect.stringContaining('Breaker Blade (i:426)') })])
    })

    it('property: no item gated by the boss itself or a later node can be suggested for it (every emitted weapon, accessory and armor set, every page boss)', () => {
      const result = validateDataset(structuredClone(loaded.raw), { now: new Date(meta.generatedAt) })
      if (!result.ok) throw new Error(result.errors.slice(0, 5).map(formatError).join('\n'))
      const ds = result.dataset
      // Independent oracle: ancestors over required-gate edges by fixpoint (not graph.ts's DFS).
      const ancestors = new Map(ds.nodes.map((n) => [n.id, new Set<string>()]))
      for (let changed = true; changed; ) {
        changed = false
        for (const e of ds.edges.filter((x) => x.type === 'required-gate')) {
          const into = ancestors.get(e.to)!
          for (const a of [e.from, ...(ancestors.get(e.from) ?? [])]) {
            if (into.has(a)) continue
            into.add(a)
            changed = true
          }
        }
      }
      const conditionNode = new Map(ds.conditions.flatMap((c) => (c.satisfiedByNode ? [[c.id, c.satisfiedByNode] as const] : [])))
      const suggestable = (item: Weapon | Accessory | ArmorPiece, target: Boss) => {
        if (!item.gatedBy) return !item._prov.unverifiedFields.includes('gatedBy')
        const gates = [...item.gatedBy.bosses, ...item.gatedBy.conditions.flatMap((c) => conditionNode.get(c) ?? [])]
        return gates.every((g) => g !== target.nodeId && ancestors.get(target.nodeId)!.has(g))
      }
      const pieces = new Map(ds.armor.map((a) => [a.id, a]))
      for (const id of BOSS_PAGE_IDS) {
        const target = ds.bosses.find((b) => b.id === id) as Boss
        // One suggestion naming EVERY item, so the gate judges each one.
        const probe = { ...target, suggestedEquipment: [{ class: 'melee' as const, weapons: ds.weapons.map((w) => w.id), armorSetIds: ds.armorSets.map((s) => s.id), accessories: ds.accessories.map((a) => a.id), buffs: [] }] }
        const rejected = new Set(checkSuggestionGating({ ...ds, bosses: ds.bosses.map((b) => (b.id === id ? probe : b)) }).map((e) => (e.code === 'E_SUGGESTION_GATING' ? e.itemRef : '')))
        const setPieces = ds.armorSets.flatMap((s) => [...s.pieces.helmets, s.pieces.chest, s.pieces.legs]).flatMap((p) => pieces.get(p) ?? [])
        const items = [...ds.weapons, ...ds.accessories, ...setPieces]
        for (const item of items) {
          expect(rejected.has(`i:${item.id}`), `${id} ← ${item.name}`).toBe(!suggestable(item, target))
          if (item.gatedBy?.bosses.includes(target.nodeId)) expect(rejected.has(`i:${item.id}`), `${id} ← ${item.name} (gated by the boss itself)`).toBe(true)
        }
        // A whole-field gear gap stands only while no weapon the boss's quoted tips name is suggestable
        // (the stale-gap rule, AMENDMENTS-015 B83(b): recommendation ≠ mere obtainability); curated gear
        // names suggestable weapons only.
        const eligible = new Set(ds.weapons.filter((w) => suggestable(w, target)).map((w) => w.id))
        const quoted = new Set((target.strategies ?? []).flatMap((st) => [...weaponNamesIn(st.text, ds.weapons.map((w) => w.name))]))
        if (target.suggestedEquipment) {
          expect(eligible.size, id).toBeGreaterThan(0)
          for (const w of target.suggestedEquipment.flatMap((g) => g.weapons)) expect(eligible.has(w), `${id} suggests i:${w}`).toBe(true)
        } else {
          expect(ds.weapons.filter((w) => eligible.has(w.id) && quoted.has(w.name)).map((w) => w.name), id).toEqual([])
        }
      }
    })
  })

  it('meta.json keeps the shape the app footer reads', () => {
    expect(meta).toMatchObject({ gameVersion: '1.4.5.8', dataSchemaVersion: 1, license: 'CC BY-NC-SA 4.0' })
    expect(meta).not.toHaveProperty('stub')
  })

  // AMENDMENTS-014 B70 P4-prep slice. Spot-check values were compared with the cached article revisions
  // (Ironskin Potion, Healing Potion, Archery Potion, Frost armor, Musket Ball / Arms Dealer, King Slime
  // strategies) on 2026-10-14; the gap report's P4-prep sections carry the full reconciliation.
  describe('B70 P4-prep: potion corpus, B52 classes, B68/B78 gating, B54 kinds, forced gear', () => {
    const read = <T,>(f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as T
    const items = read<Item[]>('items.detail.json')
    const buffs = read<Buff[]>('buffs.json')
    const weapons = read<Weapon[]>('weapons.detail.json')
    const accessories = read<Accessory[]>('accessories.detail.json')
    const sets = read<ArmorSet[]>('armor-sets.json')
    const bossesB = read<Boss[]>('bosses.json')
    const item = (id: number) => items.find((i) => i.id === id) as Item
    const buff = (id: string) => buffs.find((b) => b.id === id) as Buff
    const weapon = (name: string) => weapons.find((w) => w.name === name) as Weapon
    const potions = items.filter((i) => i.category === 'potion')

    it('potion corpus: 66 potions (41/43 Buff potions table rows; Love / Stink potions excluded), every one granting a buff record, searchable', () => {
      expect(potions).toHaveLength(66)
      expect(potions.every((p) => p.buffGrants && p.buffGrants.every((g) => buffs.some((b) => b.id === g.buffId)))).toBe(true)
      expect(potions.map((p) => p.name)).not.toEqual(expect.arrayContaining(['Love Potion']))
      expect(potions.map((p) => p.name)).not.toEqual(expect.arrayContaining(['Stink Potion']))
      const docs = read<SearchDoc[]>('search-docs.json')
      for (const p of potions) expect(docs.find((d) => d.id === `i:${p.id}`), p.name).toMatchObject({ type: 'item', name: p.name })
      expect(read<{ counts: Record<string, number> }>('meta.json').counts.items).toBe(145)
    })

    it('spot-check Ironskin: +8 defense (stat), 8 minutes = 28800 ticks, early pre-Hardmode with no gate', () => {
      expect(buff('ironskin').effects).toEqual([{ kind: 'stat', stat: 'defense-flat', value: 8 }])
      expect(item(292)).toMatchObject({ category: 'potion', buffGrants: [{ buffId: 'ironskin', durationTicks: 28800 }], gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    })

    it('spot-check a healing potion: Healing Potion heals 100 and inflicts Potion Sickness for 1 minute; a heal range stays Unknown', () => {
      expect(item(188)).toMatchObject({ healLife: 100, buffGrants: [{ buffId: 'potion-sickness', durationTicks: 3600 }] })
      expect(item(28)).toMatchObject({ healLife: 50 })
      expect(getField(item(3001), 'healLife')).toEqual({ status: 'unverified' }) // Strange Brew: "70–120" vs one game value
    })

    it("spot-check Archery's scope: bow damage / arrow speed is a quoted special, never a ranged-wide damage stat", () => {
      expect(buff('archery').effects).toEqual([{ kind: 'special', text: '10% increased bow damage and 20% increased arrow speed', simulated: false, sourceUrl: 'https://terraria.wiki.gg/wiki/Archery_Potion' }])
    })

    it('spot-check B52: hybrid sets carry their quoted classes (class stays "other"); single-class and class-less variants [class]', () => {
      const variant = (id: string) => (sets.find((x) => x.id === id) as ArmorSet).variants[0]
      expect(variant('frost-armor')).toMatchObject({ class: 'other', classes: ['melee', 'ranged'] })
      expect(variant('forbidden-armor')).toMatchObject({ class: 'other', classes: ['magic', 'summon'] })
      expect(variant('crystal-assassin-armor')).toMatchObject({ class: 'other', classes: ['other'] })
      expect(sets.every((x) => x.variants.every((v) => v.classes && (v.classes.length > 1 ? v.class === 'other' : v.classes[0] === v.class)))).toBe(true)
      expect(sets.flatMap((x) => x.variants).filter((v) => (v.classes?.length ?? 0) > 1)).toHaveLength(10)
    })

    it('spot-check newly gated Musket Ball: Shadow Orb OR Crimson Heart (either world evil) and the Arms Dealer, always in stock → early pre-Hardmode, no gate', () => {
      expect(item(97)).toMatchObject({ gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' }, stage: 'early-prehm' })
      expect(item(97).acquisition).toContainEqual({ method: 'purchase', npcName: 'Arms Dealer', priceCopper: 7, conditions: [] })
      expect(item(97)._prov.unverifiedFields).toEqual([])
      // honest residuals: one ore-tier bar (world-specific), a seed-world chest, an orb weapon with an unknown other route
      for (const name of ['Iron Broadsword', 'Terragrim', 'Musket']) expect(getField(weapon(name), 'gatedBy'), name).toEqual({ status: 'unverified' })
      expect(weapon('Minishark').gatedBy).toEqual({ bosses: [], conditions: [], stage: 'early-prehm' })
    })

    it('spot-check stale-gap-forced gear (B83b): King Slime melee Thorn Chakram + Ice Blade, magic Wand of Frosting, ranged / summon Unknown; Eater of Worlds stays a whole-field Unknown', () => {
      const ks = bossesB.find((b) => b.id === 'king-slime') as Boss
      expect(ks.suggestedEquipment?.map((g) => [g.class, g.weapons])).toEqual([['melee', [191]], ['melee', [724]], ['magic', [5147]]])
      expect(ks._prov.unverifiedFields.filter((f) => f.startsWith('suggestedEquipment'))).toEqual(['suggestedEquipment.ranged', 'suggestedEquipment.summon'])
      expect(getField(bossesB.find((b) => b.id === 'eater-of-worlds'), 'suggestedEquipment')).toEqual({ status: 'unverified' })
    })

    it('B54 kinds: Ammo Reservation 20% ammo save, Tipsy +5 fishing power, Lava Charm 7 s = 420 ticks, Shark Tooth Necklace 5 armor penetration', () => {
      expect(buff('ammo-reservation').effects).toEqual([{ kind: 'stat', stat: 'ammo-save-pct', value: 20 }])
      expect(buff('tipsy').effects).toContainEqual({ kind: 'stat', stat: 'fishing-power-flat', value: 5 })
      const effectsOf = (name: string) => (accessories.find((a) => a.name === name) as Accessory).effects
      expect(effectsOf('Lava Charm')).toEqual([{ kind: 'stat', stat: 'lava-immunity-ticks', value: 420 }])
      expect(effectsOf('Shark Tooth Necklace')).toEqual([{ kind: 'stat', stat: 'armor-penetration-flat', value: 5 }])
    })

    it('B78 gatherables: an emitted gatherable carries its quoted "other" route (Gel)', () => {
      expect(item(23).acquisition).toContainEqual({ method: 'other', description: 'Gel is a common crafting material dropped by most slimes and Slimed Zombies', sourceUrl: 'https://terraria.wiki.gg/wiki/Gel', conditions: [] })
      expect(item(23).gatedBy).toEqual({ bosses: [], conditions: [], stage: 'early-prehm' })
    })
  })
})
