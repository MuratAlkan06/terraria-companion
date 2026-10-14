/**
 * Data for /favorites (PRD P7-S1): the weapon list and the boss records the stored refs resolve
 * against, plus the sprite manifest (null = unavailable → placeholder art, the safe direction for
 * the D3 lever). Loaded only when there is something to resolve; the page shows its empty state
 * without any of it.
 */
import { loadBosses, loadList, loadSpriteIndex, peekBosses, peekList, peekSpriteIndex } from '../../../data-access'
import type { Boss, SpriteIndex, WeaponListRecord } from '../../../data-access/types'
import type { FavoriteSources } from './favoritesModel'

export interface FavoritesPageData extends FavoriteSources {
  sprites: SpriteIndex | null
}

function pageData(weapons: readonly WeaponListRecord[], bosses: readonly Boss[], sprites: SpriteIndex | null): FavoritesPageData {
  return {
    weaponsById: new Map(weapons.map((w) => [w.id, w])),
    bossesById: new Map(bosses.map((b) => [b.id, b])),
    sprites,
  }
}

export async function loadFavoritesData(): Promise<FavoritesPageData> {
  const [weapons, bosses, sprites] = await Promise.all([
    loadList('weapons'),
    loadBosses(),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return pageData(weapons, bosses, sprites)
}

export function peekFavoritesData(): FavoritesPageData | undefined {
  const weapons = peekList('weapons')
  const bosses = peekBosses()
  return weapons && bosses ? pageData(weapons, bosses, peekSpriteIndex() ?? null) : undefined
}
