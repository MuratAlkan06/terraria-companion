/**
 * Feature B's deep links (UX_SPEC §1 `/plan`, `/plan/new?item=:id`, `/plan/:planId`; §10.11). Dependency-free
 * on purpose: the item and weapon pages ("What Should I Grind For?"), the builder's gated track and the
 * readiness checker's "Show Me How to Get It" link here without downloading the planner (routes registered in
 * src/app/routes.tsx as "plans", "plan-new" and "plan").
 */
export const PLAN_PATH = '/plan'
export const PLAN_NEW_PATH = '/plan/new'
export const PLAN_ITEM_PARAM = 'item'
export const PLAN_AMOUNT_PARAM = 'n'

/** The planner for an item: its plan preview and "Make My Plan". */
export const planNewHref = (itemId: number): string => `${PLAN_NEW_PATH}?${PLAN_ITEM_PARAM}=${itemId}`

/** History-state flag: the preview was opened by picking in the goal picker (it takes focus on its heading). */
export const PICKED_STATE = 'planPicked'

/** A saved plan. */
export const planHref = (planId: string): string => `${PLAN_PATH}/${encodeURIComponent(planId)}`
