import { describe, expect, it } from 'vitest'
import { getField, isCoveredBy, resolvePath } from './getField'

const prov = (unverifiedFields: string[] = [], editorialFields: string[] = []) => ({
  gameVersion: '1.4.5.8',
  sources: [{ kind: 'cargo:Drops', url: 'https://terraria.wiki.gg/wiki/Shadow_Orb', fetchedAt: '2026-10-12' }],
  verified: unverifiedFields.length === 0,
  unverifiedFields,
  editorialFields,
})

// Shapes mirror the P2-S1 sample (pipeline/fixtures/sample): a drop whose rates are Unknown,
// a drop with a not-applicable difficulty, and a boss with editorial + unverified fields.
const shadowOrbDrop = {
  id: '97-shadow-orb-741638a5',
  itemId: 97,
  quantity: { min: 100, max: 100 },
  rates: {},
  _prov: prov(['rates.classic', 'rates.expert', 'rates.master']),
}
const wofDirectDrop = {
  id: '434-wall-of-flesh-741638a5',
  itemId: 434,
  rates: { classic: 0.25 },
  _prov: prov(),
}
const boss = {
  id: 'eater-of-worlds',
  stage: 'early-prehm',
  statsByDifficulty: {},
  location: { biomes: ['The Corruption', 'Underground Corruption'], time: 'any' },
  suggestedNote: undefined,
  _prov: prov(['statsByDifficulty.master', 'strategies'], ['stage', 'location.biomes']),
}

describe('getField', () => {
  it('returns "verified" with the value for a present, unlisted field', () => {
    expect(getField(wofDirectDrop, 'rates.classic')).toEqual({ status: 'verified', value: 0.25 })
    expect(getField(shadowOrbDrop, 'quantity.max')).toEqual({ status: 'verified', value: 100 })
  })

  it('returns "unverified" (no value) for an absent field listed in unverifiedFields', () => {
    expect(getField(shadowOrbDrop, 'rates.classic')).toEqual({ status: 'unverified' })
    expect(getField(shadowOrbDrop, 'rates.master')).toEqual({ status: 'unverified' })
    expect(getField(boss, 'strategies')).toEqual({ status: 'unverified' })
  })

  it('treats a listed path as covering its descendants', () => {
    expect(getField(boss, 'statsByDifficulty.master.hp')).toEqual({ status: 'unverified' })
    expect(getField(boss, 'strategies.0.text')).toEqual({ status: 'unverified' })
  })

  it('returns "not-applicable" for an absent field that is not listed', () => {
    expect(getField(wofDirectDrop, 'rates.expert')).toEqual({ status: 'not-applicable' })
    expect(getField(boss, 'statsByDifficulty.classic')).toEqual({ status: 'not-applicable' })
    expect(getField(boss, 'suggestedNote')).toEqual({ status: 'not-applicable' })
  })

  it('returns "editorial" with the value for a present field listed in editorialFields (incl. descendants)', () => {
    expect(getField(boss, 'stage')).toEqual({ status: 'editorial', value: 'early-prehm' })
    expect(getField(boss, 'location.biomes.1')).toEqual({ status: 'editorial', value: 'Underground Corruption' })
    expect(getField(boss, 'location.time')).toEqual({ status: 'verified', value: 'any' })
  })

  it('withholds a value that is present but listed as unverified (forbidden at emit) — never consumable', () => {
    const leaked = { ...shadowOrbDrop, rates: { classic: 0.2 } }
    expect(getField(leaked, 'rates.classic')).toEqual({ status: 'unverified' })
  })

  it('reads an absent editorial-only field as not-applicable', () => {
    const record = { _prov: prov([], ['attackPatternTags']) }
    expect(getField(record, 'attackPatternTags')).toEqual({ status: 'not-applicable' })
  })

  it('never throws on malformed input or paths', () => {
    expect(getField(null, 'a')).toEqual({ status: 'not-applicable' })
    expect(getField('text', 'length')).toEqual({ status: 'not-applicable' })
    expect(getField(wofDirectDrop, '')).toEqual({ status: 'not-applicable' })
    expect(getField(wofDirectDrop, 'rates..classic')).toEqual({ status: 'not-applicable' })
    expect(getField(wofDirectDrop, 'constructor')).toEqual({ status: 'not-applicable' })
    expect(getField(wofDirectDrop, '__proto__')).toEqual({ status: 'not-applicable' })
    expect(getField({ _prov: 'garbage', a: 1 }, 'a')).toEqual({ status: 'verified', value: 1 })
    expect(getField({ a: [1, 2] }, 'a.x')).toEqual({ status: 'not-applicable' })
  })
})

describe('resolvePath / isCoveredBy', () => {
  it('indexes arrays with numeric segments and only reads own properties', () => {
    expect(resolvePath({ v: [{ c: 'magic' }] }, 'v.0.c')).toBe('magic')
    expect(resolvePath({ v: [] }, 'v.0')).toBeUndefined()
    expect(resolvePath({}, 'toString')).toBeUndefined()
  })

  it('matches equal paths and descendants, not siblings sharing a prefix', () => {
    expect(isCoveredBy(['rates.expert'], 'rates.expert')).toBe(true)
    expect(isCoveredBy(['gatedBy'], 'gatedBy.bosses')).toBe(true)
    expect(isCoveredBy(['rates.expert'], 'rates.expertise')).toBe(false)
    expect(isCoveredBy(['rates.expert'], 'rates')).toBe(false)
  })
})
