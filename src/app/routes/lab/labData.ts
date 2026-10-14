/**
 * Data for /lab: the weapon detail records (the sim needs `labBehavior` params and verified
 * stats; the browser filters every weapon by class, stage, rarity, source and damage), the item
 * records (ammo for bows and guns, P3-S4), the buff registry (damage-over-time weapons) and the
 * sprite manifest. All are the shared lazy data chunks (ADR D7) — the Lab adds no data of its own.
 */
import { loadBuffs, loadDetailIndex, loadItems, loadSpriteIndex, peekBuffs, peekDetailIndex, peekItems, peekSpriteIndex } from '../../../data-access'
import type { Buff, Item, SpriteIndex, Weapon } from '../../../data-access/types'
import { labSetup, type LabSetup } from '../../../lab/labSetup'
import { labWeapons } from '../../../lab/labWeapons'
import { browserRows, type LabBrowserRow } from './browserModel'

export interface LabData {
  /** Weapons the Lab can equip (picker order). */
  list: readonly Weapon[]
  /** Every weapon in the dataset, for the in-Lab browser (browse order, with simulation status). */
  rows: readonly LabBrowserRow[]
  byId: ReadonlyMap<number, Weapon>
  /** Ammo and buffs handed to the engine (src/lab/labSetup.ts). */
  setup: LabSetup
  sprites: SpriteIndex | null
}

type Derived = Pick<LabData, 'list' | 'rows' | 'setup'>

// One derivation per loaded dataset (the loaders are session singletons, so these keys are stable).
const derived = new WeakMap<ReadonlyMap<number, Weapon>, WeakMap<readonly Item[], WeakMap<readonly Buff[], Derived>>>()

function derive(byId: ReadonlyMap<number, Weapon>, items: readonly Item[], buffs: readonly Buff[]): Derived {
  let byItems = derived.get(byId)
  if (!byItems) derived.set(byId, (byItems = new WeakMap()))
  let byBuffs = byItems.get(items)
  if (!byBuffs) byItems.set(items, (byBuffs = new WeakMap()))
  let data = byBuffs.get(buffs)
  if (!data) {
    const setup = labSetup(items, buffs)
    data = { setup, list: labWeapons(byId.values(), setup), rows: browserRows(byId.values(), setup) }
    byBuffs.set(buffs, data)
  }
  return data
}

export async function loadLabData(): Promise<LabData> {
  const [byId, items, buffs, sprites] = await Promise.all([
    loadDetailIndex('weapons'),
    loadItems(),
    loadBuffs(),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { ...derive(byId, items, buffs), byId, sprites }
}

export function peekLabData(): LabData | undefined {
  const byId = peekDetailIndex('weapons')
  const items = peekItems()
  const buffs = peekBuffs()
  return byId && items && buffs ? { ...derive(byId, items, buffs), byId, sprites: peekSpriteIndex() ?? null } : undefined
}

/**
 * The file the arena draws for a weapon, or null for the original placeholder art — the same
 * rules as SpriteImg: no sprite, unlisted, takedown fallback mode (ADR D3), or the user's
 * placeholder-art setting.
 */
export function arenaSpriteUrl(weapon: Weapon, sprites: SpriteIndex | null, userFallback: boolean): string | null {
  const entry = weapon.sprite ? sprites?.byPath.get(weapon.sprite) : undefined
  if (!entry || !sprites || sprites.fallbackMode || userFallback) return null
  return entry.path
}
