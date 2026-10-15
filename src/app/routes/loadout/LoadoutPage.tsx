import { CircleHelp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate } from 'react-router'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { effectiveProgress } from '../../../scoring/progress'
import { recommendLoadout, type Pin, type SlotId, type SlotOption, type AltView } from '../../../scoring/recommend'
import type { SavedBuild } from '../../../storage/builds'
import { useBuildsStore } from '../../buildsStore'
import { useProgressStore } from '../../progressStore'
import { useSettingsStore } from '../../settingsStore'
import { getStageInfo, type Stage } from '../../stages'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { loadReadinessData, peekReadinessData, type ReadinessPageData } from '../bosses/readiness/readinessData'
import { InputsStep, type InputField } from './InputsStep'
import * as copy from './loadoutCopy'
import {
  blocksLeave,
  defaultBuildName,
  draftFrom,
  effectiveInputs,
  engineInput,
  hasUnsavedChanges,
  LOADOUT_PATH,
  loadoutSearch,
  parseLoadoutSearch,
  pinCount,
  slotLabel,
  stageAwaiting,
  stateFromBuild,
  stepHeadingId,
  swapButtonId,
  slotCardId,
  weaponIds,
  withInputs,
  withPin,
  withSkipped,
  type LoadoutState,
  type Step,
} from './loadoutModel'
import { LoadoutStep } from './LoadoutStep'
import { OwnedPicker } from './OwnedPicker'
import { SaveStep } from './SaveStep'
import { StepFooter, StepNav } from './StepNav'
import { SwapSheet } from './SwapSheet'
import { WhyStep } from './WhyStep'
import type { LoadoutClass } from '../../../schemas'

/**
 * /loadout — the Loadout Builder (PRD P4-S2; UX_SPEC §1, §3.5, §4(c), §6, §7; SCORING_SPEC §4).
 * A four-step wizard — 1 Inputs · 2 Loadout · 3 Why it works · 4 Save — over ONE engine run
 * (src/scoring/recommend.ts) recomputed from the URL on every change: the URL is the draft (inputs,
 * step, swaps, the saved build being edited), so reloads, back / forward and shared links restore it.
 * Availability is tracked ∪ virtual (the selected stage contributes virtual defeats, B69/Q9), read live
 * from the boss map's store. Saved builds persist to tc.v1.builds (quarantine on unreadable data).
 * AMENDMENTS-016 B108: a rebuild that resets fixed picks is warned before and said visibly after (H1);
 * leaving the builder with unsaved changes to a saved build asks first (H5, UX_SPEC §6).
 */
export const PAGE_TITLE_ID = 'loadout-title'

export default function LoadoutPage() {
  useDocumentTitle(copy.DOC_TITLE)
  const resource = useResource('readiness-data', loadReadinessData, peekReadinessData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1 id={PAGE_TITLE_ID} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
          {copy.PAGE_TITLE}
        </h1>
        <p className="max-w-prose text-fg-muted">{copy.PAGE_INTRO}</p>
      </header>
      {resource.status === 'ready' ? (
        <LoadoutView page={resource.data} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.LOAD_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={PAGE_TITLE_ID} />
      ) : showSkeleton ? (
        <SkeletonPanel label={copy.LOADING} lines={10} />
      ) : (
        <div className="min-h-[60dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

export function LoadoutView({ page }: { page: ReadinessPageData }) {
  const location = useLocation()
  const navigate = useNavigate()
  const progress = useProgressStore((s) => s.progress)
  const selectedStage = useSettingsStore((s) => s.settings.selectedStage)
  const builds = useBuildsStore()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const parsed = useMemo(() => parseLoadoutSearch(params, (id) => page.engine.bosses.has(id)), [params, page])
  const state = parsed.state
  const eff = useMemo(() => effectiveInputs(state, selectedStage), [state, selectedStage])
  const input = useMemo(() => engineInput(eff, progress, state.pins), [eff, progress, state.pins])
  const result = useMemo(() => recommendLoadout(input, page.engine, { stageName: getStageInfo(eff.stage).label }), [input, page, eff.stage])
  const ep = useMemo(() => effectiveProgress(page.engine.graph, progress, eff.stage), [page, progress, eff.stage])

  const [announcement, setAnnouncement] = useState('')
  const [linkNotices, setLinkNotices] = useState<string[]>([])
  const [swapSlot, setSwapSlot] = useState<SlotId | null>(null)
  /** The slot whose sheet was last open: focus returns to its Swap button after the sheet closes (the state is cleared first). */
  const lastSwap = useRef<SlotId | null>(null)
  const openSwap = (slot: SlotId) => {
    lastSwap.current = slot
    setSwapSlot(slot)
  }
  const [ownedOpen, setOwnedOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SavedBuild | null>(null)
  const ownedButtonId = 'loadout-owned-add'

  // In-place edits (rebuild, swaps, notices) replace the entry and keep the scroll position — the change
  // and its notice stay where the user is (B108 H1); a new step is a new entry and starts at the top.
  const go = (next: LoadoutState, replace = true) => navigate({ pathname: LOADOUT_PATH, search: loadoutSearch(next) }, { replace, preventScrollReset: replace })
  const hrefFor = (step: Step) => `${LOADOUT_PATH}${loadoutSearch({ ...state, step })}`

  // A link naming what can't be used: say so once, then rewrite it to its canonical form (AMENDMENTS-016 B101d pattern).
  useEffect(() => {
    if (parsed.notices.length === 0) return
    setLinkNotices(parsed.notices)
    setAnnouncement(parsed.notices.join(' '))
    go(state)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.notices.join('|')])

  // `?build=<id>` alone (an Open link, UX_SPEC §1): expand it to the saved build — every slot as saved.
  const editing = state.build ? builds.builds.find((b) => b.buildId === state.build) : undefined
  useEffect(() => {
    if (!editing) return
    const bare = Object.keys(state.pins).length === 0 && !state.stage && !state.cls && !state.difficulty && !state.goal && !state.boss && state.owned.length === 0
    if (bare) go(stateFromBuild(editing, page.engine, state.step === 1 ? 2 : state.step))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.buildId, location.search])

  // Step changes move focus to the step's heading (UX_SPEC §9: focus follows navigation).
  const lastStep = useRef(state.step)
  useEffect(() => {
    if (lastStep.current === state.step) return
    lastStep.current = state.step
    document.getElementById(stepHeadingId(state.step))?.focus()
  }, [state.step])

  // "Use this" / "Back to the recommendation" remove their own button: focus lands on the slot's card instead.
  const [focusSlot, setFocusSlot] = useState<SlotId | null>(null)
  useEffect(() => {
    if (!focusSlot) return
    document.getElementById(slotCardId(focusSlot))?.focus()
    setFocusSlot(null)
  }, [focusSlot, location.search])

  const swaps = pinCount(state.pins)
  /** B108 H1: the visible "your fixed picks were reset" notice, shown while the draft is the one the rebuild made. */
  const [rebuilt, setRebuilt] = useState<{ text: string; search: string } | null>(null)
  const rebuild = (next: LoadoutState, reset: number) => {
    go(next)
    const text = copy.regenerated(reset)
    setAnnouncement(text)
    setRebuilt(reset > 0 ? { text, search: loadoutSearch(next) } : null)
  }
  const setInputs = (change: Partial<Pick<LoadoutState, 'stage' | 'cls' | 'difficulty' | 'goal' | 'boss'>>) => {
    const { next, reset } = withInputs(state, change)
    rebuild(next, reset)
  }
  const skipInput = (field: InputField) => {
    const { next, reset } = withSkipped(state, field)
    rebuild(next, reset)
  }
  const rebuiltNotice = rebuilt && rebuilt.search === location.search ? rebuilt.text : null
  const pin = (slot: SlotId, value: Pin | undefined, message: string) => {
    go({ ...state, pins: withPin(state.pins, slot, value) })
    setAnnouncement(message)
  }
  const label = (slot: SlotId) => slotLabel(slot, result.slots.find((s) => s.id === slot)?.demonHeart)
  const pinOf = (o: { id: number; pieces?: readonly [number, number, number] }): Pin => (o.pieces ? { kind: 'armor', helmet: o.pieces[0] || null, chest: o.pieces[1] || null, legs: o.pieces[2] || null } : { kind: 'item', id: o.id })

  const unsaved = editing ? hasUnsavedChanges(editing, eff, result, state.pins) : false
  const mainId = result.loadout.mainWeapon
  const headingId = stepHeadingId(state.step)

  // UX_SPEC §6 / B108 H5: leaving the builder with unsaved changes to a saved build asks first — in-app
  // navigation through a ConfirmDialog (only a change of path: steps, swaps, Back / Forward inside the
  // builder change the query), a reload or a closed tab through the browser's own prompt.
  // Stay / Esc hand focus back to what started the leave — the nav link, focused as it was activated —
  // since the dialog has no trigger of its own; after Leave the new page settles focus itself.
  const leaveFrom = useRef<HTMLElement | null>(null)
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const block = blocksLeave(unsaved, currentLocation, nextLocation)
    if (block) leaveFrom.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    return block
  })
  const leaveReturn = () => {
    if (leaving.current) return null
    const from = leaveFrom.current
    return from?.isConnected ? from : document.getElementById(headingId)
  }
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])
  // the changes got saved (or the build deleted) while the dialog was open: let the navigation through
  useEffect(() => {
    if (blocker.state !== 'blocked' || unsaved) return
    leaving.current = true
    blocker.proceed()
  }, [blocker, unsaved])

  const pinnedItemName = (() => {
    const p = state.pins.main ?? state.pins.summon
    return p?.kind === 'item' ? page.info(p.id).name : undefined
  })()
  const target = eff.bossId ? page.engine.bosses.get(eff.bossId)?.name : undefined

  return (
    <>
      {linkNotices.length > 0 ? (
        <div role="status" className="flex gap-3 border-l-4 border-gold-600 bg-night-900 px-4 py-3 text-sm text-fg-muted" data-link-notices="">
          <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />
          <ul className="space-y-1">
            {linkNotices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <StepNav step={state.step} hrefFor={hrefFor} />
      <section aria-labelledby={headingId} className="space-y-4" data-step={state.step}>
        <div className="space-y-1">
          <h2 id={headingId} tabIndex={-1} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-lg">
            <span className="sr-only">{copy.stepOf(state.step, 4)}: </span>
            {copy.STEP_NAMES[state.step]}
          </h2>
          {state.step !== 1 ? (
            <p className="text-sm text-fg-muted" data-loadout-meta="">
              {copy.loadoutMeta(copy.CLASS_NAMES[eff.cls], getStageInfo(eff.stage).label, copy.DIFFICULTY_NAMES[eff.difficulty], copy.GOAL_NAMES[eff.goal], target)}
            </p>
          ) : null}
        </div>
        {state.step === 1 ? (
          <InputsStep
            page={page}
            state={state}
            eff={eff}
            stageFromSettings={state.stage === undefined && selectedStage !== null}
            stageAwaiting={stageAwaiting(state)}
            {...(pinnedItemName ? { pinnedItemName } : {})}
            ep={ep}
            fixedPicks={swaps}
            rebuiltNotice={rebuiltNotice}
            onDismissRebuilt={() => setRebuilt(null)}
            onSet={setInputs}
            onSkip={skipInput}
            onOpenOwned={() => setOwnedOpen(true)}
            onRemoveOwned={(id) => {
              go({ ...state, owned: state.owned.filter((x) => x !== id) })
              setAnnouncement(copy.ownedRemoved(page.info(id).name))
            }}
            onBuild={() => go({ ...state, step: 2 }, false)}
            ownedButtonId={ownedButtonId}
          />
        ) : state.step === 2 ? (
          <LoadoutStep
            page={page}
            result={result}
            eff={eff}
            pins={state.pins}
            headingId={headingId}
            rebuiltNotice={rebuiltNotice}
            onDismissRebuilt={() => setRebuilt(null)}
            onRegenerate={(change: { stage?: Stage; cls?: LoadoutClass }) => setInputs(change)}
            onSwap={openSwap}
            onUse={(slot: SlotId, alt: AltView) => {
              pin(slot, pinOf(alt), copy.swapped(alt.name, label(slot)))
              setFocusSlot(slot)
            }}
            onReset={(slot) => {
              pin(slot, undefined, copy.resetDone(label(slot)))
              setFocusSlot(slot)
            }}
            onResetAll={() => {
              go({ ...state, pins: {} })
              setAnnouncement(copy.allReset)
            }}
          />
        ) : state.step === 3 ? (
          <WhyStep page={page} result={result} eff={eff} />
        ) : (
          <SaveStep
            builds={builds.builds}
            loadStatus={builds.loadStatus}
            persistError={builds.persistError}
            {...(editing ? { editing } : {})}
            editingMissing={state.build !== undefined && !editing}
            unsaved={unsaved}
            defaultName={defaultBuildName(eff)}
            weaponIds={weaponIds(result)}
            {...(mainId !== null && page.engine.weapons.get(mainId) ? { mainWeapon: page.engine.weapons.get(mainId) } : {})}
            openHref={(b) => `${LOADOUT_PATH}${loadoutSearch(stateFromBuild(b, page.engine))}`}
            onSave={(name, mode) => {
              const draft = draftFrom(name, eff, result, state.pins)
              if (mode === 'overwrite' && editing) {
                builds.update(editing.buildId, draft)
              } else {
                const created = builds.create(draft)
                go({ ...state, build: created.buildId })
              }
              setAnnouncement(copy.savedAnnounce(draft.name))
            }}
            onDelete={setConfirmDelete}
          />
        )}
        {/* Step 1 ends in its own "Build my loadout" call to action. */}
        {state.step !== 1 ? <StepFooter step={state.step} hrefFor={hrefFor} /> : null}
      </section>
      <SwapSheet
        open={swapSlot !== null}
        onOpenChange={(open) => !open && setSwapSlot(null)}
        slot={swapSlot}
        label={swapSlot ? label(swapSlot) : ''}
        input={input}
        data={page.engine}
        page={page}
        pinned={swapSlot !== null && state.pins[swapSlot] !== undefined}
        onPick={(o: SlotOption) => {
          if (!swapSlot) return
          pin(swapSlot, pinOf(o), copy.swapped(o.name, label(swapSlot)))
          setSwapSlot(null)
        }}
        onEmpty={() => {
          if (!swapSlot) return
          pin(swapSlot, { kind: 'empty' }, copy.emptied(label(swapSlot)))
          setSwapSlot(null)
        }}
        onReset={() => {
          if (!swapSlot) return
          pin(swapSlot, undefined, copy.resetDone(label(swapSlot)))
          setSwapSlot(null)
        }}
        returnFocus={() => {
          const slot = lastSwap.current
          return slot ? (document.getElementById(swapButtonId(slot)) ?? document.getElementById(slotCardId(slot))) : null
        }}
      />
      <OwnedPicker
        open={ownedOpen}
        onOpenChange={setOwnedOpen}
        data={page.engine}
        ep={ep}
        sprites={page.sprites}
        bossName={(id) => page.graph.nodeById.get(id)?.name ?? id}
        owned={state.owned}
        onAdd={(id) => {
          go({ ...state, owned: [...state.owned, id] })
          setAnnouncement(copy.ownedAdded(page.info(id).name))
        }}
        returnFocus={() => document.getElementById(ownedButtonId)}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={confirmDelete ? copy.DELETE_TITLE(confirmDelete.name) : ''}
        description={copy.DELETE_BODY}
        confirmLabel={copy.DELETE}
        onConfirm={() => {
          if (!confirmDelete) return
          builds.remove(confirmDelete.buildId)
          if (state.build === confirmDelete.buildId) {
            const { build: _b, ...rest } = state
            go(rest)
          }
          setAnnouncement(copy.deleted(confirmDelete.name))
          setConfirmDelete(null)
        }}
        returnFocus={() => document.getElementById(headingId)}
      >
        <p>{copy.DELETE_KEEP}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
        title={copy.LEAVE_TITLE}
        description={copy.leaveBody(editing?.name ?? '')}
        confirmLabel={copy.LEAVE}
        cancelLabel={copy.STAY}
        onConfirm={() => {
          leaving.current = true
          blocker.proceed?.()
        }}
        returnFocus={leaveReturn}
      >
        <p>{copy.LEAVE_KEEP}</p>
      </ConfirmDialog>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  )
}
