/**
 * Sprite manifest `public/sprites/manifest.json` (DATA_SCHEMA_SPEC §5, ADR-001 D3,
 * AMENDMENTS-001 A10). Item sprites are Re-Logic IP: the image files are downloaded locally
 * (gitignored, never committed) and only this manifest is committed. Every file records the wiki
 * file page it came from. `fallbackMode: true` is the D3 takedown lever — the app then renders
 * the original placeholder art for every item instead of any wiki sprite.
 */
import * as z from 'zod'
import { PlainText1, TypedRef, WikiUrl } from './common'

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
})
export type SpriteManifestFile = z.infer<typeof SpriteManifestFile>

export const SpriteManifest = z.strictObject({
  fallbackMode: z.boolean(),
  rightsNote: PlainText1,
  files: z.array(SpriteManifestFile),
})
export type SpriteManifest = z.infer<typeof SpriteManifest>
