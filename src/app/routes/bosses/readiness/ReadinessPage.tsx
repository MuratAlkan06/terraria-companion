import { CircleAlert, FolderInput, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { WORLD_EVIL_LABEL } from '../../../../components/nodeMap/graph'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import { improveSuggestions } from '../../../../scoring/improve'
import { effectiveProgress, isNodeSatisfied, type TrackedProgress } from '../../../../scoring/progress'
import { analyzeReadiness, loadoutEntries } from '../../../../scoring/readiness'
import { DEMON_HEART_GATE_NODE, SLOT_COUNT } from '../../../../scoring/constants'
import type { SavedBuild } from '../../../../storage/builds'
import { READINESS_CLASSES, READINESS_DIFFICULTIES, type ReadinessClass, type ReadinessDifficulty } from '../../../../storage/readiness'
import { useBuildsStore } from '../../../buildsStore'
import { useProgressStore } from '../../../progressStore'
import { useReadinessStore } from '../../../readinessStore'
import { getStageInfo } from '../../../stages'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { prepEntries } from '../bossPageModel'
import { prepChecklistKey, usePrepChecklistStore } from '../prepChecklistStore'
import { recommend } from '../recommend'
import { AnalysisPane } from './AnalysisPane'
import { importReplacesLoadout, readinessImportFromBuild } from './buildImport'
import { loadReadinessData, peekReadinessData, type ReadinessPageData } from './readinessData'
import { BUILD_PARAM } from './readinessLinks'
import { engineInput, hasAnyItem, markedDefeats, staleReason, targetKey, targetLabel, type PickerTarget } from './readinessUi'
import * as copy from './readinessUiCopy'
import { SetupPane } from './SetupPane'
import { SlotPicker } from './SlotPicker'

/**
 * /readiness — Boss Readiness Checker (PRD P5-S6/S7 + §9 Feature A; UX_SPEC §3.8, §4e, §6, §7).
 * Two panes from md up (setup | analysis), sequential below (setup, then the analysis after it; focus
 * moves to the analysis when it's ready). `?boss=&class=&difficulty=` prefills the setup (boss pages,
 * the map) and is then cleared from the URL; the store keeps it. Availability follows TRACKED defeats
 * from the shared progress store (B69/Q9) with the progress module's own world-evil rule (B96a: under
 * "Both" a marked evil boss counts, as on the map), so marking a boss on the map updates the setup's
 * slot badges at once and marks a shown analysis out of date.
 * `?build=<id>` (the builder's "Analyze this build", AMENDMENTS-016 B106 queue) and the setup's own
 * "Import a saved build" load a saved build's slots, class, difficulty and stage (and its target boss)
 * — asking first when that would replace a loadout entered here — and say what was loaded; the
 * checker's own rules stay (tracked defeats only, its own assumptions).
 */
export const PAGE_TITLE_ID = 'readiness-title'

export default function ReadinessPage() {
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
        <ReadinessView page={resource.data} />
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

const isClass = (v: string | null): v is ReadinessClass => v !== null && (READINESS_CLASSES as readonly string[]).includes(v)
const isDifficulty = (v: string | null): v is ReadinessDifficulty => v !== null && (READINESS_DIFFICULTIES as readonly string[]).includes(v)

export function ReadinessView({ page }: { page: ReadinessPageData }) {
  const store = useReadinessStore()
  const { setup, snapshot } = store
  const savedBuilds = useBuildsStore((s) => s.builds)
  const progress = useProgressStore((s) => s.progress)
  const prepByKey = usePrepChecklistStore((s) => s.byKey)
  const tracked: TrackedProgress = progress
  const [searchParams, setSearchParams] = useSearchParams()
  const uid = useId()
  const ids = {
    setup: `${uid}setup`,
    boss: `${uid}boss`,
    bossError: `${uid}boss-error`,
    loadout: `${uid}loadout`,
    loadoutError: `${uid}loadout-error`,
    title: `${uid}analysis-title`,
    region: `${uid}analysis`,
    improve: `${uid}improve`,
  }
  const [errors, setErrors] = useState({ boss: false, empty: false })
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [improveOpen, setImproveOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  /** A saved build waiting for "Replace setup" (it would replace a loadout entered here). */
  const [pendingImport, setPendingImport] = useState<SavedBuild | null>(null)
  /** What the last import loaded (a visible notice; the live region says it too). */
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const isBoss = (id: string) => page.engine.bosses.has(id)
  const applyImport = (build: SavedBuild) => {
    const values = readinessImportFromBuild(build, isBoss)
    store.importLoadout(values)
    const boss = values.bossId ? page.engine.bosses.get(values.bossId)?.name : undefined
    const notice = boss ? `${copy.imported(build.name)} ${copy.importedBoss(boss)}` : copy.imported(build.name)
    setErrors({ boss: false, empty: false })
    setImportNotice(notice)
    setAnnouncement(notice)
  }
  const requestImport = (buildId: string) => {
    const build = useBuildsStore.getState().builds.find((b) => b.buildId === buildId)
    if (!build) {
      setImportNotice(copy.IMPORT_MISSING)
      setAnnouncement(copy.IMPORT_MISSING)
      return
    }
    if (importReplacesLoadout(useReadinessStore.getState().setup, readinessImportFromBuild(build, isBoss))) setPendingImport(build)
    else applyImport(build)
  }
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  /** The element that opened the picker, and the slot it fills (focus returns there on close). */
  const opener = useRef<{ el: HTMLElement | null; key: string } | null>(null)
  const openPicker = (target: PickerTarget) => {
    const el = document.activeElement instanceof HTMLElement ? document.activeElement : null
    opener.current = { el, key: target.kind === 'ammo' || target.kind === 'buffs' ? `${target.kind}-add` : targetKey(target) }
    setPicker(target)
  }
  // The opener if it's still on the page (the guided start's button isn't, once an item is added), else the slot's own button.
  const pickerReturnFocus = () => {
    const o = opener.current
    if (!o) return null
    return o.el && o.el.isConnected ? o.el : (slots.current.get(o.key) ?? null)
  }

  // Deep-link prefill (UX_SPEC §1, §10.11): applied once, then cleared from the URL (the store keeps it).
  // `?build=` imports a saved build (asking first when it would replace a loadout entered here).
  useEffect(() => {
    const boss = searchParams.get('boss')
    const cls = searchParams.get('class')
    const difficulty = searchParams.get('difficulty')
    const build = searchParams.get(BUILD_PARAM)
    if (boss === null && cls === null && difficulty === null && build === null) return
    if (boss !== null || cls !== null || difficulty !== null)
      store.prefill({ ...(boss && page.engine.bosses.has(boss) ? { bossId: boss } : {}), ...(isClass(cls) ? { cls } : {}), ...(isDifficulty(difficulty) ? { difficulty } : {}) })
    if (build !== null) requestImport(build)
    setSearchParams({}, { replace: true })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A restored analysis is pinned to the progress it is first shown with (store `pinProgress`).
  useEffect(() => {
    if (snapshot && !snapshot.progress) store.pinProgress(tracked)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

  useEffect(() => {
    if (!focusTarget) return
    const el = document.getElementById(focusTarget.id) ?? slots.current.get(focusTarget.id)
    el?.focus()
  }, [focusTarget])

  const ep = useMemo(() => effectiveProgress(page.engine.graph, tracked), [page, tracked])
  const marks = useMemo(() => markedDefeats(page.engine.graph, tracked), [page, tracked])
  const nodeName = (id: string) => page.graph.nodeById.get(id)?.name ?? id
  const entries = useMemo(() => loadoutEntries(engineInput(setup, tracked), page.engine), [setup, tracked, page])
  const prepDoneFor = useCallback(
    (bossId: string | null) => {
      const boss = bossId ? page.engine.bosses.get(bossId) : undefined
      if (!boss) return undefined
      const list = prepEntries(boss)
      if (list.status !== 'curated') return undefined
      const checked = new Set(prepByKey[prepChecklistKey(boss.id)] ?? [])
      return list.entries.filter((e) => checked.has(e.id)).length
    },
    [page, prepByKey],
  )
  const shownProgress = snapshot?.progress ?? tracked
  const analysis = useMemo(() => {
    if (!snapshot) return undefined
    const r = analyzeReadiness(engineInput(snapshot.setup, shownProgress, prepDoneFor(snapshot.setup.bossId)), page.engine)
    return 'error' in r ? undefined : r
  }, [snapshot, shownProgress, page, prepDoneFor])
  const improve = useMemo(() => {
    if (!snapshot) return undefined
    const r = improveSuggestions(engineInput(snapshot.setup, shownProgress), page.engine)
    return 'error' in r ? undefined : r
  }, [snapshot, shownProgress, page])
  const stale = staleReason(snapshot, setup, tracked)

  const rec = useMemo(() => recommend(page.graph, progress.nodeStates, progress.worldEvil, setup.stage), [page, progress, setup.stage])
  const stageNote = rec.stageNote ? copy.stageNote(getStageInfo(rec.stageNote.selected).label, getStageInfo(rec.progressStage).label, rec.stageNote.relation) : undefined

  const analyze = () => {
    if (!setup.bossId) {
      setErrors({ boss: true, empty: false })
      setFocusTarget({ id: ids.boss })
      return
    }
    if (!hasAnyItem(setup)) {
      setErrors({ boss: false, empty: true })
      setFocusTarget({ id: 'mainWeapon' })
      return
    }
    setErrors({ boss: false, empty: false })
    store.analyze(tracked)
    setImproveOpen(false)
    setAnnouncement(copy.ANNOUNCE_READY)
    setFocusTarget({ id: ids.title })
  }

  const onPick = (id: number) => {
    if (!picker) return
    if (picker.kind === 'accessory') store.setAccessory(picker.index, id)
    else if (picker.kind === 'ammo' || picker.kind === 'buffs') store.addToList(picker.kind, id)
    else store.setSlot(picker.kind, id)
    if (errors.empty) setErrors((e) => ({ ...e, empty: false }))
    setPicker(null)
  }

  const onRemove = (target: PickerTarget, listIndex?: number) => {
    if (target.kind === 'accessory') store.setAccessory(target.index, null)
    else if (target.kind === 'ammo' || target.kind === 'buffs') store.removeFromList(target.kind, listIndex ?? -1)
    else store.setSlot(target.kind, null)
    // the slot's own button stays (now "empty"); a list returns focus to its Add button
    setFocusTarget({ id: target.kind === 'ammo' || target.kind === 'buffs' ? `${target.kind}-add` : targetKey(target) })
  }

  const registerSlot = useCallback((key: string, el: HTMLElement | null) => {
    if (el) slots.current.set(key, el)
    else slots.current.delete(key)
  }, [])

  return (
    <>
      {store.loadStatus === 'quarantined' ? (
        <p role="status" className="flex gap-2 border-2 border-earth-600 bg-earth-900 p-2 text-sm">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
          {copy.QUARANTINE_NOTICE}
        </p>
      ) : null}
      {store.persistError ? (
        <p role="status" className="flex gap-2 text-sm text-negative">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {copy.PERSIST_ERROR_NOTICE}
        </p>
      ) : null}
      {importNotice ? (
        <div className="flex items-start gap-2 border-l-4 border-gold-600 bg-night-900 py-1 pr-1 pl-3 text-sm" data-import-notice="">
          <FolderInput aria-hidden="true" className="mt-2.5 size-4 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 py-2 leading-snug">{importNotice}</p>
          <button
            type="button"
            onClick={() => {
              setImportNotice(null)
              document.getElementById(ids.loadout)?.focus()
            }}
            aria-label={copy.IMPORT_DISMISS}
            className="grid min-h-tap min-w-tap shrink-0 place-items-center text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      {/* md+: whichever pane is shorter follows the longer one (SetupPane / AnalysisPane), so neither column sits empty. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] md:items-start lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-6">
        <SetupPane
          page={page}
          setup={setup}
          entries={entries}
          markedCount={marks.marked.length}
          worldEvilName={progress.worldEvil ? WORLD_EVIL_LABEL[progress.worldEvil] : null}
          offWorldNames={marks.offWorld.map(nodeName)}
          demonHeartOpen={isNodeSatisfied(page.engine.graph, ep, DEMON_HEART_GATE_NODE)}
          stageNote={stageNote}
          inactiveSlotItems={setup.loadout.accessories.slice(SLOT_COUNT[setup.difficulty]).filter((x) => x !== null).length}
          errors={errors}
          onBoss={(id) => {
            store.setBoss(id)
            if (id) setErrors((e) => ({ ...e, boss: false }))
          }}
          onStage={store.setStage}
          onDifficulty={store.setDifficulty}
          onClass={store.setClass}
          onOpenPicker={openPicker}
          onRemove={onRemove}
          onAnalyze={analyze}
          onClear={() => setConfirmClear(true)}
          registerSlot={registerSlot}
          ids={ids}
          savedBuilds={savedBuilds}
          onImport={requestImport}
        />
        <AnalysisPane
          page={page}
          analysis={analysis}
          improve={improve}
          analyzedSetup={snapshot?.setup}
          analyzedAt={snapshot?.at}
          currentBossId={setup.bossId}
          stale={stale}
          hasItems={hasAnyItem(setup)}
          improveOpen={improveOpen}
          onToggleImprove={() => setImproveOpen((open) => !open)}
          onReanalyze={analyze}
          onAnalyze={analyze}
          onGuidedAdd={() => openPicker({ kind: 'mainWeapon' })}
          ids={ids}
        />
      </div>
      <SlotPicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        target={picker}
        label={picker ? targetLabel(picker, setup.difficulty) : ''}
        data={page.engine}
        setup={setup}
        progress={tracked}
        sprites={page.sprites}
        bossName={(id) => page.graph.nodeById.get(id)?.name ?? id}
        onPick={onPick}
        returnFocus={pickerReturnFocus}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={copy.CLEAR_TITLE}
        description={copy.CLEAR_BODY}
        confirmLabel={copy.CLEAR}
        onConfirm={() => {
          store.clear()
          setImproveOpen(false)
          setErrors({ boss: false, empty: false })
        }}
        returnFocus={() => document.getElementById(PAGE_TITLE_ID)}
      >
        <p>{copy.CLEAR_KEEP}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingImport !== null}
        onOpenChange={(open) => !open && setPendingImport(null)}
        title={copy.IMPORT_REPLACE_TITLE}
        description={pendingImport ? copy.importReplaceBody(pendingImport.name) : ''}
        confirmLabel={copy.IMPORT_REPLACE}
        cancelLabel={copy.IMPORT_KEEP}
        onConfirm={() => {
          if (pendingImport) applyImport(pendingImport)
          setPendingImport(null)
        }}
        returnFocus={() => document.getElementById(`${ids.loadout}-import`) ?? document.getElementById(ids.loadout)}
      >
        <p>{copy.IMPORT_REPLACE_KEEP}</p>
      </ConfirmDialog>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  )
}
