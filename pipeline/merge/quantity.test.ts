import { describe, expect, it } from 'vitest'
import { DropSource, getField, isModeledField, type DropSource as DropRecord } from '../../src/schemas'
import { applyUnitQuantity, type DropItemKind } from './quantity'

const prov = (unverified: string[] = []) => ({ gameVersion: '1.4.5.8' as const, sources: [{ kind: 'cargo:Drops' as const, url: 'https://terraria.wiki.gg/wiki/Empress_of_Light', fetchedAt: '2026-10-13' }], verified: unverified.length === 0, unverifiedFields: unverified, editorialFields: [] })
const unstated = (id: string, itemId: number, extra: string[] = []): DropRecord => ({
  id,
  itemId,
  source: { npcName: 'Empress of Light' },
  quantity: {},
  rates: { classic: 0.25 },
  conditions: [],
  _prov: prov(['quantity.classic', ...extra]),
})

const KINDS = new Map<number, DropItemKind>([
  [5005, 'weapon'], // Terraprisma
  [1130, 'weapon'], // Beenade (consumable)
  [5004, 'vanity'], // Badger's Hat
  [867, 'armor'], // Green Cap
  [73, 'ammo'], // Gold Coin
  [319, 'material'], // Shark Fin (non-consumable but stackable)
  [4379, 'other'], // Wyvern Kite
])
const CONSUMABLE = new Map<number, boolean>([[5005, false], [1130, true], [5004, false], [867, false], [73, true], [319, false], [4379, false]])

function run(drops: DropRecord[], unstatedIds: Map<string, boolean>) {
  return applyUnitQuantity({ drops, unstated: unstatedIds, kindOf: (id) => KINDS.get(id), consumable: (id) => CONSUMABLE.get(id) })
}

describe('AMENDMENTS-016 B105 applyUnitQuantity', () => {
  it('non-consumable direction: a weapon / vanity / armor drop with no stated quantity derives 1, listed in modeledFields', () => {
    const drops = [unstated('5005-eol', 5005), unstated('5004-eoc', 5004), unstated('867-guide', 867)]
    const out = run(drops, new Map(drops.map((d) => [d.id, false])))
    expect(out.derived.map((d) => [d.drop.id, d.kind])).toEqual([['5005-eol', 'weapon'], ['5004-eoc', 'vanity'], ['867-guide', 'armor']])
    for (const d of out.drops) {
      expect(DropSource.parse(d)).toBeTruthy()
      expect(d.quantity).toEqual({ min: 1, max: 1 })
      expect(d._prov).toMatchObject({ verified: true, unverifiedFields: [], modeledFields: ['quantity'] })
      expect(getField(d, 'quantity')).toEqual({ status: 'verified', value: { min: 1, max: 1 } })
      expect(isModeledField(d, 'quantity')).toBe(true)
    }
  })

  it('consumable / stackable direction: coins, a consumable weapon, a material and an "other" item keep quantity Unknown', () => {
    const drops = [unstated('73-bag', 73), unstated('1130-bag', 1130), unstated('319-shark', 319), unstated('4379-wyvern', 4379), unstated('9-nothing', 9)]
    const out = run(drops, new Map(drops.map((d) => [d.id, false])))
    expect(out.derived).toEqual([])
    expect(out.drops).toEqual(drops) // untouched
    expect(out.kept.map((k) => [k.drop.id, k.kind, k.reason])).toEqual([
      ['73-bag', 'ammo', 'not a ruled item kind'],
      ['1130-bag', 'weapon', 'consumable'],
      ['319-shark', 'material', 'not a ruled item kind'],
      ['4379-wyvern', 'other', 'not a ruled item kind'],
      ['9-nothing', 'not emitted', 'not a ruled item kind'],
    ])
    for (const d of out.drops) expect(getField(d, 'quantity.classic')).toEqual({ status: 'unverified' })
  })

  it('only records whose cell states no quantity are ruled on; other Unknowns and a failed cross-check stay honest', () => {
    const stated = unstated('5005-stated-unparseable', 5005)
    const other = unstated('5005-eol', 5005, ['rates.expert'])
    const crossFailed = unstated('5004-eoc', 5004)
    const out = run([stated, other, crossFailed], new Map([['5005-eol', false], ['5004-eoc', true]]))
    expect(out.drops[0]).toBe(stated) // a stated-but-unparseable cell is not in `unstated`
    expect(out.drops[1]._prov).toMatchObject({ verified: false, unverifiedFields: ['rates.expert'], modeledFields: ['quantity'] })
    expect(out.drops[2]._prov).toMatchObject({ verified: false, unverifiedFields: [], modeledFields: ['quantity'] })
  })
})
