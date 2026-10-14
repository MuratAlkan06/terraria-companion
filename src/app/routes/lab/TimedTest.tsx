import { Lock, Repeat, RotateCcw, Timer } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Assumptions } from '../../../components/assumptions'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { useReducedMotion } from '../../../components/useReducedMotion'
import type { LabTimedTestHud } from '../../../lab/labSession'
import { TIMED_TEST_DURATIONS, type TimedTestDuration, type TimedTestResult } from '../../../sim'
import { format1, formatInt, HUD_PANEL } from './hudStyles'
import { RESULTS_TITLE_ID, startTestId, TIMED_TEST_STATUS_ID } from './labIds'
import { lockReason, testDpsLabel, testName } from './timedTestCopy'

/**
 * Timed tests (PRD P3-S3 AC3, UX_SPEC §3.4 TimedTestControl, §5.7, §12):
 * - `TimedTestControl`: "10s test" / "30s test"; while one runs, a countdown ring and the seconds
 *   left (the ring steps with the HUD, no tween — nothing to remove under reduced motion).
 * - `ResultsSummary`: slides up 260 ms when the run ends (readouts are frozen by then — the engine
 *   halts), the estimated DPS counts up 300 ms in tabular numerals with its width reserved (no
 *   shift), no confetti; reduced motion: no slide, no count-up. "Run again" replays the exact run;
 *   "Reset" is the single Lab reset. The DoT rows appear only for a weapon that applies DoT, the
 *   "Ammo used" / "Mana used" rows only for a weapon that uses them.
 * - `LockBadge` / `LockNotice`: why the panels are disabled while a test runs (§5.7).
 * Copy shared with the announcer lives in ./timedTestCopy.ts. The countdown and the results heading
 * are programmatically focusable (tabIndex −1): the Lab moves focus to them as each one replaces
 * the control that had it (./timedTestFocus.ts, design review H2).
 */

export function LockBadge({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 border-2 border-gold-600 bg-night-950 px-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-accent', className)} data-lock-badge="">
      <Lock aria-hidden="true" className="size-3.5" />
      Locked
    </span>
  )
}

/** The lock notice at the top of a disabled panel: badge + reason, always readable (not inert). */
export function LockNotice({ durationSec, id }: { durationSec: TimedTestDuration | null; id?: string }) {
  return (
    <p id={id} className="flex items-start gap-2 border-2 border-gold-600 bg-night-950 p-2 text-sm text-fg" data-lock-notice="">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{lockReason(durationSec)}</span>
    </p>
  )
}

const RING_R = 15
const RING_C = 2 * Math.PI * RING_R

/** Depletes clockwise from 12 o'clock as the test runs. Decorative: the seconds are in text. */
function CountdownRing({ progress }: { progress: number }) {
  const elapsed = Math.min(1, Math.max(0, progress))
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" className="size-9 shrink-0 -rotate-90" data-countdown-ring={elapsed.toFixed(2)}>
      <circle cx={18} cy={18} r={RING_R} className="fill-none stroke-night-600" strokeWidth={4} />
      <circle
        cx={18}
        cy={18}
        r={RING_R}
        className="fill-none stroke-accent"
        strokeWidth={4}
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * elapsed}
      />
    </svg>
  )
}

export interface TimedTestControlProps {
  test: LabTimedTestHud
  onStart: (durationSec: TimedTestDuration) => void
  compact: boolean
}

export function TimedTestControl({ test, onStart, compact }: TimedTestControlProps) {
  if (test.status === 'running' && test.durationSec !== null) {
    // Whole seconds left, counted down (10, 9, … 1).
    const left = Math.max(0, Math.ceil(test.remainingSec - 1e-9))
    return (
      <div
        id={TIMED_TEST_STATUS_ID}
        tabIndex={-1}
        role="timer"
        aria-label={testName(test.durationSec)}
        className={cx(HUD_PANEL, 'flex items-center gap-2 py-1 pr-3 pl-1')}
        data-timed-test="running"
      >
        <CountdownRing progress={test.progress} />
        <p className="text-sm leading-tight font-semibold tabular-nums">
          {compact ? null : <span className="block text-xs font-normal text-fg-muted">{test.durationSec}s test</span>}
          <span data-test-left={left}>{left} s left</span>
        </p>
      </div>
    )
  }
  return (
    <div role="group" aria-label="Timed tests" className="pointer-events-auto flex gap-2" data-timed-test={test.status}>
      {TIMED_TEST_DURATIONS.map((durationSec) => (
        <button
          key={durationSec}
          id={startTestId(durationSec)}
          type="button"
          onClick={() => onStart(durationSec)}
          className={buttonClass('secondary', compact ? 'min-w-tap px-2' : 'px-3')}
          data-start-test={durationSec}
        >
          {compact ? null : <Timer aria-hidden="true" className="size-5" />}
          <span aria-hidden="true">{compact ? `${durationSec}s` : `${durationSec}s test`}</span>
          <span className="sr-only">Start a {testName(durationSec)}</span>
        </button>
      ))}
    </div>
  )
}

/** Eases a number from 0 to `target` over `ms` (once per mount); `target` at once when not animating. */
function useCountUp(target: number, ms: number, animate: boolean): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!animate) return
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setValue(target * (1 - (1 - t) ** 3))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, ms, animate])
  return animate ? value : target
}

export interface ResultsSummaryProps {
  result: TimedTestResult
  weaponName: string
  /** The equipped weapon applies damage over time: show the direct / DoT split. */
  appliesDot: boolean
  /** A bow or gun: show the ammo the run used. */
  usesAmmo?: boolean
  /** A weapon with a mana cost: show the mana the run used. */
  usesMana?: boolean
  /**
   * Multiple Dummies (PRD P3-S6 AC4): the row's dummy ids, nearest first (the first is the primary
   * target) — the totals are then over all dummies, with the primary target's DPS and each dummy's
   * numbers apart. Null or absent: one dummy.
   */
  dummyIds?: readonly string[] | null
  /**
   * Damage by source (PRD P3-S9 AC3, P3-S10 AC3: the summoner loop): what to call the weapon's own hits
   * (null: a summon staff, which has none) and its summons' — the total's split, with the whip tag's
   * share of the summons' damage. Null or absent: no summons involved.
   */
  sources?: { weapon: string | null; summons: string } | null
  /** The test result's AssumptionsTip (labAssumptions 'timed-test-dps'). */
  assumptions: Assumptions
  onRunAgain: () => void
  onReset: () => void
  compact: boolean
}

export function ResultsSummary({
  result,
  weaponName,
  appliesDot,
  usesAmmo = false,
  usesMana = false,
  dummyIds = null,
  sources = null,
  assumptions,
  onRunAgain,
  onReset,
  compact,
}: ResultsSummaryProps) {
  const reducedMotion = useReducedMotion()
  const dps = useCountUp(result.estimatedDps, 300, !reducedMotion)
  const counting = dps !== result.estimatedDps
  const final = format1(result.estimatedDps)
  const critRate = result.hits > 0 ? Math.round((result.crits / result.hits) * 100) : 0
  const row = dummyIds && dummyIds.length > 1 ? dummyIds.map((id, i) => ({ id, number: i + 1, stats: result.perDummy[id] })) : null
  return (
    // A column that shrinks to the room it has (the arena above the HUD controls): the heading and the
    // actions always show; only the numbers between them scroll (a 5-dummy row on a phone is taller
    // than its room — design review P3-S6/S7).
    <section
      aria-labelledby={RESULTS_TITLE_ID}
      className={cx(HUD_PANEL, 'flex max-h-full min-h-0 w-full max-w-sm animate-sheet-in flex-col', compact ? 'p-2.5' : 'p-3')}
      data-results-summary=""
    >
      {/* Focused when the test ends: the ring is drawn inside the heading's box so it never covers the line below. */}
      <h2 id={RESULTS_TITLE_ID} tabIndex={-1} className="shrink-0 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus-visible:-outline-offset-2">
        {testName(result.durationSec)} results
      </h2>
      {/* overflow-x-hidden: an est. button's invisible 44px tap area (its ::before) reaches past the right
          edge — clipped there anyway, it must not add a sideways scrollbar (design review: 2px on a phone). */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1" data-results-body="">
        <p className="text-xs text-fg-muted">
          {weaponName} vs {row ? `${row.length} Infinite Dummies in a row (totals over all; dummy 1 is the primary target)` : 'the Infinite Dummy'} · browser simulation,
          approximate values
        </p>
        <dl className={cx('mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm tabular-nums', compact && 'text-[0.8125rem]')}>
          <Row label={testDpsLabel(result.durationSec)} emphasis>
            <span className="inline-flex items-center gap-1.5">
              {/* One value for everyone: the final number reserves the width (the count-up drawn over it
                  in the same grid cell never shifts the row) and is what screen readers read; it is only
                  transparent while the aria-hidden count-up runs, which then unmounts. */}
              <span className="inline-grid text-lg leading-6 font-bold text-fg">
                <span className={cx('text-right [grid-area:1/1]', counting && 'opacity-0')} data-result="dps">
                  {final}
                </span>
                {counting ? (
                  <span aria-hidden="true" className="text-right [grid-area:1/1]" data-result="dps-animated">
                    {format1(dps)}
                  </span>
                ) : null}
              </span>
              <EstimateLabel assumptions={assumptions} context={`estimated DPS over the ${testName(result.durationSec)}${row ? ', all dummies' : ''}`} />
            </span>
          </Row>
          {row ? (
            <Row label="Primary target" srLabel={`${testDpsLabel(result.durationSec)}, primary target`} nested>
              <span className="inline-flex items-center gap-1.5">
                <span data-result="primary-dps">{format1((row[0].stats?.damage ?? 0) / result.durationSec)}</span>
                <EstimateLabel assumptions={assumptions} context={`estimated DPS over the ${testName(result.durationSec)}, primary target`} />
              </span>
            </Row>
          ) : null}
          <Row label="Total damage">
            <span data-result="total">{formatInt(result.totalDamage)}</span>
          </Row>
          {/* The parts of the total, nested under it (indented on a rule, a size smaller): by source with
              summons (the weapon's own hits, the summons' with the tag's share, DoT), else direct / DoT. */}
          {sources ? (
            <>
              {sources.weapon ? (
                <Row label={`${sources.weapon} damage`} nested>
                  <span data-result="weapon-damage">{formatInt(result.breakdown.weaponDamage)}</span>
                </Row>
              ) : null}
              <Row label={`${sources.summons} damage`} nested>
                <span data-result="summon-damage">{formatInt(result.breakdown.summonDamage)}</span>
              </Row>
              {sources.weapon ? (
                <Row label="of which tag bonus" srLabel={`of the ${sources.summons.toLowerCase()} damage, added by the whip tag`} nested>
                  <span className="text-success" data-result="tag-bonus">
                    +{formatInt(result.breakdown.tagBonusDamage)}
                  </span>
                </Row>
              ) : null}
              {result.breakdown.dotDamage > 0 ? (
                <Row label="DoT damage" srLabel="Damage over time (DoT)" nested>
                  <span data-result="dot">{formatInt(result.breakdown.dotDamage)}</span>
                </Row>
              ) : null}
            </>
          ) : appliesDot ? (
            <>
              <Row label="Direct damage" nested>
                <span data-result="direct">{formatInt(result.directDamage)}</span>
              </Row>
              <Row label="DoT damage" srLabel="Damage over time (DoT)" nested>
                <span data-result="dot">{formatInt(result.dotDamage)}</span>
              </Row>
            </>
          ) : null}
          {/* Multiple Dummies: the total's split over the row, each dummy's hits beside it. */}
          {row
            ? row.map((d) => (
                <Row key={d.id} label={`Dummy ${d.number}${d.number === 1 ? ' (primary)' : ''}`} nested>
                  <span data-result="dummy" data-dummy={d.number}>
                    {formatInt(d.stats?.damage ?? 0)}
                    <span className="ml-1 text-xs font-normal text-fg-muted">
                      ({formatInt(d.stats?.hits ?? 0)} {d.stats?.hits === 1 ? 'hit' : 'hits'})
                    </span>
                  </span>
                </Row>
              ))
            : null}
          <Row label="Hits">
            <span data-result="hits">{formatInt(result.hits)}</span>
          </Row>
          <Row label="Crits">
            <span data-result="crits">{formatInt(result.crits)}</span>
            <span className="ml-1 text-xs font-normal text-fg-muted">({critRate}% of hits)</span>
          </Row>
          {usesAmmo ? (
            <Row label="Ammo used">
              <span data-result="ammo">{formatInt(result.ammoConsumed)}</span>
            </Row>
          ) : null}
          {usesMana ? (
            <Row label="Mana used">
              <span data-result="mana">{formatInt(result.manaConsumed)}</span>
            </Row>
          ) : null}
        </dl>
        <p className="mt-2 text-xs text-fg-muted">
          Seed <span className="tabular-nums" data-result="seed">{result.seed}</span> · Run again replays this exact run.
        </p>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap gap-2" data-results-actions="">
        <button type="button" onClick={onRunAgain} className={buttonClass('primary', compact ? 'px-3' : undefined)} data-results-run-again="">
          <Repeat aria-hidden="true" className="size-5" />
          Run again
        </button>
        <button type="button" onClick={onReset} className={buttonClass('secondary', compact ? 'px-3' : undefined)} data-results-reset="">
          <RotateCcw aria-hidden="true" className="size-5" />
          Reset
        </button>
      </div>
    </section>
  )
}

function Row({ label, srLabel, emphasis, nested, children }: { label: string; srLabel?: string; emphasis?: boolean; nested?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={cx('self-center text-fg-muted', emphasis && 'font-semibold text-fg', nested && 'ml-1 border-l-2 border-night-600 pl-2.5 text-xs')} data-result-nested={nested ? '' : undefined}>
        {srLabel ? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">{srLabel}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className={cx('self-center text-right font-semibold whitespace-nowrap text-fg', nested && 'text-xs')}>{children}</dd>
    </>
  )
}
