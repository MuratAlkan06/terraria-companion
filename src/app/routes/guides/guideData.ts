import { loadSearchDocs, loadSpriteIndex } from '../../../data-access'
import type { SpriteIndex } from '../../../data-access/types'
import type { SearchDoc } from '../../../schemas'

/**
 * Data behind a guide's links: the SearchDocs (every entity's id, type, name, rarity and wiki
 * page — the same index global search uses) and the sprite manifest (null when unavailable: slots
 * then show placeholder art, the safe direction for the ADR D3 lever). Cached for the session so a
 * second guide renders on its first frame.
 */
export interface GuideData {
  docs: ReadonlyMap<string, SearchDoc>
  sprites: SpriteIndex | null
  /** Sprite path by entity ref, from the manifest's own `ref` field (never guessed from ids). */
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
  for (const file of sprites?.byPath.values() ?? []) {
    if (!spriteByRef.has(file.ref)) spriteByRef.set(file.ref, file.path)
  }
  return { docs: new Map(docs.map((doc) => [doc.id, doc])), sprites, spriteByRef }
}
