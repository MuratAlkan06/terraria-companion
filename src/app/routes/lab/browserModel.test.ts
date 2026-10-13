/**
 * The in-Lab weapon browser's model (PRD P3-S2 AC1/AC2, UX_SPEC §3.4) against the committed
 * dataset: every weapon is listed; search + class / stage / rarity / source / damage filters
 * combine (OR within, AND across, counts given the others); simulated-or-not comes from the
 * engine's verdict on the data, so a record that gains params lights up with no UI change.
 * Expectations are derived from the data, never hand lists — the data may grow under these tests.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon, WeaponListRecord } from '../../../data-access/types'
import weaponsJson from '../../../data/weapons.detail.json'
import weaponsList from '../../../data/weapons.list.json'
import { labStatus } from '../../../lab/labWeapons'
import { STAGE_OPTIONS } from '../db/weapons/weaponFilters'
import {
  activeLabFilterCount,
  browserRows,
  buildLabFacets,
  damageBucket,
  DAMAGE_BANDS,
  EMPTY_LAB_FILTERS,
  filterRows,
  LAB_FACET_IDS,
  labFacetValues,
  matchesQuery,
  queryWords,
  simulatedCount,
  sourceBuckets,
  toggleLabFilter,
  type LabFilters,
} from './browserModel'

const all = weaponsJson as Weapon[]
const list = weaponsList as WeaponListRecord[]
const rows = browserRows(all)
const f = (partial: Partial<LabFilters>): LabFilters => ({ ...EMPTY_LAB_FILTERS, ...partial })
const names = (r: readonly { weapon: Weapon }[]) => r.map((x) => x.weapon.name)

describe('every weapon, with its simulation status from the data', () => {
  it('lists every weapon in the dataset exactly once, by name', () => {
    expect(rows).toHaveLength(all.length)
    expect(rows.length).toBeGreaterThanOrEqual(488)
    expect(new Set(rows.map((r) => r.weapon.id)).size).toBe(all.length)
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
    expect(names(rows)).toEqual([...names(rows)].sort((a, b) => collator.compare(a, b)))
  })

  it('the list file and the detail records agree on every weapon’s lab kind (the browser reads the detail record)', () => {
    const kinds = new Map(all.map((w) => [w.id, w.labBehavior.kind]))
    expect(list).toHaveLength(all.length)
    for (const w of list) expect(w.labKind, w.name).toBe(kinds.get(w.id))
  })

  it('"Simulated" is exactly what equips (labStatus): every archetype record the Lab can run, never a limitation', () => {
    for (const row of rows) {
      expect(row.simulated, row.weapon.name).toBe(labStatus(row.weapon).kind === 'equippable')
      if (row.weapon.labBehavior.kind !== 'archetype') expect(row.simulated, row.weapon.name).toBe(false)
    }
    expect(simulatedCount(rows)).toBeGreaterThanOrEqual(35)
    expect(simulatedCount(rows)).toBeLessThan(rows.length)
  })

  it('a record that gains thrust params appears as simulated (equippable) with no UI change', () => {
    const spear = all.find((w) => w.tags.includes('spears'))!
    const mocked: Weapon = { ...spear, labBehavior: { kind: 'archetype', params: { archetype: 'thrust', reachTiles: 3.5 } } }
    const before = browserRows(all.filter((w) => w.id !== spear.id).concat(spear)).find((r) => r.weapon.id === spear.id)!
    const after = browserRows(all.filter((w) => w.id !== spear.id).concat(mocked)).find((r) => r.weapon.id === spear.id)!
    expect(after.status).toEqual({ kind: 'equippable', archetype: 'thrust' })
    expect(after.simulated).toBe(true)
    // Same weapon, same filters: only the data changed.
    expect(after.buckets).toEqual(before.buckets)
  })

  it('magic: the class filter keeps every magic weapon; each is marked simulated only if the Lab equips it', () => {
    const magic = filterRows(rows, f({ class: ['magic'] }), '')
    expect(magic).toHaveLength(all.filter((w) => w.damageClass === 'magic').length)
    expect(magic.every((r) => r.weapon.damageClass === 'magic')).toBe(true)
    const engineReady = magic.filter((r) => r.weapon.labBehavior.kind === 'archetype')
    // Today's data: two magic-bolt staffs have params, but the Lab can't equip magic bolts yet
    // (projectiles + mana, P3-S5) — so they read "Not simulated" and their card says why.
    expect(simulatedCount(magic)).toBe(magic.filter((r) => labStatus(r.weapon).kind === 'equippable').length)
    for (const r of engineReady) expect(r.status.kind === 'equippable' || r.status.kind === 'not-in-lab-yet', r.weapon.name).toBe(true)
  })
})

describe('search: local, case- and accent-insensitive, every word must appear in the name', () => {
  it('normalizes the query like the names', () => {
    expect(queryWords("  Night's   EDGE ")).toEqual(['nights', 'edge'])
    expect(queryWords('')).toEqual([])
  })

  it('finds weapons by partial words in any case; punctuation in names does not get in the way', () => {
    const edge = all.find((w) => w.name === "Night's Edge")
    if (edge) {
      for (const q of ['night edge', 'NIGHTS', "night's ed", 'edge night']) expect(names(filterRows(rows, EMPTY_LAB_FILTERS, q)), q).toContain("Night's Edge")
    }
    const sdmg = all.find((w) => w.name === 'S.D.M.G.')
    if (sdmg) expect(names(filterRows(rows, EMPTY_LAB_FILTERS, 'sdmg'))).toContain('S.D.M.G.')
    // Every result contains every word; a nonsense query finds nothing.
    for (const row of filterRows(rows, EMPTY_LAB_FILTERS, 'sword')) expect(matchesQuery(row, ['sword'])).toBe(true)
    expect(filterRows(rows, EMPTY_LAB_FILTERS, 'zzzz qqqq')).toEqual([])
    expect(filterRows(rows, EMPTY_LAB_FILTERS, '   ')).toHaveLength(rows.length)
  })
})

describe('facets: class, stage (incl. Unknown), rarity, source, damage', () => {
  const facets = buildLabFacets(rows, EMPTY_LAB_FILTERS, '')
  const facet = (id: string) => facets.find((x) => x.id === id)!

  it('offers the five facets the UX spec lists, in order', () => {
    expect(facets.map((x) => x.id)).toEqual([...LAB_FACET_IDS])
    expect(facets.map((x) => x.label)).toEqual(['Class', 'Game stage', 'Rarity', 'Source', 'Base damage'])
  })

  it('single-bucket facets (class, stage, rarity, damage) partition all weapons; stage includes "Stage unknown"', () => {
    for (const id of ['class', 'stage', 'rarity', 'damage']) {
      expect(facet(id).options.reduce((n, o) => n + o.count, 0), id).toBe(all.length)
    }
    const unknownStage = facet('stage').options.find((o) => o.value === 'unknown')!
    expect(unknownStage.label).toBe('Stage unknown')
    expect(unknownStage.count).toBe(all.filter((w) => w.stage === undefined).length)
    for (const stage of ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']) {
      expect(filterRows(rows, f({ stage: [stage] }), '').every((r) => r.weapon.stage === stage)).toBe(true)
    }
  })

  it('a stage no weapon is in is not offered (no "Early Pre-Hardmode 0"), like "Unclassified"', () => {
    const inData = new Set(all.map((w) => w.stage ?? 'unknown'))
    const offered = facet('stage').options
    expect(offered.map((o) => o.value)).toEqual(STAGE_OPTIONS.map((o) => o.value).filter((v) => inData.has(v)))
    expect(offered.every((o) => o.count > 0)).toBe(true)
    // Whatever the data covers: a stage emptied out of the rows drops out of the options.
    const stage = offered.find((o) => o.value !== 'unknown')
    if (stage) expect(labFacetValues(rows.filter((r) => r.weapon.stage !== stage.value)).stage).not.toContain(stage.value)
  })

  it('source: a weapon with several routes is in each of their buckets; no verified route = "Source unknown"', () => {
    const values = labFacetValues(rows).source
    for (const value of values) {
      const hits = filterRows(rows, f({ source: [value] }), '')
      const expected = all.filter((w) => (value === 'unknown' ? w.acquisition.length === 0 : w.acquisition.some((a) => a.method === value)))
      expect(hits.length, value).toBe(expected.length)
      expect(facet('source').options.find((o) => o.value === value)!.count).toBe(expected.length)
    }
    expect(values).toContain('unknown')
    const multi = all.find((w) => new Set(w.acquisition.map((a) => a.method)).size > 1)
    if (multi) expect(sourceBuckets(multi).length).toBeGreaterThan(1)
    expect(sourceBuckets({ acquisition: [] })).toEqual(['unknown'])
  })

  it('damage bands are inclusive ranges; unverified damage is "Damage unknown"', () => {
    expect(damageBucket({ damage: 19 })).toBe('0-19')
    expect(damageBucket({ damage: 20 })).toBe('20-39')
    expect(damageBucket({ damage: 100 })).toBe('100+')
    expect(damageBucket({ damage: undefined })).toBe('unknown')
    for (const band of DAMAGE_BANDS) {
      for (const r of filterRows(rows, f({ damage: [band.value] }), '')) {
        expect(r.weapon.damage!).toBeGreaterThanOrEqual(band.min)
        expect(r.weapon.damage!).toBeLessThanOrEqual(band.max)
      }
    }
    expect(filterRows(rows, f({ damage: ['unknown'] }), '').length).toBe(all.filter((w) => w.damage === undefined).length)
    expect(facet('damage').options.at(-1)).toMatchObject({ value: 'unknown', label: 'Damage unknown' })
  })

  it('OR within a facet, AND across facets and the search; counts assume the other facets and the search', () => {
    const melee = filterRows(rows, f({ class: ['melee'] }), '')
    const meleeOrMagic = filterRows(rows, f({ class: ['melee', 'magic'] }), '')
    expect(meleeOrMagic.length).toBe(melee.length + filterRows(rows, f({ class: ['magic'] }), '').length)
    const combo = f({ class: ['melee'], damage: ['20-39'], source: ['craft'] })
    const hits = filterRows(rows, combo, 'sword')
    for (const r of hits) {
      expect(r.weapon.damageClass).toBe('melee')
      expect(damageBucket(r.weapon)).toBe('20-39')
      expect(r.weapon.acquisition.some((a) => a.method === 'craft')).toBe(true)
      expect(matchesQuery(r, ['sword'])).toBe(true)
    }
    // Picking a class option would give exactly its count.
    const classFacet = buildLabFacets(rows, combo, 'sword').find((x) => x.id === 'class')!
    for (const option of classFacet.options) {
      expect(filterRows(rows, { ...combo, class: [option.value] }, 'sword').length, option.value).toBe(option.count)
    }
  })

  it('toggling keeps the facet’s canonical order; clearing empties every facet', () => {
    const order = labFacetValues(rows).class
    let filters = toggleLabFilter(EMPTY_LAB_FILTERS, 'class', 'magic', order)
    filters = toggleLabFilter(filters, 'class', 'melee', order)
    expect(filters.class).toEqual(['melee', 'magic'])
    expect(activeLabFilterCount(filters)).toBe(2)
    expect(toggleLabFilter(filters, 'class', 'magic', order).class).toEqual(['melee'])
  })
})
