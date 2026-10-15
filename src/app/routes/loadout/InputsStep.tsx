import { ArrowRight, Plus, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelPanel } from '../../../components/PixelPanel'
import type { Difficulty, Goal, LoadoutClass } from '../../../schemas'
import { BUILD_GOALS } from '../../../storage/builds'
import { availabilityOf } from '../../../scoring/candidates'
import { READINESS_CLASSES, READINESS_DIFFICULTIES } from '../../../storage/readiness'
import { getStageInfo, STAGES, type Stage } from '../../stages'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import * as copy from './loadoutCopy'
import { AvailabilityChips, ChoiceGroup, FIELD, FixedPicksWarning, ItemName, ItemSquare, LABEL, RebuiltNotice } from './LoadoutBits'
import type { EffectiveInputs, LoadoutState } from './loadoutModel'
import { recordOf } from './loadoutView'

/**
 * Step 1 — inputs (PRD P4-S2 AC1; UX_SPEC §3.5 Step1 InputsForm, §4(c)): stage, class, difficulty,
 * goal, the boss being prepared for, and gear the user owns. Every field is skippable: an unset field
 * shows its default; a set one offers "Skip — use default" (which removes it from the link). The CTA
 * is always enabled — skipping everything yields a complete default loadout.
 * AMENDMENTS-016 B108: a link that fixes an item but names no stage (compare's "Open in Builder") waits
 * for the stage with a prompt — never a silent default (M4); fixed picks are warned about before an
 * input change resets them, and the reset is said visibly after (H1); each owned item says what the
 * builder's progress makes of it.
 */
export type InputField = 'stage' | 'cls' | 'difficulty' | 'goal' | 'boss'

export interface InputsStepProps {
  page: ReadinessPageData
  state: LoadoutState
  eff: EffectiveInputs
  /** Where the default stage comes from (the header's stage setting) — for the default note. */
  stageFromSettings: boolean
  /** B108(c): the draft fixes picks but names no stage — the stage waits for a choice. */
  stageAwaiting?: boolean
  /** The fixed item the prompt names ("Zenith stays in your loadout"). */
  pinnedItemName?: string
  /** The builder's effective progress (tracked ∪ virtual): each owned item's status. */
  ep?: ReadonlySet<string>
  /** Slots holding fixed picks (B108 H1 warning). */
  fixedPicks?: number
  rebuiltNotice?: string | null
  onDismissRebuilt?: () => void
  onSet: (change: Partial<Pick<LoadoutState, 'stage' | 'cls' | 'difficulty' | 'goal' | 'boss'>>) => void
  onSkip: (field: InputField) => void
  onOpenOwned: () => void
  onRemoveOwned: (id: number) => void
  onBuild: () => void
  ownedButtonId: string
}

export function InputsStep(props: InputsStepProps) {
  const { page, state, eff } = props
  const id = useId()
  const skip = (field: InputField, label: string, set: boolean, defaultText: string): ReactNode =>
    set ? (
      <button type="button" onClick={() => props.onSkip(field)} aria-label={copy.skipFor(label)} className="inline-flex min-h-tap items-center px-1 text-sm font-semibold text-link hover:text-accent-strong" data-skip={field}>
        {copy.SKIP}
      </button>
    ) : (
      <p className="text-xs text-fg-muted" data-default={field}>
        {copy.defaultNote(defaultText)}
      </p>
    )
  const byStage = STAGES.map((st) => ({ stage: st, bosses: page.bosses.filter((b) => b.stage === st.id) })).filter((g) => g.bosses.length > 0)
  const awaiting = props.stageAwaiting === true
  const defaultStage = props.stageFromSettings ? `${getStageInfo(eff.stage).label} (${copy.STAGE_FROM_SETTINGS})` : getStageInfo(eff.stage).label
  const fixed = props.fixedPicks ?? 0
  const warnId = `${id}rebuild-warning`
  return (
    <PixelPanel className="space-y-6" data-step-body="1">
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">{copy.INPUTS_INTRO}</p>
        {props.rebuiltNotice ? <RebuiltNotice text={props.rebuiltNotice} onDismiss={() => props.onDismissRebuilt?.()} /> : null}
        {fixed > 0 ? <FixedPicksWarning id={warnId} text={awaiting ? copy.awaitingWarning(props.pinnedItemName ?? copy.SLOT_LABELS.main) : copy.inputsWarning(fixed)} /> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChoiceGroup<Stage>
          legend={copy.STAGE_LABEL}
          name={`${id}stage`}
          value={awaiting ? undefined : eff.stage}
          awaiting={awaiting}
          hint={
            awaiting ? (
              <span className="block space-y-1 text-fg" data-stage-prompt="">
                <span className="block text-sm font-semibold">{copy.stagePrompt(props.pinnedItemName ?? copy.SLOT_LABELS.main.toLowerCase())}</span>
                <span className="block text-fg-muted">{copy.stageAwaitingFallback(defaultStage)}</span>
              </span>
            ) : (
              copy.STAGE_HINT
            )
          }
          options={STAGES.map((st) => ({ value: st.id, label: st.label }))}
          onChange={(v) => props.onSet({ stage: v })}
          aside={awaiting ? null : skip('stage', copy.STAGE_LABEL, state.stage !== undefined, defaultStage)}
        />
        <ChoiceGroup<LoadoutClass>
          legend={copy.CLASS_LABEL}
          name={`${id}class`}
          value={eff.cls}
          options={READINESS_CLASSES.map((c) => ({ value: c, label: copy.CLASS_NAMES[c] }))}
          onChange={(v) => props.onSet({ cls: v })}
          aside={
            <>
              {eff.cls === 'hybrid' ? <p className="text-xs text-fg-muted">{copy.HYBRID_NOTE}</p> : null}
              {skip('cls', copy.CLASS_LABEL, state.cls !== undefined, copy.CLASS_NAMES.melee)}
            </>
          }
        />
        <ChoiceGroup<Difficulty>
          legend={copy.DIFFICULTY_LABEL}
          name={`${id}difficulty`}
          value={eff.difficulty}
          hint={copy.DIFFICULTY_HINT}
          options={READINESS_DIFFICULTIES.map((d) => ({ value: d, label: copy.DIFFICULTY_NAMES[d] }))}
          onChange={(v) => props.onSet({ difficulty: v })}
          aside={skip('difficulty', copy.DIFFICULTY_LABEL, state.difficulty !== undefined, copy.DIFFICULTY_NAMES.classic)}
        />
        <ChoiceGroup<Goal>
          legend={copy.GOAL_LABEL}
          name={`${id}goal`}
          value={eff.goal}
          hint={copy.GOAL_HINT}
          options={BUILD_GOALS.map((g) => ({ value: g, label: copy.GOAL_NAMES[g], description: copy.GOAL_DESCRIPTIONS[g] }))}
          onChange={(v) => props.onSet({ goal: v })}
          aside={skip('goal', copy.GOAL_LABEL, state.goal !== undefined, copy.GOAL_NAMES.balanced)}
        />
        <div className="space-y-1.5" data-field="boss">
          <label htmlFor={`${id}boss`} className={LABEL}>
            {copy.BOSS_LABEL}
          </label>
          <p className="text-xs text-fg-muted">{copy.BOSS_HINT}</p>
          <select id={`${id}boss`} value={state.boss ?? ''} onChange={(e) => (e.target.value ? props.onSet({ boss: e.target.value }) : props.onSkip('boss'))} className={FIELD}>
            <option value="">{copy.BOSS_NONE}</option>
            {byStage.map(({ stage, bosses }) => (
              <optgroup key={stage.id} label={stage.label}>
                {bosses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {state.boss === undefined ? (
            <p className="text-xs text-fg-muted" data-default="boss">
              {copy.defaultNote(copy.BOSS_NONE)}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5" data-field="owned">
          <p className={LABEL} id={`${id}owned`}>
            {copy.OWNED_LABEL}
          </p>
          <p className="text-xs text-fg-muted">{copy.OWNED_HINT}</p>
          {state.owned.length === 0 ? (
            <p className="text-sm text-fg-muted">{copy.OWNED_EMPTY}</p>
          ) : (
            <ul aria-labelledby={`${id}owned`} className="grid gap-1.5">
              {state.owned.map((itemId) => {
                const record = recordOf(page.engine, itemId)
                const availability = record && props.ep ? availabilityOf(record, page.engine.graph, props.ep) : undefined
                return (
                <li key={itemId} className="flex items-center gap-2" data-owned-item={itemId} data-owned-status={availability?.status}>
                  <ItemSquare page={page} id={itemId} />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate">
                      <ItemName page={page} id={itemId} />
                    </span>
                    {availability ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                        <AvailabilityChips page={page} availability={availability} id={itemId} />
                        <span>{copy.OWNED_STATUS[availability.status]}</span>
                      </span>
                    ) : null}
                  </span>
                  <button type="button" onClick={() => props.onRemoveOwned(itemId)} aria-label={copy.ownedRemove(page.info(itemId).name)} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
                    <X aria-hidden="true" className="size-5" />
                  </button>
                </li>
                )
              })}
            </ul>
          )}
          <button type="button" id={props.ownedButtonId} onClick={props.onOpenOwned} className="inline-flex min-h-tap items-center gap-2 border-2 border-dashed border-panel-border px-3 text-sm font-semibold text-link hover:bg-night-800">
            <Plus aria-hidden="true" className="size-4" />
            {copy.OWNED_ADD}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t-2 border-panel-border pt-4">
        <button type="button" onClick={props.onBuild} className={buttonClass('primary')} data-build-cta="">
          {copy.BUILD_CTA}
          <ArrowRight aria-hidden="true" className="size-5" />
        </button>
      </div>
    </PixelPanel>
  )
}
