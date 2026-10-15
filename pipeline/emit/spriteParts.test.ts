import { describe, expect, it } from 'vitest'
import { SpriteManifestIndex, SpriteManifestPart, spritePartFor, spritePathKey, type SpriteManifest } from '../../src/schemas'
import { serializeSpriteIndex, serializeSpritePart, splitSpriteManifest } from './spriteParts'

const file = (path: string, ref: string, extra: Partial<SpriteManifest['files'][number]> = {}): SpriteManifest['files'][number] => ({
  path,
  ref,
  wikiFileUrl: `https://terraria.wiki.gg/wiki/File:${ref.replace(/\W/g, '_')}.png`,
  sha1: 'a'.repeat(40),
  bytes: 200,
  width: 20,
  height: 24,
  rights: 're-logic',
  ...extra,
})

const manifest: SpriteManifest = {
  fallbackMode: false,
  rightsNote: 'Item sprites are Terraria content © Re-Logic.',
  files: [
    file('/sprites/accessories/111.png', 'i:111'),
    file('/sprites/bosses/113.gif', 'boss:wall-of-flesh', { bytes: 668777, width: 210, height: 420, thumbnail: { path: '/sprites/thumbs/bosses/113.png', width: 53, height: 105 } }),
    file('/sprites/items/2.png', 'i:2'),
    file('/sprites/items/999.png', 'i:999'),
    file('/sprites/items/1000.png', 'i:1000'),
    file('/sprites/items/5043.gif', 'i:5043'),
    file('/sprites/weapons/4956.png', 'i:4956'),
  ],
}

describe('AMENDMENTS-016 B104 sprite-manifest split', () => {
  const { index, parts } = splitSpriteManifest(manifest, 1000)

  it('one part per directory, the item directory per 1,000-id range; entries are the SpriteEntry projection', () => {
    expect(SpriteManifestIndex.parse(index)).toBeTruthy()
    expect(index.parts.map((p) => [p.part, p.file, p.dir, p.ids, p.count])).toEqual([
      ['accessories', 'manifest.accessories.json', 'accessories', undefined, 1],
      ['bosses', 'manifest.bosses.json', 'bosses', undefined, 1],
      ['items.0', 'manifest.items.0.json', 'items', [0, 999], 2],
      ['items.1', 'manifest.items.1.json', 'items', [1000, 1999], 1],
      ['items.5', 'manifest.items.5.json', 'items', [5000, 5999], 1],
      ['weapons', 'manifest.weapons.json', 'weapons', undefined, 1],
    ])
    for (const part of parts) expect(SpriteManifestPart.parse(part)).toBeTruthy()
    const boss = parts.find((p) => p.part === 'bosses')!.files[0]
    // no SHA-1 / byte size / rights in the runtime entry (the provenance record keeps them); thumbnail kept
    expect(boss).toEqual({ path: '/sprites/bosses/113.gif', ref: 'boss:wall-of-flesh', wikiFileUrl: manifest.files[1].wikiFileUrl, width: 210, height: 420, thumbnail: { path: '/sprites/thumbs/bosses/113.png', width: 53, height: 105 } })
    expect(index).toMatchObject({ fallbackMode: false, rightsNote: manifest.rightsNote })
  })

  it('every path resolves to the part listing it; thumbnails and foreign paths resolve to none', () => {
    for (const part of parts) for (const f of part.files) expect(spritePartFor(index.parts, f.path)?.part, f.path).toBe(part.part)
    expect(spritePartFor(index.parts, '/sprites/items/3500.png')).toBeUndefined() // no items.3 part in this manifest
    expect(spritePartFor(index.parts, '/sprites/thumbs/bosses/113.png')).toBeUndefined()
    expect(spritePathKey('/sprites/items/1000.png')).toEqual({ dir: 'items', id: 1000 })
    expect(spritePathKey('https://example.com/x.png')).toBeUndefined()
  })

  it('serializes deterministically (one record per line) and round-trips', () => {
    const text = serializeSpriteIndex(index)
    expect(text).toBe(serializeSpriteIndex(splitSpriteManifest(manifest, 1000).index))
    expect(JSON.parse(text)).toEqual(index)
    const part = parts[2]
    expect(serializeSpritePart(part).split('\n')).toHaveLength(part.files.length + 3)
    expect(JSON.parse(serializeSpritePart(part))).toEqual(part)
  })

  it('carries the D3 lever: a manifest in fallbackMode yields an index in fallbackMode', () => {
    expect(splitSpriteManifest({ ...manifest, fallbackMode: true }, 1000).index.fallbackMode).toBe(true)
  })
})
