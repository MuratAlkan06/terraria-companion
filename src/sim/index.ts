/**
 * Weapon Lab simulation core — public API (ADR-001 D5 layer 1). Pure TypeScript: no renderer,
 * DOM, or framework imports; runs headless in Node. See ./README.md.
 */
export { createLabSim, DEFAULT_DUMMY, DEFAULT_LAB_SETTINGS, DEFAULT_SEED, dummyRow } from './sim'
export { assessWeapon, cadenceTicksFor, type WeaponAssessment } from './guard'
export { IMPLEMENTED_ARCHETYPES } from './interpreters'
export { APPROXIMATIONS, type Approximation, type ApproximationId } from './approximations'
export {
  BASE_CRIT_PCT,
  DEFAULT_DUMMY_HEIGHT_TILES,
  DEFAULT_DUMMY_WIDTH_TILES,
  DUMMY_ROW_SPACING_TILES,
  GROUND_Y_TILES,
  MAX_MINION_SLOTS,
  MAX_SENTRY_SLOTS,
  THROWN_REST_HEIGHT_TILES,
  TICKS_PER_SECOND,
  TIMED_TEST_DURATIONS,
  timedTestTicks,
  WHIP_TAG_DURATION_TICKS,
  type TimedTestDuration,
} from './constants'
export { dummyPathOffset } from './motion'
export { mulberry32, type Rng } from './rng'
export type * from './types'
