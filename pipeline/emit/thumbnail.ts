/**
 * Sprite thumbnails (AMENDMENTS-007 B30). Heavy sprite files (> 100 KB — today the animated boss GIFs
 * of the Wall of Flesh, Moon Lord and Empress of Light) get a static PNG of their FIRST FRAME,
 * downscaled by a whole-number factor n = ceil(longest edge / 128) with nearest-neighbour sampling of
 * each n×n block's top-left pixel: pixel art is never resampled by a fractional factor or blended
 * (src/components/spriteScale.ts, P2-S3 design review). Dependency-free: a GIF first-frame decoder
 * (LZW, interlacing, local/global palettes, transparency) and an RGBA PNG encoder on node:zlib.
 *
 * The thumbnail's path and size are a pure function of the manifest entry (`thumbnailFor`), so the
 * build writes them into public/sprites/manifest.json from imageinfo metadata alone; the binaries are
 * generated locally by `npm run pipeline:sprites` from the verified sprite (A10: never committed).
 */
import { crc32, deflateSync } from 'node:zlib'

export const THUMBNAIL_MIN_BYTES = 100 * 1024
export const THUMBNAIL_MAX_EDGE = 128

export interface Rgba {
  width: number
  height: number
  /** width × height × 4 bytes, row-major, non-premultiplied. */
  data: Uint8Array
}

/** Whole-number downscale factor for a sprite of this size (1 = already within the limit). */
export const thumbnailFactor = (width: number, height: number): number => Math.max(1, Math.ceil(Math.max(width, height) / THUMBNAIL_MAX_EDGE))

/**
 * Manifest thumbnail of a sprite file: only for files over 100 KB in a format the generator decodes
 * (GIF). `/sprites/bosses/113.gif` → `/sprites/thumbs/bosses/113.png`.
 */
export function thumbnailFor(file: { path: string; bytes: number; width: number; height: number }): { path: string; width: number; height: number } | undefined {
  if (file.bytes <= THUMBNAIL_MIN_BYTES || !/\.gif$/i.test(file.path)) return undefined
  const n = thumbnailFactor(file.width, file.height)
  return { path: file.path.replace(/^\/sprites\//, '/sprites/thumbs/').replace(/\.gif$/i, '.png'), width: Math.ceil(file.width / n), height: Math.ceil(file.height / n) }
}

export class ImageDecodeError extends Error {}

/** First frame of a GIF on a transparent canvas of the logical screen size. */
export function decodeGifFirstFrame(bytes: Uint8Array): Rgba {
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new ImageDecodeError('not a GIF')
  let p = 6
  const u8 = () => {
    if (p >= bytes.length) throw new ImageDecodeError('truncated GIF')
    return bytes[p++]
  }
  const u16 = () => u8() | (u8() << 8)
  const width = u16()
  const height = u16()
  const packed = u8()
  p += 2 // background color index, pixel aspect ratio (the first frame is drawn on a transparent canvas, as browsers do)
  const readTable = (size: number) => {
    const t = bytes.subarray(p, p + 3 * size)
    if (t.length !== 3 * size) throw new ImageDecodeError('truncated color table')
    p += 3 * size
    return t
  }
  const global = packed & 0x80 ? readTable(1 << ((packed & 7) + 1)) : undefined
  let transparent = -1
  const skipSubBlocks = () => {
    for (let len = u8(); len !== 0; len = u8()) p += len
  }
  for (;;) {
    const block = u8()
    if (block === 0x3b) throw new ImageDecodeError('GIF has no image')
    if (block === 0x21) {
      const label = u8()
      if (label === 0xf9) {
        const size = u8()
        const flags = u8()
        p += 2 // delay
        const index = u8()
        p += size - 4
        skipSubBlocks()
        transparent = flags & 1 ? index : -1
      } else skipSubBlocks()
      continue
    }
    if (block !== 0x2c) throw new ImageDecodeError(`unexpected GIF block 0x${block.toString(16)}`)
    const left = u16()
    const top = u16()
    const fw = u16()
    const fh = u16()
    const fpacked = u8()
    const palette = fpacked & 0x80 ? readTable(1 << ((fpacked & 7) + 1)) : global
    if (!palette) throw new ImageDecodeError('GIF frame has no color table')
    const minCodeSize = u8()
    const data: number[] = []
    for (let len = u8(); len !== 0; len = u8()) {
      for (let i = 0; i < len; i += 1) data.push(u8())
    }
    const indices = lzwDecode(Uint8Array.from(data), minCodeSize, fw * fh)
    const rows = fpacked & 0x40 ? interlacedRows(fh) : Array.from({ length: fh }, (_, i) => i)
    const out = new Uint8Array(width * height * 4)
    for (let r = 0; r < fh; r += 1) {
      const y = top + rows[r]
      if (y >= height) continue
      for (let x = 0; x < fw; x += 1) {
        const cx = left + x
        const index = indices[r * fw + x]
        if (cx >= width || index === transparent || index === undefined) continue
        const o = (y * width + cx) * 4
        out[o] = palette[index * 3] ?? 0
        out[o + 1] = palette[index * 3 + 1] ?? 0
        out[o + 2] = palette[index * 3 + 2] ?? 0
        out[o + 3] = 255
      }
    }
    return { width, height, data: out }
  }
}

/** Row order of an interlaced GIF frame (passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1). */
function interlacedRows(h: number): number[] {
  const order: number[] = []
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) order.push(y)
  return order
}

/** GIF variable-width LZW → palette indices (at most `count`). */
export function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) throw new ImageDecodeError(`invalid LZW minimum code size ${minCodeSize}`)
  const clear = 1 << minCodeSize
  const end = clear + 1
  const out = new Uint8Array(count)
  let n = 0
  // dictionary as prefix links: entry → (prefix entry, last byte, first byte, length)
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const firstByte = new Uint8Array(4096)
  const length = new Uint16Array(4096)
  for (let i = 0; i < clear; i += 1) {
    prefix[i] = -1
    suffix[i] = i
    firstByte[i] = i
    length[i] = 1
  }
  let size = minCodeSize + 1
  let next = end + 1
  let prev = -1
  let bitPos = 0
  const totalBits = data.length * 8
  const emit = (code: number) => {
    const len = length[code]
    const start = n
    let c = code
    for (let i = len - 1; i >= 0; i -= 1) {
      if (start + i < count) out[start + i] = suffix[c]
      c = prefix[c]
    }
    n = Math.min(count, n + len)
  }
  const add = (from: number, last: number) => {
    prefix[next] = from
    suffix[next] = last
    firstByte[next] = firstByte[from]
    length[next] = length[from] + 1
    next += 1
  }
  while (bitPos + size <= totalBits && n < count) {
    let code = 0
    for (let i = 0; i < size; i += 1) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1
      code |= bit << i
    }
    bitPos += size
    if (code === clear) {
      size = minCodeSize + 1
      next = end + 1
      prev = -1
      continue
    }
    if (code === end) break
    if (prev === -1) {
      if (code >= clear) throw new ImageDecodeError('LZW stream starts with a non-literal code')
      emit(code)
      prev = code
      continue
    }
    if (code < next) {
      emit(code)
      if (next < 4096) add(prev, firstByte[code])
    } else if (code === next && next < 4096) {
      add(prev, firstByte[prev])
      emit(code)
    } else throw new ImageDecodeError('invalid LZW code')
    if (next === 1 << size && size < 12) size += 1
    prev = code
  }
  return out
}

/** Whole-number nearest-neighbour downscale: output pixel (x, y) = source pixel (x·n, y·n). */
export function downscale(img: Rgba, n: number): Rgba {
  if (!Number.isInteger(n) || n < 1) throw new ImageDecodeError(`downscale factor must be a positive integer (got ${n})`)
  const width = Math.ceil(img.width / n)
  const height = Math.ceil(img.height / n)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = (y * n * img.width + x * n) * 4
      data.set(img.data.subarray(s, s + 4), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
  return Buffer.concat([head, body, crc])
}

/** RGBA → PNG (8-bit RGBA, no filtering, zlib level 9: deterministic for a given zlib). */
export function encodePng(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y += 1) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))])
}

/** GIF bytes → thumbnail PNG bytes (first frame, whole-number downscale to ≤ 128 px). */
export function gifThumbnail(gif: Uint8Array): { png: Buffer; width: number; height: number } {
  const frame = decodeGifFirstFrame(gif)
  const small = downscale(frame, thumbnailFactor(frame.width, frame.height))
  return { png: encodePng(small), width: small.width, height: small.height }
}
