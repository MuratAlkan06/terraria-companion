/**
 * Homepage v2 data (PRD P2-S5, UX_SPEC §3.2): the daily featured picks and the "Recently viewed"
 * rail. Pure selection/resolution rules live here so they are unit-testable; the components in
 * this folder only render them.
 *
 * - Featured: one weapon + one boss per local calendar day, chosen deterministically from the
 *   date (no server, no randomness), so every visit on the same day shows the same picks.
 * - Recent: `tc.v1.recent` refs resolved against the shipped weapon list; refs that no longer
 *   resolve (removed item, entity type without a local page) are skipped silently.
 */
import { asRarity } from '../../../components/rarity'
import {
  loadAccessoryList,
  loadArmorList,
  loadBosses,
  loadList,
  loadSpriteIndex,
  peekAccessoryList,
  peekArmorList,
  peekBosses,
  peekList,
  peekSpriteIndex,
} from '../../../data-access'
import type { AccessoryListRecord, ArmorListRecord, Boss, SpriteIndex, WeaponListRecord } from '../../../data-access/types'
import { loadDomain, type StorageBackend } from '../../../storage'
import type { RecentEntry } from '../../../storage/recent'
import type { ResourceState } from '../../useResource'

const MS_PER_DAY = 86_400_000

/** Days since 1970-01-01 for the LOCAL calendar date of `date` (the featured picks change at local midnight). */
export function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY)
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

/**
 * Day-to-day stride through a pool of `n`: about n·(1 − 1/φ), bumped until coprime with `n`.
 * Coprime ⇒ day ↦ index is a permutation: consecutive days never repeat (n > 1) and every
 * entry is featured once per `n` days. The large stride keeps neighbouring days far apart in
 * the id-sorted pool (no run of near-identical weapons).
 */
function strideFor(n: number): number {
  let stride = Math.max(1, Math.round(n * 0.381966))
  while (gcd(stride, n) !== 1) stride++
  return stride
}

/** The pool entry for `day`; undefined for an empty pool. Order the pool stably before calling. */
export function pickForDay<T>(pool: readonly T[], day: number): T | undefined {
  const n = pool.length
  if (n === 0) return undefined
  return pool[(((day * strideFor(n)) % n) + n) % n]
}

/**
 * Weapons that can fill every field the featured card shows: sprite, rarity, class and a damage
 * value. List records are projections of detail records and the pipeline never emits an
 * unverified value (E_UNVERIFIED_VALUE_EMITTED), so a present `damage` is a verified stat
 * (home.test.ts checks this against the detail `_prov`). Sorted by id: independent of file order.
 */
export function featuredWeaponPool(list: readonly WeaponListRecord[]): WeaponListRecord[] {
  return list
    .filter((w) => w.sprite !== undefined && w.damage !== undefined && w.damageClass !== undefined && asRarity(w.rarity) !== undefined)
    .sort((a, b) => a.id - b.id)
}

export function pickFeaturedWeapon(list: readonly WeaponListRecord[], date: Date): WeaponListRecord | undefined {
  return pickForDay(featuredWeaponPool(list), localDayNumber(date))
}

/** Undefined when the dataset has no bosses: the boss card is then absent (AMENDMENTS-001 A17). */
export function pickFeaturedBoss(bosses: readonly Boss[], date: Date): Boss | undefined {
  const pool = [...bosses].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return pickForDay(pool, localDayNumber(date))
}

// ---------------------------------------------------------------------------------------------
// Recently viewed

export interface RecentWeapon {
  ref: string
  weapon: WeaponListRecord
}

const ITEM_REF = /^i:(\d+)$/

/**
 * Stored entries (most recent first) → weapons with a detail page, same order. Skipped silently:
 * item ids not in the weapon list, refs of entity types that have no local page yet, and repeats.
 */
export function resolveRecent(
  entries: readonly RecentEntry[],
  weaponsById: ReadonlyMap<number, WeaponListRecord>,
): RecentWeapon[] {
  const seen = new Set<string>()
  const resolved: RecentWeapon[] = []
  for (const { ref } of entries) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const match = ITEM_REF.exec(ref)
    const weapon = match ? weaponsById.get(Number(match[1])) : undefined
    if (weapon) resolved.push({ ref, weapon })
  }
  return resolved
}

/**
 * The stored recent list, or [] when there is none / storage is unavailable. An unreadable
 * payload is quarantined by loadDomain (set aside, not deleted) and reads as empty here.
 */
export function readRecentEntries(backend?: StorageBackend | null): RecentEntry[] {
  // `undefined` falls through to loadDomain's default backend (localStorage).
  const result = loadDomain('recent', backend)
  return result.kind === 'loaded' ? result.data.entries : []
}

// ---------------------------------------------------------------------------------------------
// Loading

export interface HomeData {
  weapons: readonly WeaponListRecord[]
  weaponsById: ReadonlyMap<number, WeaponListRecord>
  bosses: readonly Boss[]
  /** null = sprite manifest unavailable → placeholder art. */
  sprites: SpriteIndex | null
}

/** The page-level `useResource` over loadHomeData, shared by the featured row and the rail. */
export type HomeResource = ResourceState<HomeData> & { retry: () => void }

function homeData(weapons: readonly WeaponListRecord[], bosses: readonly Boss[], sprites: SpriteIndex | null): HomeData {
  return { weapons, weaponsById: new Map(weapons.map((w) => [w.id, w])), bosses, sprites }
}

export async function loadHomeData(): Promise<HomeData> {
  const [weapons, bosses, sprites] = await Promise.all([
    loadList('weapons'),
    loadBosses(),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return homeData(weapons, bosses, sprites)
}

export function peekHomeData(): HomeData | undefined {
  const weapons = peekList('weapons')
  const bosses = peekBosses()
  return weapons && bosses ? homeData(weapons, bosses, peekSpriteIndex() ?? null) : undefined
}

// ---------------------------------------------------------------------------------------------
// Saved-builds rail (PRD P4-S4 AC4; UX_SPEC §3.2 SavedBuildsRail)

/**
 * The armor and accessory list records the rail's previews read (names + sprites; weapons come from
 * the home data). Loaded only when the rail shows — when builds exist. Ammo and potions have no light
 * list (items.list is the whole encyclopedia), so the rail counts them without a square.
 */
export interface BuildPreviewData {
  armor: ReadonlyMap<number, ArmorListRecord>
  accessories: ReadonlyMap<number, AccessoryListRecord>
}

const previewData = (armor: readonly ArmorListRecord[], accessories: readonly AccessoryListRecord[]): BuildPreviewData => ({
  armor: new Map(armor.map((a) => [a.id, a])),
  accessories: new Map(accessories.map((a) => [a.id, a])),
})

export async function loadBuildPreviewData(): Promise<BuildPreviewData> {
  const [armor, accessories] = await Promise.all([loadArmorList(), loadAccessoryList()])
  return previewData(armor, accessories)
}

export function peekBuildPreviewData(): BuildPreviewData | undefined {
  const armor = peekArmorList()
  const accessories = peekAccessoryList()
  return armor && accessories ? previewData(armor, accessories) : undefined
}

/** One square of a build's preview: an item with a light list record (weapon, armor, accessory). */
export interface PreviewItem {
  id: number
  name: string
  sprite?: string
  rarity?: number | string
  damageClass?: string
}

/** The previewable items of a build (in `ids` order); ammo and potions — no light record — are left to the count. */
export function previewItems(ids: readonly number[], weapons: ReadonlyMap<number, WeaponListRecord>, data: BuildPreviewData): PreviewItem[] {
  const out: PreviewItem[] = []
  for (const id of ids) {
    const w = weapons.get(id)
    const r = w ?? data.armor.get(id) ?? data.accessories.get(id)
    if (!r) continue
    out.push({ id, name: r.name, ...(r.sprite ? { sprite: r.sprite } : {}), ...(r.rarity !== undefined ? { rarity: r.rarity } : {}), ...(w?.damageClass ? { damageClass: w.damageClass } : {}) })
  }
  return out
}
