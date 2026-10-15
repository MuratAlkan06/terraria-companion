/**
 * `chunk-compare` (UX_SPEC §1): the weapon comparison's lazy chunk (PRD P4-S1). It lives beside the
 * database pages it shares display rules with, but loads on its own so /weapons never downloads it.
 */
export { default as ComparePage } from './ComparePage'
