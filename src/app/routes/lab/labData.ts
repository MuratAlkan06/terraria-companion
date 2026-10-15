/**
 * Data for /lab: the weapon detail records (the sim needs `labBehavior` params and verified
 * stats; the browser filters every weapon by class, stage, rarity, source and damage), the item
 * records (ammo for bows and guns, P3-S4), the buff registry (damage-over-time weapons), the
 * sprite manifest and the boss records (the Armored Dummy's verified boss-defense quick picks, P3-S12).
 * All are the shared lazy data chunks (ADR D7) — the Lab adds no data of its own. The sprites and the
 * bosses are optional: if either can't load, the Lab works without them (placeholder art; the Armored
 * Dummy's defense slider without the boss picks).
 */
import { loadBosses, loadBuffs, loadDetailIndex, loadItems, loadSpriteIndex, peekBosses, peekBuffs, peekDetailIndex, peekItems, peekSpriteIndex } from '../../../data-access'
import type { Boss, Buff, Item, SpriteIndex, Weapon } from '../../../data-access/types'
import { bossDefenses, type BossDefense } from '../../../lab/labBossDefense'
import { labSetup, type LabSetup } from '../../../lab/labSetup'
import { labWeapons } from '../../../lab/labWeapons'
import { browserRows, type LabBrowserRow } from './browserModel'

/** Sprite-manifest parts loaded with the page (AMENDMENTS-016 B104): the arena draws the equipped weapon's sprite from it; any other sprite loads on demand. */
const SPRITE_DIRS = ['weapons'] as const

export interface LabData {
  /** Weapons the Lab can equip (picker order). */
  list: readonly Weapon[]
  /** Every weapon in the dataset, for the in-Lab browser (browse order, with simulation status). */
  rows: readonly LabBrowserRow[]
  byId: ReadonlyMap<number, Weapon>
  /** Ammo and buffs handed to the engine (src/lab/labSetup.ts). */
  setup: LabSetup
  sprites: SpriteIndex | null
  /** Bosses whose verified defense the Armored Dummy offers (empty when the boss records couldn't load). */
  bossDefenses: readonly BossDefense[]
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

const bossPicks = new WeakMap<readonly Boss[], readonly BossDefense[]>()

/** The Armored Dummy's boss picks, derived once per loaded boss list. */
function picksOf(bosses: readonly Boss[] | null): readonly BossDefense[] {
  if (!bosses) return []
  let picks = bossPicks.get(bosses)
  if (!picks) bossPicks.set(bosses, (picks = bossDefenses(bosses)))
  return picks
}

export async function loadLabData(): Promise<LabData> {
  const [byId, items, buffs, sprites, bosses] = await Promise.all([
    loadDetailIndex('weapons'),
    loadItems(),
    loadBuffs(),
    loadSpriteIndex(SPRITE_DIRS).catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
    loadBosses().catch((error: unknown) => {
      console.warn('[lab] Boss records unavailable; the Armored Dummy offers no boss defense picks.', error)
      return null
    }),
  ])
  return { ...derive(byId, items, buffs), byId, sprites, bossDefenses: picksOf(bosses) }
}

/** Ready only once the boss records are in too (else the load fetches them; a failed boss load just leaves no picks). */
export function peekLabData(): LabData | undefined {
  const byId = peekDetailIndex('weapons')
  const items = peekItems()
  const buffs = peekBuffs()
  const bosses = peekBosses()
  return byId && items && buffs && bosses ? { ...derive(byId, items, buffs), byId, sprites: peekSpriteIndex(SPRITE_DIRS) ?? null, bossDefenses: picksOf(bosses) } : undefined
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
