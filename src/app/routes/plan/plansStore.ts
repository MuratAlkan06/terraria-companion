/**
 * Acquisition plans (ADR D4: Zustand), persisted through the storage module to `tc.v1.plans` (ADR D6;
 * DATA_SCHEMA_SPEC §8a PlansV1; PRD P6-S6 AC3, §9 Feature B AC4; UX_SPEC §3.9 "every check/qty edit saves
 * immediately (no save button)"). Hydrated synchronously when first imported (the plan chunk), like the
 * builds store.
 *
 * - Every action saves immediately. A failed save keeps the change for this session and sets `persistError`
 *   (DATA_SCHEMA_SPEC §4b) — the page says so.
 * - Unreadable payloads are quarantined by the storage module (set aside, never deleted): the store starts
 *   empty and reports `loadStatus: 'quarantined'` (UX_SPEC §5.6).
 * - Several plans coexist (P6-S6 AC3), newest first; deleting one is confirmed by the page (§9 AC4).
 * - Changing a choice regenerates the saved steps (the user's own action — §8c "never silent rewrite"); a data
 *   update is applied only when the user asks (`updateSnapshot`), which also drops check marks of steps that
 *   no longer exist. Until then they are kept.
 */
import { create } from 'zustand'
import { meta } from '../../../data/meta'
import { loadDomain, saveDomain, type StorageBackend } from '../../../storage'
import { EMPTY_PLANS, type PlansData, type SavedPlan, type StoredPlanStep } from '../../../storage/plans'
import type { Stage } from '../../stages'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface PlanDraft {
  targetItemId: number
  targetAmount: number
  stageAtCreation: Stage | null
  steps: StoredPlanStep[]
  choices: Record<string, string>
}

export interface PlansState {
  plans: SavedPlan[]
  loadStatus: LoadStatus
  persistError: boolean
  /** Saves a new plan (newest first) and returns it. */
  create: (draft: PlanDraft, now?: Date) => SavedPlan
  setChecked: (planId: string, stepId: string, checked: boolean, now?: Date) => void
  /** Owned quantity of a node (`i:<id>` / `grp:<slug>`); 0 clears it. */
  setOwned: (planId: string, key: string, quantity: number, now?: Date) => void
  /** Picks (or, with null, clears) a way to get a node, with the steps regenerated for it. */
  setChoice: (planId: string, key: string, value: string | null, steps: StoredPlanStep[], now?: Date) => void
  /** Applies today's steps after a data update (the user asked): check marks of vanished steps are dropped. */
  updateSnapshot: (planId: string, steps: StoredPlanStep[], now?: Date) => void
  /** active ↔ done (§8c: done when every step is complete; un-checking reopens). */
  setStatus: (planId: string, status: SavedPlan['status'], now?: Date) => void
  /** Deletes a plan (the page confirms first). */
  remove: (planId: string) => void
  /**
   * A one-time message for the plan list after a plan page navigates there (B118(g)/(j) "Deleted the plan for
   * …"). Session-only, never persisted; the list shows and announces it, then clears it.
   */
  flash: string | null
  setFlash: (message: string | null) => void
}

/** A plan id: time + randomness, ≥ 8 characters (PlanV1.planId). */
export function newPlanId(now: Date = new Date(), random: () => number = Math.random): string {
  const rand = Array.from({ length: 6 }, () => Math.floor(random() * 36).toString(36)).join('')
  return `p${now.getTime().toString(36)}${rand}`
}

function hydrate(backend: StorageBackend | null | undefined): Pick<PlansState, 'plans' | 'loadStatus'> {
  const result = loadDomain('plans', backend)
  if (result.kind === 'loaded') return { plans: result.data.plans, loadStatus: 'loaded' }
  return { plans: EMPTY_PLANS.plans, loadStatus: result.kind }
}

const snapshotOf = (steps: StoredPlanStep[], now: Date): SavedPlan['snapshot'] => ({ generatedAt: now.toISOString(), gameVersion: meta.gameVersion, steps })

/** A plans store over `backend` (default: localStorage). Tests pass an in-memory backend and an id factory. */
export function createPlansStore(backend?: StorageBackend | null, makeId: (now: Date) => string = newPlanId) {
  return create<PlansState>()((set, get) => {
    const commit = (plans: SavedPlan[], what: string) => {
      let persistError = false
      try {
        const data: PlansData = { plans }
        saveDomain('plans', data, backend)
      } catch (error) {
        persistError = true
        console.warn(`[plans] ${what} kept for this session only.`, error)
      }
      set({ plans, persistError })
    }
    /** Applies `change` to one plan (stamping updatedAt); no-op when it no longer exists or nothing changed. */
    const edit = (planId: string, now: Date, what: string, change: (plan: SavedPlan) => SavedPlan | undefined) => {
      const current = get().plans.find((p) => p.planId === planId)
      if (!current) return
      const next = change(current)
      if (!next) return
      const stamped = { ...next, updatedAt: now.toISOString() }
      commit(
        get().plans.map((p) => (p.planId === planId ? stamped : p)),
        what,
      )
    }
    return {
      ...hydrate(backend),
      persistError: false,
      create: (draft, now = new Date()) => {
        const at = now.toISOString()
        const existing = new Set(get().plans.map((p) => p.planId))
        const base = makeId(now)
        let planId = base
        for (let i = 2; existing.has(planId); i++) planId = `${base}-${i}`
        const plan: SavedPlan = {
          planId,
          targetItemId: draft.targetItemId,
          ...(draft.targetAmount > 1 ? { targetAmount: draft.targetAmount } : {}),
          createdAt: at,
          updatedAt: at,
          status: 'active',
          stageAtCreation: draft.stageAtCreation,
          snapshot: snapshotOf(draft.steps, now),
          owned: {},
          checkedStepIds: [],
          ...(Object.keys(draft.choices).length > 0 ? { choices: { ...draft.choices } } : {}),
        }
        commit([plan, ...get().plans], 'New plan')
        return plan
      },
      setChecked: (planId, stepId, checked, now = new Date()) =>
        edit(planId, now, 'Check mark', (plan) => {
          const has = plan.checkedStepIds.includes(stepId)
          if (has === checked) return undefined
          return { ...plan, checkedStepIds: checked ? [...plan.checkedStepIds, stepId] : plan.checkedStepIds.filter((id) => id !== stepId) }
        }),
      setOwned: (planId, key, quantity, now = new Date()) =>
        edit(planId, now, 'Owned quantity', (plan) => {
          const q = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0
          if ((plan.owned[key] ?? 0) === q) return undefined
          const { [key]: _old, ...rest } = plan.owned
          return { ...plan, owned: q > 0 ? { ...rest, [key]: q } : rest }
        }),
      setChoice: (planId, key, value, steps, now = new Date()) =>
        edit(planId, now, 'Choice', (plan) => {
          const { [key]: _old, ...rest } = plan.choices ?? {}
          const choices = value === null ? rest : { ...rest, [key]: value }
          const { choices: _drop, ...withoutChoices } = plan
          return { ...withoutChoices, ...(Object.keys(choices).length > 0 ? { choices } : {}), snapshot: snapshotOf(steps, now) }
        }),
      updateSnapshot: (planId, steps, now = new Date()) =>
        edit(planId, now, 'Updated plan', (plan) => {
          const ids = new Set(steps.map((s) => s.stepId))
          return { ...plan, snapshot: snapshotOf(steps, now), checkedStepIds: plan.checkedStepIds.filter((id) => ids.has(id)) }
        }),
      setStatus: (planId, status, now = new Date()) => edit(planId, now, 'Plan status', (plan) => (plan.status === status ? undefined : { ...plan, status })),
      remove: (planId) => {
        if (!get().plans.some((p) => p.planId === planId)) return
        commit(
          get().plans.filter((p) => p.planId !== planId),
          'Deleted plan',
        )
      },
      flash: null,
      setFlash: (message) => set({ flash: message }),
    }
  })
}

export const usePlansStore = createPlansStore()
