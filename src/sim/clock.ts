/**
 * Fixed-timestep accumulator (ADR-001 D5): wall-clock frame deltas in, whole 60 Hz ticks out.
 *
 * Frame-rate independence: the sim state is a pure function of (seed, setup, tick count, inputs at
 * tick boundaries). The clock only decides HOW MANY ticks run per frame; the leftover fraction is
 * kept for the next frame and exposed as `alpha` for render interpolation. A small epsilon absorbs
 * float drift so e.g. 144 frames of 1000/144 ms yield exactly 60 ticks. Deltas are clamped
 * (MAX_FRAME_MS) so a backgrounded tab can't trigger a spiral of catch-up ticks; clamped time is
 * dropped, which delays but never alters the simulation (timed tests count ticks, not wall time).
 */
import { MAX_FRAME_MS, TICK_MS } from './constants'

const EPSILON_MS = 1e-6

export class FixedStepClock {
  private acc = 0

  /** Adds a frame delta and returns how many ticks are now due. */
  push(dtMs: number): number {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0
    this.acc += Math.min(dtMs, MAX_FRAME_MS)
    let ticks = 0
    while (this.acc + EPSILON_MS >= TICK_MS) {
      this.acc -= TICK_MS
      ticks++
    }
    if (this.acc < 0) this.acc = 0
    return ticks
  }

  /** Fraction of a tick accumulated toward the next tick, in [0, 1). */
  get alpha(): number {
    return Math.min(this.acc / TICK_MS, 1 - Number.EPSILON)
  }

  clear(): void {
    this.acc = 0
  }
}
