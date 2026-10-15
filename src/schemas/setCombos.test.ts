/* Armor-set combinations (P6 fix round; schemas/setCombos.ts): every consumer — the armor pages, the builder, the
 * readiness checker, Improve My Build — reads a set's wearable full sets through these helpers. A one-chest set
 * keeps its pre-fix-round keys (one combination per helmet, keyed by the helmet id). */
import { describe, expect, it } from 'vitest'
import type { ArmorSet } from './equipment'
import { comboDistinctIds, comboName, setChestIds, setCombos, setPieceIds, wornCombo } from './setCombos'

const variant = (helmetId: number, extra: Partial<ArmorSet['variants'][number]> = {}): ArmorSet['variants'][number] => ({
  helmetId,
  class: 'melee',
  classes: ['melee'],
  setBonus: [{ kind: 'special', text: `bonus ${helmetId}`, simulated: false, sourceUrl: 'https://terraria.wiki.gg/wiki/X' }],
  setBonusText: `bonus ${helmetId}`,
  ...extra,
})
type Shape = Pick<ArmorSet, 'name' | 'pieces' | 'variants'>
const hallowed: Shape = { name: 'Hallowed armor', pieces: { helmets: [553, 558], chest: 551, legs: 552 }, variants: [variant(553), variant(558)] }
const beetle: Shape = {
  name: 'Beetle armor',
  pieces: { helmets: [2199], chest: 2200, chests: [2200, 2201], legs: 2202 },
  variants: [variant(2199, { chestId: 2200, setBonusText: 'offense' }), variant(2199, { chestId: 2201, setBonusText: 'defense' })],
}
const wizard: Shape = { name: 'Wizard set', pieces: { helmets: [238, 2275], chest: 1282, chests: [1282, 2279] }, variants: [variant(238), variant(2275)] }
const names: Record<number, string> = { 553: 'Hallowed Mask', 558: 'Hallowed Headgear', 2200: 'Beetle Scale Mail', 2201: 'Beetle Shell', 238: 'Wizard Hat', 2275: 'Magic Hat', 1282: 'Amethyst Robe', 2279: 'Mystic Robe' }
const nameOf = (id: number) => names[id] ?? `#${id}`

describe('setCombos', () => {
  it('a one-chest set: one combination per helmet, keyed by the helmet id (pre-fix-round keys and URLs unchanged)', () => {
    expect(setCombos(hallowed).map((c) => [c.key, c.helmetId, c.chestId, c.legsId])).toEqual([
      ['553', 553, 551, 552],
      ['558', 558, 551, 552],
    ])
    expect(setChestIds(hallowed)).toEqual([551])
    expect(setPieceIds(hallowed)).toEqual([553, 558, 551, 552])
    expect(comboName(hallowed, setCombos(hallowed)[1], nameOf)).toBe('Hallowed armor (Hallowed Headgear)')
  })

  it('Beetle armor: the bonus keyed by the chest — one combination per variant, each with its own chest', () => {
    const combos = setCombos(beetle)
    expect(combos.map((c) => [c.key, c.chestId, c.variant.setBonusText])).toEqual([
      ['2199.2200', 2200, 'offense'],
      ['2199.2201', 2201, 'defense'],
    ])
    expect(comboDistinctIds(beetle, combos[1])).toEqual([2201])
    expect(comboName(beetle, combos[1], nameOf)).toBe('Beetle armor (Beetle Shell)')
    expect(wornCombo(beetle, 2199, 2201, 2202)?.variant.setBonusText).toBe('defense')
    expect(wornCombo(beetle, 2199, 2201, undefined)).toBeUndefined() // the legs piece is part of the set
  })

  it('the Wizard set: either hat with any robe (helmet × chest), no legs piece — any legs (or none) keep the bonus', () => {
    const combos = setCombos(wizard)
    expect(combos.map((c) => c.key)).toEqual(['238.1282', '238.2279', '2275.1282', '2275.2279'])
    expect(combos.every((c) => c.legsId === undefined)).toBe(true)
    expect(setPieceIds(wizard)).toEqual([238, 2275, 1282, 2279])
    expect(comboName(wizard, combos[3], nameOf)).toBe('Wizard set (Magic Hat, Mystic Robe)')
    expect(wornCombo(wizard, 2275, 2279, 99)?.variant.helmetId).toBe(2275)
    expect(wornCombo(wizard, 2275, 2279, undefined)?.variant.helmetId).toBe(2275)
    expect(wornCombo(wizard, 2275, 551, undefined)).toBeUndefined()
  })
})
