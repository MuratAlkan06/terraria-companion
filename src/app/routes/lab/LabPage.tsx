import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  Swords,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { hasAssumptions } from '../../../components/assumptions'
import { BottomSheet } from '../../../components/BottomSheet'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { PixelLoader } from '../../../components/PixelLoader'
import { EmptyState, ErrorState } from '../../../components/States'
import { useBreakpoint, useMediaQuery } from '../../../components/useMediaQuery'
import type { Weapon } from '../../../data-access/types'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import { LAB_WEAPON_PARAM } from '../../../lab/labLinks'
import { resolveLabSelection, type LabSelection } from '../../../lab/labWeapons'
import { useSettingsStore } from '../../settingsStore'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { ArenaCanvas } from './ArenaCanvas'
import { AttackHint, EquippedBar, HudControls, StatReadouts } from './Hud'
import { arenaSpriteUrl, loadLabData, peekLabData, type LabData } from './labData'
import { PANEL_SETTINGS, PANEL_WEAPONS, panelToggleId, pickerOptionId } from './labIds'
import { LIMITATION_TITLE_ID, LimitationCard } from './LimitationCard'
import { SimDisclaimerBar } from './SimDisclaimerBar'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { useElementSize } from './useElementSize'
import { useLabFullscreen } from './useLabFullscreen'
import { useLabHud } from './useLabHud'
import { WeaponPicker } from './WeaponPicker'

/**
 * /lab — Weapon Lab, P3-S1 "Arena Core + Swing-Melee" (PRD P3-S1 AC1–5; UX_SPEC §3.4, §5.5, §7, §8, §9).
 *
 * Desktop (≥ lg): weapons panel | arena (canvas + HTML HUD) | target panel (UX_SPEC's
 * TargetSettingsPanel; titled "Target" while it holds no settings for the swords the Lab equips),
 * both panels collapsible. Tablet (md–lg): the arena in the centre and ONE side panel at a time,
 * opened from a two-button dock under it. Phone (< md): the arena on top (~55vh), corner HUD, the
 * camera zoomed onto the fight, and the same dock opening the panels as bottom sheets. The
 * SimDisclaimerBar sits on top at every breakpoint and in fullscreen. `?weapon=:id` deep-links the
 * equipped weapon; anything the Lab can't equip falls back to a starter sword with a
 * LimitationCard explaining why.
 */
type PanelKey = 'weapons' | 'settings'

// Each sheet has its own description: without one, the dialog would be described by its title again.
const DOCK: readonly { key: PanelKey; title: string; panelId: string; icon: LucideIcon; description: string }[] = [
  { key: 'weapons', title: 'Weapons', panelId: PANEL_WEAPONS, icon: Swords, description: 'Choose a weapon to equip in the arena.' },
  { key: 'settings', title: 'Target', panelId: PANEL_SETTINGS, icon: SlidersHorizontal, description: 'What the arena’s dummy is, and how to attack it.' },
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
  return <LabStage selection={selection} data={data} equip={equip} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} />
}

interface StageProps extends WorkspaceProps {
  selection: LabSelection
  equip: (id: number) => void
}

function LabStage({ selection, ...rest }: StageProps) {
  const created = useMemo(() => createLabSession(selection.weapon), [selection.weapon])
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
  return <LabView session={created.session} selection={selection} {...rest} />
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

function LabView({ session, selection, data, equip, fullscreen, onToggleFullscreen }: StageProps & { session: LabSession }) {
  const hud = useLabHud(session)
  const wide = useBreakpoint('lg')
  const medium = useBreakpoint('md') && !wide
  const touch = useMediaQuery('(pointer: coarse)')
  const userFallback = useSettingsStore((s) => s.settings.spriteFallback)
  const weapon = selection.weapon
  const spriteUrl = arenaSpriteUrl(weapon, data.sprites, userFallback)
  const assumptions = session.assumptions
  // ≥ lg: both panels, each collapsible. md–lg: one side panel at a time. < md: bottom sheets.
  const [panels, setPanels] = useState({ weapons: true, settings: true })
  const [sidePanel, setSidePanel] = useState<PanelKey | null>(null)
  const [sheet, setSheet] = useState<PanelKey | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const arenaRef = useRef<HTMLElement>(null)
  const hudTopRef = useRef<HTMLDivElement>(null)
  const hudBottomRef = useRef<HTMLDivElement>(null)
  const arenaSize = useElementSize(arenaRef)
  const hudTop = useElementSize(hudTopRef)
  const hudBottom = useElementSize(hudBottomRef)
  // The HUD follows the arena's own width (side panels squeeze it); before the first measurement,
  // the viewport decides.
  const compact = arenaSize ? arenaSize.width < HUD_COMPACT_BELOW : !(wide || medium)
  const blocked = selection.notice !== null
  // Phone layout (not fullscreen): the LimitationCard flows in the page instead of scrolling in the arena.
  const cardInFlow = blocked && !(wide || medium || fullscreen)
  useSpaceAttack(session, !blocked)

  // Polite live region; a zero-width suffix makes a repeated message announce again.
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text}\u200b` : text)), [])

  // Every picker change equips (arrow keys too: a live preview, in the panel and in the sheet alike).
  // Only a deliberate pick — click, tap, Space or Enter — closes the phone sheet (WCAG 3.2.2); Radix
  // then returns focus to the Weapons button.
  const onEquip = (next: Weapon) => {
    equip(next.id)
    announce(`Equipped ${next.name}.`)
  }
  const closeSheet = () => setSheet(null)
  const onReset = () => {
    session.reset()
    announce(`Stats reset — ${weapon.name} is ready.`)
  }

  // LimitationCard "Back to weapons": keep the fallback equipped and go to the weapon list.
  const pickerName = wide || medium ? 'lab-weapon-panel' : 'lab-weapon-sheet'
  const onBackToWeapons = () => {
    equip(weapon.id)
    if (wide) {
      setPanels((p) => ({ ...p, weapons: true }))
      focusSoon(pickerOptionId(pickerName, weapon.id))
    } else if (medium) {
      setSidePanel('weapons')
      focusSoon(pickerOptionId(pickerName, weapon.id))
    } else {
      setSheet('weapons')
    }
  }

  // A deep link that fell back: move focus to the card's title so it is read first.
  const noticeKey = selection.notice ? `${selection.notice.kind}:${requested(selection)}` : null
  useEffect(() => {
    if (noticeKey) document.getElementById(LIMITATION_TITLE_ID)?.focus({ preventScroll: true })
  }, [noticeKey])

  const panelContent: Record<PanelKey, ReactNode> = {
    weapons: (
      <WeaponPicker
        weapons={data.list}
        equippedId={weapon.id}
        sprites={data.sprites}
        onEquip={onEquip}
        onCommit={wide || medium ? undefined : closeSheet}
        name={pickerName}
      />
    ),
    settings: <TargetSettingsPanel usesMana={hud.weapon.manaCostPerUse > 0} dummy={session.sim.renderState().dummies[0]} />,
  }
  const hasEstimates = hasAssumptions(assumptions)
  // The camera frames the scene below the HUD's top row (EquippedBar + StatReadouts); on phones it
  // zooms onto the fight between that row and the bottom controls (design review H3).
  const hudPad = compact ? 8 : 12
  const insetTop = hudTop ? hudTop.height + hudPad : 0
  const insetBottom = hudBottom ? hudBottom.height + hudPad : 0
  const framing = wide || medium ? 'scene' : 'action'
  const openSide = medium && sidePanel ? DOCK.find((d) => d.key === sidePanel) : undefined

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
        >
          <p id="lab-arena-help" className="sr-only">
            Hold Space to swing at the Infinite Dummy. Damage appears in the live stats.
          </p>
          <ArenaCanvas session={session} spriteUrl={spriteUrl} insetTop={insetTop} insetBottom={insetBottom} framing={framing} />
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
            <div ref={hudBottomRef} className="flex items-end justify-between gap-2">
              {hud.attackSeconds === 0 ? <AttackHint touch={touch} /> : <span />}
              <HudControls onReset={onReset} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} compact={compact} />
            </div>
          </div>
          {selection.notice ? (
            // Auto margins centre the card without making any overflow unreachable (unlike place-items).
            <div
              className={cx(
                'z-(--z-hud) flex bg-night-950/75 p-3',
                cardInFlow ? 'relative min-h-[inherit]' : 'absolute inset-0 overflow-y-auto overscroll-contain',
              )}
              data-lab-notice=""
            >
              <div className="m-auto flex w-full justify-center">
                <LimitationCard notice={selection.notice} fallback={weapon} sprites={data.sprites} onBack={onBackToWeapons} />
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
          {DOCK.map(({ key, title, panelId, icon: Icon, description }) => {
            const label = (
              <>
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                {title}
              </>
            )
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
                  className={buttonClass('secondary', cx('w-full', expanded && 'border-gold-500 bg-night-700'))}
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
                trigger={
                  <button type="button" className={buttonClass('secondary', 'w-full')}>
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
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

/**
 * Side panel (UX_SPEC §3.4 "collapsible"). On desktop a closed panel collapses to a narrow rail
 * with a show button; focus follows to the counterpart button (show ↔ hide share one id).
 */
function SidePanel({ side, title, id, open, onOpenChange, children }: SidePanelProps) {
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
      <div className={cx('flex w-12 shrink-0 flex-col items-center gap-3 border-panel-border bg-surface py-2', border)}>
        <button type="button" id={panelToggleId(id)} aria-expanded={false} aria-controls={id} onClick={() => toggle(true)} className={iconButton}>
          <OpenIcon aria-hidden="true" className="size-5" />
          <span className="sr-only">Show the {title.toLowerCase()} panel</span>
        </button>
        <span aria-hidden="true" className="text-xs font-semibold tracking-wide text-fg-muted uppercase [writing-mode:vertical-rl]">
          {title}
        </span>
      </div>
    )
  }
  return (
    <aside aria-labelledby={`${id}-title`} className={cx('flex w-72 shrink-0 flex-col border-panel-border bg-surface', border)} data-lab-panel={id}>
      <div className="flex items-center justify-between gap-2 border-b-2 border-panel-border py-1 pr-1 pl-3">
        <h2 id={`${id}-title`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">
          {title}
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
