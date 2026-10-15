import { describe, expect, it } from 'vitest'
import type { WeaponListRecord } from '../../../../data-access/types'
import weaponsList from '../../../../data/weapons.list.json'
import {
  activeFilterCount,
  applyFilters,
  buildFacets,
  EMPTY_FILTERS,
  facetCounts,
  facetValues,
  parseFilters,
  sortForBrowse,
  toggleFilter,
  writeFilters,
  type WeaponFilters,
} from './weaponFilters'

const base = { slug: 'x', type: 'weapon' as const, tags: [], wikiUrl: 'https://terraria.wiki.gg/wiki/X', useTimeTicks: 20, useAnimationTicks: 20, labKind: 'limitation' as const }
const LIST: WeaponListRecord[] = [
  { ...base, id: 1, name: 'Copper Sword', damageClass: 'melee', rarity: 0, stage: 'early-prehm' },
  { ...base, id: 2, name: 'Bow', damageClass: 'ranged', rarity: 0 },
  { ...base, id: 3, name: 'Zenith', damageClass: 'melee', rarity: 10 },
  { ...base, id: 4, name: 'Mystery', rarity: 2 }, // no damageClass → unclassified
  { ...base, id: 5, name: 'Bomb', damageClass: 'other' }, // no rarity, no stage
]
const VALID = facetValues(LIST)
const f = (partial: Partial<WeaponFilters>): WeaponFilters => ({ ...EMPTY_FILTERS, ...partial })
const ids = (list: WeaponListRecord[]) => list.map((w) => w.id)

describe('weapon filters (P2-S3 AC2)', () => {
  it('no filters → everything', () => {
    expect(ids(applyFilters(LIST, EMPTY_FILTERS))).toEqual([1, 2, 3, 4, 5])
  })

  it('OR within a facet', () => {
    expect(ids(applyFilters(LIST, f({ class: ['melee', 'ranged'] })))).toEqual([1, 2, 3])
  })

  it('AND across facets (combinable)', () => {
    expect(ids(applyFilters(LIST, f({ class: ['melee'], rarity: ['10'] })))).toEqual([3])
    expect(ids(applyFilters(LIST, f({ class: ['melee'], stage: ['early-prehm'] })))).toEqual([1])
    expect(ids(applyFilters(LIST, f({ class: ['ranged'], rarity: ['10'] })))).toEqual([])
  })

  it('A1: absent damageClass is the "unclassified" bucket', () => {
    expect(ids(applyFilters(LIST, f({ class: ['unclassified'] })))).toEqual([4])
  })

  it('§2.2: absent stage is the honest "unknown" stage bucket, never a real stage', () => {
    expect(ids(applyFilters(LIST, f({ stage: ['unknown'] })))).toEqual([2, 3, 4, 5])
    for (const stage of ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']) {
      expect(applyFilters(LIST, f({ stage: [stage] })).every((w) => w.stage === stage)).toBe(true)
    }
  })

  it('absent rarity is an "unknown" rarity bucket, offered only when present in data', () => {
    expect(VALID.rarity).toEqual(['0', '2', '10', 'unknown'])
    expect(ids(applyFilters(LIST, f({ rarity: ['unknown'] })))).toEqual([5])
  })

  it('facet counts reflect the OTHER facets only', () => {
    const counts = facetCounts(LIST, f({ class: ['melee'], rarity: ['0'] }), 'class')
    // class counts ignore the class selection but respect rarity=0
    expect(Object.fromEntries(counts)).toEqual({ melee: 1, ranged: 1 })
    const rarityCounts = facetCounts(LIST, f({ class: ['melee'], rarity: ['0'] }), 'rarity')
    expect(Object.fromEntries(rarityCounts)).toEqual({ '0': 1, '10': 1 })
  })

  it('buildFacets lists all 6 class options and 5 stages + Stage unknown, with counts', () => {
    const facets = buildFacets(LIST, EMPTY_FILTERS)
    expect(facets.map((x) => x.id)).toEqual(['class', 'stage', 'rarity'])
    expect(facets[0].options.map((o) => [o.value, o.count])).toEqual([
      ['melee', 2],
      ['ranged', 1],
      ['magic', 0],
      ['summon', 0],
      ['other', 1],
      ['unclassified', 1],
    ])
    expect(facets[1].options.map((o) => o.value)).toEqual(['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame', 'unknown'])
    expect(facets[1].options.at(-1)).toMatchObject({ label: 'Stage unknown', count: 4 })
    expect(facets[2].options.map((o) => o.label)).toEqual(['White (0)', 'Green (2)', 'Red (10)', 'Rarity unknown'])
    expect(facets[2].options[2].color).toBe('var(--rarity-10)')
  })

  it('"Unclassified" is offered only when some weapon has no class (never an always-zero option)', () => {
    const classified = LIST.filter((w) => w.damageClass !== undefined)
    expect(facetValues(classified).class).not.toContain('unclassified')
    expect(buildFacets(classified, EMPTY_FILTERS)[0].options.map((o) => o.value)).toEqual(['melee', 'ranged', 'magic', 'summon', 'other'])
    // A stale ?class=unclassified link is dropped, not guessed.
    expect(parseFilters(new URLSearchParams('class=unclassified'), facetValues(classified)).class).toEqual([])
  })

  it('URL round-trip: parse drops unknown values, writes canonical order, preserves other params', () => {
    const params = new URLSearchParams('class=ranged,bogus,melee&stage=unknown&rarity=99&q=keep')
    const filters = parseFilters(params, VALID)
    expect(filters).toEqual({ class: ['melee', 'ranged'], stage: ['unknown'], rarity: [] })
    const written = writeFilters(params, filters)
    expect(written.get('class')).toBe('melee,ranged')
    expect(written.has('rarity')).toBe(false)
    expect(written.get('q')).toBe('keep')
    expect(parseFilters(written, VALID)).toEqual(filters)
  })

  it('toggle adds/removes in canonical order; clear all empties every facet', () => {
    let filters = toggleFilter(EMPTY_FILTERS, 'class', 'ranged', VALID.class)
    filters = toggleFilter(filters, 'class', 'melee', VALID.class)
    expect(filters.class).toEqual(['melee', 'ranged'])
    filters = toggleFilter(filters, 'class', 'ranged', VALID.class)
    expect(filters.class).toEqual(['melee'])
    expect(activeFilterCount(f({ class: ['melee'], rarity: ['0', '10'] }))).toBe(3)
    expect(writeFilters(new URLSearchParams('class=melee&rarity=0'), EMPTY_FILTERS).toString()).toBe('')
  })

  it('browse order is by name', () => {
    expect(sortForBrowse(LIST).map((w) => w.name)).toEqual(['Bomb', 'Bow', 'Copper Sword', 'Mystery', 'Zenith'])
  })
})

describe('filters over the real weapons list', () => {
  const list = weaponsList as WeaponListRecord[]

  it('every weapon lands in exactly one class, stage and rarity bucket', () => {
    const facets = buildFacets(list, EMPTY_FILTERS)
    for (const facet of facets) {
      expect(facet.options.reduce((n, o) => n + o.count, 0), facet.id).toBe(list.length)
    }
  })

  it('a stage bucket only ever contains weapons verified for that stage', () => {
    for (const stage of ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']) {
      expect(applyFilters(list, f({ stage: [stage] })).every((w) => w.stage === stage)).toBe(true)
    }
    expect(applyFilters(list, f({ stage: ['unknown'] })).every((w) => w.stage === undefined)).toBe(true)
  })
})
