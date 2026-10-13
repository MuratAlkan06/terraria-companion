/* Validate-stage tests over the real P2-S1 sample: it passes, and each intentional corruption
 * (applied to a fresh clone) fails with the expected NAMED error from DATA_SCHEMA_SPEC §6. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Gaps, getField, Meta, type SearchDoc } from '../../src/schemas'
import { loadDatasetDir, type CollectionKey, type RawDataset } from './dataset'
import { formatError, type PipelineError, type PipelineErrorCode } from './errors'
import { validateDataset, type ValidationResult } from './index'
import { projectList } from './listDetail'

// Test-only loose record type for mutating raw JSON fixtures.
// oxlint-disable-next-line typescript/no-explicit-any
type Rec = Record<string, any>

const SAMPLE_DIR = join(import.meta.dirname, '../fixtures/sample')
const loaded = loadDatasetDir(SAMPLE_DIR)
const NOW = new Date('2026-10-12T12:00:00.000Z')

const sample = (): RawDataset => structuredClone(loaded.raw)
const records = (raw: RawDataset, key: CollectionKey) => raw.collections[key] as Rec[]
const find = (raw: RawDataset, key: CollectionKey, id: string | number): Rec => {
  const found = records(raw, key).find((r) => r.id === id)
  if (!found) throw new Error(`fixture ${key} ${id} not found`)
  return found
}
const run = (raw: RawDataset) => validateDataset(raw, { now: NOW })
const errorsOf = (result: ValidationResult): PipelineError[] => (result.ok ? [] : result.errors)
const codesOf = (result: ValidationResult): PipelineErrorCode[] => [...new Set(errorsOf(result).map((e) => e.code))]

function expectOnly(result: ValidationResult, code: PipelineErrorCode): PipelineError[] {
  expect(result.ok, `expected failure with ${code}`).toBe(false)
  expect(codesOf(result)).toEqual([code])
  return errorsOf(result)
}

describe('sample dataset', () => {
  it('loads without file-level errors and has 20+ records across entity types', () => {
    expect(loaded.errors).toEqual([])
    const total = Object.values(loaded.raw.collections).reduce<number>((n, c) => n + (c as unknown[]).length, 0)
    expect(total).toBeGreaterThanOrEqual(20)
  })

  it('passes validation and emits schema-valid gaps.json + meta.json', () => {
    const result = run(sample())
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(Gaps.parse(result.gaps)).toEqual(result.gaps)
    expect(Meta.parse(result.meta)).toEqual(result.meta)
    expect(result.meta.iteminfo).toEqual({ rev: 1023241, syncedTo: '1.4.5.7' })
    expect(result.gaps.summary.labCoverage).toEqual({ archetype: 1, customScenario: 0, limitation: 4, unhandled: 0 })
    expect(result.meta.gapSummary.total).toBe(result.gaps.entries.length)
  })

  it('every record carries a terraria.wiki.gg source URL in _prov', () => {
    for (const [key, list] of Object.entries(loaded.raw.collections)) {
      for (const r of list as Rec[]) {
        expect(r._prov.sources.length, `${key} ${r.id ?? r.from}`).toBeGreaterThan(0)
        for (const s of r._prov.sources) expect(s.url).toMatch(/^https:\/\/terraria\.wiki\.gg\/wiki\//)
      }
    }
  })

  it('§2.1-3: weapons with unverified archetype parameters are downgraded to limitations; the fully sourced yoyo stays simulated', () => {
    const result = run(sample())
    if (!result.ok) throw new Error('sample should pass')
    const lab = Object.fromEntries(result.dataset.weapons.map((w) => [w.id, w.labBehavior]))
    expect(lab[3278]).toMatchObject({ kind: 'archetype', params: { archetype: 'returning', variant: 'yoyo' } })
    for (const id of [39, 98, 3069]) {
      expect(lab[id]).toMatchObject({ kind: 'limitation', reason: expect.stringMatching(/^required simulation parameter unverified: labBehavior\.params\./) })
    }
    expect(lab[434]).toMatchObject({ kind: 'limitation', reason: 'Burst fire is not modeled by the bow-gun archetype parameters.' })
    expect(result.warnings.filter((w) => w.code === 'W_LAB_DOWNGRADE').map((w) => w.ref).sort()).toEqual(['i:3069', 'i:39', 'i:98'])
  })

  it('the Unknown drop rate reads as "unverified" through getField, not-applicable rates as "not-applicable"', () => {
    const result = run(sample())
    if (!result.ok) throw new Error('sample should pass')
    const shadowOrb = result.dataset.drops.find((d) => d.id === '97-shadow-orb-741638a5')
    const wof = result.dataset.drops.find((d) => d.id === '434-wall-of-flesh-741638a5')
    expect(getField(shadowOrb, 'rates.classic')).toEqual({ status: 'unverified' })
    expect(getField(wof, 'rates.classic')).toEqual({ status: 'verified', value: 0.25 })
    expect(getField(wof, 'rates.expert')).toEqual({ status: 'not-applicable' })
    expect(result.gaps.entries.filter((e) => e.kind === 'unverified-drop-rate').map((e) => e.field)).toEqual(['rates.classic', 'rates.expert', 'rates.master'])
  })
})

describe('corrupted records fail with named errors', () => {
  it('E_SCHEMA: invalid stat value', () => {
    const raw = sample()
    find(raw, 'weapons', 434).damage = -17
    const [error] = expectOnly(run(raw), 'E_SCHEMA')
    expect(error).toMatchObject({ code: 'E_SCHEMA', ref: 'i:434' })
    expect(formatError(error)).toContain('at damage:')
  })

  it('E_SCHEMA: unknown key (strictObject)', () => {
    const raw = sample()
    find(raw, 'items', 9).color = 'brown'
    expect(expectOnly(run(raw), 'E_SCHEMA')[0]).toMatchObject({ ref: 'i:9' })
  })

  it('E_SCHEMA: markup in a wiki-derived string (A15)', () => {
    const raw = sample()
    find(raw, 'weapons', 98).name = "<span class='i'>Minishark</span>"
    expect(formatError(expectOnly(run(raw), 'E_SCHEMA')[0])).toContain('A15')
  })

  it('E_SCHEMA: verified:true with unverified fields (§2.1 rule 1)', () => {
    const raw = sample()
    find(raw, 'drops', '97-shadow-orb-741638a5')._prov.verified = true
    expectOnly(run(raw), 'E_SCHEMA')
  })

  it('E_SCHEMA: §7a-12 conditional field missing and NOT listed as unverified', () => {
    const raw = sample()
    find(raw, 'weapons', 3278).labBehavior = { kind: 'archetype', params: { archetype: 'piercing-beam', mode: 'channel-beam' } }
    expect(formatError(expectOnly(run(raw), 'E_SCHEMA')[0])).toContain('§7a-12')
  })

  it('§7a-12 conditional field missing but listed as unverified → downgraded, not failed', () => {
    const raw = sample()
    const yoyo = find(raw, 'weapons', 3278)
    yoyo.labBehavior = { kind: 'archetype', params: { archetype: 'piercing-beam', mode: 'channel-beam' } }
    yoyo._prov.unverifiedFields.push('labBehavior.params.tickRateTicks')
    raw.lists.weapons = (raw.lists.weapons as Rec[]).map((l) => (l.id === 3278 ? { ...l, labKind: 'limitation' } : l))
    const result = run(raw)
    expect(result.ok).toBe(true)
  })

  it('E_SCHEMA: empty acquisition that is not listed as unverified', () => {
    const raw = sample()
    find(raw, 'items', 22)._prov.unverifiedFields = ['gatedBy', 'stage']
    expect(expectOnly(run(raw), 'E_SCHEMA')[0].message).toContain('acquisition')
  })

  it('E_DANGLING_REF: recipe ingredient points at a missing item', () => {
    const raw = sample()
    find(raw, 'recipes', '39-43666ca8').ingredients[0].ref.itemId = 999999
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([
      expect.objectContaining({ fromRef: 'rcp:39-43666ca8', field: 'ingredients.0.ref.itemId', toRef: 'i:999999' }),
    ])
  })

  it('E_DANGLING_REF: unknown recipe group, drop boss, condition, buff and node refs', () => {
    const raw = sample()
    find(raw, 'recipes', '48-5d2fabc3').ingredients[0].ref.groupId = 'any-gold-bar'
    find(raw, 'drops', '216-zombie-741638a5').source.bossId = 'zombie-king'
    find(raw, 'items', 398).acquisition[0].conditions = ['blood-moon']
    find(raw, 'items', 292).buffGrants[0].buffId = 'regeneration'
    find(raw, 'items', 70).summonsBossNode = 'king-slime'
    const errors = expectOnly(run(raw), 'E_DANGLING_REF')
    expect(errors.map((e) => (e.code === 'E_DANGLING_REF' ? e.toRef : '')).sort()).toEqual(
      ['boss:zombie-king', 'buff:regeneration', 'cond:blood-moon', 'grp:any-gold-bar', 'node:king-slime'].sort(),
    )
  })

  it('E_DANGLING_REF: acquisition recipe produces a different item', () => {
    const raw = sample()
    find(raw, 'weapons', 39).acquisition[0].recipeIds = ['36-4cee494e']
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0].message).toContain('recipe produces i:36')
  })

  it('E_DANGLING_REF: Boss.dropIds disagrees with DropSource.source.bossId (§7a-3)', () => {
    const raw = sample()
    find(raw, 'bosses', 'wall-of-flesh').dropIds = ['434-wall-of-flesh-741638a5']
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([
      expect.objectContaining({ fromRef: 'boss:wall-of-flesh', field: 'dropIds', toRef: 'drop:434-treasure-bag-wall-of-flesh-741638a5' }),
    ])
  })

  it('E_DANGLING_REF: Boss↔Node asymmetry (§7a-4)', () => {
    const raw = sample()
    const nodes = (raw.collections.nodes as Rec[])
    nodes.find((n) => n.id === 'brain-of-cthulhu')!.bossId = 'eater-of-worlds'
    const errors = expectOnly(run(raw), 'E_DANGLING_REF')
    expect(errors.map((e) => e.message).join('\n')).toContain('asymmetric')
  })

  it('E_DANGLING_REF: armor set helmet without a set-bonus variant (§7a-6 bijection)', () => {
    const raw = sample()
    const cobalt = find(raw, 'armorSets', 'cobalt')
    cobalt.variants = cobalt.variants.filter((v: Rec) => v.helmetId !== 373)
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([
      expect.objectContaining({ fromRef: 'set:cobalt', field: 'variants', toRef: 'i:373' }),
    ])
  })

  it('E_DANGLING_REF: armor piece in the wrong slot / missing back-ref (§7a-6)', () => {
    const raw = sample()
    find(raw, 'armorSets', 'cobalt').pieces.legs = 374
    const messages = expectOnly(run(raw), 'E_DANGLING_REF').map((e) => e.message).join('\n')
    expect(messages).toContain('expected a legs piece, found chest')
    expect(messages).toContain('set does not list this piece under pieces.legs')
  })

  it('E_DANGLING_REF: tinkering combinedFrom/upgradesTo asymmetric (§7a-7)', () => {
    const raw = sample()
    find(raw, 'accessories', 54).upgradesTo = []
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([
      expect.objectContaining({ fromRef: 'i:54', field: 'upgradesTo', toRef: 'i:405' }),
    ])
  })

  it('E_DANGLING_REF: derived Item.isStation disagrees with recipes', () => {
    const raw = sample()
    find(raw, 'items', 36).isStation = false
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0]).toMatchObject({ fromRef: 'i:36', field: 'isStation' })
  })

  it('E_DANGLING_REF: A5 Enemy.dropIds disagrees with drop sources', () => {
    const raw = sample()
    find(raw, 'enemies', 'voodoo-demon').dropIds = []
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0]).toMatchObject({ fromRef: 'enemy:voodoo-demon', field: 'dropIds' })
  })

  it('E_DANGLING_REF: EoW/BoC not joined by an alternative-route edge (§7a-8)', () => {
    const raw = sample()
    raw.collections.edges = (raw.collections.edges as Rec[]).filter((e) => e.type !== 'alternative-route')
    const refs = expectOnly(run(raw), 'E_DANGLING_REF').map((e) => (e.code === 'E_DANGLING_REF' ? e.fromRef : ''))
    expect(refs.sort()).toEqual(['node:brain-of-cthulhu', 'node:eater-of-worlds'])
  })

  it('E_DANGLING_REF: edge endpoint does not resolve', () => {
    const raw = sample()
    ;(raw.collections.edges as Rec[])[1].to = 'hard-mode'
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0]).toMatchObject({ field: 'to', toRef: 'node:hard-mode' })
  })

  it('E_DUPLICATE_ID: item ID reused across item collections', () => {
    const raw = sample()
    records(raw, 'items').push({ ...structuredClone(find(raw, 'items', 9)), id: 216, slug: 'wood-copy' })
    expect(expectOnly(run(raw), 'E_DUPLICATE_ID')[0]).toMatchObject({ ref: 'i:216' })
  })

  it('E_DUPLICATE_ID: duplicate recipe id and duplicate edge triple', () => {
    const raw = sample()
    records(raw, 'recipes').push(structuredClone(find(raw, 'recipes', '36-4cee494e')))
    const edges = raw.collections.edges as Rec[]
    edges.push(structuredClone(edges[0]))
    const errors = expectOnly(run(raw), 'E_DUPLICATE_ID')
    expect(errors.map((e) => (e.code === 'E_DUPLICATE_ID' ? e.collection : '')).sort()).toEqual(['progression.edges', 'recipes'])
  })

  it('E_GRAPH_CYCLE: required-gate cycle', () => {
    const raw = sample()
    const edges = raw.collections.edges as Rec[]
    edges.push({ ...structuredClone(edges[1]), from: 'pirate-invasion', to: 'wall-of-flesh' })
    const [error] = expectOnly(run(raw), 'E_GRAPH_CYCLE')
    expect(error.message).toBe('required-gate subgraph has a cycle: hardmode -> pirate-invasion -> wall-of-flesh -> hardmode')
  })

  it('E_GRAPH_CYCLE: self-loop', () => {
    const raw = sample()
    const edges = raw.collections.edges as Rec[]
    edges.push({ ...structuredClone(edges[0]), from: 'hardmode', to: 'hardmode', type: 'optional' })
    expect(expectOnly(run(raw), 'E_GRAPH_CYCLE')[0].message).toContain('self-loop')
  })

  describe('E_SUGGESTION_GATING (§7a-5)', () => {
    // Test-only editorial suggestion on the Wall of Flesh (the fixture leaves it absent + unverified per A1 staging).
    const suggest = (raw: RawDataset, weapons: number[]) => {
      const wof = find(raw, 'bosses', 'wall-of-flesh')
      wof.suggestedEquipment = [{ class: 'ranged', weapons, armorSetIds: [], accessories: [], buffs: [] }]
      wof._prov.unverifiedFields = wof._prov.unverifiedFields.filter((f: string) => f !== 'suggestedEquipment')
      wof._prov.editorialFields.push('suggestedEquipment')
    }

    it('passes for an item obtainable before the boss', () => {
      const raw = sample()
      suggest(raw, [98])
      expect(run(raw).ok).toBe(true)
    })

    it('fails for an item gated behind the boss itself', () => {
      const raw = sample()
      suggest(raw, [434])
      expect(expectOnly(run(raw), 'E_SUGGESTION_GATING')).toEqual([
        expect.objectContaining({ bossId: 'wall-of-flesh', itemRef: 'i:434', message: expect.stringContaining('the boss itself') }),
      ])
    })

    it('fails for an item whose gating is unknown', () => {
      const raw = sample()
      suggest(raw, [3278])
      expect(expectOnly(run(raw), 'E_SUGGESTION_GATING')[0].message).toContain('gating is unknown')
    })

    it('fails for a condition gate whose node is not upstream (hardmode ⇐ wall-of-flesh)', () => {
      const raw = sample()
      find(raw, 'weapons', 98).gatedBy = { bosses: [], conditions: ['hardmode'], stage: 'early-hm' }
      suggest(raw, [98])
      expect(expectOnly(run(raw), 'E_SUGGESTION_GATING')[0].message).toContain('node:wall-of-flesh')
    })
  })

  it('E_LIST_DETAIL_DRIFT: list value differs from its detail record', () => {
    const raw = sample()
    ;(raw.lists.weapons as Rec[]).find((l) => l.id === 98)!.damage = 7
    expect(expectOnly(run(raw), 'E_LIST_DETAIL_DRIFT')).toEqual([
      expect.objectContaining({ file: 'weapons.list.json', ref: 'i:98', field: 'damage' }),
    ])
  })

  it('E_LIST_DETAIL_DRIFT: list carries the pre-downgrade labKind, an extra field, or misses a record', () => {
    const raw = sample()
    const list = raw.lists.weapons as Rec[]
    list.find((l) => l.id === 39)!.labKind = 'archetype'
    list.find((l) => l.id === 434)!.knockback = 0
    raw.lists.weapons = list.filter((l) => l.id !== 3069)
    const errors = expectOnly(run(raw), 'E_LIST_DETAIL_DRIFT').map((e) => e.message)
    expect(errors).toHaveLength(3)
    expect(errors.join('\n')).toMatch(/i:39 labKind[\s\S]*i:434 knockback[\s\S]*i:3069: detail record has no list record/)
  })

  it('E_UNVERIFIED_VALUE_EMITTED: value present while listed as unverified', () => {
    const raw = sample()
    find(raw, 'drops', '97-shadow-orb-741638a5').rates.classic = 0.2
    expect(expectOnly(run(raw), 'E_UNVERIFIED_VALUE_EMITTED')).toEqual([
      expect.objectContaining({ ref: 'drop:97-shadow-orb-741638a5', field: 'rates.classic' }),
    ])
  })
})

describe('A1 downgrades (never build-fatal)', () => {
  it('an unverified core stat on an archetype weapon downgrades it to a limitation', () => {
    const raw = sample()
    const yoyo = find(raw, 'weapons', 3278)
    delete yoyo.damage
    yoyo._prov.unverifiedFields.push('damage')
    raw.lists.weapons = (raw.lists.weapons as Rec[]).map((l) => {
      if (l.id !== 3278) return l
      const { damage: _damage, ...rest } = l
      return { ...rest, labKind: 'limitation' }
    })
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    const weapon = result.dataset.weapons.find((w) => w.id === 3278)!
    expect(weapon.labBehavior).toEqual({
      kind: 'limitation',
      inGameBehavior: 'See the Wooden Yoyo wiki page for its in-game behavior.',
      reason: 'required simulation parameter unverified: damage',
      sourceUrl: 'https://terraria.wiki.gg/wiki/Wooden_Yoyo',
    })
    expect(getField(weapon, 'damage')).toEqual({ status: 'unverified' })
  })

  it('rule 10: ammoClass with no matching ammo item is a warning + downgrade, not an error', () => {
    const raw = sample()
    const minishark = find(raw, 'weapons', 98)
    // Synthetic fully-specified params (test-only) so the weapon would otherwise stay simulated.
    minishark.labBehavior = { kind: 'archetype', params: { archetype: 'bow-gun', ammoClass: 'bullet', projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true } }
    minishark._prov.unverifiedFields = []
    minishark._prov.verified = true
    delete find(raw, 'items', 97).ammoStats
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(result.dataset.weapons.find((w) => w.id === 98)!.labBehavior).toMatchObject({ kind: 'limitation', reason: 'compatible ammo data unverified' })
    expect(result.warnings.filter((w) => w.code === 'W_AMMO_CLASS_UNMATCHED').map((w) => w.ref).sort()).toEqual(['i:434', 'i:98'])
  })
})

describe('§7a-11 search docs (when provided)', () => {
  const docsFor = (raw: RawDataset): SearchDoc[] => {
    const result = run(raw)
    if (!result.ok) throw new Error('sample should pass')
    const d = result.dataset
    return [
      ...d.weapons.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'weapon' as const, tags: r.tags })),
      ...d.armor.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'armor' as const, tags: r.tags })),
      ...d.accessories.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'accessory' as const, tags: r.tags })),
      ...d.items.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'item' as const, tags: r.tags })),
      ...d.armorSets.map((r) => ({ id: `set:${r.id}`, name: r.name, type: 'set' as const, tags: [] })),
      ...d.bosses.map((r) => ({ id: `boss:${r.id}`, name: r.name, type: 'boss' as const, tags: [] })),
      ...d.buffs.map((r) => ({ id: `buff:${r.id}`, name: r.name, type: 'buff' as const, tags: [] })),
      ...d.enemies.map((r) => ({ id: `enemy:${r.id}`, name: r.name, type: 'enemy' as const, tags: [] })),
    ]
  }

  it('passes when every searchable entity appears exactly once', () => {
    const raw = sample()
    raw.searchDocs = docsFor(raw)
    expect(run(raw).ok).toBe(true)
  })

  it('fails on a missing entity, a duplicate, and an unresolved ref', () => {
    const raw = sample()
    const docs = docsFor(raw).filter((d) => d.id !== 'enemy:voodoo-demon')
    docs.push({ ...docs[0] }, { id: 'boss:king-slime', name: 'King Slime', type: 'boss', tags: [] })
    raw.searchDocs = docs
    expect(codesOf(run(raw)).sort()).toEqual(['E_DANGLING_REF', 'E_DUPLICATE_ID'])
  })
})

describe('list projection + loader', () => {
  it('projectList keeps list fields only and derives labKind', () => {
    const projected = projectList('weapons', { id: 1, name: 'X', slug: 'x', type: 'weapon', tags: [], damage: 3, knockback: 1, labBehavior: { kind: 'limitation' } })
    expect(projected).toEqual({ id: 1, name: 'X', slug: 'x', type: 'weapon', tags: [], damage: 3, labKind: 'limitation' })
  })

  it('reports unknown files, invalid JSON and a missing manifest as E_SCHEMA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-validate-'))
    try {
      mkdirSync(join(dir, 'nested'))
      writeFileSync(join(dir, 'weapon.json'), '[]')
      writeFileSync(join(dir, 'items.json'), '{ not json')
      const { errors, raw } = loadDatasetDir(dir)
      expect(errors.map((e) => e.message)).toEqual([
        'file:weapon.json: unknown dataset file',
        expect.stringContaining('file:items.json: invalid JSON'),
      ])
      expect(codesOf(validateDataset(raw))).toEqual(['E_SCHEMA'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
