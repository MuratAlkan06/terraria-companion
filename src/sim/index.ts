/**
 * Weapon Lab simulation core — public API (ADR-001 D5 layer 1). Pure TypeScript: no renderer,
 * DOM, or framework imports; runs headless in Node. See ./README.md.
 */
export { createLabSim, DEFAULT_DUMMY, DEFAULT_LAB_SETTINGS, DEFAULT_SEED } from './sim'
export { assessWeapon, cadenceTicksFor, type WeaponAssessment } from './guard'
export { IMPLEMENTED_ARCHETYPES } from './interpreters'
export { APPROXIMATIONS, type Approximation, type ApproximationId } from './approximations'
export {
  BASE_CRIT_PCT,
  TICKS_PER_SECOND,
  TIMED_TEST_DURATIONS,
  timedTestTicks,
  type TimedTestDuration,
} from './constants'
export { mulberry32, type Rng } from './rng'
export type * from './types'
