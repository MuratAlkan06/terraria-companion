/**
 * Words for the timed tests (PRD P3-S3 AC3, UX_SPEC §5.7, §9) shared by the HUD, the panels' lock
 * notices and the aria-live announcer.
 */
import type { TimedTestDuration, TimedTestResult } from '../../../sim'
import { format1, formatInt } from './hudStyles'

export const testName = (durationSec: TimedTestDuration) => `${durationSec}-second test`

/**
 * The two est. DPS figures say what they divide by (design review P3-S2/S3): the live readout
 * divides by the time spent attacking, a test's result by the whole test.
 */
export const LIVE_DPS_LABEL = 'Est. DPS (while attacking)'
/** The compact HUD's shorter visible label (screen readers get LIVE_DPS_LABEL). */
export const LIVE_DPS_SHORT = 'Est. DPS (attacking)'
export const testDpsLabel = (durationSec: TimedTestDuration) => `Est. DPS (over the ${durationSec}s test)`

/** Why the weapon, target and settings can't change right now. */
export function lockReason(durationSec: TimedTestDuration | null): string {
  return `Locked while the ${durationSec ? testName(durationSec) : 'test'} runs. Reset stops it.`
}

/** The aria-live line when a run ends (UX_SPEC §9). */
export function completionAnnouncement(result: TimedTestResult): string {
  return `${testName(result.durationSec)} complete. Estimated DPS ${format1(result.estimatedDps)}, labeled estimate. ${formatInt(result.hits)} hits, ${formatInt(result.totalDamage)} total damage.`
}
