import { loadBosses, loadProgression, loadSpriteIndex } from '../../../data-access'
import type { Boss, ProgressionData, SpriteIndex } from '../../../data-access/types'

/** Sprite-manifest parts loaded with the page (AMENDMENTS-016 B104): the boss nodes; any other sprite loads on demand. */
const SPRITE_DIRS = ['bosses'] as const

/**
 * Data for /bosses: the progression graph, the boss records behind its boss nodes, and the sprite
 * manifest (optional: without it every node shows placeholder art — the safe direction for the
 * ADR D3 lever). Cached for the session so returning to the map renders on the first frame.
 */
export interface BossMapData {
  progression: ProgressionData
  bosses: readonly Boss[]
  /** null = manifest unavailable → placeholder art. */
  sprites: SpriteIndex | null
}

let cached: BossMapData | undefined

export async function loadBossMapData(): Promise<BossMapData> {
  const [progression, bosses, sprites] = await Promise.all([
    loadProgression(),
    loadBosses(),
    loadSpriteIndex(SPRITE_DIRS).catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  cached = { progression, bosses, sprites }
  return cached
}

export const peekBossMapData = (): BossMapData | undefined => cached
