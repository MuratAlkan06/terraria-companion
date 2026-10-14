/**
 * Arena camera: fits the world into the canvas at a WHOLE number of device pixels per ART pixel
 * (one art pixel = 2 game pixels, so ½-steps of device pixels per game pixel), so the arena's
 * pixel art stays crisp at every size and device pixel ratio (ADR-001 D5 nearest scaling), and maps
 * world tiles ↔ CSS pixels for the renderer and pointer aiming. Pure (testable in Node).
 *
 * Two framings (design review P3-S1 H3 / M6):
 * - `scene` (tablet and desktop): the band of world rows that must stay visible (the tallest swing
 *   above the player down to a strip of ground) is centred below the HUD, the player stands at
 *   `anchorX` of the width, and the platforms are always whole: a narrow arena zooms out (the extra
 *   height shows more sky and ground) and shifts sideways rather than slicing a platform, and no
 *   view edge ever cuts a set piece when a small shift avoids it. A thrown explosive's blast circle
 *   (`blast`, design review P3-S11 #3) is kept whole the same way: only a ring the composition
 *   would cut zooms the view out, only as far as the ring needs, and shifts it just enough.
 * - `action` (phones): the fight itself — player, dummies and the equipped weapon's reach — fills
 *   the canvas between the HUD's top row and its bottom controls, zoomed up to `actionMaxTilePx`.
 *   It never zooms out past the scene framing — except for a box that must be seen whole
 *   (`actionWhole`: a thrown explosive's blast circle, design review P3-S11 #3), which the scene's
 *   framing would cut: then it zooms out as far as the box needs (down to one device pixel per game
 *   pixel), so the whole ring — its underground lower arc too — sits above the bottom HUD row.
 *
 * HUD-aware placement (design review P3-S2/S3 M6 + nit; never changes the zoom): the bottom HUD
 * (controls, DPS graph strip) covers the canvas too, so both framings lift the fight above it. The
 * scene band moves up toward the middle of the space between the HUD rows, at most until its top
 * meets the top row — further if the weapon's reach circle (a swing's whole sweep) would still dip
 * under the bottom row, as far as the circle's top stays below the top row (`reachTiles`). An
 * action box too tall for that space (a long spear's reach circle) keeps its
 * bottom — the fighters and their ground — above the bottom row and lets the top of the reach
 * circle go under the top row. Either way the feet stay `floorPx` clear of the bottom row (the
 * first-use hint floats there) and the player's head stays below the top row.
 */
import { ARENA_CORE_X, ARENA_LAYOUT, ARENA_SET_PIECES, buildPlayer, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'

export type CameraFraming = 'scene' | 'action'

/** An axis-aligned world box (tiles, y down). */
export interface WorldBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface CameraOptions {
  /** Minimum world width / height kept visible (tiles). */
  minTilesW: number
  minTilesH: number
  /** Player x as a fraction of the canvas width (scene framing). */
  anchorX: number
  /** World y (tiles) placed at the vertical centre of the usable height (scene framing). */
  focusY: number
  /** CSS px at the top reserved for HUD (the fit uses the height below it). */
  insetTop: number
  /** CSS px at the bottom covered by HUD controls (the fight is placed above them). */
  insetBottom: number
  /** CSS px kept clear between the player's feet and the bottom inset (placement only, never the zoom). */
  floorPx: number
  /**
   * The equipped weapon's reach (tiles): scene framing lifts the view until the whole reach circle
   * (a swing's full sweep) clears the bottom inset, as far as the circle's top stays below the top
   * inset. Placement only, never the zoom; 0 = no weapon.
   */
  reachTiles: number
  /** Largest tile size (CSS px): big canvases show more arena instead of zooming in further. */
  maxTilePx: number
  framing: CameraFraming
  /** Scene framing: world x-range always shown whole. */
  sceneX: readonly [number, number]
  /** Scene framing: air (tiles) the zoom leaves on each side of `sceneX` when it has to zoom out for it. */
  sceneMarginX: number
  /** Scene framing: world x-ranges a view edge should not cut. */
  setPieces: readonly (readonly [number, number])[]
  /**
   * Scene framing: a thrown explosive's blast circle, kept whole between the HUD rows (design review
   * P3-S11 #3) — its x-range joins `sceneX`, and the zoom steps out only if the ring wouldn't fit
   * between the rows; null = none. (The action framing has it in `action`.)
   */
  blast: WorldCircle | null
  /** Action framing: the world box the fight occupies (see `actionBox`); null = scene framing. */
  action: WorldBox | null
  /**
   * Action framing: the box must be seen whole (it holds a thrown explosive's blast circle), so the action
   * framing is kept even where it zooms out further than the scene's — which would cut the circle.
   */
  actionWhole: boolean
  /** Action framing: largest tile size (CSS px) — 2× the arena's 16 px tile. */
  actionMaxTilePx: number
}

export const DEFAULT_CAMERA: CameraOptions = {
  // Room for the longest reach in the data on both sides (≈5.7 tiles) at the default anchor.
  minTilesW: 12,
  // From just above the highest swing tip (−6.75) to a strip of ground below the feet (+4.25).
  minTilesH: 11,
  anchorX: 0.38,
  focusY: -1.25,
  insetTop: 0,
  insetBottom: 0,
  floorPx: 0,
  reachTiles: 0,
  maxTilePx: 48,
  framing: 'scene',
  sceneX: ARENA_CORE_X,
  sceneMarginX: 0.25,
  setPieces: ARENA_SET_PIECES,
  blast: null,
  action: null,
  actionWhole: false,
  actionMaxTilePx: 2 * GAME_PX_PER_TILE,
}

export interface CameraFit {
  cssWidth: number
  cssHeight: number
  dpr: number
  /** Device pixels per game pixel: a whole number per art pixel (½ steps), ≥ 1. */
  devicePxPerGamePx: number
  /** CSS pixels per game pixel (= devicePxPerGamePx / dpr). */
  scale: number
  /** CSS pixels per tile. */
  tilePx: number
  /** CSS position of the world origin (the player's centre), snapped to the device-pixel grid. */
  originX: number
  originY: number
  framing: CameraFraming
}

const snap = (css: number, dpr: number): number => Math.round(css * dpr) / dpr

/** Largest crisp zoom ≤ `devicePxPerGamePx`: whole device pixels per art pixel, never below 1. */
const quantize = (devicePxPerGamePx: number): number => Math.max(1, Math.floor(devicePxPerGamePx * GAME_PX_PER_ART_PX + 1e-9) / GAME_PX_PER_ART_PX)

/** Air kept around the fight in action framing (tiles). */
const ACTION_MARGIN = 0.5
/** Room above a dummy for its rising damage numbers (tiles). */
const NUMBER_HEADROOM = 1.5
/** Ground kept below the feet in action framing (tiles). */
const ACTION_GROUND = 1
/** The top of the player's head (world tiles): the arena's player sprite stands on the ground line. */
export const PLAYER_TOP_Y = ARENA_LAYOUT.groundY - (buildPlayer().length * GAME_PX_PER_ART_PX) / GAME_PX_PER_TILE

/**
 * The CSS y of the world row `y` that keeps the fight clear of the HUD rows, from a preferred one:
 * no lower than puts the feet `floorPx` above the bottom inset, no higher than puts the head under
 * the top inset (the head wins on a canvas too short for both).
 */
function clearOfHud(preferred: number, y: number, tilePx: number, cssHeight: number, o: CameraOptions): number {
  const feet = cssHeight - o.insetBottom - o.floorPx - (ARENA_LAYOUT.groundY - y) * tilePx
  const head = o.insetTop + (y - PLAYER_TOP_Y) * tilePx
  return Math.max(head, Math.min(preferred, feet))
}

/** A circle in the world (tiles): a thrown explosive's blast where it goes off. */
export interface WorldCircle {
  x: number
  y: number
  radiusTiles: number
}

/**
 * The fight's world box for action framing: the swing's full circle of reach around the player's
 * centre (a pointer can aim either way), every dummy with headroom for its damage numbers, and a
 * strip of ground under the feet — and, for a thrown explosive, its whole blast circle (`blast`, where a
 * Space or timed-test throw goes off; design review P3-S11 #3: the ring, its underground lower arc
 * too, must be observable, like the reach). From the weapon's own data, never per weapon.
 */
export function actionBox(reachTiles: number, dummies: readonly { x: number; y: number; width: number; height: number }[], blast: WorldCircle | null = null): WorldBox {
  const reach = Math.max(0, reachTiles)
  let x0 = -reach
  let x1 = reach
  let y0 = -reach
  let y1 = ARENA_LAYOUT.groundY + ACTION_GROUND
  for (const d of dummies) {
    x0 = Math.min(x0, d.x - d.width / 2)
    x1 = Math.max(x1, d.x + d.width / 2)
    y0 = Math.min(y0, d.y - d.height / 2 - NUMBER_HEADROOM)
  }
  if (blast && blast.radiusTiles > 0) {
    x0 = Math.min(x0, blast.x - blast.radiusTiles)
    x1 = Math.max(x1, blast.x + blast.radiusTiles)
    y0 = Math.min(y0, blast.y - blast.radiusTiles)
    y1 = Math.max(y1, blast.y + blast.radiusTiles + ACTION_MARGIN)
  }
  return { x0: x0 - ACTION_MARGIN, x1: x1 + ACTION_MARGIN, y0: y0 - ACTION_MARGIN, y1 }
}

/** Air kept beyond the far dummy of a row in scene framing (tiles): room for its damage numbers. */
const ROW_MARGIN_TILES = 1.5
/** Air kept around a blast ring in scene framing (tiles): its two-art-px stroke reaches 1½ art px past the radius. */
const RING_MARGIN_TILES = (1.5 * GAME_PX_PER_ART_PX) / GAME_PX_PER_TILE

/**
 * Scene framing's always-shown x-range with the dummies in it: the arena's core composition, widened
 * only as far as a row of Multiple Dummies reaches past it (plus room for its numbers). A dummy inside
 * the core changes nothing, so the single-dummy framing is exactly the core's.
 */
export function sceneXFor(dummies: readonly { x: number; width: number }[], core: readonly [number, number] = ARENA_CORE_X): [number, number] {
  let [x0, x1] = core
  for (const d of dummies) {
    x0 = Math.min(x0, d.x - d.width / 2 - ROW_MARGIN_TILES)
    x1 = Math.max(x1, d.x + d.width / 2 + ROW_MARGIN_TILES)
  }
  return [x0, x1]
}

export function fitCamera(cssWidth: number, cssHeight: number, dpr: number, options: Partial<CameraOptions> = {}): CameraFit {
  const o = { ...DEFAULT_CAMERA, ...options }
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const scene = fitScene(cssWidth, cssHeight, ratio, o)
  if (o.framing !== 'action' || !o.action) return scene
  const action = fitAction(cssWidth, cssHeight, ratio, o, o.action)
  return action.devicePxPerGamePx >= scene.devicePxPerGamePx || o.actionWhole ? action : scene
}

function fitScene(cssWidth: number, cssHeight: number, ratio: number, o: CameraOptions): CameraFit {
  const usableH = Math.max(1, cssHeight - o.insetTop)
  // A blast ring kept whole (P3-S11 #3): its x-range is shown whole like the platforms', and the zoom
  // steps out only if the ring wouldn't fit between the HUD rows.
  const ring = o.blast && o.blast.radiusTiles > 0 ? { ...o.blast, r: o.blast.radiusTiles + RING_MARGIN_TILES } : null
  const [sceneX0, sceneX1] = ring ? [Math.min(o.sceneX[0], ring.x - ring.r), Math.max(o.sceneX[1], ring.x + ring.r)] : o.sceneX
  const needW = Math.max(o.minTilesW, sceneX1 - sceneX0 + 2 * o.sceneMarginX)
  const byWidth = (cssWidth * ratio) / (needW * GAME_PX_PER_TILE)
  const byHeight = (usableH * ratio) / (o.minTilesH * GAME_PX_PER_TILE)
  const byCap = (o.maxTilePx * ratio) / GAME_PX_PER_TILE
  const byRing = ring ? (Math.max(1, cssHeight - o.insetTop - o.insetBottom) * ratio) / (2 * ring.r * GAME_PX_PER_TILE) : Infinity
  const devicePxPerGamePx = quantize(Math.min(byWidth, byHeight, byCap, byRing))
  const scale = devicePxPerGamePx / ratio
  const tilePx = scale * GAME_PX_PER_TILE
  const viewW = cssWidth / tilePx
  // The default composition, shifted only as far as needed to keep the platforms whole…
  const preferred = -o.anchorX * viewW
  const lo = sceneX1 - viewW
  const hi = sceneX0
  const fits = lo <= hi
  const left = fits ? clearOfSetPieces(Math.min(hi, Math.max(lo, preferred)), viewW, lo, hi, o.setPieces) : (sceneX0 + sceneX1 - viewW) / 2
  let originX = snap(-left * tilePx, ratio)
  if (fits) {
    // Snapping must not pull an edge a fraction of a pixel into the platforms it was clamped to.
    const edge = (x: number) => -x / tilePx
    if (edge(originX) > hi + 1e-9) originX += 1 / ratio
    else if (edge(originX) + viewW < sceneX1 - 1e-9) originX -= 1 / ratio
  }
  // The band's centre (focusY): centred below the top row as before, raised toward the middle of
  // the space between the HUD rows — never past the band's top meeting the top row.
  const centred = o.insetTop + usableH / 2
  const between = Math.max(o.insetTop + (o.minTilesH * tilePx) / 2, o.insetTop + (cssHeight - o.insetBottom - o.insetTop) / 2)
  const focus = clearOfHud(Math.min(centred, between), o.focusY, tilePx, cssHeight, o)
  // Then the weapon's reach circle (a swing's whole sweep) lifted clear of the bottom row, as far
  // as its top — and the player's head — stay below the top row.
  let originY = focus - o.focusY * tilePx
  const reach = Math.max(0, o.reachTiles) * tilePx
  const under = originY + reach - (cssHeight - o.insetBottom)
  if (reach > 0 && under > 0) originY -= Math.min(under, Math.max(0, originY - Math.max(reach, -PLAYER_TOP_Y * tilePx) - o.insetTop))
  if (ring) {
    // A blast ring: moved just enough to sit whole between the rows — one taller than the room (only at
    // one device pixel per game pixel) keeps its lower arc above the bottom row — the head below the top row.
    originY = Math.min(cssHeight - o.insetBottom - (ring.y + ring.r) * tilePx, Math.max(o.insetTop - (ring.y - ring.r) * tilePx, originY))
    originY = Math.max(originY, o.insetTop - PLAYER_TOP_Y * tilePx)
  }
  return {
    cssWidth,
    cssHeight,
    dpr: ratio,
    devicePxPerGamePx,
    scale,
    tilePx,
    originX,
    originY: snap(originY, ratio),
    framing: 'scene',
  }
}

/**
 * …then nudged (within [lo, hi]) to the nearest left edge where neither view edge cuts a set
 * piece; unchanged if it already cuts none or no such position exists.
 */
function clearOfSetPieces(left: number, viewW: number, lo: number, hi: number, pieces: CameraOptions['setPieces']): number {
  const slices = (l: number) => pieces.some(([a, b]) => (a < l && l < b) || (a < l + viewW && l + viewW < b))
  if (!slices(left)) return left
  const options = pieces.flatMap(([a, b]) => [a, b, a - viewW, b - viewW]).filter((l) => l >= lo && l <= hi && !slices(l))
  if (options.length === 0) return left
  return options.reduce((best, l) => (Math.abs(l - left) < Math.abs(best - left) ? l : best))
}

function fitAction(cssWidth: number, cssHeight: number, ratio: number, o: CameraOptions, box: WorldBox): CameraFit {
  const usableH = Math.max(1, cssHeight - o.insetTop - o.insetBottom)
  const byWidth = (cssWidth * ratio) / ((box.x1 - box.x0) * GAME_PX_PER_TILE)
  const byHeight = (usableH * ratio) / ((box.y1 - box.y0) * GAME_PX_PER_TILE)
  const byCap = (o.actionMaxTilePx * ratio) / GAME_PX_PER_TILE
  const devicePxPerGamePx = quantize(Math.min(byWidth, byHeight, byCap))
  const scale = devicePxPerGamePx / ratio
  const tilePx = scale * GAME_PX_PER_TILE
  // Centred between the HUD rows; a box taller than that space keeps its bottom (the fighters and
  // their ground) above the bottom row.
  const mid = (box.y0 + box.y1) / 2
  const boxH = (box.y1 - box.y0) * tilePx
  const preferred = boxH > usableH ? cssHeight - o.insetBottom - boxH / 2 : o.insetTop + usableH / 2
  return {
    cssWidth,
    cssHeight,
    dpr: ratio,
    devicePxPerGamePx,
    scale,
    tilePx,
    originX: snap(cssWidth / 2 - ((box.x0 + box.x1) / 2) * tilePx, ratio),
    originY: snap(clearOfHud(preferred, mid, tilePx, cssHeight, o) - mid * tilePx, ratio),
    framing: 'action',
  }
}

/** World tiles → CSS pixels inside the canvas. */
export function worldToScreen(fit: CameraFit, x: number, y: number): { x: number; y: number } {
  return { x: fit.originX + x * fit.tilePx, y: fit.originY + y * fit.tilePx }
}

/** CSS pixels inside the canvas → world tiles (pointer aiming). */
export function screenToWorld(fit: CameraFit, x: number, y: number): { x: number; y: number } {
  return { x: (x - fit.originX) / fit.tilePx, y: (y - fit.originY) / fit.tilePx }
}

/** The world x-range (tiles) the fit shows across the canvas. */
export function visibleWorldX(fit: CameraFit): [number, number] {
  return [screenToWorld(fit, 0, 0).x, screenToWorld(fit, fit.cssWidth, 0).x]
}
