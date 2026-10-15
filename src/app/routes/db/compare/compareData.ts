import { loadConditionIndex, loadDetailIndex, loadProgression, loadSpriteIndex } from '../../../../data-access'
import type { ConditionIndex, ProgressionData, SpriteIndex, Weapon } from '../../../../data-access/types'

/** Sprite-manifest parts loaded with the page (AMENDMENTS-016 B104): the compared weapons; any other sprite loads on demand. */
const SPRITE_DIRS = ['weapons'] as const

/**
 * Data for /compare (PRD P4-S1 [D: weapons dataset only]): every weapon record (the URL can name any),
 * the progression graph (gate names + tracked-progress satisfaction), the conditions registry
 * (requirement chips) and the sprite manifest (optional — placeholder art without it, the safe
 * direction for the ADR D3 lever). All lazy data chunks; cached for the session so returning to a
 * comparison renders on the first frame.
 */
export interface CompareData {
  weapons: ReadonlyMap<number, Weapon>
  graph: ProgressionData
  conditions: ConditionIndex
  /** null = manifest unavailable → placeholder art. */
  sprites: SpriteIndex | null
}

let cached: CompareData | undefined

export async function loadCompareData(): Promise<CompareData> {
  const [weapons, graph, conditions, sprites] = await Promise.all([
    loadDetailIndex('weapons'),
    loadProgression(),
    loadConditionIndex(),
    loadSpriteIndex(SPRITE_DIRS).catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  cached = { weapons, graph, conditions, sprites }
  return cached
}

export const peekCompareData = (): CompareData | undefined => cached
