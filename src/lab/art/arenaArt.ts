/**
 * Original pixel art for the Weapon Lab arena (AMENDMENTS-001 A12: arena tileset, dummy and
 * player are produced in-slice as ORIGINAL art — nothing here is derived from a Re-Logic asset).
 * Built with the homepage's procedural kit (PixelCanvas + sceneKit), so the arena shares the
 * hero's palette and texture language. Pure and deterministic (seeded): identical on every load
 * and testable in Node. The PixiJS layer turns these grids into textures (../arena/textures.ts).
 *
 * Scale: one art pixel = 2 game pixels, so a 16 px game tile is 8 × 8 art pixels — the chunky
 * pixel size of the game's own tiles. Weapon sprites are drawn at 1 game pixel per sprite pixel.
 *
 * World layout (tiles; origin = the player's centre, y down — src/sim/README.md): the dummy stands
 * at its sim position on a flat ground line; platforms, torches, trees and the moon are decoration
 * (the sim has no terrain).
 */
import { PixelCanvas } from '../../components/art/pixelCanvas'
import {
  dither,
  hash2,
  haze,
  intBetween,
  mulberry32,
  noise1d,
  paintGround,
  paintHills,
  paintMoon,
  paintRange,
  paintSky,
  paintStrata,
  paintTreeline,
  scatterStars,
  sparkle,
  stampOn,
  treeSprite,
  type TreeColors,
} from '../../components/art/hero/sceneKit'
import { A } from './arenaPalette'

export const ART_PX_PER_TILE = 8
export const GAME_PX_PER_TILE = 16
export const GAME_PX_PER_ART_PX = GAME_PX_PER_TILE / ART_PX_PER_TILE

export interface Platform {
  /** Left / right edge (tiles). */
  x0: number
  x1: number
  /** Walkable top surface (tiles). */
  y: number
}

/** Arena geometry in world tiles. */
export const ARENA_LAYOUT = {
  /** Ground surface: the feet line of the player and the default Target Dummy (2×3 at y = 0). */
  groundY: 1.5,
  /** Area the baked backdrop texture covers; outside it the sky / deep-ground colours continue. */
  backdrop: { x0: -28, y0: -18, widthTiles: 64, heightTiles: 26 },
  platforms: [
    { x0: -6.5, x1: -2.5, y: -3.5 },
    { x0: 4.5, x1: 8.5, y: -2.5 },
    { x0: -1, x1: 3, y: -7.5 },
  ] satisfies readonly Platform[],
  /** Torch bases (tiles), standing on the platforms. */
  torches: [
    { x: -6, y: -3.5 },
    { x: 8, y: -2.5 },
  ],
  moon: { x: -4.25, y: -5.9, r: 8 },
  /** Foreground trees on the ground line: trunk x (tiles), trunk height and crown radius (art px). */
  trees: [
    { x: -12, trunkH: 16, crownR: 9 },
    { x: -21, trunkH: 20, crownR: 10 },
    { x: 14, trunkH: 18, crownR: 10 },
    { x: 24, trunkH: 14, crownR: 8 },
  ],
} as const

/**
 * World x-extents (tiles) of the arena's set pieces: each platform with its outline, and each
 * tree's sprite box (sceneKit `treeSprite` is `2 × crownR + 10` art px wide, anchored at its
 * centre). The camera never lets a view edge slice one of these (design review M6).
 */
export const ARENA_SET_PIECES: readonly (readonly [number, number])[] = [
  ...ARENA_LAYOUT.platforms.map((p) => [p.x0 - 1 / ART_PX_PER_TILE, p.x1 + 1 / ART_PX_PER_TILE] as const),
  ...ARENA_LAYOUT.trees.map((t) => [t.x - (t.crownR + 5) / ART_PX_PER_TILE, t.x + (t.crownR + 5) / ART_PX_PER_TILE] as const),
]

/** The span of the platforms (with outlines): the arena's core composition, always shown whole. */
export const ARENA_CORE_X: readonly [number, number] = [
  Math.min(...ARENA_LAYOUT.platforms.map((p) => p.x0)) - 1 / ART_PX_PER_TILE,
  Math.max(...ARENA_LAYOUT.platforms.map((p) => p.x1)) + 1 / ART_PX_PER_TILE,
]

const { backdrop } = ARENA_LAYOUT
export const BACKDROP_W = backdrop.widthTiles * ART_PX_PER_TILE
export const BACKDROP_H = backdrop.heightTiles * ART_PX_PER_TILE
/** Backdrop grid column / row of a world position (tiles). */
export const backdropCol = (xTiles: number): number => Math.round((xTiles - backdrop.x0) * ART_PX_PER_TILE)
export const backdropRow = (yTiles: number): number => Math.round((yTiles - backdrop.y0) * ART_PX_PER_TILE)

const STAR_COLORS = [A.n200, A.n200, A.s400, A.s300, A.white, A.n400]
/** Stone strata colours (the band under the dirt, and the deep-rock tile below the backdrop). */
const STONE = { base: A.s800, dark: A.s900, light: A.s700, ore: [A.g600, A.n400] }

const ARENA_TREE: TreeColors = {
  leafLight: A.f500,
  leaf: A.f600,
  leafMid: A.f700,
  leafDark: A.f800,
  trunkLight: A.e600,
  trunk: A.e700,
  trunkDark: A.e800,
  outline: A.f950,
}

/** The static scene: night sky, moon, far peaks, forest edge, arena ground, platforms, torches. */
export function buildArenaBackdrop(): string[] {
  const rng = mulberry32(0x1ab5ee)
  const c = new PixelCanvas(BACKDROP_W, BACKDROP_H)
  const ground = backdropRow(ARENA_LAYOUT.groundY)

  paintSky(
    c,
    [
      { color: A.n950, until: backdropRow(-7.5) },
      { color: A.n900, until: backdropRow(-5) },
      { color: A.n800, until: backdropRow(-2.5) },
      { color: A.n700, until: BACKDROP_H },
    ],
    8,
  )
  const m = ARENA_LAYOUT.moon
  const moon = { cx: backdropCol(m.x), cy: backdropRow(m.y), r: m.r }
  const nearMoon = (x: number, y: number) => Math.hypot(x - moon.cx, y - moon.cy) < moon.r + 5
  scatterStars(c, rng, { top: 0, bottom: backdropRow(-2.5), count: 300, colors: STAR_COLORS, avoid: nearMoon })
  for (let i = 0; i < 9; i++) {
    const x = intBetween(rng, 4, BACKDROP_W - 5)
    const y = intBetween(rng, 4, backdropRow(-5))
    if (!nearMoon(x, y)) sparkle(c, x, y, A.white, A.n400)
  }
  paintMoon(c, { ...moon, body: A.g200, shade: A.g300, crater: A.g300, rim: A.white, crescent: { dx: -5, dy: -3 } })

  // Far snow-capped range low on the horizon, then darker foothills, each fading into haze.
  const peaks = Array.from({ length: 9 }, (_, i) => ({
    x: Math.round((i + 0.3 + rng() * 0.4) * (BACKDROP_W / 8.6)),
    top: backdropRow(-3.6 + rng() * 1.4),
    slope: 1.2 + rng() * 0.3,
  }))
  paintRange(
    c,
    rng,
    peaks,
    { lit: A.n600, shadow: A.n900, base: A.n800, rim: A.n400, snow: A.s300, snowShade: A.n400 },
    { bottom: ground, snowDepth: 4, speckle: 0.03, seed: 31 },
  )
  haze(c, backdropRow(-1.5), ground, A.n700, 0.5)
  const hills = noise1d(rng, BACKDROP_W, 60, 3).map((v) => backdropRow(-0.4) + v * 4)
  paintHills(c, hills, { fill: A.f950, top: A.f900, speck: A.n900 }, ground + 1)
  paintTreeline(c, rng, {
    from: -4,
    to: BACKDROP_W + 4,
    baseY: () => ground,
    minH: 9,
    maxH: 16,
    minGap: 5,
    maxGap: 10,
    colors: { body: A.f900, shade: A.f950, rim: A.f700 },
  })
  for (const { x, trunkH, crownR } of ARENA_LAYOUT.trees) {
    const tree = treeSprite(rng, trunkH, crownR, ARENA_TREE)
    stampOn(c, tree.rows, backdropCol(x), ground - 1, tree.anchorX)
  }

  // Flat arena floor: grass over dirt, stone strata deeper down.
  paintGround(c, new Array<number>(BACKDROP_W).fill(ground), { grassLight: A.f500, grass: A.f600, grassDark: A.f700, dirt: A.e800, dirtDark: A.e900, dirtLight: A.e700, deep: A.e900 }, 11)
  const stone = noise1d(rng, BACKDROP_W, 40, 2).map((v) => backdropRow(ARENA_LAYOUT.groundY + 3.2) + v * 3)
  paintStrata(c, stone, STONE, 37)

  for (const p of ARENA_LAYOUT.platforms) paintPlatform(c, p)
  for (const t of ARENA_LAYOUT.torches) stampOn(c, TORCH, backdropCol(t.x), backdropRow(t.y) - 1)
  return c.rows()
}

/** Repeating deep-rock tile (art px): a whole number of the 8 × 4 seam blocks and of the 16 px seam period. */
export const DEEP_TILE_W = 64
export const DEEP_TILE_H = 32

/**
 * The rock below the baked backdrop (design review M2) as a seamless tile the renderer repeats:
 * the strata's speckle, jittered diagonal seams and rare ore, over a sparse ordered dither of the
 * dark stone so the depths read a step darker than the band above. Every pattern repeats within
 * the tile (hash per pixel, seam period 16, Bayer period 4), so tiles meet without a visible edge.
 */
export function buildDeepTile(): string[] {
  const c = new PixelCanvas(DEEP_TILE_W, DEEP_TILE_H)
  for (let y = 0; y < DEEP_TILE_H; y++) {
    for (let x = 0; x < DEEP_TILE_W; x++) {
      const h = hash2(x, y, 41)
      let color = dither(x, y, 0.25) ? STONE.dark : STONE.base
      if (h < 0.1) color = STONE.dark
      else if (h > 0.93) color = STONE.light
      if ((x + y * 2 + Math.floor(hash2(x >> 3, y >> 2, 41) * 6)) % 16 === 0) color = STONE.dark
      if (hash2(x, y, 48) > 0.9975) color = STONE.ore[(x + y) % STONE.ore.length]
      c.set(x, y, color)
    }
  }
  return c.rows()
}

/** Wooden platform: half a tile thick, plank seams each tile, outlined so it reads over any sky. */
function paintPlatform(c: PixelCanvas, p: Platform): void {
  const x0 = backdropCol(p.x0)
  const x1 = backdropCol(p.x1) - 1
  const top = backdropRow(p.y)
  c.rect(x0 - 1, top - 1, x1 - x0 + 3, 6, A.n950)
  for (let x = x0; x <= x1; x++) {
    const seam = (x - x0) % ART_PX_PER_TILE === 0 && x !== x0
    c.set(x, top, seam ? A.e500 : A.e400)
    c.set(x, top + 1, seam ? A.e800 : A.e500)
    c.set(x, top + 2, seam ? A.e800 : (x - x0) % 3 === 1 ? A.e600 : A.e500)
    c.set(x, top + 3, A.e700)
  }
}

/** Torch on a post (base row last). The glow is a soft light sprite in the renderer. */
const TORCH: readonly string[] = (() => {
  const t = new PixelCanvas(5, 9)
  t.set(2, 1, A.g200)
    .rect(1, 2, 3, 2, A.g300)
    .set(2, 2, A.white)
    .set(2, 3, A.g200)
    .rect(1, 4, 3, 1, A.g500)
    .rect(2, 5, 1, 4, A.e500)
  return t.outline(A.n950).rows()
})()

/**
 * Infinite Dummy (UX_SPEC §3.4): an ORIGINAL training-dummy design — a stitched burlap sack on a
 * wooden cross-post with a painted bullseye — sized to the sim's default dummy, 2 × 3 tiles
 * (16 × 24 art px). Generic iconography, not a copy of the game's Target Dummy sprite.
 */
/** The dummy art's size (art px) and its painted bullseye's box within it (art px, end-exclusive). */
export const DUMMY_ART = { width: 16, height: 24, bullseye: { x0: 5, x1: 11, y0: 9, y1: 16 } } as const

/**
 * The bullseye's box in world tiles for a dummy drawn over its whole box (the arena stretches the art
 * to the dummy's width × height) — damage-over-time numbers keep clear of it.
 */
export function dummyBullseye(d: { x: number; y: number; width: number; height: number }): { x0: number; x1: number; y0: number; y1: number } {
  const { width, height, bullseye: b } = DUMMY_ART
  const left = d.x - d.width / 2
  const top = d.y - d.height / 2
  return { x0: left + (b.x0 / width) * d.width, x1: left + (b.x1 / width) * d.width, y0: top + (b.y0 / height) * d.height, y1: top + (b.y1 / height) * d.height }
}

export function buildDummy(): string[] {
  const c = new PixelCanvas(DUMMY_ART.width, DUMMY_ART.height)
  // Base plank with two feet, and the post.
  c.rect(3, 21, 10, 2, A.e600).rect(3, 21, 10, 1, A.e500).rect(3, 23, 3, 1, A.e800).rect(10, 23, 3, 1, A.e800)
  c.rect(7, 15, 2, 6, A.e600).rect(8, 15, 1, 6, A.e700)
  // Cross-bar arms with rope bindings.
  c.rect(1, 8, 14, 2, A.e600).rect(1, 9, 14, 1, A.e700).set(1, 8, A.e500).set(14, 8, A.e500)
  c.rect(3, 8, 1, 2, A.skin).rect(12, 8, 1, 2, A.skin)
  // Burlap torso (lit from the upper left), stitched side seams.
  c.rect(4, 7, 8, 9, A.e400).rect(5, 16, 6, 1, A.e400)
  c.rect(4, 7, 1, 9, A.skin).rect(11, 7, 1, 9, A.e500).rect(5, 16, 6, 1, A.e500)
  for (let y = 8; y <= 15; y += 2) c.set(4, y, A.e600).set(11, y, A.e700)
  // Painted bullseye on the chest (DUMMY_ART.bullseye).
  const eye = DUMMY_ART.bullseye
  for (let y = eye.y0; y < eye.y1; y++) {
    for (let x = eye.x0; x < eye.x1; x++) {
      const d = Math.hypot(x - 7.5, y - 12)
      if (d <= 1.2) c.set(x, y, A.red)
      else if (d <= 2.2) c.set(x, y, A.white)
      else if (d <= 3.1) c.set(x, y, A.red)
    }
  }
  // Rope collar and the sack head with a tied tuft on top.
  c.rect(6, 6, 4, 1, A.e700).set(7, 6, A.skin)
  c.rect(5, 2, 6, 4, A.e400).rect(6, 1, 4, 1, A.e400).rect(5, 2, 1, 4, A.skin).rect(6, 1, 1, 1, A.skin).rect(10, 2, 1, 4, A.e500)
  c.set(7, 0, A.e600).set(8, 0, A.e600)
  c.set(7, 4, A.e600).set(8, 4, A.e600) // stitched mouth seam
  return c.outline(A.n950).rows()
}

/**
 * The player: an ORIGINAL generic adventurer (hair, green tunic, belt, boots), facing right —
 * the renderer mirrors it to face left. 12 × 22 art px ≈ the game's 20 × 42 px player box.
 */
export function buildPlayer(): string[] {
  const c = new PixelCanvas(12, 22)
  // Hair and face.
  c.rect(4, 1, 4, 1, A.e800).rect(3, 2, 6, 2, A.e800).rect(3, 4, 2, 2, A.e800).set(8, 2, A.e700).set(4, 1, A.e700)
  c.rect(5, 4, 4, 3, A.skin).rect(5, 4, 1, 3, A.e400).set(8, 6, A.e400)
  c.set(7, 4, A.n950).set(8, 5, A.skin)
  c.rect(5, 7, 2, 1, A.e400)
  // Tunic with a lit right edge, sleeves, belt + buckle.
  c.rect(3, 8, 6, 5, A.f500).rect(3, 8, 1, 5, A.f600).rect(8, 8, 1, 5, A.f400)
  c.rect(2, 8, 1, 4, A.f600).rect(9, 8, 1, 4, A.f500)
  c.set(2, 12, A.e400).set(9, 12, A.skin)
  c.rect(3, 13, 6, 1, A.e700).set(6, 13, A.g400)
  // Legs and boots (toes forward).
  c.rect(4, 14, 2, 4, A.n600).rect(7, 14, 2, 4, A.n600).rect(5, 14, 1, 4, A.n700).rect(6, 14, 1, 2, A.n600)
  c.rect(3, 18, 3, 2, A.e800).rect(7, 18, 3, 2, A.e800).set(5, 18, A.e700).set(9, 18, A.e700)
  return c.outline(A.n950).rows()
}

/** Same shape, every pixel one colour (hit flash overlay). */
export function silhouette(rows: readonly string[], ch: string): string[] {
  return rows.map((row) => row.replace(/[^.]/g, ch))
}

/**
 * Summons (PRD P3-S9) — ORIGINAL generic art, one silhouette per AI class (AMENDMENTS-013 B63 P-6) so
 * each class reads differently at a glance, plus a sentry turret; none is a game sprite (the Lab has no
 * minion art). Facing right; the renderer mirrors them. About a tile each (8 art px = 1 tile).
 */
export type SummonArt = 'melee-contact' | 'ground-melee' | 'hover-strike' | 'ranged-shot' | 'sentry'

export function buildSummon(art: SummonArt): string[] {
  switch (art) {
    case 'melee-contact': {
      // a small winged flyer: spread wings, round body, one bright eye forward
      const c = new PixelCanvas(11, 7)
      c.rect(0, 1, 1, 2, A.n400).rect(1, 2, 2, 2, A.n400).rect(2, 3, 2, 1, A.n200)
      c.rect(10, 1, 1, 2, A.n400).rect(8, 2, 2, 2, A.n400).rect(7, 3, 2, 1, A.n200)
      c.rect(4, 2, 3, 4, A.n400).rect(4, 2, 3, 1, A.n200).set(6, 3, A.white).set(5, 6, A.g400)
      return c.outline(A.n950).rows()
    }
    case 'ground-melee': {
      // a hopping blob with two eyes, lit from above
      const c = new PixelCanvas(10, 7)
      c.rect(3, 0, 4, 1, A.f300).rect(2, 1, 6, 1, A.f400).rect(1, 2, 8, 1, A.f400).rect(0, 3, 10, 3, A.f500).rect(1, 6, 8, 1, A.f600)
      c.set(3, 1, A.f300).set(2, 2, A.f300)
      c.set(5, 3, A.n950).set(8, 3, A.n950).set(5, 4, A.white).set(8, 4, A.white)
      return c.outline(A.n950).rows()
    }
    case 'hover-strike': {
      // a hovering blade pointing forward, its hilt glowing
      const c = new PixelCanvas(12, 5)
      c.rect(0, 1, 1, 3, A.g500).rect(1, 2, 2, 1, A.e600).rect(3, 0, 1, 5, A.g400)
      c.rect(4, 1, 6, 3, A.s200).rect(4, 1, 6, 1, A.white).rect(10, 2, 1, 1, A.s200).rect(4, 3, 6, 1, A.s400)
      return c.outline(A.n950).rows()
    }
    case 'ranged-shot': {
      // a floating orb with a gold lens facing forward and two fins; it hovers in the night sky, so past
      // its dark outline a pale rim keeps it readable there (design review M4)
      const c = new PixelCanvas(13, 13)
      const o = 2
      c.rect(o + 2, o + 1, 5, 7, A.n600).rect(o + 1, o + 2, 7, 5, A.n600).rect(o + 2, o + 2, 3, 2, A.n400)
      c.rect(o + 5, o + 3, 3, 3, A.g400).set(o + 6, o + 4, A.white).set(o + 7, o + 3, A.g300)
      c.set(o, o, A.n400).set(o + 1, o + 1, A.n400).set(o, o + 8, A.n400).set(o + 1, o + 7, A.n400)
      return c.outline(A.n950).outline(A.n200).rows()
    }
    case 'sentry': {
      // a turret on a tripod: stone housing, gold muzzle forward
      const c = new PixelCanvas(13, 14)
      c.rect(2, 3, 7, 6, A.s500).rect(2, 3, 7, 1, A.s300).rect(2, 8, 7, 1, A.s700).rect(3, 4, 2, 2, A.s400)
      c.rect(9, 5, 3, 2, A.g500).rect(9, 5, 3, 1, A.g300).set(12, 5, A.g200)
      c.rect(5, 9, 1, 2, A.e600).line(5, 11, 2, 13, A.e600).line(5, 11, 8, 13, A.e600).rect(4, 13, 3, 1, A.e700)
      return c.outline(A.n950).rows()
    }
  }
}

/**
 * The whip tag marker's icon (PRD P3-S10 AC1): a luggage tag with its eyelet — a shape, not a colour.
 * `outline`: the same tag HOLLOW — only its one-pixel edge lit, dark inside — for a tagged dummy the
 * summons are not attacking (design review M2: filled vs hollow, never colour alone).
 */
export function buildTagIcon(style: 'filled' | 'outline' = 'filled'): string[] {
  const c = new PixelCanvas(8, 6)
  c.rect(2, 0, 6, 6, A.f300).rect(1, 1, 1, 4, A.f300).rect(0, 2, 1, 2, A.f300)
  if (style === 'outline') {
    const body = c.rows()
    const lit = (x: number, y: number) => (body[y]?.[x] ?? '.') !== '.'
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) if (lit(x, y) && lit(x - 1, y) && lit(x + 1, y) && lit(x, y - 1) && lit(x, y + 1)) c.set(x, y, A.n950)
    }
    return c.outline(A.n950).rows()
  }
  c.rect(2, 0, 6, 1, A.f400).rect(3, 4, 5, 1, A.f400)
  c.set(2, 2, A.n950).set(2, 3, A.n950)
  c.rect(4, 2, 3, 1, A.f500)
  return c.outline(A.n950).rows()
}
