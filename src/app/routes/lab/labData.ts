/**
 * Data for /lab: the weapon detail records (the sim needs `labBehavior` params and verified
 * stats; the browser filters every weapon by class, stage, rarity, source and damage) and the
 * sprite manifest. Both are the shared lazy data chunks the database pages use (ADR D7) — the Lab
 * adds no data of its own.
 */
import { loadDetailIndex, loadSpriteIndex, peekDetailIndex, peekSpriteIndex } from '../../../data-access'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { labWeapons } from '../../../lab/labWeapons'
import { browserRows, type LabBrowserRow } from './browserModel'

export interface LabData {
  /** Weapons the Lab can equip (picker order). */
  list: readonly Weapon[]
  /** Every weapon in the dataset, for the in-Lab browser (browse order, with simulation status). */
  rows: readonly LabBrowserRow[]
  byId: ReadonlyMap<number, Weapon>
  sprites: SpriteIndex | null
}

const derived = new WeakMap<ReadonlyMap<number, Weapon>, Pick<LabData, 'list' | 'rows'>>()

function derive(byId: ReadonlyMap<number, Weapon>): Pick<LabData, 'list' | 'rows'> {
  let data = derived.get(byId)
  if (!data) {
    data = { list: labWeapons(byId.values()), rows: browserRows(byId.values()) }
    derived.set(byId, data)
  }
  return data
}

export async function loadLabData(): Promise<LabData> {
  const [byId, sprites] = await Promise.all([
    loadDetailIndex('weapons'),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { ...derive(byId), byId, sprites }
}

export function peekLabData(): LabData | undefined {
  const byId = peekDetailIndex('weapons')
  return byId ? { ...derive(byId), byId, sprites: peekSpriteIndex() ?? null } : undefined
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
