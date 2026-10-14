/**
 * Commit-on-settle for a range input whose change is expensive — the max-mana slider restarts the
 * stats (src/lab/labSession.ts), so it must restart, and be announced, ONCE per adjustment, not once
 * per step. Steps only move a draft (shown on the slider and its readout); the draft is committed:
 * - when a pointer drag (or a click / tap on the track) ends — pointer up or cancel;
 * - when the slider loses focus;
 * - otherwise (keyboard arrows, Page Up/Down, Home/End) RANGE_SETTLE_MS after the last step.
 * Pure, timers injected: unit-testable in Node.
 */
export const RANGE_SETTLE_MS = 500

export interface RangeCommitTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const browserTimers: RangeCommitTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class RangeCommit {
  private pending: number | null = null
  private dragging = false
  private timer: unknown = null
  private readonly onCommit: (value: number) => void
  private readonly settleMs: number
  private readonly timers: RangeCommitTimers

  constructor(onCommit: (value: number) => void, settleMs = RANGE_SETTLE_MS, timers: RangeCommitTimers = browserTimers) {
    this.onCommit = onCommit
    this.settleMs = settleMs
    this.timers = timers
  }

  /** The value stepped to but not committed yet (null = nothing pending). */
  get draft(): number | null {
    return this.pending
  }

  /** One step (the input event): the draft moves; without a pointer down, the commit waits for the steps to settle. */
  input(value: number): void {
    this.pending = value
    this.stopTimer()
    if (!this.dragging) this.timer = this.timers.set(() => this.commit(), this.settleMs)
  }

  /** A pointer went down on the slider: steps follow it until it is released. */
  pointerDown(): void {
    this.dragging = true
    this.stopTimer()
  }

  /** The pointer was released (or the gesture cancelled): commit at once. */
  pointerUp(): void {
    if (!this.dragging) return
    this.dragging = false
    this.commit()
  }

  /** Focus left the slider: commit at once. */
  blur(): void {
    this.dragging = false
    this.commit()
  }

  /** Commit the draft now, if any (also on unmount: a chosen value is never dropped). */
  commit(): void {
    this.stopTimer()
    const value = this.pending
    this.pending = null
    if (value !== null) this.onCommit(value)
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }
}
