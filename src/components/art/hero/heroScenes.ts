/**
 * Homepage hero scenes (REQUIREMENTS §1/§11: forest, mountains, glowing crystals,
 * night sky). Three original compositions built from the procedural kit; the
 * homepage ships DEFAULT_HERO_SCENE. Swapping variants is the one-line change at
 * the bottom of this file.
 *
 * Grid: 480 x 135 art pixels. The hero renders it with `xMidYMax slice`, so the
 * ground is always visible and the sides crop on narrow screens: keep focal
 * points inside columns ~180–300 (visible at 375px) and ~60–420 (at 1440px).
 */
import { PixelCanvas } from '../pixelCanvas'
import { S } from './heroPalette'
import {
  carveCave,
  clamp,
  type CrystalColors,
  crystalSprite,
  dither,
  hash2,
  haze,
  intBetween,
  mulberry32,
  noise1d,
  paintGround,
  paintHills,
  paintMoon,
  paintMushroom,
  paintPebbles,
  paintPine,
  paintRange,
  paintSky,
  paintSpike,
  paintStrata,
  paintTreeline,
  scatterFireflies,
  scatterStars,
  sparkle,
  stampHanging,
  stampOn,
  type TreeColors,
  treeSprite,
} from './sceneKit'

export const HERO_W = 480
export const HERO_H = 135

/** A grid box (cells, fractional edges) and the scene's on-screen scale there. */
export interface TextZone {
  x0: number
  x1: number
  y0: number
  y1: number
  /** CSS px per grid cell at that breakpoint (hero height / HERO_H). */
  pxPerCell: number
}

const MD_SCALE = 480 / HERO_H // HomeHero md:min-h-120
const LG_SCALE = 544 / HERO_H // HomeHero lg:min-h-136

/**
 * Protected text zones (design review H1/N5): where the HomeHero title and
 * tagline land on the grid, measured in the browser as the union over md
 * (768–1023px) and lg+ (1024–1440px), with and without a classic scrollbar.
 * `xMidYMax slice` fixes the text rows per breakpoint and slides the columns
 * with viewport width. Below md the text sits under the strong top-down scrim.
 * Re-measure if HomeHero's type scale, padding or min-heights change.
 */
export const HERO_TITLE_ZONES: readonly TextZone[] = [
  { x0: 102, x1: 303, y0: 17.4, y1: 26.4, pxPerCell: MD_SCALE },
  { x0: 87, x1: 336, y0: 22.1, y1: 34, pxPerCell: LG_SCALE },
]
export const HERO_TAGLINE_ZONES: readonly TextZone[] = [
  { x0: 102, x1: 308, y0: 34.6, y1: 40.5, pxPerCell: MD_SCALE },
  { x0: 87, x1: 268, y0: 41.9, y1: 47.2, pxPerCell: LG_SCALE },
]

/**
 * True when cell (x, y) is within `pad` cells of a tagline zone. Stars and
 * sparkles skip these cells: a lone bright pixel beside body-size text reads as
 * stray punctuation (N5). The display-size title is left starry on purpose.
 */
export function nearTagline(x: number, y: number, pad = 1): boolean {
  return HERO_TAGLINE_ZONES.some((z) => x + 1 > z.x0 - pad && x < z.x1 + pad && y + 1 > z.y0 - pad && y < z.y1 + pad)
}

export type GlowTone = 'moon' | 'crystal' | 'warm'

/** Soft light drawn over the pixels (grid units). */
export interface Glow {
  x: number
  y: number
  r: number
  tone: GlowTone
  /** Peak opacity, 0..1. */
  strength: number
  /** Slow stepped pulse (motion-safe only). */
  pulse?: boolean
}

export interface HeroSceneData {
  rows: string[]
  glows: Glow[]
}

export type HeroSceneId = 'moonlit-forest' | 'crystal-cavern' | 'mountain-ridge'

export interface HeroSceneDef {
  id: HeroSceneId
  label: string
  build: () => HeroSceneData
}

const CRYSTAL_BLUE: CrystalColors = { light: S.n200, mid: S.n400, dark: S.n600, glint: S.white, outline: S.n950 }

const FOREST_TREE: TreeColors = {
  leafLight: S.f500,
  leaf: S.f600,
  leafMid: S.f700,
  leafDark: S.f800,
  trunkLight: S.e600,
  trunk: S.e700,
  trunkDark: S.e800,
  outline: S.f950,
}

const NIGHT_GROUND = {
  grassLight: S.f500,
  grass: S.f600,
  grassDark: S.f700,
  dirt: S.e800,
  dirtDark: S.e900,
  dirtLight: S.e700,
  deep: S.e900,
}

const STAR_COLORS = [S.n200, S.n200, S.s400, S.s300, S.white, S.n400]

/* --------------------------------------------- A: moonlit forest -- */

function buildMoonlitForest(): HeroSceneData {
  const rng = mulberry32(0x5eed01)
  const c = new PixelCanvas(HERO_W, HERO_H)
  const glows: Glow[] = []

  paintSky(
    c,
    [
      { color: S.n950, until: 28 },
      { color: S.n900, until: 52 },
      { color: S.n800, until: 74 },
      { color: S.n700, until: 94 },
      { color: S.n600, until: HERO_H },
    ],
    10,
  )
  // Low in the right-hand sky, between the far peaks: >= 16px below the lg title
  // and right of every tagline position, and wholly in frame at 768/1024/1440
  // (design review H1, N6). Moving it consumes no RNG, so nothing else shifts.
  const moon = { cx: 330, cy: 52, r: 12 }
  const nearMoon = (x: number, y: number) => Math.hypot(x - moon.cx, y - moon.cy) < moon.r + 6
  const avoid = (x: number, y: number) => nearMoon(x, y) || nearTagline(x, y)
  scatterStars(c, rng, { top: 0, bottom: 76, count: 230, colors: STAR_COLORS, avoid })
  scatterStars(c, rng, { top: 0, bottom: 60, count: 26, colors: [S.twinkle, S.twinkleSlow], avoid })
  for (const [x, y] of [
    [214, 9],
    [402, 46],
    [283, 38],
    [96, 22],
    [452, 14],
  ] as const) {
    if (!nearTagline(x, y, 2)) sparkle(c, x, y, S.white, S.n400)
  }
  paintMoon(c, { ...moon, body: S.g200, shade: S.g300, crater: S.g300, rim: S.white })
  glows.push({ x: moon.cx, y: moon.cy, r: 44, tone: 'moon', strength: 0.28 })

  // Far snow-capped range, moonlit from the right, fading into horizon haze.
  paintRange(
    c,
    rng,
    [
      { x: 14, top: 60, slope: 1.25 },
      { x: 84, top: 50, slope: 1.1 },
      { x: 160, top: 58, slope: 1.2 },
      { x: 222, top: 46, slope: 1.05 },
      { x: 292, top: 57, slope: 1.2 },
      { x: 384, top: 48, slope: 1.1 },
      { x: 452, top: 58, slope: 1.2 },
    ],
    { lit: S.n600, shadow: S.n900, base: S.n800, rim: S.n400, snow: S.s300, snowShade: S.n400 },
    { bottom: 106, snowDepth: 6, speckle: 0.03, seed: 11 },
  )
  haze(c, 86, 106, S.n700, 0.5)

  // Nearer foothills, darker, no snow.
  paintRange(
    c,
    rng,
    [
      { x: 44, top: 82, slope: 2.4 },
      { x: 150, top: 86, slope: 2.6 },
      { x: 246, top: 80, slope: 2.4 },
      { x: 344, top: 85, slope: 2.5 },
      { x: 446, top: 81, slope: 2.4 },
    ],
    { lit: S.n700, shadow: S.n950, base: S.n900, rim: S.n600 },
    { bottom: 112, speckle: 0.04, seed: 12 },
  )
  haze(c, 98, 112, S.n800, 0.4)

  // Forest mass: rolling hill + two pine treelines.
  const hills = noise1d(rng, HERO_W, 70, 3).map((v) => 104 + v * 6)
  paintHills(c, hills, { fill: S.f950, top: S.f900, speck: S.n900 }, HERO_H)
  paintTreeline(c, rng, {
    from: -4,
    to: HERO_W + 4,
    baseY: (x) => Math.round(hills[x]) + 6,
    minH: 10,
    maxH: 17,
    minGap: 4,
    maxGap: 7,
    colors: { body: S.f950, shade: S.n950, rim: S.f800 },
  })
  const surface = noise1d(rng, HERO_W, 110, 2).map((v) => 123 + v * 3)
  paintTreeline(c, rng, {
    from: -6,
    to: HERO_W + 6,
    baseY: (x) => Math.round(surface[x]),
    minH: 14,
    maxH: 26,
    minGap: 8,
    maxGap: 15,
    colors: { body: S.f900, shade: S.f950, rim: S.f700 },
  })
  scatterFireflies(c, rng, 34, { x0: 0, x1: HERO_W - 1, y0: 92, y1: 118 }, S.firefly)

  // Foreground ground.
  paintGround(c, surface, { ...NIGHT_GROUND, accents: [S.n200, S.g300, S.n200] }, 7)
  paintPebbles(c, rng, 22, { x0: 0, x1: HERO_W - 1, y0: 128, y1: 133 }, { light: S.s600, mid: S.s700, dark: S.s800 })

  // Tall trees framing the scene.
  for (const [x, trunkH, crownR] of [
    [92, 30, 12],
    [152, 22, 9],
    [198, 18, 8],
    [322, 24, 10],
    [404, 32, 12],
    [452, 20, 9],
  ] as const) {
    const tree = treeSprite(rng, trunkH, crownR, FOREST_TREE)
    stampOn(c, tree.rows, x, Math.round(surface[x]), tree.anchorX)
  }

  // Glowing crystals growing from the forest floor.
  for (const [x, size, strength] of [
    [258, 5, 0.6],
    [234, 3, 0.45],
    [128, 3, 0.45],
    [370, 4, 0.5],
  ] as const) {
    const base = Math.round(surface[x]) + 1
    const sprite = crystalSprite(rng, size, CRYSTAL_BLUE)
    stampOn(c, sprite, x, base)
    glows.push({ x, y: base - size * 1.6, r: size * 7, tone: 'crystal', strength, pulse: true })
  }

  return { rows: c.rows(), glows }
}

export const MOONLIT_FOREST: HeroSceneDef = {
  id: 'moonlit-forest',
  label: 'Moonlit forest',
  build: buildMoonlitForest,
}

/* --------------------------------------------- B: crystal cavern -- */

const CRYSTAL_GOLD: CrystalColors = { light: S.g200, mid: S.g400, dark: S.g600, glint: S.white, outline: S.n950 }

/** Terraria-style cross-section: a thin night surface over a crystal-lit cavern. */
function buildCrystalCavern(): HeroSceneData {
  const rng = mulberry32(0xca7e5)
  const c = new PixelCanvas(HERO_W, HERO_H)
  const glows: Glow[] = []

  paintSky(
    c,
    [
      { color: S.n950, until: 22 },
      { color: S.n900, until: 42 },
      { color: S.n800, until: 58 },
      { color: S.n700, until: HERO_H },
    ],
    8,
  )
  const moon = { cx: 372, cy: 20, r: 9 }
  const nearMoon = (x: number, y: number) => Math.hypot(x - moon.cx, y - moon.cy) < moon.r + 5
  const avoid = (x: number, y: number) => nearMoon(x, y) || nearTagline(x, y)
  scatterStars(c, rng, { top: 0, bottom: 56, count: 190, colors: STAR_COLORS, avoid })
  scatterStars(c, rng, { top: 0, bottom: 48, count: 22, colors: [S.twinkle, S.twinkleSlow], avoid })
  for (const [x, y] of [
    [226, 8],
    [118, 30],
    [440, 40],
    [300, 14],
  ] as const) {
    if (!nearTagline(x, y, 2)) sparkle(c, x, y, S.white, S.n400)
  }
  paintMoon(c, { ...moon, body: S.g200, shade: S.g300, crater: S.g300, rim: S.white, crescent: { dx: -5, dy: -3 } })
  glows.push({ x: moon.cx, y: moon.cy, r: 30, tone: 'moon', strength: 0.2 })

  // Low distant range on the horizon.
  paintRange(
    c,
    rng,
    [
      { x: 40, top: 52, slope: 1.6 },
      { x: 150, top: 47, slope: 1.5 },
      { x: 262, top: 54, slope: 1.7 },
      { x: 360, top: 46, slope: 1.5 },
      { x: 456, top: 52, slope: 1.6 },
    ],
    { lit: S.n600, shadow: S.n900, base: S.n800, rim: S.n400, snow: S.s300, snowShade: S.n400 },
    { bottom: 74, snowDepth: 3, speckle: 0.03, seed: 21 },
  )
  haze(c, 60, 74, S.n700, 0.5)

  // Surface: treeline, two trees, then grass and dirt.
  const surface = noise1d(rng, HERO_W, 90, 2).map((v) => 70 + v * 2)
  paintTreeline(c, rng, {
    from: -4,
    to: HERO_W + 4,
    baseY: (x) => Math.round(surface[x]),
    minH: 8,
    maxH: 15,
    minGap: 5,
    maxGap: 11,
    colors: { body: S.f900, shade: S.f950, rim: S.f700 },
  })
  for (const [x, trunkH, crownR] of [
    [92, 12, 7],
    [418, 14, 8],
  ] as const) {
    const tree = treeSprite(rng, trunkH, crownR, FOREST_TREE)
    stampOn(c, tree.rows, x, Math.round(surface[x]), tree.anchorX)
  }
  scatterFireflies(c, rng, 14, { x0: 0, x1: HERO_W - 1, y0: 56, y1: 68 }, S.firefly)
  paintGround(c, surface, NIGHT_GROUND, 9)

  // Underground stone, then the cavern carved through it.
  const stoneTop = noise1d(rng, HERO_W, 50, 2).map((v) => 79 + v * 2)
  paintStrata(c, stoneTop, { base: S.s800, dark: S.s900, light: S.s700, ore: [S.g600, S.g700, S.n400] }, 23)

  const floorNoise = noise1d(rng, HERO_W, 60, 3)
  const ceilNoise = noise1d(rng, HERO_W, 30, 3)
  const pool = { x0: 302, x1: 350, level: 0 }
  const floor = floorNoise.map((v, x) => {
    const dip = x > pool.x0 && x < pool.x1 ? Math.round(5 * Math.sin((Math.PI * (x - pool.x0)) / (pool.x1 - pool.x0)) ** 0.6) : 0
    return 127 + v * 3 + dip
  })
  pool.level = Math.min(Math.round(floor[pool.x0]), Math.round(floor[pool.x1])) - 1
  const ceiling = ceilNoise.map((v, x) => {
    const envelope = Math.sin(Math.PI * clamp((x - 14) / 452, 0, 1)) ** 0.5
    const pillar = 1 - 0.92 * (Math.exp(-(((x - 150) / 5) ** 2)) + Math.exp(-(((x - 384) / 4) ** 2)))
    return floor[x] - Math.max(0, (envelope * 37 + v * 9) * pillar)
  })
  const isAir = carveCave(c, ceiling, floor, { wall: S.s950, wallDark: S.n950, wallLight: S.s900, rim: S.s600, moss: S.f600 }, 25)

  for (let i = 0; i < 34; i++) {
    const x = intBetween(rng, 0, HERO_W - 1)
    const top = Math.round(ceiling[x]) + 1
    if (isAir(x, top) && isAir(x, top + 3)) paintSpike(c, x, top, intBetween(rng, 2, 7), 1, { rock: S.s700, rim: S.s600 })
  }
  for (let i = 0; i < 16; i++) {
    const x = intBetween(rng, 0, HERO_W - 1)
    const base = Math.round(floor[x]) - 1
    if (x > pool.x0 - 3 && x < pool.x1 + 3) continue
    if (isAir(x, base) && isAir(x, base - 3)) paintSpike(c, x, base, intBetween(rng, 2, 5), -1, { rock: S.s700, rim: S.s600 })
  }

  // Still underground pool with a shimmering surface line.
  for (let x = pool.x0; x <= pool.x1; x++) {
    for (let y = pool.level; y < Math.round(floor[x]); y++) {
      if (!isAir(x, y)) continue
      c.set(x, y, y === pool.level ? (hash2(x, y, 3) < 0.35 ? S.shimmer : S.n400) : dither(x, y, 0.4) ? S.n700 : S.n600)
    }
  }

  // Glowing mushrooms along the cave floor.
  for (let i = 0; i < 18; i++) {
    const x = intBetween(rng, 20, HERO_W - 20)
    const base = Math.round(floor[x]) - 1
    if (x > pool.x0 - 2 && x < pool.x1 + 2) continue
    if (isAir(x, base) && isAir(x, base - 4)) paintMushroom(c, x, base, { cap: S.n400, capLight: S.n200, stem: S.s300 })
  }

  // Crystal formations: floor clusters (blue + two warm gold) and hanging ones.
  for (const [x, size, colors, tone] of [
    [240, 6, CRYSTAL_BLUE, 'crystal'],
    [212, 3, CRYSTAL_BLUE, 'crystal'],
    [270, 4, CRYSTAL_GOLD, 'warm'],
    [118, 4, CRYSTAL_BLUE, 'crystal'],
    [184, 2, CRYSTAL_GOLD, 'warm'],
    [420, 5, CRYSTAL_BLUE, 'crystal'],
    [62, 3, CRYSTAL_GOLD, 'warm'],
  ] as const) {
    const base = Math.round(floor[x]) + 1
    const sprite = crystalSprite(rng, size, colors)
    stampOn(c, sprite, x, base)
    glows.push({ x, y: base - size * 1.5, r: size * 7, tone, strength: tone === 'warm' ? 0.4 : 0.55, pulse: true })
  }
  for (const [x, size] of [
    [256, 3],
    [334, 3],
    [96, 2],
  ] as const) {
    const top = Math.round(ceiling[x])
    const sprite = crystalSprite(rng, size, CRYSTAL_BLUE, true)
    stampHanging(c, sprite, x, top - 1)
    glows.push({ x, y: top + size * 1.5, r: size * 6, tone: 'crystal', strength: 0.4, pulse: true })
  }

  return { rows: c.rows(), glows }
}

export const CRYSTAL_CAVERN: HeroSceneDef = {
  id: 'crystal-cavern',
  label: 'Crystal cavern',
  build: buildCrystalCavern,
}

/* -------------------------------------------- C: mountain ridge -- */

const STONE_LEDGE = { base: S.s700, dark: S.s800, light: S.s600 }

/** A towering moonlit massif over a misty pine valley; crystals on a near ledge. */
function buildMountainRidge(): HeroSceneData {
  const rng = mulberry32(0x9eac3)
  const c = new PixelCanvas(HERO_W, HERO_H)
  const glows: Glow[] = []

  paintSky(
    c,
    [
      { color: S.n950, until: 34 },
      { color: S.n900, until: 60 },
      { color: S.n800, until: 82 },
      { color: S.n700, until: 100 },
      { color: S.n600, until: HERO_H },
    ],
    10,
  )
  const moon = { cx: 356, cy: 24, r: 14 }
  const nearMoon = (x: number, y: number) => Math.hypot(x - moon.cx, y - moon.cy) < moon.r + 5
  const avoid = (x: number, y: number) => nearMoon(x, y) || nearTagline(x, y)
  scatterStars(c, rng, { top: 0, bottom: 92, count: 320, colors: STAR_COLORS, avoid })
  scatterStars(c, rng, { top: 0, bottom: 70, count: 30, colors: [S.twinkle, S.twinkleSlow], avoid })
  for (const [x, y] of [
    [196, 12],
    [410, 52],
    [62, 40],
    [292, 6],
    [460, 18],
    [130, 8],
  ] as const) {
    if (!nearTagline(x, y, 2)) sparkle(c, x, y, S.white, S.n400)
  }
  paintMoon(c, { ...moon, body: S.g200, shade: S.g300, crater: S.g300, rim: S.white, crescent: { dx: -8, dy: -4 } })
  glows.push({ x: moon.cx, y: moon.cy, r: 46, tone: 'moon', strength: 0.24 })

  // Far blue range behind the massif.
  paintRange(
    c,
    rng,
    [
      { x: 30, top: 62, slope: 1.4 },
      { x: 104, top: 58, slope: 1.3 },
      { x: 388, top: 60, slope: 1.35 },
      { x: 462, top: 56, slope: 1.3 },
    ],
    { lit: S.n700, shadow: S.n900, base: S.n800, rim: S.n600, snow: S.n400, snowShade: S.n600 },
    { bottom: 104, snowDepth: 3, speckle: 0.03, seed: 31 },
  )
  haze(c, 84, 104, S.n700, 0.45)

  // The massif: tallest peak first so lower summits overlap its flanks. The
  // summit sits right of the lg/xl tagline zone (rows 40-47, cols < ~240) so
  // bright snow never lands behind text.
  paintRange(
    c,
    rng,
    [
      { x: 300, top: 38, slope: 1.15 },
      { x: 238, top: 51, slope: 1.1 },
      { x: 360, top: 49, slope: 1.1 },
      { x: 180, top: 57, slope: 1.2 },
      { x: 414, top: 58, slope: 1.15 },
      { x: 128, top: 61, slope: 1.3 },
    ],
    { lit: S.s600, shadow: S.s900, base: S.s800, rim: S.s400, snow: S.s200, snowShade: S.s400 },
    { bottom: 112, snowDepth: 10, speckle: 0.04, fadeAfter: 22, fadeMax: 0.5, seed: 32 },
  )
  haze(c, 92, 112, S.n600, 0.55)

  // Misty pine valley.
  const hills = noise1d(rng, HERO_W, 80, 3).map((v) => 106 + v * 5)
  paintHills(c, hills, { fill: S.f950, top: S.f900, speck: S.n950 }, HERO_H)
  paintTreeline(c, rng, {
    from: -4,
    to: HERO_W + 4,
    baseY: (x) => Math.round(hills[x]) + 5,
    minH: 9,
    maxH: 18,
    minGap: 4,
    maxGap: 8,
    colors: { body: S.f950, shade: S.n950, rim: S.f800 },
  })
  scatterFireflies(c, rng, 18, { x0: 0, x1: HERO_W - 1, y0: 100, y1: 120 }, S.firefly)

  const surface = noise1d(rng, HERO_W, 100, 2).map((v) => 125 + v * 2)
  paintGround(c, surface, { ...NIGHT_GROUND, accents: [S.n200, S.g300] }, 11)

  // Rocky ledge in the foreground, grass on top, crystals growing from it.
  const ledgeNoise = noise1d(rng, HERO_W, 24, 2)
  const ledge = { x0: 196, x1: 318 }
  const ledgeTop: number[] = []
  for (let x = ledge.x0; x <= ledge.x1; x++) {
    const p = (x - ledge.x0) / (ledge.x1 - ledge.x0)
    const shoulder = Math.min(1, p * 5, (1 - p) * 4)
    const top = Math.round(Math.round(surface[x]) - shoulder * (9 + ledgeNoise[x] * 2))
    ledgeTop[x] = top
    for (let y = top; y < Math.round(surface[x]) + 2; y++) {
      const h = hash2(x, y, 41)
      let color = h < 0.12 ? STONE_LEDGE.dark : h > 0.9 ? STONE_LEDGE.light : STONE_LEDGE.base
      if (y === top) color = S.f500
      else if (y === top + 1) color = hash2(x, y, 42) < 0.6 ? S.f600 : STONE_LEDGE.light
      c.set(x, y, color)
    }
  }
  for (const [x, size, strength] of [
    [254, 5, 0.6],
    [232, 3, 0.45],
    [282, 2, 0.4],
  ] as const) {
    const base = ledgeTop[x] + 1
    const sprite = crystalSprite(rng, size, CRYSTAL_BLUE)
    stampOn(c, sprite, x, base)
    glows.push({ x, y: base - size * 1.6, r: size * 7, tone: 'crystal', strength, pulse: true })
  }

  // Tall dark pines framing the view.
  for (const [x, h] of [
    [72, 44],
    [98, 34],
    [396, 40],
    [432, 48],
    [24, 38],
    [470, 36],
  ] as const) {
    paintPine(c, x, Math.round(surface[x]), h, { body: S.f950, shade: S.n950, rim: S.f800 })
  }

  return { rows: c.rows(), glows }
}

export const MOUNTAIN_RIDGE: HeroSceneDef = {
  id: 'mountain-ridge',
  label: 'Mountain ridge',
  build: buildMountainRidge,
}

/**
 * All variants, keyed by id (design review / dev preview via `/?hero=<id>`).
 * Literal keys keep this object side-effect free, so production builds (which
 * only reference DEFAULT_HERO_SCENE) tree-shake the other variants away.
 */
export const HERO_SCENES: Readonly<Record<HeroSceneId, HeroSceneDef>> = {
  'moonlit-forest': MOONLIT_FOREST,
  'crystal-cavern': CRYSTAL_CAVERN,
  'mountain-ridge': MOUNTAIN_RIDGE,
}

/** The variant the homepage ships. Swap variants here (one line). */
export const DEFAULT_HERO_SCENE: HeroSceneDef = MOONLIT_FOREST
