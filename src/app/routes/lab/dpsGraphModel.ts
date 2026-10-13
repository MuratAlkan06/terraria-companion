/**
 * DpsGraph model (PRD P3-S3 AC2, UX_SPEC §3.4): a rolling bar strip of the engine's per-second
 * damage series (`stats.dpsSeries`, completed seconds, oldest first) plus the current second so far.
 * Pure: the bars ARE the engine's numbers, windowed — nothing is smoothed or re-derived. Clears on
 * reset because the engine's series does.
 */
import { TICKS_PER_SECOND } from '../../../sim'
import type { LabGraphHud } from '../../../lab/labSession'
import { formatInt } from './hudStyles'

/** Seconds shown: enough for a whole 30-second test. */
export const DPS_GRAPH_SECONDS = 30

/** The Lab's page layouts: phone (< md), tablet (md–lg), desktop three-column (≥ lg). */
export type LabLayout = 'phone' | 'tablet' | 'desktop'

/**
 * Whether the DPS graph strip shows before the user toggles it (PRD P3-S3 AC2; UX_SPEC §3.4, §7):
 * on in the tablet and desktop layouts — however much width the side panels leave the arena, so
 * a compact HUD at 1024–1180 shows it too (design review P3-S2/S3 H3) — and behind the "Graph"
 * chip on phones.
 */
export function graphOpenByDefault(layout: LabLayout): boolean {
  return layout !== 'phone'
}

export interface DpsGraphBar {
  /** Seconds since the last reset (0-based). */
  second: number
  damage: number
  /** The current, incomplete second. */
  partial: boolean
}

export interface DpsGraphModel {
  bars: DpsGraphBar[]
  /** The y-axis top: the largest bar rounded up to 1, 2 or 5 × 10ⁿ (0 when nothing to show). */
  scaleMax: number
  peak: number
  /** The last completed second's damage, or null before the first second completes. */
  latest: number | null
  windowSeconds: number
}

/** Smallest 1 / 2 / 5 × 10ⁿ ≥ n (n > 0); 0 for 0. */
export function niceCeiling(n: number): number {
  if (!(n > 0)) return 0
  const power = 10 ** Math.floor(Math.log10(n))
  for (const step of [1, 2, 5, 10]) if (step * power >= n) return step * power
  return 10 * power
}

/** The graph in words, for screen readers (the bars are aria-hidden). */
export function dpsGraphSummary({ bars, peak, latest, windowSeconds }: DpsGraphModel): string {
  if (peak === 0) return `No damage in the last ${windowSeconds} seconds.`
  const span = bars.length === 1 ? 'Last second' : `Last ${bars.length} seconds`
  return `${span}: peak ${formatInt(peak)} damage in one second${latest !== null ? `, last full second ${formatInt(latest)}` : ''}.`
}

export function dpsGraphModel(graph: LabGraphHud, windowSeconds: number = DPS_GRAPH_SECONDS): DpsGraphModel {
  const completed: DpsGraphBar[] = graph.series.map((damage, i) => ({ second: graph.startSecond + i, damage, partial: false }))
  const inProgress = graph.elapsedTicks % TICKS_PER_SECOND !== 0
  const bars = (inProgress ? [...completed, { second: graph.startSecond + completed.length, damage: graph.currentSecondDamage, partial: true }] : completed).slice(-windowSeconds)
  const peak = bars.reduce((max, bar) => Math.max(max, bar.damage), 0)
  return { bars, scaleMax: niceCeiling(peak), peak, latest: completed.at(-1)?.damage ?? null, windowSeconds }
}
