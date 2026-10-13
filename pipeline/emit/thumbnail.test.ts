/* B30 sprite thumbnails: GIF first-frame decoding (against a test-side standard LZW encoder), whole-number
 * downscaling, PNG encoding, and the manifest thumbnail rule. The real heavy boss GIFs are gitignored
 * binaries (A10), so CI uses synthetic GIFs; the P2-S7 slice compared all three against macOS sips. */
import { crc32, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeGifFirstFrame, downscale, encodePng, gifThumbnail, ImageDecodeError, lzwDecode, thumbnailFor, type Rgba } from './thumbnail'

/** GIF LZW encoder (the standard encoder's rule: widen the code before assigning code 2^size). */
function lzwEncode(indices: readonly number[], minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let size = minCodeSize + 1
  let next = end + 1
  let table = new Map<number, number>()
  const out: number[] = []
  let buf = 0
  let bits = 0
  const write = (code: number) => {
    buf |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(buf & 255)
      buf >>>= 8
      bits -= 8
    }
  }
  write(clear)
  let prefix = indices[0]
  for (const k of indices.slice(1)) {
    const key = (prefix << 8) | k
    const code = table.get(key)
    if (code !== undefined) {
      prefix = code
      continue
    }
    write(prefix)
    if (next === 4096) {
      write(clear)
      size = minCodeSize + 1
      next = end + 1
      table = new Map()
    } else {
      if (next >= 1 << size) size += 1
      table.set(key, next++)
    }
    prefix = k
  }
  write(prefix)
  write(end)
  if (bits > 0) out.push(buf & 255)
  return Uint8Array.from(out)
}

const subBlocks = (data: Uint8Array): number[] => {
  const out: number[] = []
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, i + 255)
    out.push(chunk.length, ...chunk)
  }
  return [...out, 0]
}
const le16 = (n: number) => [n & 255, n >> 8]

interface Frame {
  left: number
  top: number
  w: number
  h: number
  indices: number[]
  interlaced?: boolean
  transparent?: number
}

/** A GIF89a with a 4-color global palette (red, green, blue, white) and the given frames. */
function gif(width: number, height: number, frames: Frame[]): Uint8Array {
  const bytes = [...'GIF89a'].map((c) => c.charCodeAt(0))
  bytes.push(...le16(width), ...le16(height), 0x80 | 0x01, 0, 0) // global table of 4 colors
  bytes.push(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255)
  bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0) // an application extension to skip
  for (const f of frames) {
    if (f.transparent !== undefined) bytes.push(0x21, 0xf9, 4, 0x01, 10, 0, f.transparent, 0)
    bytes.push(0x2c, ...le16(f.left), ...le16(f.top), ...le16(f.w), ...le16(f.h), f.interlaced ? 0x40 : 0)
    bytes.push(2, ...subBlocks(lzwEncode(f.indices, 2)))
  }
  bytes.push(0x3b)
  return Uint8Array.from(bytes)
}

const px = (img: Rgba, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]
const RED = [255, 0, 0, 255]
const GREEN = [0, 255, 0, 255]
const BLUE = [0, 0, 255, 255]
const NONE = [0, 0, 0, 0]

describe('LZW (GIF variable-width codes)', () => {
  it('round-trips data that exercises dictionary growth, the KwKwK case and the 4096-entry reset', () => {
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (const minCodeSize of [2, 4, 8]) {
      const symbols = 1 << minCodeSize
      const data = [
        ...Array.from({ length: 5000 }, () => Math.floor(rand() * symbols)),
        ...Array(3000).fill(1), // long runs → code === next (KwKwK)
        ...Array.from({ length: 9000 }, () => Math.floor(rand() * Math.min(3, symbols))),
      ]
      expect([...lzwDecode(lzwEncode(data, minCodeSize), minCodeSize, data.length)]).toEqual(data)
    }
  })

  it('rejects an invalid minimum code size and a stream starting with a non-literal', () => {
    expect(() => lzwDecode(new Uint8Array([0]), 1, 1)).toThrow(ImageDecodeError)
    // code 6 (= first free code) right after the clear code 4, at 3 bits: 0b110_100
    expect(() => lzwDecode(new Uint8Array([0b110100]), 2, 1)).toThrow(ImageDecodeError)
  })
})

describe('decodeGifFirstFrame', () => {
  it('draws the first frame at its offset on a transparent canvas; the transparent index stays transparent; later frames are ignored', () => {
    const file = gif(4, 3, [
      { left: 1, top: 1, w: 2, h: 2, indices: [0, 1, 2, 3], transparent: 3 },
      { left: 0, top: 0, w: 4, h: 3, indices: Array(12).fill(0) },
    ])
    const img = decodeGifFirstFrame(file)
    expect([img.width, img.height]).toEqual([4, 3])
    expect(px(img, 0, 0)).toEqual(NONE)
    expect([px(img, 1, 1), px(img, 2, 1), px(img, 1, 2), px(img, 2, 2)]).toEqual([RED, GREEN, BLUE, NONE])
    expect(px(img, 3, 2)).toEqual(NONE)
  })

  it('reorders interlaced rows (passes 0/8, 4/8, 2/4, 1/2)', () => {
    // stored row r carries color r % 3; display row = interlace order[r]
    const order = [0, 8, 4, 2, 6, 1, 3, 5, 7]
    const img = decodeGifFirstFrame(gif(1, 9, [{ left: 0, top: 0, w: 1, h: 9, indices: order.map((_, r) => r % 3), interlaced: true }]))
    for (let r = 0; r < 9; r += 1) expect(px(img, 0, order[r])).toEqual([RED, GREEN, BLUE][r % 3])
  })

  it('rejects non-GIF and truncated input', () => {
    expect(() => decodeGifFirstFrame(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toThrow('not a GIF')
    expect(() => decodeGifFirstFrame(gif(2, 2, [{ left: 0, top: 0, w: 2, h: 2, indices: [0, 0, 0, 0] }]).subarray(0, 20))).toThrow(ImageDecodeError)
  })
})

describe('downscale + PNG', () => {
  it('downscales by a whole number with nearest-neighbour block sampling (top-left pixel of each n×n block)', () => {
    const data = new Uint8Array(5 * 3 * 4)
    for (let i = 0; i < 15; i += 1) data.set([i, 0, 0, 255], i * 4) // red channel = pixel index
    const small = downscale({ width: 5, height: 3, data }, 2)
    expect([small.width, small.height]).toEqual([3, 2])
    expect([0, 1, 2].map((x) => px(small, x, 0)[0])).toEqual([0, 2, 4])
    expect([0, 1, 2].map((x) => px(small, x, 1)[0])).toEqual([10, 12, 14])
    expect(() => downscale(small, 1.5)).toThrow(ImageDecodeError)
  })

  it('encodes a valid 8-bit RGBA PNG (signature, IHDR, CRCs, unfiltered scanlines)', () => {
    const img: Rgba = { width: 2, height: 2, data: Uint8Array.from([...RED, ...GREEN, ...BLUE, ...NONE]) }
    const png = encodePng(img)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const chunks: { type: string; body: Buffer }[] = []
    for (let p = 8; p < png.length; ) {
      const len = png.readUInt32BE(p)
      const type = png.toString('latin1', p + 4, p + 8)
      const body = png.subarray(p + 8, p + 8 + len)
      expect(png.readUInt32BE(p + 8 + len)).toBe(crc32(png.subarray(p + 4, p + 8 + len)) >>> 0)
      chunks.push({ type, body })
      p += 12 + len
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect([chunks[0].body.readUInt32BE(0), chunks[0].body.readUInt32BE(4), chunks[0].body[8], chunks[0].body[9]]).toEqual([2, 2, 8, 6])
    expect([...inflateSync(chunks[1].body)]).toEqual([0, ...RED, ...GREEN, 0, ...BLUE, ...NONE])
  })

  it('gifThumbnail: first frame, factor ceil(longest edge / 128)', () => {
    const t = gifThumbnail(gif(300, 10, [{ left: 0, top: 0, w: 300, h: 10, indices: Array.from({ length: 3000 }, (_, i) => i % 3) }]))
    expect([t.width, t.height]).toEqual([100, 4]) // n = 3
  })
})

describe('thumbnailFor (manifest rule)', () => {
  it('only GIF files over 100 KB; path under /sprites/thumbs/, size = the whole-number downscale', () => {
    expect(thumbnailFor({ path: '/sprites/bosses/113.gif', bytes: 668777, width: 210, height: 420 })).toEqual({ path: '/sprites/thumbs/bosses/113.png', width: 53, height: 105 })
    expect(thumbnailFor({ path: '/sprites/bosses/636.gif', bytes: 677616, width: 386, height: 218 })).toEqual({ path: '/sprites/thumbs/bosses/636.png', width: 97, height: 55 })
    expect(thumbnailFor({ path: '/sprites/bosses/222.gif', bytes: 29062, width: 168, height: 134 })).toBeUndefined()
    expect(thumbnailFor({ path: '/sprites/weapons/1.png', bytes: 200_000, width: 64, height: 64 })).toBeUndefined()
    expect(thumbnailFor({ path: '/sprites/bosses/9.gif', bytes: 150_000, width: 100, height: 40 })).toEqual({ path: '/sprites/thumbs/bosses/9.png', width: 100, height: 40 })
  })
})
