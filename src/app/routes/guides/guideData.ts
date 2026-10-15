import { loadSearchDocs, loadSpriteIndex } from '../../../data-access'
import type { SpriteIndex } from '../../../data-access/types'
import type { SearchDoc } from '../../../schemas'

/**
 * Data behind a guide's links: the SearchDocs (every entity's id, type, name, rarity, wiki page and
 * sprite path — the same index global search uses) and the sprite index (null when unavailable: slots
 * then show placeholder art, the safe direction for the ADR D3 lever). Cached for the session so a
 * second guide renders on its first frame.
 */
export interface GuideData {
  docs: ReadonlyMap<string, SearchDoc>
  sprites: SpriteIndex | null
  /**
   * Sprite path by entity ref, from each search doc's own `sprite` (AMENDMENTS-016 B104: the record's own
   * path — never guessed from ids). The slots load the manifest part that lists it on demand.
   */
  spriteByRef: ReadonlyMap<string, string>
}

let cached: GuideData | undefined

export async function loadGuideData(): Promise<GuideData> {
  const [docs, sprites] = await Promise.all([
    loadSearchDocs(),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  cached = buildGuideData(docs, sprites)
  return cached
}

export const peekGuideData = (): GuideData | undefined => cached

export function buildGuideData(docs: readonly SearchDoc[], sprites: SpriteIndex | null): GuideData {
  const spriteByRef = new Map<string, string>()
  for (const doc of docs) if (doc.sprite) spriteByRef.set(doc.id, doc.sprite)
  return { docs: new Map(docs.map((doc) => [doc.id, doc])), sprites, spriteByRef }
}
