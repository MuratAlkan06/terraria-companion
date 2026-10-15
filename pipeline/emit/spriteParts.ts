/**
 * AMENDMENTS-016 B104 sprite-manifest split (src/schemas/spriteParts.ts, SpriteManifestIndex / Part). The
 * complete manifest (public/sprites/manifest.json) stays the committed provenance record; the app reads
 * the small index and only the parts it needs instead of the whole 270 KB gz file. One part per sprite
 * directory (weapons, armor, accessories, bosses), the item directory split by item-id range (the
 * items.detail.<n>.json shard size), each entry projected onto SpriteEntry. Pure + deterministic: parts
 * ordered by directory then range, entries keep the manifest's path order.
 */
import { SpriteEntry, spritePartFile, spritePathKey, type SpriteManifest, type SpriteManifestIndex, type SpriteManifestPart } from '../../src/schemas'
import { serializeRecords } from './write'

/** Directories split by id range (the rest are one part each). */
export const RANGED_SPRITE_DIRS: ReadonlySet<string> = new Set(['items'])
/** Runtime part files in public/sprites/ (the index is manifest.index.json, the full record manifest.json). */
export const SPRITE_PART_FILE = /^manifest\.[a-z]+(?:\.\d+)?\.json$/

const ENTRY_KEYS = Object.keys(SpriteEntry.shape) as (keyof SpriteEntry)[]

export function splitSpriteManifest(manifest: SpriteManifest, itemPartSize: number): { index: SpriteManifestIndex; parts: SpriteManifestPart[] } {
  const groups = new Map<string, { dir: string; ids?: [number, number]; files: SpriteEntry[] }>()
  for (const file of manifest.files) {
    const key = spritePathKey(file.path)
    if (!key) throw new Error(`sprite path ${file.path} is not /sprites/<dir>/<id>.<ext>`)
    const ranged = RANGED_SPRITE_DIRS.has(key.dir)
    const n = Math.floor(key.id / itemPartSize)
    const part = ranged ? `${key.dir}.${n}` : key.dir
    const group = groups.get(part) ?? { dir: key.dir, ...(ranged ? { ids: [n * itemPartSize, (n + 1) * itemPartSize - 1] as [number, number] } : {}), files: [] }
    const entry = Object.fromEntries(ENTRY_KEYS.flatMap((k) => (file[k] === undefined ? [] : [[k, file[k]]]))) as SpriteEntry
    group.files.push(entry)
    groups.set(part, group)
  }
  const order = [...groups].sort(([a, ga], [b, gb]) => ga.dir.localeCompare(gb.dir) || (ga.ids?.[0] ?? 0) - (gb.ids?.[0] ?? 0) || a.localeCompare(b))
  return {
    index: {
      fallbackMode: manifest.fallbackMode,
      rightsNote: manifest.rightsNote,
      parts: order.map(([part, g]) => ({ part, file: spritePartFile(part), dir: g.dir, ...(g.ids ? { ids: g.ids } : {}), count: g.files.length })),
    },
    parts: order.map(([part, g]) => ({ part, files: g.files })),
  }
}

/** manifest.index.json text: one part per line (compact, diff-friendly). */
export const serializeSpriteIndex = (index: SpriteManifestIndex): string =>
  `{"fallbackMode":${JSON.stringify(index.fallbackMode)},"rightsNote":${JSON.stringify(index.rightsNote)},"parts":${serializeRecords(index.parts).trimEnd()}}\n`

/** manifest.<part>.json text: one sprite per line. */
export const serializeSpritePart = (part: SpriteManifestPart): string => `{"part":${JSON.stringify(part.part)},"files":${serializeRecords(part.files).trimEnd()}}\n`
