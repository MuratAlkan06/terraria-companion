import {
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Swords,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router'
import { hasAssumptions } from '../../../components/assumptions'
import { BottomSheet } from '../../../components/BottomSheet'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { PixelLoader } from '../../../components/PixelLoader'
import { EmptyState, ErrorState } from '../../../components/States'
import { useBreakpoint, useMediaQuery } from '../../../components/useMediaQuery'
import type { Weapon } from '../../../data-access/types'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import { LAB_WEAPON_PARAM } from '../../../lab/labLinks'
import { attackVerb, labStatus, resolveLabSelection, type LabNotice, type LabSelection } from '../../../lab/labWeapons'
import type { LabSettings, TimedTestDuration } from '../../../sim'
import { useSettingsStore } from '../../settingsStore'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { ArenaCanvas } from './ArenaCanvas'
import { DpsGraph } from './DpsGraph'
import { graphOpenByDefault } from './dpsGraphModel'
import { AttackHint, EquippedBar, HudControls, StatReadouts } from './Hud'
import { INITIAL_BROWSER_STATE, type LabBrowserState } from './browserModel'
import { LabBrowser } from './LabBrowser'
import { arenaSpriteUrl, loadLabData, peekLabData, type LabData } from './labData'
import { DPS_GRAPH_ID, lockNoticeId, PANEL_SETTINGS, PANEL_WEAPONS, panelToggleId } from './labIds'
import { LIMITATION_TITLE_ID, LimitationCard } from './LimitationCard'
import { SimDisclaimerBar } from './SimDisclaimerBar'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { LockBadge, LockNotice, ResultsSummary, TimedTestControl } from './TimedTest'
import { completionAnnouncement, testName } from './timedTestCopy'
import { focusIsLost, timedTestFocusTarget, type TimedTestFocusEvent } from './timedTestFocus'
import { useElementSize } from './useElementSize'
import { useLabFullscreen } from './useLabFullscreen'
import { useLabHud } from './useLabHud'

/**
 * /lab — Weapon Lab: P3-S1 arena core, P3-S2 in-Lab weapon browser + single reset, P3-S3 live
 * stats + DPS graph + timed tests (PRD P3-S1–S3; UX_SPEC §3.4, §5.5, §5.7, §7, §8, §9, §12).
 *
 * Desktop (≥ lg): weapon browser | arena (canvas + HTML HUD) | target & settings panel, both panels
 * collapsible. Tablet (md–lg): the arena in the centre and ONE side panel at a time, opened from a
 * two-button dock under it. Phone (< md): the arena on top (~55vh), corner HUD, the camera zoomed
 * onto the fight, the DPS graph behind its "Graph" chip, and the same dock opening the panels as
 * bottom sheets. The SimDisclaimerBar sits on top at every breakpoint and in fullscreen.
 *
 * `?weapon=:id` deep-links the equipped weapon; anything the Lab can't equip falls back to a
 * starter weapon with a LimitationCard. Choosing a not-simulated weapon in the browser shows its
 * card and keeps the current weapon equipped (never a broken equip). While a timed test runs, the
 * browser and the settings are locked: inert, with a lock badge and the reason (UX_SPEC §5.7).
 */
type PanelKey = 'weapons' | 'settings'

// Each sheet has its own description: without one, the dialog would be described by its title again.
// The weapons sheet's one line stands in for the browser's own intro (hidden there, so the list keeps
// its rows — design review P3-S2/S3).
const DOCK: readonly { key: PanelKey; title: string; panelId: string; icon: LucideIcon; description: string }[] = [
  { key: 'weapons', title: 'Weapons', panelId: PANEL_WEAPONS, icon: Swords, description: 'Simulated weapons equip; others show why not.' },
  { key: 'settings', title: 'Target & settings', panelId: PANEL_SETTINGS, icon: SlidersHorizontal, description: 'The dummy, the test settings, and how to attack.' },
]

/** Arena width (CSS px) below which the HUD switches to its compact corner layout. */
const HUD_COMPACT_BELOW = 600

/** Move focus once React has committed the element (it may be mounting in this update). */
function focusSoon(id: string): void {
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }))
}

const dockToggleId = (panelId: string) => `${panelId}-dock`

export default function LabPage() {
  useDocumentTitle('Weapon Lab')
  const resource = useResource('lab', loadLabData, peekLabData)
  const showLoader = useDelayedFlag(resource.status === 'loading')
  const { fullscreen, toggle } = useLabFullscreen()

  return (
    <div
      className={cx(
        'flex flex-col bg-night-950',
        fullscreen ? 'fixed inset-0 z-(--z-nav) pt-[env(safe-area-inset-top,0px)] pb-safe' : 'lg:h-[calc(100dvh-(--spacing(16))-var(--pixel))] lg:min-h-136',
      )}
      data-lab-fullscreen-state={fullscreen ? 'on' : 'off'}
    >
      <h1 className="sr-only">Weapon Lab</h1>
      <SimDisclaimerBar className={cx('z-(--z-hud)', !fullscreen && 'max-lg:sticky max-lg:top-[calc(--spacing(16)+var(--pixel))]')} />
      {resource.status === 'ready' ? (
        <LabWorkspace data={resource.data} fullscreen={fullscreen} onToggleFullscreen={toggle} />
      ) : resource.status === 'error' ? (
        <div className="p-4">
          <ErrorState title="Couldn’t load the Weapon Lab" error={resource.error} onRetry={resource.retry} />
        </div>
      ) : (
        <div className="grid min-h-[55dvh] flex-1 place-items-center">{showLoader ? <PixelLoader label="Loading the Weapon Lab…" /> : null}</div>
      )}
    </div>
  )
}

interface WorkspaceProps {
  data: LabData
  fullscreen: boolean
  onToggleFullscreen: () => void
}

function LabWorkspace({ data, fullscreen, onToggleFullscreen }: WorkspaceProps) {
  const [params, setParams] = useSearchParams()
  const requested = params.get(LAB_WEAPON_PARAM)
  const selection = useMemo(() => resolveLabSelection(requested, data.byId, data.list), [requested, data])
  // Test settings carry over to the next weapon's session (Reset is what restores the defaults).
  const settingsRef = useRef<LabSettings | null>(null)

  const equip = useCallback(
    (id: number) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(LAB_WEAPON_PARAM, String(id))
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  if (!selection) {
    return (
      <div className="p-4">
        <EmptyState title="No weapons can be simulated yet" titleId="lab-empty-title" actions={<Link to="/weapons" className={buttonClass('primary')}>Browse weapons</Link>}>
          <p>The dataset has no weapon with verified simulation data. The weapon pages still list every stat.</p>
        </EmptyState>
      </div>
    )
  }
  return <LabStage selection={selection} data={data} equip={equip} settingsRef={settingsRef} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} />
}

interface StageProps extends WorkspaceProps {
  selection: LabSelection
  equip: (id: number) => void
  settingsRef: RefObject<LabSettings | null>
}

function LabStage({ selection, settingsRef, ...rest }: StageProps) {
  const created = useMemo(
    () => createLabSession(selection.weapon, settingsRef.current ? { settings: settingsRef.current } : {}),
    // A new session per weapon only; settings changes go to the live session.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [selection.weapon],
  )
  if (!created.ok) {
    // Unreachable for weapons that passed labStatus(); kept as a designed state, never a crash.
    return (
      <div className="p-4">
        <EmptyState title="This weapon can’t be simulated" titleId="lab-refusal-title">
          <p>{created.refusal.message}</p>
        </EmptyState>
      </div>
    )
  }
  return <LabView session={created.session} selection={selection} settingsRef={settingsRef} {...rest} />
}

const INTERACTIVE =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], [role="menuitem"], [role="slider"], [role="combobox"], [role="dialog"]'

const isSpace = (event: KeyboardEvent) => event.code === 'Space' || event.key === ' '

/** Space-hold attack (UX_SPEC §9) anywhere that Space has no other job (off while `enabled` is false). */
function useSpaceAttack(session: LabSession, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return
      event.preventDefault()
      if (!event.repeat) session.press('key')
    }
    const onUp = (event: KeyboardEvent) => {
      if (isSpace(event)) session.release('key')
    }
    const stop = () => session.releaseAll()
    const onVisibility = () => {
      if (document.hidden) stop()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [session, enabled])
}

function LabView({ session, selection, data, equip, settingsRef, fullscreen, onToggleFullscreen }: StageProps & { session: LabSession }) {
  const hud = useLabHud(session)
  const wide = useBreakpoint('lg')
  const medium = useBreakpoint('md') && !wide
  const touch = useMediaQuery('(pointer: coarse)')
  const userFallback = useSettingsStore((s) => s.settings.spriteFallback)
  const weapon = selection.weapon
  const spriteUrl = arenaSpriteUrl(weapon, data.sprites, userFallback)
  const assumptions = session.assumptions
  const verb = attackVerb(hud.weapon.archetype)
  // ≥ lg: both panels, each collapsible. md–lg: one side panel at a time. < md: bottom sheets.
  const [panels, setPanels] = useState({ weapons: true, settings: true })
  const [sidePanel, setSidePanel] = useState<PanelKey | null>(null)
  const [sheet, setSheet] = useState<PanelKey | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // A not-simulated weapon chosen in the browser: its LimitationCard shows, the equipped weapon stays.
  const [inspected, setInspected] = useState<Weapon | null>(null)
  const [browser, setBrowser] = useState<LabBrowserState>(INITIAL_BROWSER_STATE)
  const [focusRequest, setFocusRequest] = useState<{ id: number; nonce: number } | null>(null)
  // null = follow the layout (open on tablet and desktop, behind the Graph chip on phones) until toggled.
  const [graphChoice, setGraphChoice] = useState<boolean | null>(null)
  const [testRuns, setTestRuns] = useState(0)
  const arenaRef = useRef<HTMLElement>(null)
  const hudTopRef = useRef<HTMLDivElement>(null)
  const hudBottomRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const arenaSize = useElementSize(arenaRef)
  const hudTop = useElementSize(hudTopRef)
  const hudBottom = useElementSize(hudBottomRef)
  const hint = useElementSize(hintRef)
  // The HUD follows the arena's own width (side panels squeeze it); before the first measurement,
  // the viewport decides.
  const compact = arenaSize ? arenaSize.width < HUD_COMPACT_BELOW : !(wide || medium)
  const graphOpen = graphChoice ?? graphOpenByDefault(wide ? 'desktop' : medium ? 'tablet' : 'phone')
  const locked = hud.locked
  const lockedFor = hud.timedTest.durationSec

  // The card on show: a browser pick, else a deep link that fell back.
  const notice: LabNotice | null = useMemo(() => {
    if (!inspected) return selection.notice
    const status = labStatus(inspected)
    return status.kind === 'equippable' ? selection.notice : { kind: 'not-equippable', weapon: inspected, status }
  }, [inspected, selection.notice])
  const blocked = notice !== null
  // Phone layout (not fullscreen): the LimitationCard flows in the page instead of scrolling in the arena.
  const cardInFlow = blocked && !(wide || medium || fullscreen)
  // The checked browser row: the weapon whose card is shown, else the equipped one.
  const selectedId = notice?.kind === 'not-equippable' ? notice.weapon.id : weapon.id
  useSpaceAttack(session, !blocked)

  useEffect(() => {
    settingsRef.current = hud.settings
  }, [hud.settings, settingsRef])

  // Polite live region; a zero-width suffix makes a repeated message announce again.
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text}​` : text)), [])

  // Every browser change applies at once (arrow keys too: a live preview, in the panel and in the
  // sheet alike). Only a deliberate pick — click, tap, Space or Enter — closes the phone sheet
  // (WCAG 3.2.2); Radix then returns focus to the Weapons button.
  const onSelect = (next: Weapon) => {
    if (locked) return
    if (labStatus(next).kind === 'equippable') {
      setInspected(null)
      equip(next.id)
      announce(`Equipped ${next.name}.`)
      return
    }
    setInspected(next)
    // A deep-link notice gives way to the chosen weapon's card; the URL keeps the equipped weapon.
    if (selection.notice) equip(weapon.id)
    announce(`${next.name} isn’t simulated in the Lab — its card says why. ${weapon.name} stays equipped.`)
  }
  const closeSheet = () => setSheet(null)
  const onReset = () => {
    const stopped = hud.timedTest.status === 'running'
    session.reset()
    announce(`${stopped ? 'Test stopped. ' : ''}Reset: stats, dummy and default settings restored — ${weapon.name} is ready.`)
  }
  // Each step of a test replaces the control that had focus; focus follows (./timedTestFocus.ts).
  const focusAfter = (event: TimedTestFocusEvent) => {
    const id = timedTestFocusTarget(event)
    if (id) focusSoon(id)
  }
  const onStartTest = (durationSec: TimedTestDuration) => {
    if (!session.startTimedTest(durationSec)) return
    setTestRuns((n) => n + 1)
    announce(`${testName(durationSec)} started. The weapon, target and settings are locked until it ends; Reset stops it.`)
    focusAfter({ kind: 'start' })
  }
  const onRunAgain = () => {
    const durationSec = hud.timedTest.durationSec
    if (!durationSec || !session.runAgain()) return
    setTestRuns((n) => n + 1)
    announce(`${testName(durationSec)} started again with the same seed and settings.`)
    focusAfter({ kind: 'run-again' })
  }

  // Completion (UX_SPEC §9: announced politely). The countdown that had focus is gone: focus moves
  // to the results heading — unless the user had moved it elsewhere, where it stays.
  const finished = hud.timedTest.status === 'finished' ? hud.timedTest.result : null
  const finishedKey = finished ? testRuns : null
  useEffect(() => {
    if (!finished) return
    announce(completionAnnouncement(finished))
    focusAfter({ kind: 'finish', focusLost: focusIsLost(document) })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey])
  const onResultsReset = () => {
    const durationSec = hud.timedTest.durationSec
    onReset()
    if (durationSec) focusAfter({ kind: 'results-reset', durationSec })
  }

  // LimitationCard "Back to weapons": the equipped weapon stays; the browser opens on its row.
  const pickerName = wide || medium ? 'lab-weapon-panel' : 'lab-weapon-sheet'
  const onBackToWeapons = () => {
    setInspected(null)
    if (selection.notice) equip(weapon.id)
    setFocusRequest((prev) => ({ id: weapon.id, nonce: (prev?.nonce ?? 0) + 1 }))
    if (wide) setPanels((p) => ({ ...p, weapons: true }))
    else if (medium) setSidePanel('weapons')
    else setSheet('weapons')
  }

  // A deep link that fell back: move focus to the card's title so it is read first.
  const noticeKey = selection.notice ? `${selection.notice.kind}:${requested(selection)}` : null
  useEffect(() => {
    if (noticeKey) document.getElementById(LIMITATION_TITLE_ID)?.focus({ preventScroll: true })
  }, [noticeKey])

  const lockable = (panelId: string, content: ReactNode): ReactNode =>
    locked ? (
      // Keeps the panel's height chain (the browser pins its header and scrolls its own list).
      <div className="flex h-full min-h-0 flex-col gap-3">
        <LockNotice id={lockNoticeId(panelId)} durationSec={lockedFor} />
        <div inert className="min-h-0 flex-1 opacity-60" data-lab-locked-content="">
          {content}
        </div>
      </div>
    ) : (
      content
    )

  const panelContent: Record<PanelKey, ReactNode> = {
    weapons: lockable(
      PANEL_WEAPONS,
      <LabBrowser
        rows={data.rows}
        state={browser}
        onStateChange={setBrowser}
        selectedId={selectedId}
        equippedId={weapon.id}
        sprites={data.sprites}
        onSelect={onSelect}
        onCommit={wide || medium ? undefined : closeSheet}
        name={pickerName}
        focusRequest={focusRequest}
        introVisible={wide || medium}
      />,
    ),
    settings: lockable(
      PANEL_SETTINGS,
      <TargetSettingsPanel
        usesMana={hud.weapon.manaCostPerUse > 0}
        dummy={session.sim.renderState().dummies[0]}
        settings={hud.settings}
        onSettingsChange={(patch) => session.updateSettings(patch)}
        locked={locked}
        verb={verb}
      />,
    ),
  }
  const hasEstimates = hasAssumptions(assumptions)
  const testAssumptions = assumptionsForEstimate(assumptions, 'timed-test-dps')
  const graphAssumptions = assumptionsForEstimate(assumptions, 'dps-graph')
  const appliesDot = weapon.labBehavior.kind === 'archetype' && weapon.labBehavior.modifiers?.dot !== undefined
  // The camera frames the scene below the HUD's top row (EquippedBar + StatReadouts); on phones it
  // zooms onto the fight between that row and the bottom controls (design review H3). Both framings
  // place the fight above the bottom controls + graph strip, the feet clear of the first-use hint
  // that floats there (its room stays reserved once it's gone, so the view never jumps).
  const hudPad = compact ? 8 : 12
  const insetTop = hudTop ? hudTop.height + hudPad : 0
  const insetBottom = hudBottom ? hudBottom.height + hudPad : 0
  const floorPx = hint ? hint.height + hudPad / 2 : 0
  const framing = wide || medium ? 'scene' : 'action'
  const openSide = medium && sidePanel ? DOCK.find((d) => d.key === sidePanel) : undefined
  const showHint = hud.attackSeconds === 0 && hud.timedTest.status === 'idle'

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-lab-announcer="">
        {announcement}
      </p>
      {/* md–lg: the row has the arena's height, so an open side panel scrolls inside it. */}
      <div className={cx('flex min-h-0 flex-1 flex-col md:flex-row', !(wide || fullscreen) && 'md:h-[60dvh] md:min-h-80 md:flex-none')}>
        {wide ? (
          <SidePanel
            side="left"
            title={DOCK[0].title}
            id={PANEL_WEAPONS}
            open={panels.weapons}
            locked={locked}
            onOpenChange={(open) => setPanels((p) => ({ ...p, weapons: open }))}
          >
            {panelContent.weapons}
          </SidePanel>
        ) : null}

        <section
          ref={arenaRef}
          aria-label="Arena"
          aria-describedby="lab-arena-help"
          tabIndex={0}
          onPointerDown={() => arenaRef.current?.focus({ preventScroll: true })}
          className={cx(
            // The focus ring is the overlay at the end (the canvas would paint over an outline).
            'group relative isolate min-w-0 overflow-hidden bg-night-950 focus-visible:outline-none',
            wide || fullscreen
              ? 'min-h-0 flex-1'
              : // Phones: a LimitationCard can be taller than the arena — the arena grows to fit it.
                cx(cardInFlow ? 'min-h-[55dvh]' : 'h-[55dvh] min-h-80', 'md:h-auto md:min-h-0 md:flex-1'),
          )}
          data-lab-arena=""
          data-hud-layout={compact ? 'compact' : 'full'}
          data-timed-test-status={hud.timedTest.status}
        >
          <p id="lab-arena-help" className="sr-only">
            Hold Space to {verb} at the Infinite Dummy. Damage appears in the live stats.
          </p>
          <ArenaCanvas session={session} spriteUrl={spriteUrl} insetTop={insetTop} insetBottom={insetBottom} floorPx={floorPx} framing={framing} />
          {/* Inert behind a LimitationCard: the card is the only thing to act on. */}
          <div className="pointer-events-none absolute inset-0 z-(--z-hud) flex flex-col justify-between gap-2 p-2 md:p-3" inert={blocked}>
            <div ref={hudTopRef} className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1">
                <EquippedBar weapon={weapon} sprites={data.sprites} hud={hud} compact={compact} />
              </div>
              {hasEstimates ? (
                <div className="shrink-0">
                  <StatReadouts hud={hud} assumptions={assumptions} compact={compact} />
                </div>
              ) : null}
            </div>
            <div ref={hudBottomRef} className="flex flex-col gap-2">
              {graphOpen && hasAssumptions(graphAssumptions) ? (
                <div id={DPS_GRAPH_ID}>
                  <DpsGraph graph={hud.graph} assumptions={graphAssumptions} compact={compact} />
                </div>
              ) : null}
              <div className="flex items-end justify-between gap-2">
                <TimedTestControl test={hud.timedTest} onStart={onStartTest} compact={compact} />
                <HudControls
                  onReset={onReset}
                  fullscreen={fullscreen}
                  onToggleFullscreen={onToggleFullscreen}
                  compact={compact}
                  graphOpen={graphOpen}
                  onToggleGraph={() => setGraphChoice(!graphOpen)}
                  graphId={DPS_GRAPH_ID}
                />
              </div>
            </div>
            {/* First-use hint, floated above the controls. Always laid out (hidden once the first
                attack starts) so the camera can keep its room clear (`floorPx`). */}
            <div
              ref={hintRef}
              className={cx('absolute left-2 md:left-3', !showHint && 'invisible')}
              style={{ bottom: insetBottom || undefined }}
              data-attack-hint-shown={showHint ? 'true' : 'false'}
            >
              <AttackHint touch={touch} verb={verb} />
            </div>
            {finished && hasAssumptions(testAssumptions) ? (
              // Above the bottom controls; may cover the frozen top readouts on a short arena (it scrolls if taller).
              <div className="absolute inset-x-0 top-2 flex items-end justify-center px-2 md:px-3" style={{ bottom: insetBottom || undefined }}>
                <div className="flex max-h-full w-full justify-center overflow-y-auto overscroll-contain">
                  <ResultsSummary
                    result={finished}
                    weaponName={weapon.name}
                    appliesDot={appliesDot}
                    assumptions={testAssumptions}
                    onRunAgain={onRunAgain}
                    onReset={onResultsReset}
                    compact={compact}
                  />
                </div>
              </div>
            ) : null}
          </div>
          {notice ? (
            // Auto margins centre the card without making any overflow unreachable (unlike place-items).
            <div
              className={cx(
                'z-(--z-hud) flex bg-night-950/75 p-3',
                cardInFlow ? 'relative min-h-[inherit]' : 'absolute inset-0 overflow-y-auto overscroll-contain',
              )}
              data-lab-notice=""
            >
              <div className="m-auto flex w-full justify-center">
                <LimitationCard notice={notice} fallback={weapon} sprites={data.sprites} onBack={onBackToWeapons} />
              </div>
            </div>
          ) : null}
          {/* Keyboard focus ring (UX_SPEC §9: 2px gold): above the canvas, the HUD and any card. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-(--z-hud) hidden border-2 border-ring group-focus-visible:block"
            data-arena-focus-ring=""
          />
        </section>

        {wide ? (
          <SidePanel
            side="right"
            title={DOCK[1].title}
            id={PANEL_SETTINGS}
            open={panels.settings}
            locked={locked}
            onOpenChange={(open) => setPanels((p) => ({ ...p, settings: open }))}
          >
            {panelContent.settings}
          </SidePanel>
        ) : openSide ? (
          <SidePanel
            side="right"
            title={openSide.title}
            id={openSide.panelId}
            open
            locked={locked}
            onOpenChange={(open) => {
              if (open) return
              setSidePanel(null)
              focusSoon(dockToggleId(openSide.panelId))
            }}
          >
            {panelContent[openSide.key]}
          </SidePanel>
        ) : null}
      </div>

      {wide ? null : (
        <div className="grid grid-cols-2 gap-2 border-t-2 border-panel-border bg-surface p-2" data-lab-dock="">
          {DOCK.map(({ key, title, panelId, icon, description }) => {
            // Locked: a gold lock glyph takes the icon's place (the panel itself shows the badge + reason).
            const Icon = locked ? Lock : icon
            const label = (
              <>
                <Icon aria-hidden="true" className={cx('size-5 shrink-0', locked && 'text-accent')} data-dock-locked={locked ? '' : undefined} />
                {title}
                {locked ? <span className="sr-only"> (locked during the test)</span> : null}
              </>
            )
            const lockedFrame = locked && 'border-gold-600'
            if (medium) {
              const expanded = sidePanel === key
              return (
                <button
                  key={key}
                  id={dockToggleId(panelId)}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setSidePanel(expanded ? null : key)}
                  className={buttonClass('secondary', cx('w-full', lockedFrame, expanded && 'border-gold-500 bg-night-700'))}
                >
                  {label}
                </button>
              )
            }
            return (
              <BottomSheet
                key={key}
                open={sheet === key}
                onOpenChange={(open) => setSheet(open ? key : null)}
                title={title}
                description={description}
                fill={key === 'weapons'}
                trigger={
                  <button type="button" className={buttonClass('secondary', cx('w-full px-2', lockedFrame))}>
                    {label}
                  </button>
                }
              >
                {panelContent[key]}
              </BottomSheet>
            )
          })}
        </div>
      )}
    </>
  )
}

function requested(selection: LabSelection): string {
  const notice = selection.notice
  if (!notice) return ''
  return notice.kind === 'not-found' ? notice.requested : String(notice.weapon.id)
}

interface SidePanelProps {
  side: 'left' | 'right'
  title: string
  id: string
  open: boolean
  /** A timed test runs: the header shows a lock badge (the content shows the reason). */
  locked?: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

/**
 * Side panel (UX_SPEC §3.4 "collapsible"). On desktop a closed panel collapses to a narrow rail
 * with a show button; focus follows to the counterpart button (show ↔ hide share one id).
 */
function SidePanel({ side, title, id, open, locked = false, onOpenChange, children }: SidePanelProps) {
  const border = side === 'left' ? 'border-r-2' : 'border-l-2'
  const CloseIcon = side === 'left' ? PanelLeftClose : PanelRightClose
  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  const iconButton = 'grid min-h-tap min-w-tap place-items-center text-fg-muted hover:bg-night-700 hover:text-fg'
  const toggle = (next: boolean) => {
    onOpenChange(next)
    focusSoon(panelToggleId(id))
  }
  if (!open) {
    return (
      <div className={cx('flex w-12 shrink-0 flex-col items-center gap-3 border-panel-border bg-surface py-2', border)} data-lab-panel-rail={id}>
        <button type="button" id={panelToggleId(id)} aria-expanded={false} aria-controls={id} onClick={() => toggle(true)} className={iconButton}>
          <OpenIcon aria-hidden="true" className="size-5" />
          <span className="sr-only">
            Show the {title.toLowerCase()} panel{locked ? ' (locked during the test)' : ''}
          </span>
        </button>
        <span aria-hidden="true" className="text-xs font-semibold tracking-wide text-fg-muted uppercase [writing-mode:vertical-rl]">
          {title}
        </span>
      </div>
    )
  }
  return (
    <aside aria-labelledby={`${id}-title`} className={cx('flex w-72 shrink-0 flex-col border-panel-border bg-surface', border)} data-lab-panel={id} data-locked={locked ? '' : undefined}>
      <div className="flex items-center justify-between gap-2 border-b-2 border-panel-border py-1 pr-1 pl-3">
        <h2 id={`${id}-title`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-display text-sm leading-relaxed text-accent text-shadow-pixel">
          {title}
          {locked ? <LockBadge className="font-sans text-shadow-none" /> : null}
        </h2>
        <button type="button" id={panelToggleId(id)} aria-expanded={true} aria-controls={id} onClick={() => toggle(false)} className={iconButton}>
          <CloseIcon aria-hidden="true" className="size-5" />
          <span className="sr-only">Hide the {title.toLowerCase()} panel</span>
        </button>
      </div>
      <div id={id} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {children}
      </div>
    </aside>
  )
}
