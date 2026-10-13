/**
 * Procedural pixel-art kit for the homepage hero (AMENDMENTS-001 A12: original art,
 * not derived from any Re-Logic asset).
 *
 * Pure and deterministic: a seeded PRNG drives every random choice, so a scene is
 * identical on every load and in tests. Texture comes from ordered (Bayer)
 * dithering, per-pixel hash speckle and lit/shadow faces rather than large flat
 * fills, which read as blank blocks at desktop scale (design review M3).
 */
import { PixelCanvas } from '../pixelCanvas'

export type Rng = () => number

/** Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const between = (rng: Rng, min: number, max: number): number => min + rng() * (max - min)
export const intBetween = (rng: Rng, min: number, max: number): number => Math.floor(between(rng, min, max + 1))
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Stable per-pixel hash in [0, 1): texture speckle that doesn't consume the RNG stream. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** Ordered dither: true when pixel (x, y) takes the second colour at `coverage` (0..1). */
export function dither(x: number, y: number, coverage: number): boolean {
  return coverage * 16 > BAYER4[((y & 3) << 2) | (x & 3)] + 0.5
}

/** 1-D value noise (cosine-interpolated octaves). Values are roughly in [-1, 1]. */
export function noise1d(rng: Rng, length: number, wavelength: number, octaves = 3): number[] {
  const out = new Array<number>(length).fill(0)
  let amp = 1
  let wl = wavelength
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const points = Array.from({ length: Math.ceil(length / wl) + 2 }, () => rng() * 2 - 1)
    for (let x = 0; x < length; x++) {
      const p = x / wl
      const i = Math.floor(p)
      const s = (1 - Math.cos((p - i) * Math.PI)) / 2
      out[x] += (points[i] * (1 - s) + points[i + 1] * s) * amp
    }
    total += amp
    amp /= 2
    wl = Math.max(2, wl / 2)
  }
  return out.map((v) => v / total)
}

/* ------------------------------------------------------------------ sky -- */

export interface SkyBand {
  color: string
  /** Exclusive bottom row of the band. */
  until: number
}

/** Banded night-sky gradient with dithered seams between bands. */
export function paintSky(c: PixelCanvas, bands: readonly SkyBand[], blend = 3): void {
  let from = 0
  for (const band of bands) {
    c.rect(0, from, c.width, band.until - from, band.color)
    from = band.until
  }
  for (let i = 0; i < bands.length - 1; i++) {
    const edge = bands[i].until
    for (let y = edge - blend; y < edge + blend; y++) {
      const t = (y - (edge - blend) + 0.5) / (2 * blend)
      for (let x = 0; x < c.width; x++) c.set(x, y, dither(x, y, t) ? bands[i + 1].color : bands[i].color)
    }
  }
}

export interface StarField {
  top: number
  bottom: number
  count: number
  colors: readonly string[]
  /** Skip positions for which this returns true (e.g. around the moon). */
  avoid?: (x: number, y: number) => boolean
}

/** Single-pixel stars, denser toward the top of the band. */
export function scatterStars(c: PixelCanvas, rng: Rng, field: StarField): void {
  for (let i = 0; i < field.count; i++) {
    const x = intBetween(rng, 0, c.width - 1)
    const y = field.top + Math.floor((field.bottom - field.top) * rng() ** 1.4)
    const color = pick(rng, field.colors)
    if (!field.avoid?.(x, y)) c.set(x, y, color)
  }
}

/** A brighter "plus" star: core pixel with short arms. */
export function sparkle(c: PixelCanvas, x: number, y: number, core: string, arm: string, reach = 1): void {
  for (let d = 1; d <= reach; d++) {
    c.set(x - d, y, arm).set(x + d, y, arm).set(x, y - d, arm).set(x, y + d, arm)
  }
  c.set(x, y, core)
}

export interface MoonSpec {
  cx: number
  cy: number
  r: number
  body: string
  shade: string
  crater: string
  rim: string
  /** Offset of the occluding disc for a crescent; omit for a full moon. */
  crescent?: { dx: number; dy: number }
}

/** Pixel moon with limb shading, craters and a lit rim (light from the upper right). */
export function paintMoon(c: PixelCanvas, m: MoonSpec): void {
  const r2 = m.r * m.r + m.r * 0.8
  const craters: Array<[number, number, number]> = [
    [-0.35, -0.15, 0.24],
    [0.28, 0.32, 0.17],
    [-0.08, 0.5, 0.12],
    [0.42, -0.38, 0.11],
  ]
  for (let y = Math.floor(m.cy - m.r - 1); y <= m.cy + m.r + 1; y++) {
    for (let x = Math.floor(m.cx - m.r - 1); x <= m.cx + m.r + 1; x++) {
      const dx = x - m.cx
      const dy = y - m.cy
      if (dx * dx + dy * dy > r2) continue
      if (m.crescent) {
        const ox = dx - m.crescent.dx
        const oy = dy - m.crescent.dy
        if (ox * ox + oy * oy <= r2) continue
      }
      const lum = (dx * 0.6 - dy * 0.8) / m.r
      const edge = Math.sqrt(dx * dx + dy * dy) > m.r - 1.1
      let color = m.body
      if (lum < -0.4 && dither(x, y, clamp((-lum - 0.4) / 0.4, 0, 1))) color = m.shade
      for (const [cxr, cyr, rr] of craters) {
        const qx = dx - cxr * m.r
        const qy = dy - cyr * m.r
        const rad = rr * m.r
        if (qx * qx + qy * qy <= rad * rad + 0.3) color = m.crater
      }
      if (edge && lum > 0.25) color = m.rim
      c.set(x, y, color)
    }
  }
}

/* ------------------------------------------------------------ terrain -- */

export interface Peak {
  x: number
  top: number
  /** Horizontal pixels per row on each flank (steepness; lower = steeper). */
  slope: number
}

export interface RangeColors {
  lit: string
  shadow: string
  /** Mid tone: texture speckle and the lit face's fade toward the base. */
  base: string
  /** Highlight on the lit-side silhouette edge. */
  rim?: string
  snow?: string
  snowShade?: string
}

export interface RangeOptions {
  bottom: number
  /** 1 = light from the right, -1 = from the left. */
  light?: 1 | -1
  snowDepth?: number
  /** Rows below the apex after which the lit face fades into the base tone. */
  fadeAfter?: number
  /** Maximum dither coverage of that fade (0..1). */
  fadeMax?: number
  /** Probability of a base-tone speckle per face pixel (rock texture). */
  speckle?: number
  seed?: number
}

/**
 * Mountain range: each peak is split by a wandering ridge line into a lit and a
 * shadow face, with craggy flanks, crevices on the lit face and optional snow.
 */
export function paintRange(c: PixelCanvas, rng: Rng, peaks: readonly Peak[], col: RangeColors, opts: RangeOptions): void {
  const light = opts.light ?? 1
  const seed = opts.seed ?? 1
  const speckle = opts.speckle ?? 0.06
  for (const peak of peaks) {
    const slopeL = peak.slope * between(rng, 0.8, 1.25)
    const slopeR = peak.slope * between(rng, 0.8, 1.25)
    const rows = opts.bottom - peak.top
    const ridge: number[] = []
    const lefts: number[] = []
    const rights: number[] = []
    let ridgeX = peak.x
    let jl = 0
    let jr = 0
    for (let r = 0; r < rows; r++) {
      if (rng() < 0.45) jl = clamp(jl + (rng() < 0.5 ? -1 : 1), -2, 2)
      if (rng() < 0.45) jr = clamp(jr + (rng() < 0.5 ? -1 : 1), -2, 2)
      const left = Math.round(peak.x - r * slopeL + (r > 1 ? jl : 0))
      const right = Math.round(peak.x + r * slopeR + (r > 1 ? jr : 0))
      if (r > 1 && rng() < 0.5) ridgeX += rng() < 0.5 ? -1 : 1
      ridgeX = clamp(ridgeX, left + 1, Math.max(left + 1, right - 1))
      ridge.push(ridgeX)
      lefts.push(left)
      rights.push(right)
    }

    const fadeAfter = opts.fadeAfter ?? Math.round(rows * 0.45)
    const fadeMax = opts.fadeMax ?? 0.75
    for (let r = 0; r < rows; r++) {
      const y = peak.top + r
      for (let x = lefts[r]; x <= rights[r]; x++) {
        const lit = light > 0 ? x > ridge[r] : x < ridge[r]
        let color = lit ? col.lit : col.shadow
        if (lit && r > fadeAfter && dither(x, y, clamp((r - fadeAfter) / (rows - fadeAfter), 0, fadeMax))) color = col.base
        if (hash2(x, y, seed) < speckle) color = col.base
        if (col.rim && lit && (light > 0 ? x === rights[r] : x === lefts[r]) && r < rows * 0.7) color = col.rim
        if (col.snow && opts.snowDepth) {
          const onRidge = Math.abs(x - ridge[r]) <= 1 ? 2 : 0
          const depth = opts.snowDepth + onRidge + Math.floor(hash2(x, 11, seed) * 3)
          if (r < depth) color = lit ? col.snow : (col.snowShade ?? col.shadow)
        }
        c.set(x, y, color)
      }
    }

    // Crevices: short diagonal shadow cuts running down the lit face.
    const crevices = intBetween(rng, 2, 4)
    for (let i = 0; i < crevices; i++) {
      let r = intBetween(rng, 3, Math.max(4, Math.round(rows * 0.6)))
      let x = ridge[Math.min(r, rows - 1)] + light * intBetween(rng, 2, 5)
      const length = intBetween(rng, 3, 8)
      for (let k = 0; k < length && r < rows; k++) {
        if (x > lefts[r] && x < rights[r] && (light > 0 ? x > ridge[r] : x < ridge[r])) {
          const y = peak.top + r
          const snowy = col.snow && opts.snowDepth && r < opts.snowDepth + 2
          c.set(x, y, snowy ? (col.snowShade ?? col.shadow) : col.shadow)
        }
        r += 1
        if (rng() < 0.6) x += light
      }
    }
  }
}

/** Dithered fog: coverage of `color` ramps from 0 at y0 to `max` at y1 (or the reverse). */
export function haze(c: PixelCanvas, y0: number, y1: number, color: string, max: number, fromTop = false): void {
  for (let y = y0; y < y1; y++) {
    const p = (y - y0 + 0.5) / (y1 - y0)
    const t = max * (fromTop ? 1 - p : p)
    for (let x = 0; x < c.width; x++) if (dither(x, y, t)) c.set(x, y, color)
  }
}

export interface HillColors {
  fill: string
  top: string
  speck?: string
}

/** Filled rolling silhouette under a height profile, with a 1px top edge and speckle. */
export function paintHills(c: PixelCanvas, profile: readonly number[], col: HillColors, bottom: number, seed = 3): void {
  for (let x = 0; x < c.width; x++) {
    const top = Math.round(profile[x])
    for (let y = top; y < bottom; y++) {
      let color = y === top ? col.top : col.fill
      if (col.speck && y > top && hash2(x, y, seed) < 0.08) color = col.speck
      c.set(x, y, color)
    }
  }
}

export interface PineColors {
  body: string
  shade: string
  rim: string
}

/** Layered pine silhouette (sawtooth tiers widening downward), rim-lit on the right. */
export function paintPine(c: PixelCanvas, x: number, baseY: number, h: number, col: PineColors): void {
  const crownH = h - 2
  const tiers = Math.max(2, Math.round(crownH / 5))
  const tierH = crownH / tiers
  const maxHalf = Math.max(2, Math.round(h * 0.3))
  for (let r = 0; r < crownH; r++) {
    const y = baseY - h + r
    const tier = Math.min(tiers - 1, Math.floor(r / tierH))
    const p = (r - tier * tierH) / tierH
    const bottomHalf = (maxHalf * (tier + 1)) / tiers
    const topHalf = tier === 0 ? 0 : bottomHalf * 0.45
    const half = Math.round(topHalf + (bottomHalf - topHalf) * p)
    for (let dx = -half; dx <= half; dx++) {
      let color = col.body
      if (dx >= half - (p > 0.6 ? 1 : 0) && dx > 0) color = col.rim
      else if (dx === -half && half > 1) color = col.shade
      c.set(x + dx, y, color)
    }
  }
  c.set(x, baseY - 2, col.shade).set(x, baseY - 1, col.shade).set(x, baseY, col.shade)
}

export interface TreelineSpec {
  from: number
  to: number
  baseY: (x: number) => number
  minH: number
  maxH: number
  minGap: number
  maxGap: number
  colors: PineColors
}

export function paintTreeline(c: PixelCanvas, rng: Rng, spec: TreelineSpec): void {
  for (let x = spec.from; x < spec.to; x += intBetween(rng, spec.minGap, spec.maxGap)) {
    paintPine(c, x, spec.baseY(clamp(x, 0, c.width - 1)), intBetween(rng, spec.minH, spec.maxH), spec.colors)
  }
}

export interface GroundColors {
  grassLight: string
  grass: string
  grassDark: string
  dirt: string
  dirtDark: string
  dirtLight: string
  deep: string
  /** Optional sparse flower/mushroom accents on top of the grass. */
  accents?: readonly string[]
}

/** Grass-over-dirt ground under a surface profile: blades, roots, speckle, depth dither. */
export function paintGround(c: PixelCanvas, surface: readonly number[], col: GroundColors, seed = 5): void {
  for (let x = 0; x < c.width; x++) {
    const s = Math.round(surface[x])
    for (let y = s; y < c.height; y++) {
      const d = y - s
      let color: string
      if (d === 0) color = hash2(x, y, seed) < 0.18 ? col.grass : col.grassLight
      else if (d === 1) color = col.grass
      else if (d === 2) color = hash2(x, y, seed) < 0.55 ? col.grassDark : col.dirt
      else if (d === 3) color = hash2(x, y, seed) < 0.2 ? col.grassDark : col.dirt
      else {
        color = dither(x, y, clamp((d - 4) / 12, 0, 0.8)) ? col.deep : col.dirt
        const h = hash2(x, y, seed + 1)
        if (h < 0.07) color = col.dirtDark
        else if (h > 0.965) color = col.dirtLight
      }
      c.set(x, y, color)
    }
    const blade = hash2(x, 0, seed + 2)
    if (blade < 0.42) c.set(x, s - 1, col.grass)
    if (blade < 0.12) c.set(x, s - 2, col.grassLight)
    if (col.accents && blade > 0.985) c.set(x, s - (blade > 0.993 ? 3 : 2), col.accents[x % col.accents.length])
  }
}

/** Embedded stones: small shaded ellipses (top-lit) inside the ground. */
export function paintPebbles(
  c: PixelCanvas,
  rng: Rng,
  count: number,
  area: { x0: number; x1: number; y0: number; y1: number },
  col: { light: string; mid: string; dark: string },
): void {
  for (let i = 0; i < count; i++) {
    const cx = intBetween(rng, area.x0, area.x1)
    const cy = intBetween(rng, area.y0, area.y1)
    const rx = intBetween(rng, 1, 3)
    const ry = Math.max(1, rx - 1)
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) > 1) continue
        c.set(cx + x, cy + y, y < 0 ? col.light : y === ry ? col.dark : col.mid)
      }
    }
  }
}

/** Sparse animated fireflies over a region (only where `allow` says so). */
export function scatterFireflies(
  c: PixelCanvas,
  rng: Rng,
  count: number,
  area: { x0: number; x1: number; y0: number; y1: number },
  color: string,
): void {
  for (let i = 0; i < count; i++) c.set(intBetween(rng, area.x0, area.x1), intBetween(rng, area.y0, area.y1), color)
}

export interface StoneColors {
  base: string
  dark: string
  light: string
  /** Sparse ore glints. */
  ore?: readonly string[]
}

/** Underground stone below a boundary profile: speckle, dark seams, sparse ore. */
export function paintStrata(c: PixelCanvas, top: readonly number[], col: StoneColors, seed = 13): void {
  for (let x = 0; x < c.width; x++) {
    for (let y = Math.round(top[x]); y < c.height; y++) {
      const h = hash2(x, y, seed)
      let color = col.base
      if (h < 0.1) color = col.dark
      else if (h > 0.93) color = col.light
      // Long diagonal seams for a layered-rock read.
      if ((x + y * 2 + Math.floor(hash2(x >> 3, y >> 2, seed) * 6)) % 23 === 0) color = col.dark
      if (col.ore && hash2(x, y, seed + 7) > 0.9975) color = col.ore[(x + y) % col.ore.length]
      c.set(x, y, color)
    }
  }
}

export interface CaveColors {
  /** Background wall seen through the cave. */
  wall: string
  wallDark: string
  wallLight: string
  /** Rock pixels touching the cave air. */
  rim: string
  moss?: string
}

/**
 * Carves a cave (cross-section view): pixels strictly between `ceiling[x]` and
 * `floor[x]` become textured background wall, rock touching the opening gets a
 * lit rim, and upward-facing floor rock optionally gets moss. Returns an `isAir`
 * test for placing sprites.
 */
export function carveCave(
  c: PixelCanvas,
  ceiling: readonly number[],
  floor: readonly number[],
  col: CaveColors,
  seed = 17,
): (x: number, y: number) => boolean {
  const isAir = (x: number, y: number) =>
    x >= 0 && x < c.width && y > Math.round(ceiling[x]) && y < Math.round(floor[x])
  for (let x = 0; x < c.width; x++) {
    for (let y = Math.round(ceiling[x]) + 1; y < Math.round(floor[x]); y++) {
      // Blocky background-wall texture: staggered 4x3 "bricks" of varying tone.
      const row = Math.floor(y / 3)
      const brick = hash2((x + row * 2) >> 2, row, seed)
      let color = brick < 0.3 ? col.wallDark : col.wall
      if (hash2(x, y, seed + 1) > 0.95) color = col.wallLight
      if (y % 3 === 0 && hash2(x >> 1, y, seed + 2) < 0.5) color = col.wallDark
      c.set(x, y, color)
    }
  }
  for (let x = 0; x < c.width; x++) {
    for (let y = 0; y < c.height; y++) {
      if (isAir(x, y)) continue
      const below = isAir(x, y - 1)
      if (below || isAir(x, y + 1) || isAir(x - 1, y) || isAir(x + 1, y)) {
        c.set(x, y, col.moss && below && hash2(x, y, seed + 3) < 0.7 ? col.moss : col.rim)
      }
    }
  }
  return isAir
}

/** Tapered rock spike from the ceiling (dir 1) or floor (dir -1), rim-lit on one side. */
export function paintSpike(c: PixelCanvas, x: number, y: number, length: number, dir: 1 | -1, col: { rock: string; rim: string }): void {
  for (let i = 0; i < length; i++) {
    const half = i < length * 0.4 ? 1 : 0
    for (let dx = -half; dx <= half; dx++) c.set(x + dx, y + i * dir, dx === half && half > 0 ? col.rim : col.rock)
  }
}

/** Small glowing mushroom (domed 5px cap on a short stem), standing on `baseY`. */
export function paintMushroom(c: PixelCanvas, x: number, baseY: number, col: { cap: string; capLight: string; stem: string }): void {
  c.set(x, baseY, col.stem).set(x, baseY - 1, col.stem)
  for (let dx = -2; dx <= 2; dx++) c.set(x + dx, baseY - 2, Math.abs(dx) === 2 ? col.cap : col.capLight)
  for (let dx = -1; dx <= 1; dx++) c.set(x + dx, baseY - 3, dx === 1 ? col.capLight : col.cap)
}

/**
 * Splits a finished grid into a static base layer and an animated layer, so the
 * large static art is rasterised once and stepped animations only repaint the
 * few animated pixels. In the base, each animated cell takes the nearest static
 * cell on its row (what it was drawn over); the animated layer is '.' elsewhere.
 */
export function splitAnimated(rows: readonly string[], animated: ReadonlySet<string>): { base: string[]; animated: string[] } {
  const base: string[] = []
  const anim: string[] = []
  for (const row of rows) {
    let b = ''
    let a = ''
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (!animated.has(ch)) {
        b += ch
        a += '.'
        continue
      }
      a += ch
      let fill = '.'
      for (let d = 1; d < row.length; d++) {
        const left = row[x - d]
        const right = row[x + d]
        if (left !== undefined && !animated.has(left)) {
          fill = left
          break
        }
        if (right !== undefined && !animated.has(right)) {
          fill = right
          break
        }
      }
      b += fill
    }
    base.push(b)
    anim.push(a)
  }
  return { base, animated: anim }
}

/* ------------------------------------------------------------ sprites -- */

export interface TreeColors {
  leafLight: string
  leaf: string
  leafMid: string
  leafDark: string
  trunkLight: string
  trunk: string
  trunkDark: string
  outline: string
}

/**
 * Tall broadleaf tree (bare trunk, fluffy crown) as a transparent sprite.
 * Returns rows whose last row is the trunk base; `anchorX` is the trunk centre.
 */
export function treeSprite(rng: Rng, trunkH: number, crownR: number, col: TreeColors): { rows: string[]; anchorX: number } {
  const w = crownR * 2 + 10
  const h = trunkH + crownR * 2 + 4
  const art = new PixelCanvas(w, h)
  const cx = Math.floor(w / 2)
  const cy = crownR + 2

  // Trunk (3 wide, lit on the right) with bark speckle and a root flare.
  for (let y = cy; y < h; y++) {
    art.set(cx - 1, y, col.trunkDark).set(cx, y, hash2(cx, y, 9) < 0.25 ? col.trunkDark : col.trunk).set(cx + 1, y, col.trunkLight)
  }
  art.set(cx - 2, h - 1, col.trunkDark).set(cx + 2, h - 1, col.trunk).set(cx - 2, h - 2, col.trunkDark)

  // Side branches with small leaf tufts.
  const blobs: Array<[number, number, number]> = [[cx, cy, crownR]]
  for (const side of [-1, 1] as const) {
    if (rng() < 0.35) continue
    const by = cy + crownR + intBetween(rng, 2, Math.max(3, Math.floor(trunkH * 0.5)))
    if (by >= h - 3) continue
    art.line(cx + side, by, cx + side * 4, by - 2, col.trunk)
    blobs.push([cx + side * 5, by - 3, 2.6])
  }
  // Crown: a main disc plus overlapping sub-blobs for a cloudy silhouette.
  const lobes = intBetween(rng, 5, 7)
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + between(rng, -0.3, 0.3)
    const d = crownR * between(rng, 0.5, 0.75)
    blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, crownR * between(rng, 0.42, 0.6)])
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = -Infinity
      let owner = blobs[0]
      for (const b of blobs) {
        const depth = b[2] - Math.hypot(x - b[0], y - b[1])
        if (depth > best) {
          best = depth
          owner = b
        }
      }
      if (best < -0.3) continue
      const lum =
        ((x - owner[0]) * 0.55 + (owner[1] - y) * 0.85) / owner[2] +
        ((x - cx) * 0.25 + (cy - y) * 0.25) / crownR +
        (hash2(x, y, 21) - 0.5) * 0.35
      const color = lum > 0.75 ? col.leafLight : lum > 0.2 ? col.leaf : lum > -0.45 ? col.leafMid : col.leafDark
      art.set(x, y, color)
    }
  }
  return { rows: art.outline(col.outline).rows(), anchorX: cx }
}

export interface CrystalColors {
  light: string
  mid: string
  dark: string
  glint: string
  outline: string
}

/** Cluster of leaning crystal shards (outlined sprite). `hang` flips it for ceilings. */
export function crystalSprite(rng: Rng, size: number, col: CrystalColors, hang = false): string[] {
  const w = size * 4 + 7
  const h = Math.ceil(size * 2.8) + 3
  const art = new PixelCanvas(w, h)
  const cx = Math.floor(w / 2)
  const count = intBetween(rng, 3, 5)
  // Side shards first so the tall central shard sits in front.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(b - (count - 1) / 2) - Math.abs(a - (count - 1) / 2))
  for (const i of order) {
    const offset = Math.round((i - (count - 1) / 2) * size * 0.75)
    const central = Math.abs(i - (count - 1) / 2) < 0.6
    const height = Math.round(size * (central ? between(rng, 2.2, 2.6) : between(rng, 1.1, 1.9)))
    const half = central || size >= 4 ? 2 : 1
    const lean = (offset === 0 ? between(rng, -0.1, 0.1) : Math.sign(offset) * between(rng, 0.2, 0.45))
    for (let r = 0; r < height; r++) {
      const y = h - 2 - r
      const centre = Math.round(cx + offset + lean * r)
      const span = Math.min(half, height - 1 - r)
      for (let dx = -span; dx <= span; dx++) {
        let color = dx < 0 ? col.light : dx === span && span > 0 ? col.dark : col.mid
        if (dx === -span && span > 0 && r > height * 0.35 && r < height - 2) color = col.glint
        art.set(centre + dx, y, color)
      }
      if (r === height - 1) art.set(centre, y, col.glint)
    }
  }
  const rows = art.outline(col.outline).rows()
  return hang ? rows.reverse() : rows
}

/** Stamp a sprite so its bottom row sits on `baseY`, centred on `x` (or at `anchorX`). */
export function stampOn(c: PixelCanvas, rows: readonly string[], x: number, baseY: number, anchorX?: number): void {
  const ax = anchorX ?? Math.floor((rows[0]?.length ?? 0) / 2)
  c.stamp(x - ax, baseY - rows.length + 1, rows)
}

/** Stamp a hanging sprite so its top row sits on `topY`. */
export function stampHanging(c: PixelCanvas, rows: readonly string[], x: number, topY: number): void {
  c.stamp(x - Math.floor((rows[0]?.length ?? 0) / 2), topY, rows)
}
