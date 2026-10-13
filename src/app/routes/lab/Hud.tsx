import { ChartColumn, Maximize, Minimize, MousePointerClick, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { hasAssumptions, type Assumptions } from '../../../components/assumptions'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import type { LabHudState } from '../../../lab/labSession'
import { getField } from '../../../schemas/getField'
import { format1, format2, formatInt, HUD_PANEL } from './hudStyles'
import { LIVE_DPS_LABEL, LIVE_DPS_SHORT } from './timedTestCopy'

/**
 * HudOverlay (UX_SPEC §3.4) — HTML over the canvas; the canvas itself is aria-hidden, so every
 * meaningful output lives here (§9). EquippedBar top-left, StatReadout cluster top-right, the
 * timed tests bottom-left (./TimedTest.tsx), the Graph / Reset / Fullscreen controls bottom-right.
 * Numbers use tabular numerals so live updates never shift the layout. Derived numbers carry an
 * EstimateLabel with the session's AssumptionsTip. `compact` follows the arena's own width (narrow
 * phones, or a tablet/desktop arena squeezed by side panels): short labels, content-sized columns,
 * values that never wrap.
 */
const PANEL = HUD_PANEL

export function EquippedBar({ weapon, sprites, hud, compact }: { weapon: Weapon; sprites: SpriteIndex | null; hud: LabHudState; compact: boolean }) {
  const rarityView = getField(weapon, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const { weapon: summary } = hud
  return (
    <section aria-label="Equipped weapon" className={cx(PANEL, 'flex max-w-full min-w-0 items-center', compact ? 'gap-2 p-1.5' : 'gap-3 p-2')} data-equipped-bar="">
      <span className="grid shrink-0 place-items-center border-2 border-slot-border bg-slot">
        <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={compact ? 32 : 40} maxScale={2} />
      </span>
      <div className="min-w-0">
        {/* Long names wrap (never a marquee): up to three short lines in the compact bar, which stays
            shorter than the stats box beside it; the title is the full name if even that clips. */}
        <p className={cx('leading-tight font-semibold', compact ? 'line-clamp-3 text-sm' : 'line-clamp-2 text-base')} title={weapon.name}>
          <span className="sr-only">Equipped: </span>
          <RarityText rarity={rarity} tooltip>
            {weapon.name}
          </RarityText>
        </p>
        <dl className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-fg-muted tabular-nums">
          <Fact label="Damage" short="Dmg" compact={compact}>
            {summary.damage}
          </Fact>
          <Fact label="Use time" short="Use" compact={compact}>
            {weapon.useAnimationTicks}
            {compact ? 't' : ' ticks'}
          </Fact>
          <Fact label="Crit" short="Crit" compact={compact}>
            {summary.critChancePct}%
          </Fact>
        </dl>
      </div>
    </section>
  )
}

function Fact({ label, short, compact, children }: { label: string; short: string; compact: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-1 whitespace-nowrap">
      <dt>
        {compact ? (
          <>
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="font-semibold text-fg">{children}</dd>
    </div>
  )
}

export function StatReadouts({ hud, assumptions, compact }: { hud: LabHudState; assumptions: Assumptions; compact: boolean }) {
  const last = hud.lastHit
  // Each tip lists what its own number depends on: attacks/sec only the cadence assumptions; est.
  // DPS all of them, led by what it divides by.
  const cadence = assumptionsForEstimate(assumptions, 'attacks-per-sec')
  const rateAssumptions = hasAssumptions(cadence) ? cadence : assumptions
  const dps = assumptionsForEstimate(assumptions, 'estimated-dps')
  const dpsAssumptions = hasAssumptions(dps) ? dps : assumptions
  return (
    <section aria-label="Live stats" className={cx(PANEL, compact ? 'p-2' : 'p-3')} data-stat-readouts="">
      {/* Compact: both columns reserve their width from the first frame — "999 (99 crits)" and
          "8.57 est." — so the box doesn't grow (and squeeze the EquippedBar) as the numbers climb. */}
      <dl
        className={cx(
          'grid gap-y-1 text-sm tabular-nums',
          compact ? 'grid-cols-[minmax(5.25rem,auto)_minmax(4.25rem,auto)] gap-x-2' : 'min-w-52 grid-cols-[auto_auto] gap-x-3',
        )}
      >
        <Readout label="Per hit" compact={compact}>
          {last ? (
            <span data-stat="per-hit" className="inline-flex items-center gap-1">
              {formatInt(last.amount)}
              {last.crit ? (
                <span className="border-2 border-gold-300 px-1 text-xs leading-4 font-bold tracking-wide text-gold-300 uppercase">
                  Crit
                </span>
              ) : null}
            </span>
          ) : (
            <span data-stat="per-hit">
              <span aria-hidden="true">–</span>
              <span className="sr-only">no hits yet</span>
            </span>
          )}
        </Readout>
        <Readout label="Total damage" short="Total" compact={compact}>
          <span data-stat="total">{formatInt(hud.totalDamage)}</span>
        </Readout>
        <Readout label="Hits" compact={compact}>
          <span data-stat="hits">{formatInt(hud.hits)}</span>
          <span className="ml-1 text-xs font-normal text-fg-muted" data-stat="crits">
            ({formatInt(hud.crits)} crit{hud.crits === 1 ? '' : 's'})
          </span>
        </Readout>
        <Readout label="Attacks/sec" short="Atk/s" compact={compact}>
          <span className="inline-flex items-center gap-1">
            <span data-stat="attacks-per-sec">{format2(hud.attacksPerSec)}</span>
            <EstimateLabel assumptions={rateAssumptions} context="attacks per second" />
          </span>
        </Readout>
        <Readout label={LIVE_DPS_LABEL} short={LIVE_DPS_SHORT} compact={compact} wide={compact}>
          <span className="inline-flex items-center gap-1">
            <span data-stat="dps">{format1(hud.estimatedDps)}</span>
            <EstimateLabel assumptions={dpsAssumptions} context="estimated DPS while attacking" />
          </span>
        </Readout>
      </dl>
    </section>
  )
}

function Readout({ label, short, compact, wide, children }: { label: string; short?: string; compact: boolean; wide?: boolean; children: ReactNode }) {
  return compact ? (
    <div className={cx('flex min-w-0 flex-col', wide && 'col-span-2')}>
      <dt className="text-xs leading-4 font-semibold tracking-wide text-fg-muted uppercase">
        {short ? (
          <>
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="min-h-5 font-semibold whitespace-nowrap text-fg">{children}</dd>
    </div>
  ) : (
    <div className="contents">
      <dt className="py-0.5 text-fg-muted">{label}</dt>
      <dd className="py-0.5 text-right font-semibold whitespace-nowrap text-fg">{children}</dd>
    </div>
  )
}

/** The single Reset's accessible name: what one press restores (PRD P3-S2 AC3). */
export const RESET_LABEL = 'Reset the test, target and settings'

export function HudControls({
  onReset,
  fullscreen,
  onToggleFullscreen,
  compact,
  graphOpen,
  onToggleGraph,
  graphId,
}: {
  onReset: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  compact: boolean
  /** DpsGraph strip shown (UX_SPEC §3.4 "toggleable"; behind a "Graph" chip on phones). */
  graphOpen?: boolean
  onToggleGraph?: () => void
  graphId?: string
}) {
  const FullIcon = fullscreen ? Minimize : Maximize
  const iconOnly = compact ? 'min-w-tap px-2' : undefined
  return (
    <div className="pointer-events-auto flex gap-2">
      {onToggleGraph ? (
        <button
          type="button"
          aria-pressed={graphOpen === true}
          aria-controls={graphOpen ? graphId : undefined}
          onClick={onToggleGraph}
          className={buttonClass('secondary', cx(iconOnly, graphOpen && 'border-gold-500 bg-night-700'))}
          data-lab-graph-toggle=""
        >
          <ChartColumn aria-hidden="true" className="size-5" />
          {compact ? <span className="sr-only">Damage per second graph</span> : 'Graph'}
        </button>
      ) : null}
      <button type="button" onClick={onReset} className={buttonClass('secondary', iconOnly)} data-lab-reset="">
        <RotateCcw aria-hidden="true" className="size-5" />
        {compact ? <span className="sr-only">{RESET_LABEL}</span> : (
          <>
            Reset<span className="sr-only"> the test, target and settings</span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        className={buttonClass('secondary', compact ? 'min-w-tap px-2' : undefined)}
        data-lab-fullscreen=""
      >
        <FullIcon aria-hidden="true" className="size-5" />
        {compact ? <span className="sr-only">{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span> : fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>
    </div>
  )
}

/** First-use hint; gone once the first attack of the session starts. `verb`: "swing", "thrust"… */
export function AttackHint({ touch, verb = 'swing' }: { touch: boolean; verb?: string }) {
  return (
    <p className={cx(PANEL, 'pointer-events-none flex items-center gap-2 px-2 py-1 text-xs text-fg md:text-sm')} data-attack-hint="">
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0 text-accent" />
      {touch ? `Touch and hold the arena to ${verb}` : `Press and hold to ${verb} · or hold Space`}
    </p>
  )
}
