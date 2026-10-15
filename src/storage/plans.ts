/**
 * `tc.v1.plans` domain (DATA_SCHEMA_SPEC §8a `PlansV1` / `PlanV1` / `PlanStepV1`; PRD P6-S6 AC3, §9 Feature B
 * AC4; UX_SPEC §3.9 "every check/qty edit saves to tc.v1.plans immediately"): the user's acquisition plans —
 * several at once — each its goal item, the steps as last generated (a regenerable snapshot: ids, kinds,
 * amounts, wording), the owned quantities and the checked step ids.
 *
 * Additive to §8a's PlanV1 (spec parity rides the amendments chain per B58, see src/schemas/persistence.ts):
 * - `targetAmount` (optional, ≥ 1): how many of the goal (absent = 1).
 * - `choices` (optional): the ways the user picked — node key (`i:<id>` / `grp:<slug>`) → route key (or, for
 *   an "Any X" group, the member's node key). The plan is rebuilt from today's data with these choices.
 * - `stageAtCreation` may be null: no stage was selected when the plan was made (never defaulted).
 * - `owned` is keyed by node key (`i:22`, `grp:any-iron-bar`) — §8a's "itemId(string)" generalized to the
 *   "Any X" group steps a plan can hold.
 *
 * Hand-written strict validator (same pattern as ./builds.ts) so the storage module never pulls Zod into a
 * bundle; src/app/routes/plan/plan.test.ts asserts parity with the Zod `PlansV1`. A payload that fails is
 * quarantined by the storage module (set aside, never deleted — ADR D6).
 */
import { isStage, type Stage } from '../app/stages'
import { exactKeys, isItemId, ISO_DATETIME, isRecord, SLUG } from './readiness'
import type { DomainDef } from './types'

export const PLAN_STEP_KINDS = ['craft', 'gather', 'defeat-boss', 'purchase', 'fish', 'loot', 'event', 'other'] as const
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number]

/** DATA_SCHEMA_SPEC §8a PlanStepV1. */
export interface StoredPlanStep {
  stepId: string
  kind: PlanStepKind
  text: string
  itemId?: number
  amount?: number
  nodeId?: string
  groupKey: string
  refs: string[]
}

export interface SavedPlan {
  /** ≥ 8 characters, unique in the list. */
  planId: string
  targetItemId: number
  /** How many of the goal (absent = 1). */
  targetAmount?: number
  createdAt: string
  updatedAt: string
  /** active → done when every step is complete; un-checking reopens it (§8c). */
  status: 'active' | 'done'
  /** The selected stage when the plan was made; null = none was selected. */
  stageAtCreation: Stage | null
  snapshot: { generatedAt: string; gameVersion: string; steps: StoredPlanStep[] }
  /** Node key → quantity owned. */
  owned: Record<string, number>
  checkedStepIds: string[]
  /** Node key → the chosen route key (or member node key for a group). */
  choices?: Record<string, string>
}

export interface PlansData {
  plans: SavedPlan[]
}

export const EMPTY_PLANS: PlansData = { plans: [] }

/** Mirrors `TypedRef` in src/schemas/common.ts. */
export const TYPED_REF = /^(i:\d+|(set|boss|node|buff|grp|scn|cond|enemy):[a-z0-9-]+|(rcp|drop):[a-z0-9-]+)$/
/** A plan node key: an item (`i:<id>`) or an "Any X" recipe group (`grp:<slug>`). */
export const PLAN_NODE_KEY = /^(?:i:[1-9]\d*|grp:[a-z0-9]+(?:-[a-z0-9]+)*)$/

const PLAN_KEYS = ['planId', 'targetItemId', 'targetAmount', 'createdAt', 'updatedAt', 'status', 'stageAtCreation', 'snapshot', 'owned', 'checkedStepIds', 'choices'] as const
const PLAN_REQUIRED = ['planId', 'targetItemId', 'createdAt', 'updatedAt', 'status', 'stageAtCreation', 'snapshot', 'owned', 'checkedStepIds'] as const
const STEP_KEYS = ['stepId', 'kind', 'text', 'itemId', 'amount', 'nodeId', 'groupKey', 'refs'] as const
const STEP_REQUIRED = ['stepId', 'kind', 'text', 'groupKey', 'refs'] as const

const isDateTime = (v: unknown): v is string => typeof v === 'string' && ISO_DATETIME.test(v) && !Number.isNaN(Date.parse(v))
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

function knownKeys(input: Record<string, unknown>, keys: readonly string[], required: readonly string[], where: string): void {
  const unexpected = Object.keys(input).filter((k) => !keys.includes(k))
  if (unexpected.length > 0) throw new TypeError(`${where}: unexpected keys ${unexpected.join(', ')}`)
  const missing = required.filter((k) => !(k in input))
  if (missing.length > 0) throw new TypeError(`${where}: missing ${missing.join(', ')}`)
}

function parseStep(input: unknown, where: string): StoredPlanStep {
  if (!isRecord(input)) throw new TypeError(`${where}: expected an object`)
  knownKeys(input, STEP_KEYS, STEP_REQUIRED, where)
  const { stepId, kind, text, itemId, amount, nodeId, groupKey, refs } = input
  if (typeof stepId !== 'string') throw new TypeError(`${where}.stepId: expected a string`)
  if (typeof kind !== 'string' || !(PLAN_STEP_KINDS as readonly string[]).includes(kind)) throw new TypeError(`${where}.kind: expected a plan step kind`)
  if (typeof text !== 'string' || text.length < 1) throw new TypeError(`${where}.text: expected a non-empty string`)
  if (itemId !== undefined && !isItemId(itemId)) throw new TypeError(`${where}.itemId: expected an item id`)
  if (amount !== undefined && !(isItemId(amount))) throw new TypeError(`${where}.amount: expected a positive integer`)
  if (nodeId !== undefined && !(typeof nodeId === 'string' && SLUG.test(nodeId))) throw new TypeError(`${where}.nodeId: expected a node slug`)
  if (typeof groupKey !== 'string') throw new TypeError(`${where}.groupKey: expected a string`)
  if (!Array.isArray(refs) || !refs.every((r) => typeof r === 'string' && TYPED_REF.test(r))) throw new TypeError(`${where}.refs: expected typed refs`)
  return {
    stepId,
    kind: kind as PlanStepKind,
    text,
    ...(itemId !== undefined ? { itemId: itemId as number } : {}),
    ...(amount !== undefined ? { amount: amount as number } : {}),
    ...(nodeId !== undefined ? { nodeId: nodeId as string } : {}),
    groupKey,
    refs: [...(refs as string[])],
  }
}

function parseStringRecord<T>(input: unknown, where: string, value: (v: unknown) => v is T, key: (k: string) => boolean = () => true): Record<string, T> {
  if (!isRecord(input)) throw new TypeError(`${where}: expected an object`)
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!key(k)) throw new TypeError(`${where}: unexpected key ${k}`)
    if (!value(v)) throw new TypeError(`${where}.${k}: invalid value`)
    out[k] = v
  }
  return out
}

function parsePlan(input: unknown, i: number): SavedPlan {
  const where = `plans.${i}`
  if (!isRecord(input)) throw new TypeError(`${where}: expected an object`)
  knownKeys(input, PLAN_KEYS, PLAN_REQUIRED, where)
  const { planId, targetItemId, targetAmount, createdAt, updatedAt, status, stageAtCreation, snapshot, owned, checkedStepIds, choices } = input
  if (typeof planId !== 'string' || planId.length < 8) throw new TypeError(`${where}.planId: expected a string of 8+ characters`)
  if (!isItemId(targetItemId)) throw new TypeError(`${where}.targetItemId: expected an item id`)
  if (targetAmount !== undefined && !isItemId(targetAmount)) throw new TypeError(`${where}.targetAmount: expected a positive integer`)
  if (!isDateTime(createdAt)) throw new TypeError(`${where}.createdAt: expected an ISO date-time`)
  if (!isDateTime(updatedAt)) throw new TypeError(`${where}.updatedAt: expected an ISO date-time`)
  if (status !== 'active' && status !== 'done') throw new TypeError(`${where}.status: expected active or done`)
  if (stageAtCreation !== null && !isStage(stageAtCreation)) throw new TypeError(`${where}.stageAtCreation: expected a stage id or null`)
  if (!isRecord(snapshot)) throw new TypeError(`${where}.snapshot: expected an object`)
  exactKeys(snapshot, ['generatedAt', 'gameVersion', 'steps'], `${where}.snapshot`)
  if (!isDateTime(snapshot.generatedAt)) throw new TypeError(`${where}.snapshot.generatedAt: expected an ISO date-time`)
  if (typeof snapshot.gameVersion !== 'string') throw new TypeError(`${where}.snapshot.gameVersion: expected a string`)
  if (!Array.isArray(snapshot.steps) || snapshot.steps.length < 1) throw new TypeError(`${where}.snapshot.steps: expected at least one step`)
  const steps = snapshot.steps.map((s, j) => parseStep(s, `${where}.snapshot.steps.${j}`))
  if (!Array.isArray(checkedStepIds) || !checkedStepIds.every((s) => typeof s === 'string')) throw new TypeError(`${where}.checkedStepIds: expected step ids`)
  return {
    planId,
    targetItemId,
    ...(targetAmount !== undefined ? { targetAmount: targetAmount as number } : {}),
    createdAt,
    updatedAt,
    status,
    stageAtCreation: stageAtCreation as Stage | null,
    snapshot: { generatedAt: snapshot.generatedAt, gameVersion: snapshot.gameVersion, steps },
    owned: parseStringRecord(owned, `${where}.owned`, isCount),
    checkedStepIds: [...(checkedStepIds as string[])],
    ...(choices !== undefined ? { choices: parseStringRecord(choices, `${where}.choices`, (v): v is string => typeof v === 'string', (k) => PLAN_NODE_KEY.test(k)) } : {}),
  }
}

export function parsePlans(input: unknown): PlansData {
  if (!isRecord(input)) throw new TypeError('plans: expected an object')
  exactKeys(input, ['plans'], 'plans')
  if (!Array.isArray(input.plans)) throw new TypeError('plans.plans: expected a list')
  const plans = input.plans.map(parsePlan)
  if (new Set(plans.map((p) => p.planId)).size !== plans.length) throw new TypeError('plans.plans: duplicate planId')
  return { plans }
}

export const plansDomain: DomainDef<PlansData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parsePlans,
}
