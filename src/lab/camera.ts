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
 *   view edge ever cuts a set piece when a small shift avoids it.
 * - `action` (phones): the fight itself — player, dummies and the equipped weapon's reach — fills
 *   the canvas between the HUD's top row and its bottom controls, zoomed up to `actionMaxTilePx`.
 *   It never zooms out past the scene framing.
 */
import { ARENA_CORE_X, ARENA_LAYOUT, ARENA_SET_PIECES, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'

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
  /** CSS px at the bottom covered by HUD controls (action framing keeps the fight above them). */
  insetBottom: number
  /** Largest tile size (CSS px): big canvases show more arena instead of zooming in further. */
  maxTilePx: number
  framing: CameraFraming
  /** Scene framing: world x-range always shown whole. */
  sceneX: readonly [number, number]
  /** Scene framing: air (tiles) the zoom leaves on each side of `sceneX` when it has to zoom out for it. */
  sceneMarginX: number
  /** Scene framing: world x-ranges a view edge should not cut. */
  setPieces: readonly (readonly [number, number])[]
  /** Action framing: the world box the fight occupies (see `actionBox`); null = scene framing. */
  action: WorldBox | null
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
  maxTilePx: 48,
  framing: 'scene',
  sceneX: ARENA_CORE_X,
  sceneMarginX: 0.25,
  setPieces: ARENA_SET_PIECES,
  action: null,
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

/**
 * The fight's world box for action framing: the swing's full circle of reach around the player's
 * centre (a pointer can aim either way), every dummy with headroom for its damage numbers, and a
 * strip of ground under the feet. From the weapon's own data (`reachTiles`), never per weapon.
 */
export function actionBox(reachTiles: number, dummies: readonly { x: number; y: number; width: number; height: number }[]): WorldBox {
  const reach = Math.max(0, reachTiles)
  let x0 = -reach
  let x1 = reach
  let y0 = -reach
  for (const d of dummies) {
    x0 = Math.min(x0, d.x - d.width / 2)
    x1 = Math.max(x1, d.x + d.width / 2)
    y0 = Math.min(y0, d.y - d.height / 2 - NUMBER_HEADROOM)
  }
  return { x0: x0 - ACTION_MARGIN, x1: x1 + ACTION_MARGIN, y0: y0 - ACTION_MARGIN, y1: ARENA_LAYOUT.groundY + ACTION_GROUND }
}

export function fitCamera(cssWidth: number, cssHeight: number, dpr: number, options: Partial<CameraOptions> = {}): CameraFit {
  const o = { ...DEFAULT_CAMERA, ...options }
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const scene = fitScene(cssWidth, cssHeight, ratio, o)
  if (o.framing !== 'action' || !o.action) return scene
  const action = fitAction(cssWidth, cssHeight, ratio, o, o.action)
  return action.devicePxPerGamePx >= scene.devicePxPerGamePx ? action : scene
}

function fitScene(cssWidth: number, cssHeight: number, ratio: number, o: CameraOptions): CameraFit {
  const usableH = Math.max(1, cssHeight - o.insetTop)
  const [sceneX0, sceneX1] = o.sceneX
  const needW = Math.max(o.minTilesW, sceneX1 - sceneX0 + 2 * o.sceneMarginX)
  const byWidth = (cssWidth * ratio) / (needW * GAME_PX_PER_TILE)
  const byHeight = (usableH * ratio) / (o.minTilesH * GAME_PX_PER_TILE)
  const byCap = (o.maxTilePx * ratio) / GAME_PX_PER_TILE
  const devicePxPerGamePx = quantize(Math.min(byWidth, byHeight, byCap))
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
  return {
    cssWidth,
    cssHeight,
    dpr: ratio,
    devicePxPerGamePx,
    scale,
    tilePx,
    originX,
    originY: snap(o.insetTop + usableH / 2 - o.focusY * tilePx, ratio),
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
  return {
    cssWidth,
    cssHeight,
    dpr: ratio,
    devicePxPerGamePx,
    scale,
    tilePx,
    originX: snap(cssWidth / 2 - ((box.x0 + box.x1) / 2) * tilePx, ratio),
    originY: snap(o.insetTop + usableH / 2 - ((box.y0 + box.y1) / 2) * tilePx, ratio),
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
