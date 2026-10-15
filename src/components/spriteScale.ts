/**
 * Whole-number sprite scaling (UX_SPEC §3.1, design review P2-S3 #4). Pixel art must never be
 * resampled by a fractional factor: at e.g. 0.67x nearest-neighbour silently drops whole rows
 * and columns (Adamantite Sword's 1px highlight line vanished in the 40px list box).
 *
 * - fits the box  → largest integer upscale (1x, 2x, 3x…)
 * - larger than the box → integer DOWNscale 1/n (½, ⅓…). Terraria item art is drawn in 2×2
 *   texel blocks (481 of the 488 shipped weapon sprites exactly, measured 2026-10-12), so ½
 *   lands on its art pixels and loses nothing; on 2x screens every texel still maps to whole
 *   device pixels.
 *
 * `maxUpscale` caps the integer upscale (whole numbers, ≥ 1; default: no cap) — e.g. the featured
 * cards stop at 3× so a 16px sword doesn't become a 9× blob in their large slot (design review).
 */
export function spriteScale(width: number, height: number, box: number, maxUpscale = Infinity): number {
  const largest = Math.max(width, height)
  if (largest <= 0 || box <= 0) return 1
  if (largest > box) return 1 / Math.ceil(largest / box)
  return Math.min(Math.floor(box / largest), Math.max(1, Math.floor(maxUpscale)))
}

/**
 * Shift (CSS px) that moves an element whose document position is (`left`, `top`) onto the
 * device-pixel grid. A whole-number factor alone is not enough: centred layouts put sprites at
 * half pixels (e.g. `mx-auto` in a 1425px-wide viewport with a classic scrollbar), and Chromium
 * then samples a ½-scaled sprite across texel boundaries — Adamantite Sword matched 204/293 art
 * pixels at x.5 and 293/293 once on the grid (P2-S3 design-review probe).
 */
export function devicePixelOffset(left: number, top: number, dpr: number): { dx: number; dy: number } {
  const ratio = dpr > 0 ? dpr : 1
  const snap = (v: number) => {
    const d = Math.round(v * ratio) / ratio - v
    return Math.abs(d) < 1e-6 ? 0 : d
  }
  return { dx: snap(left), dy: snap(top) }
}

/**
 * Rendered CSS size of a sprite in a `box`px square. Not rounded: rounding a ⅓ downscale of an
 * odd size would make the factor inexact again (CSS accepts fractional px; the box is fixed).
 */
export function spriteSize(
  width: number,
  height: number,
  box: number,
  maxUpscale?: number,
): { width: number; height: number } {
  const scale = spriteScale(width, height, box, maxUpscale)
  return { width: width * scale, height: height * scale }
}
