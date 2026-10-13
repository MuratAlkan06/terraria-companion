/**
 * Sprite manifest `public/sprites/manifest.json` (DATA_SCHEMA_SPEC §5, ADR-001 D3,
 * AMENDMENTS-001 A10). Item sprites are Re-Logic IP: the image files are downloaded locally
 * (gitignored, never committed) and only this manifest is committed. Every file records the wiki
 * file page it came from. `fallbackMode: true` is the D3 takedown lever — the app then renders
 * the original placeholder art for every item instead of any wiki sprite.
 */
import * as z from 'zod'
import { PlainText1, TypedRef, WikiUrl } from './common'

/**
 * AMENDMENTS-007 B30: a static PNG thumbnail of a heavy sprite (file > 100 KB): its first frame,
 * downscaled by a whole-number factor (pixel art is never resampled fractionally, cf.
 * src/components/spriteScale.ts) to at most 128 px on the long edge. Generated locally from the
 * verified binary by `npm run pipeline:sprites` (same rights and A10 handling as the sprite itself);
 * rows and cards use it, the full file only on detail / boss pages.
 */
export const SpriteThumbnail = z.strictObject({
  path: z.string().regex(/^\/sprites\/thumbs\/[a-z]+\/\d+\.png$/),
  width: z.int().positive(),
  height: z.int().positive(),
})
export type SpriteThumbnail = z.infer<typeof SpriteThumbnail>

export const SpriteManifestFile = z.strictObject({
  /** Public path the app requests, e.g. "/sprites/weapons/4956.png". */
  path: z.string().regex(/^\/sprites\/[a-z]+\/\d+\.(?:png|gif)$/),
  ref: TypedRef,
  /** The wiki's File: description page (provenance + rights). */
  wikiFileUrl: WikiUrl,
  sha1: z.string().regex(/^[0-9a-f]{40}$/),
  bytes: z.int().positive(),
  width: z.int().positive(),
  height: z.int().positive(),
  rights: z.literal('re-logic'),
  thumbnail: SpriteThumbnail.optional(),
})
export type SpriteManifestFile = z.infer<typeof SpriteManifestFile>

export const SpriteManifest = z.strictObject({
  fallbackMode: z.boolean(),
  rightsNote: PlainText1,
  files: z.array(SpriteManifestFile),
})
export type SpriteManifest = z.infer<typeof SpriteManifest>
