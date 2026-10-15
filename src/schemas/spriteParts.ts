/**
 * Sprite manifest parts (AMENDMENTS-016 B104 "sprite-manifest split/lazy"): which runtime manifest part
 * lists a sprite path. `public/sprites/manifest.index.json` names every part with the sprite directory it
 * covers and, for the item directory, the item-id range (`ids`, inclusive); a sprite path
 * `/sprites/<dir>/<id>.<ext>` belongs to the part of its directory whose range holds its id. Shared by
 * the pipeline (which writes the parts) and the app's data access (which loads only the parts it needs).
 * Zod-free on purpose: the app imports it (schemas: ./sprites.ts).
 */

/** File name of the runtime index in public/sprites/. */
export const SPRITE_INDEX_FILE = 'manifest.index.json'

/** One index entry (shape validated by SpriteManifestIndex in ./sprites.ts). */
export interface SpritePartRef {
  /** Part id, e.g. "weapons", "items.3". */
  part: string
  /** File in public/sprites/, e.g. "manifest.items.3.json". */
  file: string
  /** Sprite directory the part covers ("weapons", "items", …). */
  dir: string
  /** Inclusive id range within `dir` (ranged directories only). */
  ids?: readonly [number, number]
  /** Files the part lists. */
  count: number
}

/** The runtime manifest file of a part id. */
export const spritePartFile = (part: string): string => `manifest.${part}.json`

/** `/sprites/<dir>/<id>.<ext>` → its directory and id; undefined for anything else (thumbnails included). */
export function spritePathKey(path: string): { dir: string; id: number } | undefined {
  const m = /^\/sprites\/([a-z]+)\/(\d+)\.(?:png|gif)$/.exec(path)
  return m ? { dir: m[1], id: Number(m[2]) } : undefined
}

/** The part that would list `path` (undefined when no part covers it). */
export function spritePartFor<P extends SpritePartRef>(parts: readonly P[], path: string): P | undefined {
  const key = spritePathKey(path)
  if (!key) return undefined
  return parts.find((p) => p.dir === key.dir && (p.ids === undefined || (key.id >= p.ids[0] && key.id <= p.ids[1])))
}
