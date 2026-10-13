/**
 * Floating damage numbers (UX_SPEC §12 "Signature moments"): rise-and-fade over 600 ms; crits are
 * larger with a heavier outline and a brief pop (size + outline + colour — never colour alone,
 * §9); reduced motion keeps them in place and only fades (§9). Pure timing model, a collision-aware
 * layout and a recycling pool, so the renderer's BitmapText objects are created once and reused
 * (ADR-001 D5).
 */

export const FLOAT_MS = 600
/** How far a number rises over its life (CSS px). */
export const FLOAT_RISE_PX = 40
/** Reduced motion: hold fully visible, then fade in place. */
const REDUCED_HOLD = 0.45
/** Crits pop during the first 15% of their life, from this scale down to 1. */
const CRIT_POP_SCALE = 1.35
const CRIT_POP_END = 0.15
export const FLOAT_POP_MS = FLOAT_MS * CRIT_POP_END
/**
 * Clear space kept between two live numbers (CSS px, outside their outlines). Side by side at a
 * shared height they need a word-sized gap — closer, "14" and "16" read as "1416" — while stacked
 * one above the other a small gap already reads as two lines.
 */
export const FLOAT_GAP_X = 10
export const FLOAT_GAP_Y = 2

export interface FloatPose {
  /** Vertical offset from the spawn point (CSS px, negative = up). */
  dy: number
  alpha: number
  scale: number
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

/** Rise at `ageMs` (CSS px, ≤ 0), continuous up to and including the end of life. */
function riseAt(ageMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return -FLOAT_RISE_PX * easeOutCubic(Math.min(1, Math.max(0, ageMs / FLOAT_MS)))
}

/** Scale at `ageMs`: the crit pop, else 1. Never increases with age. */
function scaleAt(ageMs: number, crit: boolean, reducedMotion: boolean): number {
  const t = ageMs / FLOAT_MS
  return crit && !reducedMotion && t < CRIT_POP_END ? CRIT_POP_SCALE - ((CRIT_POP_SCALE - 1) * Math.max(0, t)) / CRIT_POP_END : 1
}

/** Pose at `ageMs`, or null once the number has expired. */
export function floatPose(ageMs: number, crit: boolean, reducedMotion: boolean): FloatPose | null {
  if (ageMs >= FLOAT_MS || ageMs < 0) return null
  const t = ageMs / FLOAT_MS
  if (reducedMotion) {
    return { dy: 0, alpha: t < REDUCED_HOLD ? 1 : 1 - (t - REDUCED_HOLD) / (1 - REDUCED_HOLD), scale: 1 }
  }
  return { dy: riseAt(ageMs, false), alpha: t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5, scale: scaleAt(ageMs, crit, false) }
}

// ------------------------------------------------------------------------------------------------
// Collision-aware layout (design review P3-S1 H1)
//
// Every live number is a box (its measured size, anchored bottom-centre like the BitmapText) that
// moves straight up along the shared rise curve. For an older number A and a newer number B, B's
// height relative to A never increases over time (the ease-out rise is slowing, and A is always
// further along it; with reduced motion neither moves), so whether the two boxes ever overlap
// during their shared life is decided exactly by the two ends of that window — split where a crit
// pop ends, because the pop changes the box size. A new number takes the cheapest offset from its
// impact point whose box never meets any live number's box while both are visible. Only if no
// offset is free (a burst far faster than any weapon in the data) does it retire the live numbers
// in its way — normal hits before crits, so a crit is never covered by, or dropped for, a normal hit.

export interface FloatSize {
  /** Measured size at scale 1 (CSS px). */
  w: number
  h: number
}

/** The area numbers should stay inside for their whole life (CSS px; e.g. below the HUD). */
export interface FloatBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** A number's box at a moment (CSS px, top-left origin). */
export interface FloatRect {
  x: number
  y: number
  w: number
  h: number
}

interface LiveFloat<T> {
  item: T
  bornAt: number
  crit: boolean
  /** Anchor (bottom-centre) at birth, CSS px. */
  x: number
  y: number
  w: number
  h: number
}

export interface FloatPlacement<T> {
  /** Offset from the impact point (CSS px) — add it to the impact's screen position every frame. */
  dx: number
  dy: number
  /** Live numbers retired to make room (hide them now). Empty unless no offset was free. */
  evicted: T[]
}

/** Candidate offsets, in steps of half the new number's width / height. Rows go down only (never up into the HUD). */
const COLUMN_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8]
const ROW_STEPS = [0, 1, 2, 3, 4]
/** A row step costs more than a column step: numbers fan out above the target before stacking onto it. */
const ROW_COST = 1.6

interface Candidate {
  dx: number
  dy: number
  cost: number
}

function candidates(size: FloatSize): Candidate[] {
  const sx = size.w / 2 + FLOAT_GAP_X / 2
  const sy = size.h / 2 + FLOAT_GAP_Y / 2
  const list: Candidate[] = []
  for (const r of ROW_STEPS) {
    for (const c of COLUMN_STEPS) list.push({ dx: c * sx, dy: r * sy, cost: Math.abs(c) * sx + r * sy * ROW_COST })
  }
  // Stable: equal costs keep the column order above (right of the impact first, then left).
  return list.map((c, i) => ({ c, i })).sort((a, b) => a.c.cost - b.c.cost || a.i - b.i).map(({ c }) => c)
}

export class FloatLayout<T> {
  private live: LiveFloat<T>[] = []

  /** Live entries, oldest first (read-only view for diagnostics and tests). */
  get size(): number {
    return this.live.length
  }

  /** Forget numbers whose life has ended. */
  prune(now: number): void {
    this.live = this.live.filter((f) => now - f.bornAt < FLOAT_MS)
  }

  remove(item: T): void {
    this.live = this.live.filter((f) => f.item !== item)
  }

  clear(): void {
    this.live = []
  }

  /**
   * Places a number born `now` at the impact point (`at`, CSS px) and records it as live.
   * `bounds` keeps it clear of the HUD where possible.
   */
  place(item: T, now: number, at: { x: number; y: number }, size: FloatSize, crit: boolean, reducedMotion: boolean, bounds?: FloatBounds): FloatPlacement<T> {
    this.prune(now)
    this.remove(item)
    const all = candidates(size)
    const inside = bounds ? all.filter((c) => this.fits(at, c, size, crit, reducedMotion, bounds)) : all
    const pool = inside.length > 0 ? inside : all
    const blockers = (c: Candidate) => this.live.filter((f) => collides(f, { x: at.x + c.dx, y: at.y + c.dy, ...size, crit, bornAt: now }, now, reducedMotion))

    let chosen = pool.find((c) => blockers(c).length === 0)
    let evicted: LiveFloat<T>[] = []
    if (!chosen) {
      // No free offset: retire as little as possible — never a crit for a normal hit when avoidable.
      let best = Infinity
      for (const c of pool) {
        const blocking = blockers(c)
        const penalty = blocking.reduce((sum, f) => sum + (f.crit && !crit ? 1000 : 1), 0) + c.cost / 1e6
        if (penalty < best) {
          best = penalty
          chosen = c
          evicted = blocking
        }
      }
    }
    const offset = chosen ?? { dx: 0, dy: 0 }
    if (evicted.length > 0) this.live = this.live.filter((f) => !evicted.includes(f))
    this.live.push({ item, bornAt: now, crit, x: at.x + offset.dx, y: at.y + offset.dy, ...size })
    return { dx: offset.dx, dy: offset.dy, evicted: evicted.map((f) => f.item) }
  }

  /** Every live number's box at `now` (for overlap checks in tests and dev diagnostics). */
  rectsAt(now: number, reducedMotion: boolean): FloatRect[] {
    return this.live.filter((f) => now - f.bornAt < FLOAT_MS && now >= f.bornAt).map((f) => rectAt(f, now - f.bornAt, reducedMotion))
  }

  private fits(at: { x: number; y: number }, c: Candidate, size: FloatSize, crit: boolean, reducedMotion: boolean, b: FloatBounds): boolean {
    const x = at.x + c.dx
    const y = at.y + c.dy
    const s = scaleAt(0, crit, reducedMotion)
    const top = Math.min(y - size.h * s, y + riseAt(FLOAT_MS, reducedMotion) - size.h)
    return x - (size.w * s) / 2 >= b.left && x + (size.w * s) / 2 <= b.right && top >= b.top && y <= b.bottom
  }
}

/** A number's box at `age` (anchor bottom-centre, scaled about the anchor like the BitmapText). */
export function rectAt(f: { x: number; y: number; w: number; h: number; crit: boolean }, ageMs: number, reducedMotion: boolean): FloatRect {
  const s = scaleAt(ageMs, f.crit, reducedMotion)
  const bottom = f.y + riseAt(ageMs, reducedMotion)
  return { x: f.x - (f.w * s) / 2, y: bottom - f.h * s, w: f.w * s, h: f.h * s }
}

/**
 * Whether two boxes come closer than the clear space `gapX` (side by side) and `gapY` (stacked):
 * true when they are within `gapX` horizontally AND within `gapY` vertically. With no gaps this is
 * a strict overlap (touching edges don't count).
 */
export function rectsOverlap(a: FloatRect, b: FloatRect, gapX = 0, gapY = gapX): boolean {
  return a.x < b.x + b.w + gapX && b.x < a.x + a.w + gapX && a.y < b.y + b.h + gapY && b.y < a.y + a.h + gapY
}

/**
 * Whether a reach-guide dash (its box, CSS px) sits close enough to a live number to read as part
 * of it: a short gold dash beside a number at its height reads as a minus sign ("–15"). Dashes keep
 * a whole glyph's room (the number's own height) to either side and a quarter of that above and below.
 */
export function readsAsPartOfNumber(dash: FloatRect, numbers: readonly FloatRect[]): boolean {
  return numbers.some((n) => rectsOverlap(dash, n, n.h, n.h / 4))
}

type Placed = Omit<LiveFloat<unknown>, 'item'>

/**
 * Whether `next` (born `now`) and the older `prev` ever come closer than the clear space
 * (FLOAT_GAP_X side by side, FLOAT_GAP_Y stacked) while both are alive. Exact for the shared rise
 * curve: within each piece of the window where both box sizes are fixed (sizes only shrink, so
 * each piece uses its start size), the vertical offset between them only decreases, so the
 * piece's two ends bound every offset in between.
 */
function collides(prev: Placed, next: Placed, now: number, reducedMotion: boolean): boolean {
  const end = Math.min(prev.bornAt, next.bornAt) + FLOAT_MS
  if (end <= now) return false
  const cuts = [now, end]
  for (const f of [prev, next]) {
    const popEnd = f.bornAt + FLOAT_POP_MS
    if (f.crit && !reducedMotion && popEnd > now && popEnd < end) cuts.push(popEnd)
  }
  cuts.sort((a, b) => a - b)
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i]
    const t1 = cuts[i + 1]
    const sp = scaleAt(t0 - prev.bornAt, prev.crit, reducedMotion)
    const sn = scaleAt(t0 - next.bornAt, next.crit, reducedMotion)
    const halfWidths = (prev.w * sp + next.w * sn) / 2 + FLOAT_GAP_X
    if (Math.abs(prev.x - next.x) >= halfWidths) continue
    // r = next's bottom − prev's bottom (CSS px, y down); non-increasing over [t0, t1].
    const r = (t: number) => next.y + riseAt(t - next.bornAt, reducedMotion) - (prev.y + riseAt(t - prev.bornAt, reducedMotion))
    const nextBelow = next.h * sn + FLOAT_GAP_Y
    const prevBelow = prev.h * sp + FLOAT_GAP_Y
    if (r(t1) < nextBelow && r(t0) > -prevBelow) return true
  }
  return false
}

/**
 * Fixed-capacity pool: `acquire` hands out a free item, or recycles the one acquired longest ago
 * when all are live (a burst never allocates).
 */
export class RecyclingPool<T> {
  private readonly free: T[] = []
  private readonly live: T[] = []
  private readonly create: () => T
  readonly capacity: number

  constructor(capacity: number, create: () => T) {
    this.capacity = Math.max(1, capacity)
    this.create = create
  }

  get size(): number {
    return this.free.length + this.live.length
  }

  get active(): readonly T[] {
    return this.live
  }

  acquire(): T {
    let item = this.free.pop()
    if (item === undefined) item = this.size < this.capacity ? this.create() : this.live.shift()!
    this.live.push(item)
    return item
  }

  release(item: T): void {
    const i = this.live.indexOf(item)
    if (i === -1) return
    this.live.splice(i, 1)
    this.free.push(item)
  }

  releaseAll(): void {
    this.free.push(...this.live.splice(0))
  }
}
