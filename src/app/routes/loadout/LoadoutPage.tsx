import { CircleHelp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate } from 'react-router'
import { version as APP_VERSION } from '../../../../package.json'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { meta } from '../../../data/meta'
import { effectiveProgress } from '../../../scoring/progress'
import { recommendLoadout, type Pin, type SlotId, type SlotOption, type AltView } from '../../../scoring/recommend'
import { profileReferences } from '../../../scoring/references'
import type { SavedBuild } from '../../../storage/builds'
import { buildRecordOf, type BuildRecord } from '../../../storage/transfer'
import { useBuildsStore } from '../../buildsStore'
import { useProgressStore } from '../../progressStore'
import { useSettingsStore } from '../../settingsStore'
import { getStageInfo, type Stage } from '../../stages'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { loadReadinessData, peekReadinessData, type ReadinessPageData } from '../bosses/readiness/readinessData'
import { BuildsView } from './BuildsView'
import { buildText, dataNames } from './buildText'
import { BuildExportDialog } from './BuildTransfer'
import { InputsStep, type InputField } from './InputsStep'
import { runSavedBuild } from './loadoutCompare'
import * as copy from './loadoutCopy'
import { SurpriseBanner } from './LoadoutBits'
import {
  BUILDS_HEADING_ID,
  blocksLeave,
  COMPARISON_ID,
  defaultBuildName,
  draftFrom,
  effectiveInputs,
  engineInput,
  hasUnsavedChanges,
  LOADOUT_PATH,
  loadoutSearch,
  newSeed,
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
 * /loadout — the Loadout Builder (PRD P4-S2…S4; UX_SPEC §1, §3.5, §4(c), §6, §7; SCORING_SPEC §4, §5).
 * A four-step wizard — 1 Inputs · 2 Loadout · 3 Why it works · 4 Compare & Save — over ONE engine run
 * (src/scoring/recommend.ts) recomputed from the URL on every change: the URL is the draft (inputs,
 * step, swaps, the saved build being edited, a Surprise Me seed, the build compared with), so reloads,
 * back / forward and shared links restore it. Availability is tracked ∪ virtual (the selected stage
 * contributes virtual defeats, B69/Q9), read live from the boss map's store. Saved builds persist to
 * tc.v1.builds (quarantine on unreadable data); `?view=builds` lists them (UX_SPEC §1 /builds, as a
 * builder sub-view). AMENDMENTS-016 B108: a rebuild that resets fixed picks is warned before and said
 * visibly after (H1); leaving the builder with unsaved changes to a saved build asks first (H5, UX_SPEC §6).
 * P7-S2b (ADR D6, B123(a)): a saved build (the list) or this loadout (Step 4) exports as readable text with
 * its `#code:` line (one BuildExportDialog); the list's "Import a build" adds a pasted one as a new build.
 */
export const PAGE_TITLE_ID = 'loadout-title'

export default function LoadoutPage() {
  const location = useLocation()
  useDocumentTitle(new URLSearchParams(location.search).get('view') === 'builds' ? copy.BUILDS_DOC_TITLE : copy.DOC_TITLE)
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
  const input = useMemo(() => engineInput(eff, progress, state.pins, state.surprise), [eff, progress, state.pins, state.surprise])
  const stageName = getStageInfo(eff.stage).label
  const result = useMemo(() => recommendLoadout(input, page.engine, { stageName }), [input, page, stageName])
  const ep = useMemo(() => effectiveProgress(page.engine.graph, progress, eff.stage), [page, progress, eff.stage])
  // P4-S3 AC2 (AMENDMENTS-016 B113a): the Step 3 bars' references — read from the stage, class, difficulty,
  // target boss and progress only (never the goal, a pick or a draw), so swaps don't recompute them — only on Step 3
  const { stage: refStage, cls: refCls, difficulty: refDifficulty, bossId: refBoss } = input
  const references = useMemo(
    () => (state.step === 3 && !state.view ? profileReferences({ stage: refStage, cls: refCls, difficulty: refDifficulty, bossId: refBoss, progress }, page.engine, { stageName }) : undefined),
    [state.step, state.view, refStage, refCls, refDifficulty, refBoss, progress, page, stageName],
  )
  // P4-S4: the saved build beside the draft (Step 4), scored as saved
  const vsBuild = state.vs ? builds.builds.find((b) => b.buildId === state.vs) : undefined
  const savedRun = useMemo(
    () => (state.step === 4 && !state.view && vsBuild ? runSavedBuild(vsBuild, page.engine, progress, { stageName: getStageInfo(vsBuild.stage).label }) : undefined),
    [state.step, state.view, vsBuild, page, progress],
  )

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
  // P7-S2b: the text export — kept while the dialog closes; focus returns to what opened it.
  const [exporting, setExporting] = useState<{ name: string; value: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const exportFrom = useRef<HTMLElement | null>(null)
  const openExport = (record: BuildRecord) => {
    exportFrom.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    setExporting({ name: record.name, value: buildText(record, dataNames(page), { now: new Date(), appVersion: APP_VERSION, gameVersion: meta.gameVersion }) })
    setExportOpen(true)
  }

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

  // Step changes (and the builds view opening or closing) move focus to the new heading (UX_SPEC §9: focus follows navigation).
  const lastStep = useRef(`${state.step}:${state.view ?? ''}`)
  useEffect(() => {
    const at = `${state.step}:${state.view ?? ''}`
    if (lastStep.current === at) return
    lastStep.current = at
    document.getElementById(state.view === 'builds' ? BUILDS_HEADING_ID : stepHeadingId(state.step))?.focus()
  }, [state.step, state.view])

  // A saved build's "Compare" (further down the step) opens the comparison above it: focus moves there.
  const [focusComparison, setFocusComparison] = useState(false)
  useEffect(() => {
    if (!focusComparison) return
    const el = document.getElementById(COMPARISON_ID)
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'start', behavior: 'auto' })
    setFocusComparison(false)
  }, [focusComparison, location.search, savedRun])

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

  // P4-S4 AC3 Surprise Me (SCORING_SPEC §4.8): a new seed draws every slot; fixed picks are replaced —
  // warned beside the button before, said visibly after (the B108 H1 pattern). Swaps afterwards pin on top.
  const [drawn, setDrawn] = useState<{ text: string; search: string } | null>(null)
  const drawSurprise = () => {
    const reset = pinCount(state.pins)
    const next: LoadoutState = { ...state, pins: {}, surprise: newSeed() }
    go(next)
    const text = copy.surpriseDrawn(reset)
    setAnnouncement(text)
    setDrawn({ text, search: loadoutSearch(next) })
  }
  const drawnNotice = drawn && drawn.search === location.search ? drawn.text : null
  const clearSurprise = () => {
    const { surprise: _seed, ...rest } = state
    go(rest)
    setAnnouncement(copy.surpriseCleared)
  }
  const compareWith = (buildId: string | undefined, focus = false) => {
    const { vs: _vs, ...rest } = state
    go(buildId ? { ...rest, vs: buildId } : rest)
    const name = buildId ? builds.builds.find((b) => b.buildId === buildId)?.name : undefined
    setAnnouncement(name ? copy.comparing(name) : copy.COMPARE_STOPPED)
    if (buildId && focus) setFocusComparison(true)
  }

  /** The builds view's way back: the same draft, the wizard again. */
  const builderHref = (() => {
    const { view: _view, ...rest } = state
    return `${LOADOUT_PATH}${loadoutSearch(rest)}`
  })()

  const unsaved = editing ? hasUnsavedChanges(editing, eff, result, state.pins) : false
  const mainId = result.loadout.mainWeapon
  const headingId = state.view === 'builds' ? BUILDS_HEADING_ID : stepHeadingId(state.step)

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
      {state.view === 'builds' ? (
        <BuildsView
          page={page}
          builds={builds.builds}
          loadStatus={builds.loadStatus}
          persistError={builds.persistError}
          headingId={BUILDS_HEADING_ID}
          backHref={builderHref}
          openHref={(b) => `${LOADOUT_PATH}${loadoutSearch(stateFromBuild(b, page.engine))}`}
          onDelete={setConfirmDelete}
          onExport={(b) => openExport(buildRecordOf(b))}
          onImport={(record) => builds.create(record)}
        />
      ) : (
        <>
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
        {state.step !== 1 && state.surprise !== undefined ? <SurpriseBanner fixedPicks={swaps} onDrawAgain={drawSurprise} onBack={clearSurprise} /> : null}
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
              // every slot back to the recommendation: the fixed picks and a Surprise Me draw
              const { surprise: _seed, ...rest } = state
              go({ ...rest, pins: {} })
              setAnnouncement(copy.allReset)
            }}
          />
        ) : state.step === 3 ? (
          <WhyStep page={page} result={result} eff={eff} {...(references ? { references } : {})} />
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
            onExport={(name) => openExport(draftFrom(name, eff, result, state.pins))}
            onDelete={setConfirmDelete}
            compare={{
              page,
              draft: { result, pins: state.pins, eff },
              ...(savedRun ? { saved: savedRun } : {}),
              vsMissing: state.vs !== undefined && !vsBuild,
              onCompare: (buildId) => compareWith(buildId, true),
            }}
            surprise={{ fixedPicks: swaps, drawn: drawnNotice, seeHref: hrefFor(2), onSurprise: drawSurprise }}
            buildsHref={`${LOADOUT_PATH}${loadoutSearch({ ...state, view: 'builds' })}`}
          />
        )}
        {/* Step 1 ends in its own "Build my loadout" call to action. */}
        {state.step !== 1 ? <StepFooter step={state.step} hrefFor={hrefFor} /> : null}
      </section>
        </>
      )}
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
      {exporting ? (
        <BuildExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          name={exporting.name}
          value={exporting.value}
          returnFocus={() => (exportFrom.current?.isConnected ? exportFrom.current : document.getElementById(headingId))}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={confirmDelete ? copy.DELETE_TITLE(confirmDelete.name) : ''}
        description={copy.DELETE_BODY}
        confirmLabel={copy.DELETE}
        onConfirm={() => {
          if (!confirmDelete) return
          builds.remove(confirmDelete.buildId)
          // the draft no longer edits it, nor compares with it
          if (state.build === confirmDelete.buildId || state.vs === confirmDelete.buildId) {
            const { build: _b, vs: _vs, ...rest } = state
            go({ ...rest, ...(state.build && state.build !== confirmDelete.buildId ? { build: state.build } : {}), ...(state.vs && state.vs !== confirmDelete.buildId ? { vs: state.vs } : {}) })
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
