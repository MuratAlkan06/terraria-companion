/**
 * /favorites model (PRD P7-S1): stored refs (tc.v1.favorites) → entries grouped by entity type,
 * each with the page it links to. Pure, so the resolution rules are unit-testable.
 *
 * - Groups: Weapons, then Bosses; empty groups are omitted. Within a group: stored order (most
 *   recently starred first).
 * - Refs that don't resolve against the shipped dataset — a removed item, a non-weapon item id, a
 *   boss slug that's gone, an entity type with no local page yet — are skipped silently (dataset
 *   drift). They stay in storage, so a dataset that regains the entity shows it again.
 * - Links: weapon → its detail page; boss → its page where one ships, else its node on the boss
 *   map (focus card open) — always a working link, never a dead one.
 */
import type { Boss, WeaponListRecord } from '../../../data-access/types'
import { bossMapHref, bossPageHref } from '../bosses/bossNav'
import { weaponHref } from '../db/weapons/weaponNav'

export interface FavoriteWeapon {
  kind: 'weapon'
  ref: string
  name: string
  href: string
  weapon: WeaponListRecord
}

export interface FavoriteBoss {
  kind: 'boss'
  ref: string
  name: string
  href: string
  boss: Boss
}

export type FavoriteEntry = FavoriteWeapon | FavoriteBoss

export type FavoriteGroupId = 'weapons' | 'bosses'

export interface FavoriteGroup {
  id: FavoriteGroupId
  title: string
  entries: FavoriteEntry[]
}

export interface FavoriteSources {
  weaponsById: ReadonlyMap<number, WeaponListRecord>
  bossesById: ReadonlyMap<string, Boss>
}

const GROUPS: ReadonlyArray<{ id: FavoriteGroupId; title: string; kind: FavoriteEntry['kind'] }> = [
  { id: 'weapons', title: 'Weapons', kind: 'weapon' },
  { id: 'bosses', title: 'Bosses', kind: 'boss' },
]

const ITEM_REF = /^i:(\d+)$/
const BOSS_REF = /^boss:([a-z0-9-]+)$/

/** The entry behind one stored ref, or undefined when it doesn't resolve (skipped silently). */
export function resolveFavorite(ref: string, sources: FavoriteSources): FavoriteEntry | undefined {
  const item = ITEM_REF.exec(ref)
  if (item) {
    const weapon = sources.weaponsById.get(Number(item[1]))
    return weapon ? { kind: 'weapon', ref, name: weapon.name, href: weaponHref(weapon.id), weapon } : undefined
  }
  const bossMatch = BOSS_REF.exec(ref)
  if (bossMatch) {
    const boss = sources.bossesById.get(bossMatch[1])
    return boss ? { kind: 'boss', ref, name: boss.name, href: bossPageHref(boss.id) ?? bossMapHref(boss.nodeId), boss } : undefined
  }
  return undefined
}

/** Stored refs → non-empty groups in display order; repeats and unresolvable refs are dropped. */
export function groupFavorites(refs: readonly string[], sources: FavoriteSources): FavoriteGroup[] {
  const entries: FavoriteEntry[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const entry = resolveFavorite(ref, sources)
    if (entry) entries.push(entry)
  }
  return GROUPS.map(({ id, title, kind }) => ({ id, title, entries: entries.filter((e) => e.kind === kind) })).filter(
    (group) => group.entries.length > 0,
  )
}

/**
 * Where keyboard focus goes after `removedRef` leaves the page: the next entry's star in reading
 * order, else the previous one's, else null (the list is now empty — the caller focuses the title).
 */
export function focusAfterRemoval(groups: readonly FavoriteGroup[], removedRef: string): string | null {
  const order = groups.flatMap((group) => group.entries.map((entry) => entry.ref))
  const index = order.indexOf(removedRef)
  if (index === -1) return null
  return order[index + 1] ?? order[index - 1] ?? null
}
