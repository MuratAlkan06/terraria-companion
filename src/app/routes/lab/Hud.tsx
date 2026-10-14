import { ChartColumn, Crosshair, FlaskConical, Maximize, Minimize, MousePointerClick, OctagonPause, RotateCcw, Snail, Star, Tag, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { hasAssumptions, type Assumptions } from '../../../components/assumptions'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { Toggletip } from '../../../components/Toggletip'
import type { Item, SpriteIndex, Weapon } from '../../../data-access/types'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import type { LabHitSource, LabHudState, LabManaHud, LabSummonsHud, LabTagHud, LabTargetsHud } from '../../../lab/labSession'
import { behaviorFacts } from '../../../lab/labWeapons'
import { getField } from '../../../schemas/getField'
import { APPROXIMATIONS } from '../../../sim'
import { format1, format2, formatInt, HUD_PANEL, HUD_SURFACE, slotNumber } from './hudStyles'
import { LIVE_DPS_LABEL, LIVE_DPS_SHORT, LIVE_DPS_SUMMON_LABEL, LIVE_DPS_SUMMON_SHORT } from './timedTestCopy'

/**
 * HudOverlay (UX_SPEC §3.4) — HTML over the canvas; the canvas itself is aria-hidden, so every
 * meaningful output lives here (§9). EquippedBar top-left with the contextual ManaBar / AmmoCounter
 * under it, StatReadout cluster top-right (with the amber "test mode" chip while mana is ignored,
 * §5.7), the timed tests bottom-left (./TimedTest.tsx), the Graph / Reset / Fullscreen controls
 * bottom-right.
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
          {/* Behavior stats from the params: a thrown weapon's range and flight, a beam's hit rate, a pierce count. */}
          {behaviorFacts(weapon).map((f) => (
            <Fact key={f.key} label={f.label} short={f.short} compact={compact} data={f.key}>
              {compact ? (f.shortValue ?? f.value) : f.value}
            </Fact>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Fact({ label, short, compact, data, children }: { label: string; short: string; compact: boolean; data?: string; children: ReactNode }) {
  return (
    <div className="flex gap-1 whitespace-nowrap" data-fact={data}>
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

/** Who dealt a hit, in a word (the whip's own hits are the "whip"). */
const hitSourceWord = (source: LabHitSource, hud: LabHudState) => (source === 'weapon' ? (hud.weapon.archetype === 'whip' ? 'whip' : 'weapon') : source)

export function StatReadouts({ hud, assumptions, compact }: { hud: LabHudState; assumptions: Assumptions; compact: boolean }) {
  const last = hud.lastHit
  // A mixed run (a whip with the minion loadout): the per-hit label says whose hit it was — "Whip hit",
  // "Minion hit" (design review nit). In the label, not beside the number: a minion's "CRIT" badge
  // already fills the compact column, and the box must not grow with it.
  const hitSource = hud.summons?.source === 'loadout' && last ? hitSourceWord(last.source, hud) : null
  const perHitShown = hitSource ? `${hitSource.charAt(0).toUpperCase()}${hitSource.slice(1)} hit` : undefined
  // Each tip lists what its own number depends on: attacks/sec only the cadence assumptions (a yoyo's
  // hits/sec what decides its hit rate, a summon staff's what decides its summons'); est. DPS all of
  // them, led by what it divides by.
  const hitRate = hud.rateReadout !== 'attacks'
  const summonRate = hud.rateReadout === 'summon-hits'
  const cadence = assumptionsForEstimate(assumptions, summonRate ? 'summon-hits-per-sec' : hitRate ? 'hits-per-sec' : 'attacks-per-sec')
  const rateAssumptions = hasAssumptions(cadence) ? cadence : assumptions
  const dps = assumptionsForEstimate(assumptions, 'estimated-dps')
  const dpsAssumptions = hasAssumptions(dps) ? dps : assumptions
  // Multiple Dummies (PRD P3-S6 AC4): the totals are over all dummies; the primary target's own numbers sit apart.
  const targets = hud.targets
  // With summons out the live estimate divides by the time since the first summon (`dps-with-summons`).
  const dpsLabel = hud.summons ? LIVE_DPS_SUMMON_LABEL : LIVE_DPS_LABEL
  const dpsShort = hud.summons ? LIVE_DPS_SUMMON_SHORT : LIVE_DPS_SHORT
  const dpsContext = hud.summons ? 'estimated DPS since summoning' : 'estimated DPS while attacking'
  return (
    <section aria-label="Live stats" className={cx(PANEL, compact ? 'p-2' : 'p-3')} data-stat-readouts="" data-stat-scope={targets ? 'all-dummies' : 'one-dummy'}>
      {hud.mana?.ignoreMana ? <TestModeChip className={compact ? 'mb-1.5' : 'mb-2'} /> : null}
      {targets && !compact ? (
        <p className="mb-1.5 flex items-center gap-1 text-xs text-fg-muted" data-stat-scope-note="">
          Totals over all {targets.dummies.length} dummies · <Star aria-hidden="true" className="size-3 text-accent" /> dummy 1 is the primary target
        </p>
      ) : null}
      {/* Compact: both columns reserve their width from the first frame — "999 (99 crits)" and
          "8.57 est." — so the box doesn't grow (and squeeze the EquippedBar) as the numbers climb. */}
      <dl
        className={cx(
          'grid gap-y-1 text-sm tabular-nums',
          compact ? 'grid-cols-[minmax(5.25rem,auto)_minmax(4.25rem,auto)] gap-x-2' : 'min-w-52 grid-cols-[auto_auto] gap-x-3',
        )}
      >
        <Readout label={hitSource ? `Per hit, from the ${hitSource}` : 'Per hit'} visibleLabel={perHitShown} short={perHitShown} compact={compact}>
          {last ? (
            <span data-stat="per-hit" data-source={hitSource ? last.source : undefined} className="inline-flex items-center gap-1">
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
        <Readout label={targets ? 'Total damage, all dummies' : 'Total damage'} visibleLabel={targets && !compact ? 'Total damage' : undefined} short="Total" compact={compact}>
          <span data-stat="total">{formatInt(hud.totalDamage)}</span>
        </Readout>
        {targets && !compact ? (
          <Readout label="Total damage, primary target" visibleLabel="Primary target" compact={compact} nested>
            <span data-stat="primary-total">{formatInt(targets.primary.damage)}</span>
          </Readout>
        ) : null}
        <Readout label="Hits" compact={compact}>
          <span data-stat="hits">{formatInt(hud.hits)}</span>
          <span className="ml-1 text-xs font-normal text-fg-muted" data-stat="crits">
            ({formatInt(hud.crits)} crit{hud.crits === 1 ? '' : 's'})
          </span>
        </Readout>
        {/* A yoyo (tethered) is one attack for as long as it is out, hitting all the while: its rate is
            hits/sec. A summon staff attacks through its summons: theirs. */}
        {hitRate ? (
          <Readout label={summonRate ? 'Summon hits/sec' : 'Hits/sec'} short="Hits/s" compact={compact}>
            <span className="inline-flex items-center gap-1">
              <span data-stat="hits-per-sec">{format2(hud.hitsPerSec)}</span>
              <EstimateLabel assumptions={rateAssumptions} context={summonRate ? 'summon hits per second' : 'hits per second'} />
            </span>
          </Readout>
        ) : (
          <Readout label="Attacks/sec" short="Atk/s" compact={compact}>
            <span className="inline-flex items-center gap-1">
              <span data-stat="attacks-per-sec">{format2(hud.attacksPerSec)}</span>
              <EstimateLabel assumptions={rateAssumptions} context="attacks per second" />
            </span>
          </Readout>
        )}
        <Readout
          label={targets ? `${dpsLabel}, all dummies` : dpsLabel}
          visibleLabel={targets && !compact ? dpsLabel : undefined}
          short={targets ? 'DPS, all' : dpsShort}
          compact={compact}
          wide={compact && !targets}
        >
          <span className="inline-flex items-center gap-1">
            <span data-stat="dps">{format1(hud.estimatedDps)}</span>
            <EstimateLabel assumptions={dpsAssumptions} context={targets ? `${dpsContext}, all dummies` : dpsContext} />
          </span>
        </Readout>
        {targets ? (
          <Readout label={`${dpsLabel}, primary target`} visibleLabel={compact ? undefined : 'Primary target'} short="DPS, #1" compact={compact} nested={!compact}>
            <span className="inline-flex items-center gap-1">
              <span data-stat="primary-dps">{format1(targets.primary.estimatedDps)}</span>
              <EstimateLabel assumptions={dpsAssumptions} context={`${dpsContext}, primary target`} />
            </span>
          </Readout>
        ) : null}
      </dl>
    </section>
  )
}

/**
 * One stat: `label` is its full name (screen readers always get it); `visibleLabel` a shorter visible
 * one in the full HUD; `short` the compact HUD's. `nested`: a part of the row above (the primary
 * target's share of a total), indented on a rule.
 */
function Readout({
  label,
  visibleLabel,
  short,
  compact,
  wide,
  nested,
  children,
}: {
  label: string
  visibleLabel?: string
  short?: string
  compact: boolean
  wide?: boolean
  nested?: boolean
  children: ReactNode
}) {
  const shown = visibleLabel ?? label
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
    <div className="contents" data-readout-nested={nested ? '' : undefined}>
      <dt className={cx('py-0.5 text-fg-muted', nested && 'ml-1 border-l-2 border-night-600 pl-2.5 text-xs')}>
        {shown === label ? (
          label
        ) : (
          <>
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{label}</span>
          </>
        )}
      </dt>
      <dd className={cx('py-0.5 text-right font-semibold whitespace-nowrap text-fg', nested && 'text-xs')}>{children}</dd>
    </div>
  )
}

/**
 * Hits per dummy (PRD P3-S6 AC2), Multiple Dummies only: one cell per dummy, nearest first, numbered
 * as the arena labels them, the primary target starred (with words for screen readers). Hits — and
 * damage, where there is room — live. A readout only: it never takes the pointer from the arena.
 */
export function TargetStrip({ targets, compact }: { targets: LabTargetsHud; compact: boolean }) {
  return (
    <section aria-label="Hits per dummy" className={cx(HUD_SURFACE, 'pointer-events-none w-full', compact ? 'p-1' : 'p-1.5')} data-target-strip="">
      <ol className="grid auto-cols-fr grid-flow-col gap-1 text-xs leading-4 tabular-nums">
        {targets.dummies.map((d) => (
          <li
            key={d.id}
            className={cx('flex min-w-0 flex-col items-center border-2 px-1 py-0.5', d.primary ? 'border-gold-600' : 'border-night-600')}
            data-dummy={d.number}
            data-dummy-hits={d.hits}
          >
            <span className="flex items-center gap-0.5 font-semibold text-fg-muted">
              <span aria-hidden="true">#{d.number}</span>
              <span className="sr-only">
                Dummy {d.number}
                {d.primary ? ', the primary target' : ''}:
              </span>
              {d.primary ? <Star aria-hidden="true" className="size-3 text-accent" /> : null}
            </span>
            <span className="font-semibold whitespace-nowrap text-fg">
              <span data-stat="dummy-hits">{formatInt(d.hits)}</span> {d.hits === 1 ? 'hit' : 'hits'}
            </span>
            {compact ? null : (
              <span className="whitespace-nowrap text-fg-muted">
                <span data-stat="dummy-damage">{formatInt(d.damage)}</span> dmg
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** "#1, #3" on screen, "dummies 1 and 3" for screen readers. */
const dummyList = (numbers: readonly number[]) => ({
  shown: numbers.map((n) => `#${n}`).join(', '),
  spoken: numbers.length === 1 ? `dummy ${numbers[0]}` : `dummies ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`,
})

/**
 * SummonsPanel (PRD P3-S9 AC1/AC3, P3-S10 AC1–AC3), readout-only, under the EquippedBar: how many
 * minions / sentries are out against their slots (a staff's own, or the minion loadout's beside a whip),
 * with Multiple Dummies which dummy they attack now (design review M2; a sentry with none in its range
 * says so), which dummies the whip has tagged and the tag's time left — an icon and words, never colour
 * alone — and, when a whip and summons both deal damage, the split by source: the whip's own hits, the
 * summons' hits, and the share of those the tag added (UX: "per-source damage attribution"). `strip`:
 * the compact HUD's version — one wrapping row in the bottom HUD area (like the per-dummy strip), so the
 * top row stays short enough for the phone camera.
 */
export function SummonsPanel({
  summons,
  tags,
  breakdown,
  whip,
  multipleDummies = false,
  compact,
  strip = false,
}: {
  summons: LabSummonsHud | null
  tags: readonly LabTagHud[]
  breakdown: LabHudState['breakdown']
  /** A whip is equipped: the tag row shows (with "no dummy tagged" while none is). */
  whip: boolean
  /** The target is Multiple Dummies: which one the summons attack is worth saying. */
  multipleDummies?: boolean
  compact: boolean
  strip?: boolean
}) {
  if (!summons && !whip) return null
  const noun = summons ? (summons.kind === 'minion' ? 'Minions' : 'Sentries') : ''
  const split = whip && summons && breakdown
  // The summons' target: with a row, which dummy; a sentry with no dummy in its range, that it has none.
  const attacking =
    summons && summons.count > 0
      ? summons.targets.length > 0
        ? multipleDummies
          ? dummyList(summons.targets)
          : null
        : summons.kind === 'sentry'
          ? 'none'
          : null
      : null
  return (
    <section
      aria-label="Summons and whip tags"
      className={cx(HUD_SURFACE, 'pointer-events-none text-xs', strip ? 'flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 p-1' : cx('w-full max-w-64', compact ? 'p-1.5' : 'p-2'))}
      data-summons-panel={strip ? 'strip' : 'column'}
    >
      {summons ? (
        <p className="flex items-center gap-1.5 text-fg-muted tabular-nums" data-summon-count={summons.count} data-summon-slots={summons.slots}>
          <Users aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
          <span>
            <span className="font-semibold text-fg">{noun}</span>{' '}
            <span className="font-semibold text-fg" data-stat="summon-count">
              {summons.count}
            </span>
            {' · slots '}
            <span className="font-semibold text-fg" data-stat="summon-slots">
              {slotNumber(summons.slotsUsed)}/{summons.slots}
            </span>
            {summons.loadoutName && !strip ? (
              <span className={cx('text-fg-muted', compact ? 'block' : '')} data-summon-loadout="">
                {compact ? '' : ' · '}
                {summons.loadoutName}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      {attacking ? (
        <p className={cx('flex items-center gap-1.5 text-fg-muted tabular-nums', !strip && 'mt-1')} data-summon-attacking={attacking === 'none' ? 'none' : summons?.targets.join(',')}>
          <Crosshair aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
          {attacking === 'none' ? (
            <span>No dummy in range</span>
          ) : (
            <span>
              <span className="font-semibold text-fg">Attacking</span> <span aria-hidden="true">{attacking.shown}</span>
              <span className="sr-only">{attacking.spoken}</span>
            </span>
          )}
        </p>
      ) : null}
      {whip ? (
        <p className={cx('flex items-center gap-1.5 text-fg-muted tabular-nums', summons && !strip && 'mt-1')} data-whip-tags={tags.length}>
          <Tag aria-hidden="true" className="size-3.5 shrink-0 text-success" />
          {tags.length === 0 ? (
            <span>No dummy tagged</span>
          ) : (
            <span>
              <span className="font-semibold text-fg">Tagged</span>{' '}
              {tags.map((t, i) => (
                <span key={t.dummyId} data-tag-dummy={t.number}>
                  {i > 0 ? ', ' : ''}
                  <span aria-hidden="true">#{t.number}</span>
                  <span className="sr-only">dummy {t.number}</span> <span className="font-semibold text-fg">{t.remainingSec.toFixed(1)}s</span>
                  <span className="sr-only"> left</span>
                </span>
              ))}
            </span>
          )}
        </p>
      ) : null}
      {split ? (
        <dl className={cx('flex flex-wrap gap-x-2.5 text-fg-muted tabular-nums', !strip && 'mt-1')} data-damage-split="">
          <Fact label="Whip damage" short="Whip" compact={compact} data="whip-damage">
            <span data-stat="weapon-damage">{formatInt(breakdown.weaponDamage)}</span>
          </Fact>
          <Fact label="Minion damage" short="Minions" compact={compact} data="summon-damage">
            <span data-stat="summon-damage">{formatInt(breakdown.summonDamage)}</span>
          </Fact>
          <Fact label="Tag bonus" short="Tag" compact={compact} data="tag-bonus">
            <span className="text-success" data-stat="tag-bonus">
              +{formatInt(breakdown.tagBonusDamage)}
            </span>
          </Fact>
          {breakdown.dotDamage > 0 ? (
            <Fact label="Damage over time" short="DoT" compact={compact} data="dot-damage">
              <span data-stat="dot-damage">{formatInt(breakdown.dotDamage)}</span>
            </Fact>
          ) : null}
        </dl>
      ) : null}
    </section>
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

/**
 * First-use hint; gone once the first attack of the session starts. `verb`: "swing", "thrust"…;
 * `steer`: a weapon that follows the pointer while held (a yoyo, a held beam) says so.
 */
export function AttackHint({
  touch,
  verb = 'swing',
  steer = null,
  summon = null,
}: {
  touch: boolean
  verb?: string
  steer?: 'yoyo' | 'beam' | null
  /** A summon staff: one press summons where you click (P3-S9) — a minion, or a sentry that stays there. */
  summon?: 'minion' | 'sentry' | null
}) {
  const follow = steer ? (touch ? ' — drag to steer it' : ' — move to steer it') : ''
  const what = summon === 'sentry' ? 'place a sentry' : 'summon a minion'
  return (
    <p className={cx(PANEL, 'pointer-events-none flex items-center gap-2 px-2 py-1 text-xs text-fg md:text-sm')} data-attack-hint="">
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0 text-accent" />
      {summon
        ? touch
          ? `Tap the arena to ${what} there`
          : `Click the arena to ${what} there · or press Space`
        : touch
          ? `Touch and hold the arena to ${verb}${follow}`
          : `Press and hold to ${verb}${follow} · or hold Space`}
    </p>
  )
}

/**
 * "ignore mana (test mode)" is on (UX_SPEC §5.7): a persistent amber chip in the StatReadout
 * cluster — filled, with an icon and words, so it never reads as the outlined "est." chip.
 */
export function TestModeChip({ className }: { className?: string }) {
  return (
    <p
      className={cx('flex w-fit items-center gap-1.5 border-2 border-gold-300 bg-gold-500 px-1.5 text-xs leading-5 font-bold text-fg-on-accent', className)}
      data-test-mode-chip=""
    >
      <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
      Test mode: ignoring mana
    </p>
  )
}

/** The engine's low-mana rule, with its wiki source (AMENDMENTS-008 B35: the Lab labels the 40% behavior). */
const LOW_MANA_RULE = APPROXIMATIONS['insufficient-mana']
export const LOW_MANA_LABEL = 'Low mana: 40% speed (game behavior)'
/** "Stop at zero" (named as in the settings) without regeneration: casting stops for good (until a reset). */
export const OUT_OF_MANA_LABEL = 'Stop at zero: casting stopped (test setting)'
/** "Stop at zero" with regeneration: casting waits until mana covers the cost (the setting's own words). */
export const OUT_OF_MANA_WAIT_LABEL = 'Stop at zero: casting waits for mana (test setting)'
/** A label split before its closing parenthesis, which is kept on one line ("(game / behavior)" read badly). */
const keepParenthesis = (label: string): readonly [string, string] => {
  const at = label.lastIndexOf(' (')
  return [label.slice(0, at), label.slice(at + 1)]
}
const LOW_MANA_COPY = keepParenthesis(LOW_MANA_LABEL)
const OUT_OF_MANA_COPY = keepParenthesis(OUT_OF_MANA_LABEL)
const OUT_OF_MANA_WAIT_COPY = keepParenthesis(OUT_OF_MANA_WAIT_LABEL)

/** Which low-mana notice shows (none, the B35 slow cast, or stop at zero waiting / stopped). */
type LowManaNotice = 'none' | 'slow-cast' | 'stop-wait' | 'stop'

function lowManaNotice(mana: LabManaHud): LowManaNotice {
  if (!mana.warning) return 'none'
  if (mana.policy === 'slow-cast') return 'slow-cast'
  return mana.regen ? 'stop-wait' : 'stop'
}

/** The shown notice's words: the ManaBar's meter is described by them, wherever the notice sits. */
const noticeTextId = (kind: Exclude<LowManaNotice, 'none'>) => `lab-mana-notice-${kind}`

/**
 * ManaBar (UX_SPEC §3.4, contextual: weapons with a mana cost): the engine's pool as a meter, the
 * cost per cast, "Mana used" since the last reset, and — while the latched low-mana warning is on —
 * what happens instead, labeled: the game's 40% slow cast (default, with its wiki source in a tip)
 * or the "stop at zero" test setting (casting waits for mana while it regenerates, else stops).
 * The notice's room is ALWAYS laid out (design review P3-S4/S5 B1): every notice is stacked in one
 * cell, only the current one visible, so the HUD — and the phone camera framed below it — never
 * changes height when the warning comes or goes. The full HUD keeps that cell in the card; the
 * compact HUD moves it out (`inlineNotice` false) into the stats column beside the card, as a
 * callout pointing at it (`LowManaCallout`), so the card — and the HUD row — stay short enough for
 * the phone camera's 2× zoom (and keeps no room while mana is ignored: no warning can show then).
 * Either way the meter is described by the notice on show.
 */
export function ManaBar({ mana, manaConsumed, compact, inlineNotice = true }: { mana: LabManaHud; manaConsumed: number; compact: boolean; inlineNotice?: boolean }) {
  const fill = mana.max > 0 ? Math.min(1, Math.max(0, mana.current / mana.max)) : 0
  const costMark = mana.max > 0 ? Math.min(1, mana.costPerUse / mana.max) : 0
  const notice = lowManaNotice(mana)
  return (
    <section aria-label="Mana bar" className={cx(PANEL, 'w-full max-w-64', compact ? 'p-1.5' : 'p-2')} data-mana-bar="" data-low-mana-notice={notice}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-fg-muted tabular-nums">
        <span className="font-semibold tracking-wide uppercase">Mana</span>
        <span>
          <span className="font-semibold text-fg" data-stat="mana">
            {formatInt(mana.current)}
          </span>
          <span aria-hidden="true"> / </span>
          <span className="sr-only"> of </span>
          <span data-stat="mana-max">{formatInt(mana.max)}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Mana"
        aria-valuemin={0}
        aria-valuemax={mana.max}
        aria-valuenow={mana.current}
        aria-valuetext={`${mana.current} of ${mana.max}`}
        aria-describedby={notice === 'none' ? undefined : noticeTextId(notice)}
        className="relative mt-1 h-3 border-2 border-night-600 bg-night-900"
      >
        <span aria-hidden="true" className={cx('absolute inset-y-0 left-0', mana.warning ? 'bg-night-600' : 'bg-night-400')} style={{ width: `${fill * 100}%` }} />
        {/* One cast's cost: below this mark the next cast can't be paid. */}
        <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-fg-muted" style={{ left: `${costMark * 100}%` }} data-mana-cost-mark="" />
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-2.5 text-xs text-fg-muted tabular-nums">
        <Fact label="Cost per cast" short="Cost" compact={compact}>
          {mana.costPerUse}
        </Fact>
        <Fact label="Mana used" short="Used" compact={compact}>
          {/* Room for "9,999" from the first frame: a growing count never re-wraps the row (or moves the camera). */}
          <span className="inline-block min-w-[5ch]" data-stat="mana-used">
            {formatInt(manaConsumed)}
          </span>
        </Fact>
      </dl>
      {inlineNotice ? <LowManaSlot notice={notice} className="mt-1" /> : null}
    </section>
  )
}

/**
 * The compact HUD's low-mana notice (see ManaBar): in the stats column, bottom-aligned with the
 * ManaBar beside it — framed in the chip's gold with a pixel pointer at its left edge, toward the
 * card. Its room is always laid out, like the card's own cell.
 */
export function LowManaCallout({ mana }: { mana: LabManaHud }) {
  const notice = lowManaNotice(mana)
  // As wide as the stats box above it, never wider (w-0 + min-w-full: no say in the column's width);
  // the pointer sticks out into the gap between the columns.
  return <LowManaSlot notice={notice} callout className="w-0 min-w-full" data-low-mana-notice={notice} />
}

/**
 * Every notice in one grid cell: the cell is as tall as the tallest, shown or not. Hidden ones are
 * `invisible` (out of the accessibility tree and the tab order).
 */
function LowManaSlot({ notice, callout = false, className, ...data }: { notice: LowManaNotice; callout?: boolean; className?: string; 'data-low-mana-notice'?: LowManaNotice }) {
  return (
    <div className={cx('grid text-xs', className)} data-low-mana-slot="" {...data}>
      <LowManaIndicator shown={notice === 'slow-cast'} callout={callout} />
      <StopAtZeroNotice kind="stop-wait" copy={OUT_OF_MANA_WAIT_COPY} shown={notice === 'stop-wait'} callout={callout} />
      <StopAtZeroNotice kind="stop" copy={OUT_OF_MANA_COPY} shown={notice === 'stop'} callout={callout} />
    </div>
  )
}

/**
 * The callout: on the HUD panel's surface, as it floats over the arena (`CALLOUT_SURFACE`), framed
 * by the slow-cast chip's gold edge (the stop-at-zero notices take the same one there:
 * `CALLOUT_EDGE`), with a pixel arrowhead sticking out of its left edge toward the ManaBar.
 */
const CALLOUT_SURFACE = 'pointer-events-auto w-fit bg-night-950/95'
const CALLOUT_EDGE = 'border-2 border-gold-600 px-1'

/**
 * The callout's pointer: a stepped pixel arrowhead in the HUD's 2 px pixel unit (columns 12, 8 and
 * 4 px tall), centred on the notice's left edge and reaching into the gap toward the ManaBar.
 * `bordered`: the parent draws the gold edge itself, so the pointer starts outside that border.
 */
function CalloutPointer({ bordered = false }: { bordered?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 6 12"
      className={cx('absolute top-1/2 h-3 w-1.5 -translate-y-1/2 text-gold-600', bordered ? 'right-[calc(100%+--spacing(0.5))]' : 'right-full')}
      shapeRendering="crispEdges"
      data-callout-pointer=""
    >
      <path d="M4 0h2v12H4zM2 2h2v8H2zM0 4h2v4H0z" fill="currentColor" />
    </svg>
  )
}

/** A label whose closing parenthesis never breaks from its words; `id`: what the meter's description points at. */
function NoticeText({ copy, id }: { copy: readonly [string, string]; id?: string }) {
  return (
    <span id={id}>
      {copy[0]} <span className="whitespace-nowrap">{copy[1]}</span>
    </span>
  )
}

/**
 * "Stop at zero" in effect (a labeled test setting): casting waits for mana, or has stopped. As a
 * callout (the narrow stats column) the icon flows with the words, so they wrap under it: two lines,
 * where an icon column would push "casting waits for mana" onto a third.
 */
function StopAtZeroNotice({ kind, copy, shown, callout }: { kind: 'stop' | 'stop-wait'; copy: readonly [string, string]; shown: boolean; callout: boolean }) {
  return (
    <p
      className={cx('leading-4 font-semibold text-fg [grid-area:1/1]', callout ? cx('relative', CALLOUT_SURFACE, CALLOUT_EDGE) : 'flex items-start gap-1.5', !shown && 'invisible')}
      data-low-mana={kind}
      data-shown={shown}
    >
      {callout ? <CalloutPointer bordered /> : null}
      <OctagonPause aria-hidden="true" className={cx('size-3.5 shrink-0 text-accent', callout && 'mr-1.5 inline-block align-[-0.1875rem]')} />
      <NoticeText copy={copy} id={shown ? noticeTextId(kind) : undefined} />
    </p>
  )
}

const LOW_MANA_CHIP = 'inline-flex items-start gap-1.5 border-2 border-gold-600 px-1 text-left leading-4 font-semibold text-accent'

/**
 * The 40% slow cast in effect (B35), with the wiki-sourced rule one tap / hover away. While hidden
 * it keeps its room as a plain, invisible copy of the chip (no tip that could stay open behind it).
 */
function LowManaIndicator({ shown, callout }: { shown: boolean; callout: boolean }) {
  const text = (
    <>
      <Snail aria-hidden="true" className="size-3.5 shrink-0" />
      <NoticeText copy={LOW_MANA_COPY} id={shown ? noticeTextId('slow-cast') : undefined} />
    </>
  )
  // The callout is the chip itself (its frame is the chip's gold edge); its row carries the pointer.
  const chip = cx(LOW_MANA_CHIP, callout && CALLOUT_SURFACE)
  return (
    <p className={cx('[grid-area:1/1]', callout && 'relative flex', !shown && 'invisible')} data-low-mana="slow-cast" data-shown={shown}>
      {callout ? <CalloutPointer /> : null}
      {shown ? (
        <Toggletip
          data={{ 'data-low-mana-tip': '' }}
          className={cx(chip, 'hover:bg-night-800')}
          label={
            <>
              {text}
              <span className="sr-only"> — show the rule and its source</span>
            </>
          }
        >
          <p className="font-semibold text-fg">{LOW_MANA_RULE.title}</p>
          <p className="text-xs text-fg-muted">{LOW_MANA_RULE.detail}</p>
          {LOW_MANA_RULE.sourceUrl ? <ProvenanceLink href={LOW_MANA_RULE.sourceUrl} label="Mana, on the wiki" className="text-xs" /> : null}
        </Toggletip>
      ) : (
        <span className={chip}>{text}</span>
      )}
    </p>
  )
}

/** AmmoCounter (UX_SPEC §3.4, contextual: bows and guns): the loaded ammo and "Ammo used" since the last reset. */
export function AmmoCounter({ ammo, sprites, used, compact }: { ammo: Item; sprites: SpriteIndex | null; used: number; compact: boolean }) {
  const damage = ammo.ammoStats?.damage
  return (
    <section aria-label="Ammo counter" className={cx(PANEL, 'flex max-w-64 items-center gap-2', compact ? 'p-1.5' : 'p-2')} data-ammo-counter="">
      <span className="grid shrink-0 place-items-center border-2 border-slot-border bg-slot">
        <SpriteImg src={ammo.sprite} sprites={sprites} placeholder="ranged" box={compact ? 20 : 24} maxScale={1} />
      </span>
      <div className="min-w-0 text-xs leading-tight">
        <p className="line-clamp-2 font-semibold text-fg" title={ammo.name}>
          <span className="sr-only">Loaded ammo: </span>
          {ammo.name}
          {/* "+8 dmg" never breaks over two lines; the separator stays with the name. */}
          {damage !== undefined ? (
            <span className="font-normal text-fg-muted">
              {' · '}
              <span className="whitespace-nowrap">+{damage} dmg</span>
            </span>
          ) : null}
        </p>
        <p className="text-fg-muted tabular-nums">
          Ammo used <span className="font-semibold text-fg" data-stat="ammo-used">{formatInt(used)}</span>
        </p>
      </div>
    </section>
  )
}
