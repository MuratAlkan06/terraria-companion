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
import { checkItemShards, shardItems } from '../emit/itemShards'

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

  it('E_DANGLING_REF: B9 recipe availability condition not in the registry', () => {
    const raw = sample()
    find(raw, 'recipes', '48-5d2fabc3').conditions = ['blood-moon']
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([expect.objectContaining({ fromRef: 'rcp:48-5d2fabc3', field: 'conditions.0', toRef: 'cond:blood-moon' })])
  })

  it('E_DANGLING_REF: acquisition recipe produces a different item', () => {
    const raw = sample()
    find(raw, 'weapons', 39).acquisition[0].recipeIds = ['36-4cee494e']
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0].message).toContain('recipe produces i:36')
  })

  it('E_DERIVED_MISMATCH (B6): Boss.dropIds disagrees with DropSource.source.bossId (§7a-3)', () => {
    const raw = sample()
    find(raw, 'bosses', 'wall-of-flesh').dropIds = ['434-wall-of-flesh-741638a5']
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH')).toEqual([
      expect.objectContaining({ ref: 'boss:wall-of-flesh', field: 'dropIds', message: expect.stringContaining('drop:434-treasure-bag-wall-of-flesh-741638a5 derived from') }),
    ])
  })

  it('E_DERIVED_MISMATCH (B6): Boss↔Node asymmetry (§7a-4)', () => {
    const raw = sample()
    const nodes = (raw.collections.nodes as Rec[])
    nodes.find((n) => n.id === 'brain-of-cthulhu')!.bossId = 'eater-of-worlds'
    const errors = expectOnly(run(raw), 'E_DERIVED_MISMATCH')
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

  it('armor piece in the wrong slot is E_DANGLING_REF; the broken back-ref is E_DERIVED_MISMATCH (§7a-6, B6)', () => {
    const raw = sample()
    find(raw, 'armorSets', 'cobalt').pieces.legs = 374
    const result = run(raw)
    expect(codesOf(result).sort()).toEqual(['E_DANGLING_REF', 'E_DERIVED_MISMATCH'])
    const errors = errorsOf(result)
    expect(errors.filter((e) => e.code === 'E_DANGLING_REF').map((e) => e.message).join('\n')).toContain('expected a legs piece, found chest')
    expect(errors.filter((e) => e.code === 'E_DERIVED_MISMATCH').map((e) => e.message).join('\n')).toContain('does not list this piece under pieces.legs')
  })

  it('E_DUPLICATE_ID: two set-bonus variants for one helmet (§7a-6 bijection, P2-S8)', () => {
    const raw = sample()
    const cobalt = find(raw, 'armorSets', 'cobalt')
    cobalt.variants = [...cobalt.variants, structuredClone(cobalt.variants[0])]
    expect(expectOnly(run(raw), 'E_DUPLICATE_ID').map((e) => e.message).join('\n')).toContain('more than one variant for helmet')
  })

  it('P6 fix round (§7a-6): alternative chests (`chest` first) and no legs piece validate; a chest-keyed set needs a chestId on every variant, covering helmet × chest', () => {
    // the fixture's leggings stand in for a second chest: Cobalt becomes "3 helmets × 2 chests, no legs piece"
    const reshape = () => {
      const raw = sample()
      find(raw, 'armor', 375).slot = 'chest'
      const cobalt = find(raw, 'armorSets', 'cobalt')
      cobalt.pieces = { helmets: [371, 372, 373], chest: 374, chests: [374, 375] }
      return { raw, cobalt }
    }
    expect(codesOf(run(reshape().raw))).toEqual([])
    // the list starts with `chest`
    const first = reshape()
    first.cobalt.pieces.chests = [375, 374]
    expect(expectOnly(run(first.raw), 'E_DERIVED_MISMATCH').map((e) => e.message).join('\n')).toContain('pieces.chests must start with pieces.chest')
    // a chest not listed in `chests` breaks its back-ref
    const unlisted = reshape()
    unlisted.cobalt.pieces.chests = undefined
    expect(expectOnly(run(unlisted.raw), 'E_DERIVED_MISMATCH').map((e) => e.message).join('\n')).toContain('does not list this piece under pieces.chest')
    // keyed by the chest: one variant per helmet × chest, every one with its chestId
    const keyed = reshape()
    keyed.cobalt.variants = keyed.cobalt.variants.flatMap((v: Rec) => [{ ...v, chestId: 374 }, { ...structuredClone(v), chestId: 375 }])
    expect(codesOf(run(keyed.raw))).toEqual([])
    keyed.cobalt.variants = keyed.cobalt.variants.slice(1)
    expect(expectOnly(run(keyed.raw), 'E_DANGLING_REF')).toEqual([expect.objectContaining({ fromRef: 'set:cobalt', field: 'variants', toRef: 'i:371', message: expect.stringContaining('with chest i:374') })])
    delete keyed.cobalt.variants[0].chestId
    expect(errorsOf(run(keyed.raw)).map((e) => e.message).join('\n')).toContain('a set keyed by its chest needs a chestId on every variant')
  })

  it('AMENDMENTS-011 B52: variants[].classes is optional (older data validates); when present it agrees with the kept class', () => {
    const raw = sample()
    const cobalt = find(raw, 'armorSets', 'cobalt')
    expect(codesOf(run(raw))).toEqual([]) // no classes at all: the backward-compatible shape
    cobalt.variants[0].classes = ['magic']
    cobalt.variants[1].classes = ['melee', 'summon'] // hybrid list, but class is "melee" (must be "other")
    cobalt.variants[2].classes = ['melee'] // disagrees with class "ranged"
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH').map((e) => (e.code === 'E_DERIVED_MISMATCH' ? e.field : ''))).toEqual(['variants.1.classes', 'variants.2.classes'])
    cobalt.variants[1].class = 'other'
    cobalt.variants[2].classes = ['ranged']
    expect(codesOf(run(raw))).toEqual([])
    cobalt.variants[2].classes = ['ranged', 'ranged']
    expect(codesOf(run(raw))).toEqual(['E_SCHEMA']) // classes never repeat (schema)
  })

  it('P2-S8 (A1): an accessory with empty effects / categories is Unknown only when listed — unlisted empties are E_SCHEMA', () => {
    const raw = sample()
    const shackle = find(raw, 'accessories', 216)
    shackle.effects = []
    shackle.categories = []
    expect(expectOnly(run(raw), 'E_SCHEMA').map((e) => e.message)).toEqual([expect.stringContaining('i:216 effects: an empty effects list must be listed'), expect.stringContaining('i:216 categories: an empty categories list must be listed')])
    shackle._prov.unverifiedFields = ['categories', 'effects']
    shackle._prov.verified = false
    expect(codesOf(run(raw))).toEqual([])
  })

  it('E_DERIVED_MISMATCH (B6): tinkering combinedFrom/upgradesTo asymmetric (§7a-7)', () => {
    const raw = sample()
    find(raw, 'accessories', 54).upgradesTo = []
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH')).toEqual([
      expect.objectContaining({ ref: 'i:54', field: 'upgradesTo', message: expect.stringContaining('i:405 derived from') }),
    ])
  })

  it('E_DERIVED_MISMATCH (B6): derived Item.isStation disagrees with recipes', () => {
    const raw = sample()
    find(raw, 'items', 36).isStation = false
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH')[0]).toMatchObject({ ref: 'i:36', field: 'isStation' })
  })

  it('E_DERIVED_MISMATCH (B6): A5 Enemy.dropIds disagrees with drop sources', () => {
    const raw = sample()
    find(raw, 'enemies', 'voodoo-demon').dropIds = []
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH')[0]).toMatchObject({ ref: 'enemy:voodoo-demon', field: 'dropIds' })
  })

  it('E_DERIVED_MISMATCH (B6): EoW/BoC not joined by an alternative-route edge (§7a-8)', () => {
    const raw = sample()
    raw.collections.edges = (raw.collections.edges as Rec[]).filter((e) => e.type !== 'alternative-route')
    const refs = expectOnly(run(raw), 'E_DERIVED_MISMATCH').map((e) => (e.code === 'E_DERIVED_MISMATCH' ? e.ref : ''))
    expect(refs.sort()).toEqual(['node:brain-of-cthulhu', 'node:eater-of-worlds'])
  })

  it('E_DANGLING_REF: edge endpoint does not resolve', () => {
    const raw = sample()
    ;(raw.collections.edges as Rec[]).find((e) => e.to === 'pirate-invasion')!.to = 'pirate-raid'
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0]).toMatchObject({ field: 'to', toRef: 'node:pirate-raid' })
  })

  describe('§7a-13 fixtures (E_FIXTURE, P2-S6 AC3)', () => {
    it('the sample is checked against the fixture its subset expresses; breaking it is E_FIXTURE', () => {
      const raw = sample()
      raw.collections.edges = (raw.collections.edges as Rec[]).map((e) => (e.from === 'wall-of-flesh' ? { ...e, type: 'recommended-next' } : e))
      expect(expectOnly(run(raw), 'E_FIXTURE')).toEqual([
        expect.objectContaining({ name: 'wall-of-flesh-gates-hardmode', message: expect.stringContaining('no required-gate edge wall-of-flesh -> hardmode') }),
      ])
    })

    it('without a manifest restriction every fixture applies — the subset fails those it cannot express', () => {
      const raw = sample()
      delete (raw.manifest as Rec).fixtures
      const names = expectOnly(run(raw), 'E_FIXTURE').map((e) => (e.code === 'E_FIXTURE' ? e.name : ''))
      expect([...new Set(names)].sort()).toEqual(['deerclops-queen-bee-optional', 'plantera-requires-all-mechs', 'requirements-bosses'])
    })

    it('an unknown fixture name in the manifest is E_SCHEMA', () => {
      const raw = sample()
      ;(raw.manifest as Rec).fixtures = ['plantera-requires-one-mech']
      expect(expectOnly(run(raw), 'E_SCHEMA')[0].message).toContain('dataset.json')
    })
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

  describe('E_BOSS_CURATION — the P5 gate for bosses whose pages ship (AMENDMENTS-001 A1)', () => {
    const EOW = 'eater-of-worlds'
    const SRC = 'https://terraria.wiki.gg/wiki/Guide:Eater_of_Worlds_strategies'
    const withPages = (raw: RawDataset, pages: string[] = [EOW]) => {
      ;(raw.manifest as Rec).bossPages = pages
      return raw
    }
    const unlist = (boss: Rec, field: string) => {
      boss._prov.unverifiedFields = boss._prov.unverifiedFields.filter((f: string) => f !== field)
      if (!boss._prov.editorialFields.includes(field)) boss._prov.editorialFields.push(field)
    }
    /** Per-class gear gap (P5-S3 honest partial): the class's path listed Unknown + its reason in the stage gap log. */
    const classGap = (raw: RawDataset, cls: string) => {
      const field = `suggestedEquipment.${cls}`
      find(raw, 'bosses', EOW)._prov.unverifiedFields.push(field)
      raw.stageGaps = [...((raw.stageGaps as Rec[] | undefined) ?? []), { ref: `boss:${EOW}`, field, kind: 'missing-field', detail: `Eater of Worlds: no ${cls} weapon the wiki recommends is verified as obtainable before this fight.`, sources: ['https://terraria.wiki.gg/wiki/Eater_of_Worlds'] }]
    }
    /** The sample's Eater of Worlds with every curated minimum authored (gear = an ungated weapon; the other classes declared Unknown). */
    const curated = (raw: RawDataset) => {
      const eow = find(raw, 'bosses', EOW)
      eow.attackPatternTags = ['burrows']
      eow.prepChecklist = [{ text: 'Bring a ranged weapon', itemIds: [98], sourceUrl: SRC }] // §7a-5: checklist items must resolve (sample records only)
      eow.strategies = [{ class: 'ranged', text: 'Jester\'s Arrows can pierce through infinitely many segments, although the damage drops each segment.', sourceUrl: SRC }]
      eow.suggestedEquipment = [{ class: 'ranged', weapons: [98], armorSetIds: [], accessories: [], buffs: [] }]
      for (const f of ['attackPatternTags', 'prepChecklist', 'strategies', 'suggestedEquipment']) unlist(eow, f)
      for (const cls of ['melee', 'magic', 'summon']) classGap(raw, cls)
      return raw
    }
    const declareGap = (raw: RawDataset, field: string) => {
      const eow = find(raw, 'bosses', EOW)
      delete eow[field]
      eow._prov.editorialFields = eow._prov.editorialFields.filter((f: string) => f !== field)
      eow._prov.unverifiedFields.push(field)
      raw.stageGaps = [...((raw.stageGaps as Rec[] | undefined) ?? []), { ref: `boss:${EOW}`, field, kind: 'missing-field', detail: 'Eater of Worlds: no weapon is verified as obtainable before this fight.', sources: ['https://terraria.wiki.gg/wiki/Eater_of_Worlds'] }]
    }
    const fieldsOf = (result: ValidationResult) => expectOnly(result, 'E_BOSS_CURATION').map((e) => (e.code === 'E_BOSS_CURATION' ? `${e.bossId}:${e.field}` : ''))

    it('does not apply to a dataset without boss pages (the sample as committed)', () => {
      expect(run(sample()).ok).toBe(true)
    })

    it('fails every missing minimum of a listed boss: attackPatternTags, prepChecklist, strategies, suggestedEquipment', () => {
      expect(fieldsOf(run(withPages(sample())))).toEqual([`${EOW}:attackPatternTags`, `${EOW}:prepChecklist`, `${EOW}:strategies`, `${EOW}:suggestedEquipment`])
    })

    it('passes once every minimum is curated', () => {
      const result = run(withPages(curated(sample())))
      if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    })

    it('removing a curated field from a listed boss fails the build (absent + listed without a declared reason)', () => {
      for (const field of ['prepChecklist', 'strategies', 'suggestedEquipment']) {
        const raw = withPages(curated(sample()))
        const eow = find(raw, 'bosses', EOW)
        delete eow[field]
        eow._prov.editorialFields = eow._prov.editorialFields.filter((f: string) => f !== field)
        eow._prov.unverifiedFields.push(field)
        expect(fieldsOf(run(raw))).toEqual([`${EOW}:${field}`])
      }
      const raw = withPages(curated(sample()))
      delete find(raw, 'bosses', EOW).attackPatternTags
      find(raw, 'bosses', EOW)._prov.editorialFields = find(raw, 'bosses', EOW)._prov.editorialFields.filter((f: string) => f !== 'attackPatternTags')
      expect(fieldsOf(run(raw))).toEqual([`${EOW}:attackPatternTags`])
    })

    it('an empty list is not curation (it would claim there is nothing to show)', () => {
      const raw = withPages(curated(sample()))
      find(raw, 'bosses', EOW).strategies = []
      expect(fieldsOf(run(raw))).toEqual([`${EOW}:strategies`])
    })

    it('a declared gap passes only with its reason in the stage gap log', () => {
      const raw = withPages(curated(sample()))
      declareGap(raw, 'strategies')
      expect(run(raw).ok).toBe(true)
      raw.stageGaps = (raw.stageGaps as Rec[]).filter((g) => g.field !== 'strategies')
      expect(fieldsOf(run(raw))).toEqual([`${EOW}:strategies`])
    })

    it('a suggestedEquipment gap must be necessary: it is stale once the boss\'s quoted strategies name a weapon that passes E_SUGGESTION_GATING (B83b: recommendation ≠ mere obtainability)', () => {
      const raw = withPages(curated(sample()))
      declareGap(raw, 'suggestedEquipment')
      // ungated sample weapons exist (Wooden Bow, Minishark, Wand of Sparking), but no quoted tip names one → the gap stands
      const quiet = run(raw)
      if (!quiet.ok) throw new Error(quiet.errors.map(formatError).join('\n'))
      find(raw, 'bosses', EOW).strategies.push({ class: 'ranged', text: 'The Wooden Bow is fine here.', sourceUrl: SRC })
      const errors = expectOnly(run(raw), 'E_BOSS_CURATION')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toMatch(/declared gap is stale: the boss's own quoted strategies name 1 weapon\(s\) that pass E_SUGGESTION_GATING \(Wooden Bow \(i:39\)\)/)
      // gate the named weapon behind the Wall of Flesh (not upstream of the Eater) → the gap is necessary again
      find(raw, 'weapons', 39).gatedBy = { bosses: ['wall-of-flesh'], conditions: [], stage: 'early-hm' }
      const result = run(raw)
      if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    })

    describe('curated gear covers every class (P5-S3 honest partial)', () => {
      const weaponName = (raw: RawDataset, id: number) => find(raw, 'weapons', id).name as string

      it('a class with neither an entry nor a declared per-class Unknown fails', () => {
        const raw = withPages(curated(sample()))
        const eow = find(raw, 'bosses', EOW)
        eow._prov.unverifiedFields = eow._prov.unverifiedFields.filter((f: string) => f !== 'suggestedEquipment.summon')
        expect(fieldsOf(run(raw))).toEqual([`${EOW}:suggestedEquipment.summon`])
      })

      it('a per-class Unknown needs its reason in the stage gap log', () => {
        const raw = withPages(curated(sample()))
        raw.stageGaps = (raw.stageGaps as Rec[]).filter((g) => g.field !== 'suggestedEquipment.magic')
        expect(fieldsOf(run(raw))).toEqual([`${EOW}:suggestedEquipment.magic`])
      })

      it('a class cannot both have entries and be listed Unknown', () => {
        const raw = withPages(curated(sample()))
        classGap(raw, 'ranged')
        expect(fieldsOf(run(raw))).toEqual([`${EOW}:suggestedEquipment.ranged`])
      })

      it('a per-class Unknown is stale once one of the boss\'s quoted strategies names a suggestable weapon of that class', () => {
        const raw = withPages(curated(sample()))
        const eow = find(raw, 'bosses', EOW)
        // Wand of Sparking (i:3069): a magic weapon with no gates in the sample, so it passes E_SUGGESTION_GATING
        expect(weaponName(raw, 3069)).toBe('Wand of Sparking')
        eow.strategies.push({ class: 'magic', text: 'The Wand of Sparking is fine here.', sourceUrl: SRC })
        const errors = expectOnly(run(raw), 'E_BOSS_CURATION')
        expect(errors).toHaveLength(1)
        expect(errors[0].message).toMatch(/suggestedEquipment\.magic: per-class gap is stale: .*Wand of Sparking \(i:3069\)/)
        // a quote naming a weapon of ANOTHER class (Minishark, ranged) leaves the magic gap standing
        eow.strategies.pop()
        eow.strategies.push({ class: 'magic', text: `The ${weaponName(raw, 98)} is fine here.`, sourceUrl: SRC })
        const result = run(raw)
        if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
      })
    })

    it('a listed boss without a record fails', () => {
      expect(fieldsOf(run(withPages(curated(sample()), [EOW, 'king-slime'])))).toEqual(['king-slime:(record)'])
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

describe('AMENDMENTS-002 B3/B4 in validate', () => {
  const addGroup = (raw: RawDataset, id: string, memberItemIds: number[]) =>
    records(raw, 'recipeGroups').push({ ...structuredClone(find(raw, 'recipeGroups', 'any-iron-bar')), id, name: 'Test Stations', memberItemIds })

  it('B3: a station group resolves like an ingredient group', () => {
    const raw = sample()
    addGroup(raw, 'test-anvils', [35, 36])
    find(raw, 'recipes', '371-2620fd38').stations = [{ kind: 'group', groupId: 'test-anvils' }]
    expect(run(raw).ok).toBe(true)
    find(raw, 'recipes', '371-2620fd38').stations = [{ kind: 'group', groupId: 'missing-anvils' }]
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([expect.objectContaining({ field: 'stations.0.groupId', toRef: 'grp:missing-anvils' })])
  })

  it('B3: members of a station group are stations (derived Item.isStation)', () => {
    const raw = sample()
    addGroup(raw, 'test-stations', [36, 9])
    find(raw, 'recipes', '371-2620fd38').stations = [{ kind: 'group', groupId: 'test-stations' }]
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH')).toEqual([expect.objectContaining({ ref: 'i:9', field: 'isStation' })])
  })

  it('B4: loot/other acquisition conditions resolve against the registry', () => {
    const raw = sample()
    find(raw, 'items', 9).acquisition[0].conditions = ['hardmode']
    expect(run(raw).ok).toBe(true)
    find(raw, 'items', 9).acquisition[0].conditions = ['blood-moon']
    expect(expectOnly(run(raw), 'E_DANGLING_REF')).toEqual([expect.objectContaining({ fromRef: 'i:9', field: 'acquisition.0.conditions.0', toRef: 'cond:blood-moon' })])
  })
})

describe('partial datasets (manifest.partial: item universe + pending collections)', () => {
  const PENDING: CollectionKey[] = ['weapons', 'armor', 'accessories', 'items', 'armorSets', 'bosses', 'nodes', 'edges', 'buffs', 'scenarios']
  /** The sample reduced to recipes/groups/drops/enemies/conditions, as P2-S2a emits them. */
  const partialSample = (universeIds?: number[]): RawDataset => {
    const raw = sample()
    const referenced = new Set<number>()
    for (const r of records(raw, 'recipes')) {
      referenced.add(r.resultItemId)
      for (const i of r.ingredients) if (i.ref.kind === 'item') referenced.add(i.ref.itemId)
      for (const s of r.stations) if (s.kind === 'item') referenced.add(s.itemId)
    }
    for (const g of records(raw, 'recipeGroups')) for (const id of g.memberItemIds) referenced.add(id)
    for (const d of records(raw, 'drops')) referenced.add(d.itemId)
    for (const key of PENDING) delete raw.collections[key]
    raw.lists = {}
    ;(raw.manifest as Rec).partial = { itemUniverse: 'item-universe.json', pending: PENDING }
    raw.itemUniverse = {
      source: { kind: 'iteminfo', url: 'https://terraria.wiki.gg/wiki/Module:Iteminfo/data', rev: 1023241, syncedTo: '1.4.5.7', fetchedAt: '2026-10-12' },
      items: (universeIds ?? [...referenced]).map((id) => ({ id, internalName: `Item${id}` })),
    }
    return raw
  }

  it('passes: item refs resolve against the universe; refs into pending collections are deferred warnings', () => {
    const result = run(partialSample())
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    const deferred = result.warnings.filter((w) => w.code === 'W_DEFERRED_REF')
    expect(deferred.map((w) => w.ref).sort()).toEqual(['collection:bosses', 'collection:nodes'])
    expect(deferred.find((w) => w.ref === 'collection:bosses')?.message).toContain('boss:wall-of-flesh')
  })

  it('an item outside the Iteminfo universe is still E_DANGLING_REF', () => {
    const raw = partialSample()
    const universe = raw.itemUniverse as Rec
    universe.items = universe.items.filter((i: Rec) => i.id !== 381)
    expect(expectOnly(run(raw), 'E_DANGLING_REF')[0].message).toContain('Module:Iteminfo item universe')
  })

  it('a pending collection with records, an undeclared universe, or a rev mismatch is E_SCHEMA', () => {
    const withRecords = partialSample()
    withRecords.collections.buffs = [{}]
    expect(expectOnly(run(withRecords), 'E_SCHEMA')[0].message).toContain('declared pending')

    const undeclared = partialSample()
    delete (undeclared.manifest as Rec).partial.itemUniverse
    expect(expectOnly(run(undeclared), 'E_SCHEMA')[0].message).toContain('not declared')

    const revMismatch = partialSample()
    ;(revMismatch.itemUniverse as Rec).source.rev = 1
    expect(expectOnly(run(revMismatch), 'E_SCHEMA')[0].message).toContain('!= manifest iteminfo.rev')
  })

  it('A1 rule 10 is deferred while ammo items are pending: limitation weapons yield one deferred ref, no per-weapon warning', () => {
    const base = sample()
    const raw = partialSample()
    raw.collections.weapons = base.collections.weapons
    ;(raw.manifest as Rec).partial.pending = PENDING.filter((k) => k !== 'weapons')
    const universe = raw.itemUniverse as Rec
    const known = new Set(universe.items.map((i: Rec) => i.id))
    for (const w of records(base, 'weapons')) if (!known.has(w.id)) universe.items.push({ id: w.id, internalName: `Item${w.id}` })
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(result.warnings.filter((w) => w.code === 'W_AMMO_CLASS_UNMATCHED')).toEqual([])
    expect(result.warnings.find((w) => w.ref === 'collection:items')?.message).toContain('ammoClass:bullet')
  })

  it('stage gap entries are merged into gaps.json (and must be valid GapEntry records)', () => {
    const raw = partialSample()
    const entry = { ref: 'rcp:cargo-row-1', kind: 'count-reconciliation', detail: 'Cargo Recipes row 1 not emitted: test.', sources: ['https://terraria.wiki.gg/wiki/Wood'] }
    raw.stageGaps = [entry]
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(result.gaps.entries[0]).toEqual(entry)
    expect(result.meta.gapSummary.byKind['count-reconciliation']).toBe(1)
    raw.stageGaps = [{ ...entry, kind: 'not-a-kind' }]
    expect(expectOnly(run(raw), 'E_SCHEMA')[0].message).toContain('stage-gaps.json')
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

})

describe('AMENDMENTS-016 B105 derived drop quantity (_prov.modeledFields on drops)', () => {
  const schemaMessages = (result: ValidationResult) => errorsOf(result).filter((e) => e.code === 'E_SCHEMA').map((e) => e.message)

  it('passes: a non-stackable weapon drop (Clockwork Assault Rifle) models quantity 1', () => {
    const raw = sample()
    find(raw, 'drops', '434-wall-of-flesh-741638a5')._prov.modeledFields = ['quantity']
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(result.dataset.drops.find((d) => d.id === '434-wall-of-flesh-741638a5')?._prov.modeledFields).toEqual(['quantity'])
  })

  it('E_SCHEMA: a consumable item cannot model its quantity; a modeled quantity is exactly 1; only "quantity" can be modeled', () => {
    const consumable = sample()
    find(consumable, 'drops', '97-shadow-orb-741638a5').quantity = { min: 1, max: 1 }
    find(consumable, 'drops', '97-shadow-orb-741638a5')._prov.modeledFields = ['quantity']
    expect(schemaMessages(run(consumable))).toContainEqual(expect.stringContaining('item 97 is not a non-consumable'))
    const two = sample()
    find(two, 'drops', '434-wall-of-flesh-741638a5').quantity = { min: 2, max: 2 }
    find(two, 'drops', '434-wall-of-flesh-741638a5')._prov.modeledFields = ['quantity']
    expect(schemaMessages(run(two))).toContainEqual(expect.stringContaining('a derived quantity is exactly 1'))
    const rate = sample()
    find(rate, 'drops', '434-wall-of-flesh-741638a5')._prov.modeledFields = ['rates.classic']
    expect(schemaMessages(run(rate))).toContainEqual(expect.stringContaining('a drop can only model "quantity"'))
  })
})

describe('AMENDMENTS-010 B49 _prov.modeledFields', () => {
  /** Minishark with fully specified bow-gun params whose spread came from the B47 convention. */
  const modeledGun = (raw: RawDataset, modeledFields: string[]) => {
    const gun = find(raw, 'weapons', 98)
    gun.labBehavior = { kind: 'archetype', params: { archetype: 'bow-gun', ammoClass: 'bullet', projectilesPerUse: 1, spreadDegrees: 10, inheritsAmmoProjectile: true } }
    gun._prov.unverifiedFields = []
    gun._prov.verified = true
    gun._prov.modeledFields = modeledFields
    raw.lists.weapons = (raw.lists.weapons as Rec[]).map((l) => (l.id === 98 ? { ...l, labKind: 'archetype' } : l))
    return gun
  }
  const schemaMessages = (result: ValidationResult) => errorsOf(result).filter((e) => e.code === 'E_SCHEMA').map((e) => e.message)

  it('passes when every listed path is present and governed by a ratified convention (B47 spread)', () => {
    const raw = sample()
    modeledGun(raw, ['labBehavior.params.spreadDegrees'])
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(result.dataset.weapons.find((w) => w.id === 98)?._prov.modeledFields).toEqual(['labBehavior.params.spreadDegrees'])
  })

  it('E_SCHEMA: a listed path that is absent, or that no convention governs for the archetype', () => {
    const raw = sample()
    modeledGun(raw, ['labBehavior.params.reachTiles', 'damage'])
    const messages = schemaMessages(run(raw))
    expect(messages).toContainEqual(expect.stringContaining('labBehavior.params.reachTiles: the path is not present'))
    expect(messages).toContainEqual(expect.stringContaining('damage: no ratified modeling convention'))
  })

  it('E_SCHEMA: an always-modeled archetype (B44 swing-melee) must list its convention paths; non-Lab records cannot model', () => {
    const raw = sample()
    const yoyo = find(raw, 'weapons', 3278)
    yoyo.labBehavior = { kind: 'archetype', params: { archetype: 'swing-melee', arcDegrees: 180, reachTiles: 2 } }
    expect(schemaMessages(run(raw))).toContainEqual(expect.stringContaining('labBehavior.params.reachTiles can only come from the swing-geometry convention (AMENDMENTS-010 B44)'))
    yoyo._prov.modeledFields = ['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles']
    const ok = run(raw)
    if (!ok.ok) throw new Error(ok.errors.map(formatError).join('\n'))
    find(raw, 'items', 22)._prov.modeledFields = ['name']
    expect(schemaMessages(run(raw))).toContainEqual(expect.stringContaining('only Lab archetype params can be modeled'))
  })

  it('AMENDMENTS-012 B56: a thrust record lists its reach only when modeled (B46) — an article-stated range is wiki data', () => {
    const raw = sample()
    const spear = find(raw, 'weapons', 3278)
    spear.labBehavior = { kind: 'archetype', params: { archetype: 'thrust', reachTiles: 5.05 } }
    const stated = run(raw)
    if (!stated.ok) throw new Error(stated.errors.map(formatError).join('\n'))
    expect(stated.dataset.weapons.find((w) => w.id === 3278)?._prov.modeledFields).toBeUndefined()
    spear._prov.modeledFields = ['labBehavior.params.reachTiles']
    const modeled = run(raw)
    if (!modeled.ok) throw new Error(modeled.errors.map(formatError).join('\n'))
    expect(modeled.dataset.weapons.find((w) => w.id === 3278)?._prov.modeledFields).toEqual(['labBehavior.params.reachTiles'])
  })

  it('a §2.1-3 downgrade to a limitation drops the modeled Lab paths with the params', () => {
    const raw = sample()
    const gun = modeledGun(raw, ['labBehavior.params.spreadDegrees'])
    delete gun.damage
    gun._prov.verified = false
    gun._prov.unverifiedFields = ['damage']
    raw.lists.weapons = (raw.lists.weapons as Rec[]).map((l) => {
      if (l.id !== 98) return l
      const { damage: _damage, ...rest } = l
      return { ...rest, labKind: 'limitation' }
    })
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    const weapon = result.dataset.weapons.find((w) => w.id === 98)!
    expect(weapon.labBehavior.kind).toBe('limitation')
    expect(weapon._prov.modeledFields).toBeUndefined()
  })
})

describe('§7a-10 ammo classes (hard check once ammo items are produced, P2-S7)', () => {
  it('an ammoClass that matches no ammo record is E_DANGLING_REF (never a silent downgrade)', () => {
    const raw = sample()
    delete find(raw, 'items', 97).ammoStats // the only "bullet" ammo
    expect(expectOnly(run(raw), 'E_DANGLING_REF').map((e) => (e.code === 'E_DANGLING_REF' ? [e.fromRef, e.field, e.toRef] : []))).toEqual([
      ['i:98', 'ammoClass', 'ammoClass:bullet'],
      ['i:434', 'ammoClass', 'ammoClass:bullet'],
    ])
  })

  it('bow-gun params.ammoClass is checked too, and a weapon that is also ammo (Snowball) counts as an ammo record', () => {
    const raw = sample()
    const bow = find(raw, 'weapons', 39)
    // Synthetic fully-specified params (test-only) so the §2.1-3 pre-parse downgrade keeps the archetype.
    bow.labBehavior = { kind: 'archetype', params: { archetype: 'bow-gun', ammoClass: 'snowball', projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true } }
    bow._prov.unverifiedFields = []
    bow._prov.verified = true
    expect(errorsOf(run(raw))).toContainEqual(expect.objectContaining({ code: 'E_DANGLING_REF', fromRef: 'i:39', field: 'labBehavior.params.ammoClass', toRef: 'ammoClass:snowball' }))
    find(raw, 'weapons', 3278).ammoStats = { ammoClass: 'snowball', damage: 8 } // test-only: any weapon record carrying ammoStats
    expect(errorsOf(run(raw)).filter((e) => e.code === 'E_DANGLING_REF')).toEqual([])
  })
})

describe('AMENDMENTS-005 B22 unlocksStage (stage-transition gates)', () => {
  it('wall-of-flesh → early-hm is backed by its required-gate edge into the early-hm Hardmode milestone', () => {
    const raw = sample()
    find(raw, 'nodes', 'wall-of-flesh').unlocksStage = 'early-hm'
    const result = run(raw)
    if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'))
    expect(getField(result.dataset.nodes.find((n) => n.id === 'wall-of-flesh'), 'unlocksStage')).toEqual({ status: 'verified', value: 'early-hm' })
  })

  it('an unlocksStage with no matching milestone edge, or not later than the node\'s own stage, is E_DERIVED_MISMATCH', () => {
    const raw = sample()
    find(raw, 'nodes', 'wall-of-flesh').unlocksStage = 'mid-hm'
    find(raw, 'nodes', 'eater-of-worlds').unlocksStage = 'early-prehm'
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH').map((e) => (e.code === 'E_DERIVED_MISMATCH' ? `${e.ref} ${e.field}: ${e.message.split(': ').slice(1).join(': ')}` : ''))).toEqual([
      'node:eater-of-worlds unlocksStage: unlocksStage "early-prehm" is not later than the node\'s own stage "early-prehm"',
      'node:eater-of-worlds unlocksStage: no required-gate edge from node:eater-of-worlds to a "early-prehm" milestone',
      'node:wall-of-flesh unlocksStage: no required-gate edge from node:wall-of-flesh to a "mid-hm" milestone',
    ])
  })
})

describe('§7a-11 search docs (when provided)', () => {
  const docsFor = (raw: RawDataset): SearchDoc[] => {
    const result = run(raw)
    if (!result.ok) throw new Error('sample should pass')
    const d = result.dataset
    return [
      ...d.weapons.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'weapon' as const, tags: r.tags, wikiUrl: r.wikiUrl })),
      ...d.armor.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'armor' as const, tags: r.tags, wikiUrl: r.wikiUrl })),
      ...d.accessories.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'accessory' as const, tags: r.tags, wikiUrl: r.wikiUrl })),
      ...d.items.map((r) => ({ id: `i:${r.id}`, name: r.name, type: 'item' as const, tags: r.tags, wikiUrl: r.wikiUrl })),
      ...d.armorSets.map((r) => ({ id: `set:${r.id}`, name: r.name, type: 'set' as const, tags: [], wikiUrl: r.wikiUrl })),
      ...d.bosses.map((r) => ({ id: `boss:${r.id}`, name: r.name, type: 'boss' as const, tags: [], wikiUrl: r.wikiUrl })),
      ...d.buffs.map((r) => ({ id: `buff:${r.id}`, name: r.name, type: 'buff' as const, tags: [], wikiUrl: r.wikiUrl })),
      ...d.enemies.map((r) => ({ id: `enemy:${r.id}`, name: r.name, type: 'enemy' as const, tags: [], wikiUrl: r.wikiUrl })),
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

  it('B31: every doc carries its entity\'s own wikiUrl (absent or different is E_DERIVED_MISMATCH)', () => {
    const raw = sample()
    const docs = docsFor(raw)
    delete docs[0].wikiUrl
    docs[1] = { ...docs[1], wikiUrl: 'https://terraria.wiki.gg/wiki/Somewhere_else' }
    raw.searchDocs = docs
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH').map((e) => (e.code === 'E_DERIVED_MISMATCH' ? [e.ref, e.field] : []))).toEqual([
      [docs[0].id, 'wikiUrl'],
      [docs[1].id, 'wikiUrl'],
    ])
  })
})

describe('list projection + loader', () => {
  it('projectList keeps list fields only and derives labKind', () => {
    const projected = projectList('weapons', { id: 1, name: 'X', slug: 'x', type: 'weapon', tags: [], damage: 3, knockback: 1, useTimeTicks: 10, useAnimationTicks: 30, labBehavior: { kind: 'limitation' } })
    // useAnimationTicks is a list field since P2-S2 (TO-VERIFY #10: the wiki's "Use time")
    expect(projected).toEqual({ id: 1, name: 'X', slug: 'x', type: 'weapon', tags: [], damage: 3, useTimeTicks: 10, useAnimationTicks: 30, labKind: 'limitation' })
    // B31: wikiUrl is a list field (rows link the record's own page)
    expect(projectList('items', { id: 2, name: 'Y', slug: 'y', type: 'item', tags: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Y', category: 'ammo', isStation: false })).toEqual({ id: 2, name: 'Y', slug: 'y', type: 'item', tags: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Y', category: 'ammo' })
  })

  it('reports unknown files, invalid JSON and a missing manifest as E_SCHEMA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-validate-'))
    try {
      mkdirSync(join(dir, 'nested'))
      writeFileSync(join(dir, 'weapon.json'), '[]')
      writeFileSync(join(dir, 'items.detail.json'), '{ not json')
      const { errors, raw } = loadDatasetDir(dir)
      expect(errors.map((e) => e.message)).toEqual([
        'file:weapon.json: unknown dataset file',
        expect.stringContaining('file:items.detail.json: invalid JSON'),
      ])
      expect(codesOf(validateDataset(raw))).toEqual(['E_SCHEMA'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('P6-S0 item closure, drops together, item-detail shards', () => {
  it('itemClosure (manifest): a recipe / drop item that is neither emitted nor a declared gap is E_DANGLING_REF; a declared gap (field "id") resolves it', () => {
    const raw = sample()
    ;(raw.manifest as Rec).itemClosure = true
    const passing = run(raw)
    if (!passing.ok) throw new Error(passing.errors.map(formatError).join('\n'))
    // the drop's item (Musket Ball, i:97) leaves the item collections: undeclared → fails; declared → passes
    raw.collections.items = records(raw, 'items').filter((i) => i.id !== 97)
    raw.collections.weapons = records(raw, 'weapons').filter((w) => w.ammoClass !== 'musket-ball')
    raw.lists = {}
    const failing = run(raw)
    expect(failing.ok).toBe(false)
    expect(errorsOf(failing).filter((e) => e.message.includes('P6-S0 crafting closure')).map((e) => (e.code === 'E_DANGLING_REF' ? [e.fromRef, e.toRef] : []))).toEqual([['drop:97-shadow-orb-741638a5', 'i:97']])
    raw.stageGaps = [{ ref: 'i:97', field: 'id', kind: 'count-reconciliation', detail: 'Cargo Items row 1 not emitted as an item: test.', sources: ['https://terraria.wiki.gg/wiki/Musket_Ball'] }]
    expect(errorsOf(run(raw)).filter((e) => e.message.includes('P6-S0 crafting closure'))).toEqual([])
  })

  it('B84 dropsWith: must resolve, link back, and share source, rates and conditions', () => {
    const raw = sample()
    const [a, b] = [find(raw, 'drops', '434-wall-of-flesh-741638a5'), find(raw, 'drops', '434-treasure-bag-wall-of-flesh-741638a5')]
    a.dropsWith = ['434-treasure-bag-wall-of-flesh-741638a5']
    expect(expectOnly(run(raw), 'E_DERIVED_MISMATCH').map((e) => e.message).join('\n')).toMatch(/does not link back[\s\S]*another source, rate or conditions/)
    b.dropsWith = ['434-wall-of-flesh-741638a5']
    b.source = { ...a.source }
    b.rates = { ...a.rates }
    const ok = run(raw)
    expect(errorsOf(ok).filter((e) => e.message.includes('dropsWith'))).toEqual([])
    a.dropsWith = ['no-such-drop']
    expect(codesOf(run(raw))).toContain('E_DANGLING_REF')
  })

  it('the items collection loads from items.detail.json + the shards items.detail.index.json lists; any index ⇄ file drift is E_SCHEMA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-shards-'))
    try {
      const raw = sample()
      const items = records(raw, 'items') as { id: number }[]
      const write = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v))
      write('dataset.json', raw.manifest)
      const { files, index } = shardItems(items, new Set([items[0].id]))
      for (const [f, list] of files) write(f, list)
      write('items.detail.index.json', index)
      const ok = loadDatasetDir(dir)
      expect(ok.errors).toEqual([])
      expect((ok.raw.collections.items as Rec[]).map((i) => i.id)).toEqual(items.map((i) => i.id).sort((x, y) => x - y))
      // a shard the index does not list, and an id listed in the wrong range
      write('items.detail.99.json', [])
      const bad = { ...index, files: index.files.map((f, i) => (i === 1 ? { ...f, file: 'items.detail.98.json' } : f)) }
      write('items.detail.index.json', bad)
      write('items.detail.98.json', files.get(index.files[1].file))
      const drift = loadDatasetDir(dir).errors.map((e) => e.message)
      expect(drift).toEqual(expect.arrayContaining([expect.stringContaining('items.detail.99.json is not listed'), expect.stringContaining('outside the id range of items.detail.98.json')]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shardItems: core ids stay in items.detail.json, the rest go to their ID-range shard; checkItemShards accepts exactly that', () => {
    const { files, index } = shardItems([{ id: 2001 }, { id: 5 }, { id: 1999 }, { id: 43 }], new Set([43]))
    expect([...files.keys()]).toEqual(['items.detail.json', 'items.detail.0.json', 'items.detail.1.json', 'items.detail.2.json'])
    expect(index).toEqual({ shardSize: 1000, files: [{ file: 'items.detail.json', ids: [43] }, { file: 'items.detail.0.json', ids: [5] }, { file: 'items.detail.1.json', ids: [1999] }, { file: 'items.detail.2.json', ids: [2001] }] })
    expect(checkItemShards(index, files, ['items.detail.0.json', 'items.detail.1.json', 'items.detail.2.json'])).toEqual({ ok: true, problems: [] })
    expect(checkItemShards(index, new Map([...files].map(([f, l]) => [f, f === 'items.detail.0.json' ? [] : l])), []).problems).toEqual(['items.detail.0.json records do not equal its index ids'])
  })
})
