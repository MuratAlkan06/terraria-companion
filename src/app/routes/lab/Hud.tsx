import { Maximize, Minimize, MousePointerClick, RotateCcw } from 'lucide-react'
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

/**
 * HudOverlay (UX_SPEC §3.4) — HTML over the canvas; the canvas itself is aria-hidden, so every
 * meaningful output lives here (§9). EquippedBar top-left, StatReadout cluster top-right, the
 * Reset / Fullscreen controls bottom-right. Numbers use tabular numerals so live updates never
 * shift the layout. Derived numbers carry an EstimateLabel with the session's AssumptionsTip.
 * `compact` follows the arena's own width (narrow phones, or a tablet/desktop arena squeezed by
 * side panels): short labels, content-sized columns, values that never wrap.
 */
// Nearly opaque: the starfield must not show through the numbers.
const PANEL = 'pointer-events-auto border-2 border-panel-border bg-night-950/95 shadow-pixel'

const format1 = (n: number) => n.toFixed(1)
const format2 = (n: number) => n.toFixed(2)
const formatInt = (n: number) => Math.round(n).toLocaleString('en-US')

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
  // Each tip lists what its own number depends on: attacks/sec only the cadence assumptions.
  const cadence = assumptionsForEstimate(assumptions, 'attacks-per-sec')
  const rateAssumptions = hasAssumptions(cadence) ? cadence : assumptions
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
                <span className="border-2 border-gold-300 px-1 text-[0.625rem] leading-3.5 font-bold tracking-wide text-gold-300 uppercase">
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
        <Readout label="Est. DPS" compact={compact} wide={compact}>
          <span className="inline-flex items-center gap-1">
            <span data-stat="dps">{format1(hud.estimatedDps)}</span>
            <EstimateLabel assumptions={assumptions} context="estimated DPS" />
          </span>
        </Readout>
      </dl>
    </section>
  )
}

function Readout({ label, short, compact, wide, children }: { label: string; short?: string; compact: boolean; wide?: boolean; children: ReactNode }) {
  return compact ? (
    <div className={cx('flex min-w-0 flex-col', wide && 'col-span-2')}>
      <dt className="text-[0.6875rem] leading-4 font-semibold tracking-wide text-fg-muted uppercase">
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

export function HudControls({
  onReset,
  fullscreen,
  onToggleFullscreen,
  compact,
}: {
  onReset: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  compact: boolean
}) {
  const FullIcon = fullscreen ? Minimize : Maximize
  return (
    <div className="pointer-events-auto flex gap-2">
      <button type="button" onClick={onReset} className={buttonClass('secondary', compact ? 'min-w-tap px-2' : undefined)} data-lab-reset="">
        <RotateCcw aria-hidden="true" className="size-5" />
        {compact ? <span className="sr-only">Reset stats and dummy</span> : 'Reset'}
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

/** First-use hint; gone once the first swing of the session starts. */
export function AttackHint({ touch }: { touch: boolean }) {
  return (
    <p className={cx(PANEL, 'pointer-events-none flex items-center gap-2 px-2 py-1 text-xs text-fg md:text-sm')} data-attack-hint="">
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0 text-accent" />
      {touch ? 'Touch and hold the arena to swing' : 'Press and hold to swing · or hold Space'}
    </p>
  )
}
