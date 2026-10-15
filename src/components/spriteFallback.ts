import type { SpriteIndex } from '../data-access/types'

/** Why the placeholder silhouette stands in for the sprite. */
export type SpriteFallback = 'no-sprite' | 'unlisted' | 'failed' | 'placeholder-mode'

/**
 * The fallback reason for a box (pure): no `sprite` on the record; the takedown lever or the user's
 * placeholder setting; the manifest doesn't list it (or isn't available); the file failed to load.
 * Undefined while the sprite draws — or while the manifest part listing it is still on its way.
 */
export function spriteFallback(o: { src: string | undefined; sprites: SpriteIndex | null | undefined; userFallback: boolean; listed: boolean; loadingPart: boolean; failed: boolean }): SpriteFallback | undefined {
  if (o.src === undefined) return 'no-sprite'
  if (o.sprites?.fallbackMode || o.userFallback) return 'placeholder-mode'
  if (!o.listed) return o.loadingPart ? undefined : 'unlisted'
  return o.failed ? 'failed' : undefined
}
