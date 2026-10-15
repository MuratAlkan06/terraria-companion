import { ChevronDown, Lock, RotateCcw, Repeat } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { AssumptionChip } from '../../../components/AssumptionChip'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { InventoryGrid } from '../../../components/InventoryGrid'
import { ItemSlot } from '../../../components/ItemSlot'
import { PixelPanel } from '../../../components/PixelPanel'
import { DEMON_HEART_GATE_NODE, DEMON_HEART_SOURCE } from '../../../scoring/constants'
import { buildAssumption } from '../../../scoring/builderCopy'
import { ACCESSORY_SLOT_IDS, AMMO_SLOT_IDS, BUFF_SLOT_IDS, type AltView, type BuilderResult, type PickView, type Pins, type SlotGroup, type SlotId, type SlotResult } from '../../../scoring/recommend'
import { STAGES, type Stage } from '../../stages'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { GateGroup, Segments } from '../bosses/readiness/ReadinessFactorCard'
import { segmentContext } from '../bosses/readiness/readinessUi'
import { READINESS_CLASSES } from '../../../storage/readiness'
import type { LoadoutClass } from '../../../schemas'
import * as copy from './loadoutCopy'
import { AvailabilityChips, FIELD, FixedPicksWarning, ItemName, ItemSquare, LABEL, NoAmmoLine, RebuiltNotice, ScoreFigure, ZeroPointsTag } from './LoadoutBits'
import { pinCount, slotCardId, slotLabel, swapButtonId, type EffectiveInputs } from './loadoutModel'

/**
 * Step 2 — the loadout (PRD P4-S2 AC2–AC5; UX_SPEC §3.5 Step2 RecommendationView, §7 Builder row):
 * an equip-screen overview (InventoryGrid of ItemSlots with Terraria tooltips; a tap jumps to the
 * pick), the regenerate bar (stage / class rebuild in place), then one card per slot: the item linked
 * to its page, its availability as the builder's progress makes it, its score with the "est." chip
 * where it is an estimate, a 1–2 line rationale, and "How was this scored?" — the formula, its parts,
 * every effect counted or why not, the next-highest candidates (ties marked; "Use this" swaps one in)
 * and what the slot was scored from. Swap opens the slot's whole ranked pool.
 * AMENDMENTS-016 B108: the bar warns before a rebuild resets fixed picks and says so visibly after (H1);
 * a pinned pick's list reads "other candidates" with the higher-scoring ones marked (H2); 0-point picks
 * are named (H4); 768+ lays the overview beside the cards (M5); every overview square names its slot
 * and jumps to it, empty or locked ones too (M6).
 */
export interface LoadoutStepProps {
  page: ReadinessPageData
  result: BuilderResult
  eff: EffectiveInputs
  /** The user's own picks (swaps / a loaded build): a pinned slot offers "Back to the recommendation". */
  pins: Pins
  headingId: string
  /** B108 H1: the visible "fixed picks were reset" notice after a rebuild (null: none). */
  rebuiltNotice?: string | null
  onDismissRebuilt?: () => void
  onRegenerate: (change: { stage?: Stage; cls?: LoadoutClass }) => void
  onSwap: (slot: SlotId) => void
  onUse: (slot: SlotId, alt: AltView) => void
  onReset: (slot: SlotId) => void
  onResetAll: () => void
}

const GROUP_ORDER: readonly SlotGroup[] = ['weapons', 'armor', 'accessories', 'ammo', 'buffs', 'summon']

export function LoadoutStep(props: LoadoutStepProps) {
  const { page, result, eff } = props
  const [selected, setSelected] = useState<SlotId | null>(null)
  const jump = (slot: SlotId) => {
    setSelected(slot)
    const card = document.getElementById(slotCardId(slot))
    card?.scrollIntoView({ block: 'start', behavior: 'auto' })
    card?.focus({ preventScroll: true })
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-start lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-6">
      <div className="space-y-4 md:sticky md:top-36">
        <Overview page={page} result={result} selected={selected} onSelect={jump} />
        <RegenerateBar eff={eff} onRegenerate={props.onRegenerate} fixedPicks={pinCount(props.pins)} rebuiltNotice={props.rebuiltNotice ?? null} onDismiss={() => props.onDismissRebuilt?.()} />
        {Object.keys(props.pins).length > 0 ? (
          <div data-pins={Object.keys(props.pins).length} className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>{copy.swapsCount(Object.keys(props.pins).length)}</span>
            <button type="button" onClick={props.onResetAll} className={buttonClass('secondary', 'min-h-tap text-sm')}>
              <RotateCcw aria-hidden="true" className="size-4" />
              {copy.CLEAR_PICKS}
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-w-0 space-y-5">
        {result.notices.length > 0 ? (
          <div role="status" data-notices="" className="border-l-4 border-gold-600 bg-night-900 px-4 py-3 text-sm">
            <p className="font-semibold">{copy.NOTICES_TITLE}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-muted">
              {result.notices.map((n, i) => (
                <li key={i}>
                  <Segments segments={n} ctx={segmentContext(page, {})} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {GROUP_ORDER.map((group) => {
          const slots = result.slots.filter((s) => s.group === group)
          if (slots.length === 0) return null
          return (
            <section key={group} aria-labelledby={`loadout-group-${group}`} className="space-y-2" data-group={group}>
              <h3 id={`loadout-group-${group}`} className="font-display text-xs leading-relaxed text-accent text-shadow-pixel md:text-sm">
                {copy.GROUPS[group]}
              </h3>
              <div className="grid gap-2">
                {slots.map((s) => (
                  <SlotCard key={s.id} {...props} slot={s} highlighted={selected === s.id} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** A slot's short name inside an overview square (B108 M6). */
function shortLabel(slot: SlotId): string {
  if (slot === 'main' || slot === 'alt' || slot === 'summon') return copy.OVERVIEW_SHORT[slot]
  const acc = (ACCESSORY_SLOT_IDS as readonly string[]).indexOf(slot)
  if (acc >= 0) return copy.accessoryShort(acc + 1)
  const ammo = (AMMO_SLOT_IDS as readonly string[]).indexOf(slot)
  if (ammo >= 0) return copy.ammoShort(ammo + 1)
  return copy.buffShort((BUFF_SLOT_IDS as readonly string[]).indexOf(slot) + 1)
}

const PIECES = ['head', 'body', 'legs'] as const

/**
 * The equip-screen overview: every slot as a square (tooltips on hover / focus). B108 M6: every square
 * names its slot — filled ones in their accessible name, empty and locked ones visibly too — and every
 * square, empty and locked included, jumps to the slot's card.
 */
function Overview({ page, result, selected, onSelect }: { page: ReadinessPageData; result: BuilderResult; selected: SlotId | null; onSelect: (slot: SlotId) => void }) {
  const squares: ReactNode[] = []
  const blank = (key: string, slot: SlotId, short: string, full: string, locked = false) => (
    <button
      key={key}
      type="button"
      onClick={() => onSelect(slot)}
      aria-label={locked ? copy.overviewLocked(full) : copy.overviewEmpty(full)}
      aria-pressed={selected === slot}
      data-overview={locked ? 'locked' : 'empty'}
      data-overview-slot={slot}
      className={cx(
        'grid size-slot shrink-0 place-items-center border-2 border-dashed transition-[background-color,transform] duration-(--dur-press) ease-out-strong hover:bg-slot-hover active:scale-[0.97]',
        selected === slot ? 'border-slot-selected bg-slot-hover shadow-slot-selected' : locked ? 'border-earth-600 bg-night-900' : 'border-slot-border bg-slot',
      )}
    >
      {locked ? <Lock aria-hidden="true" className="size-5 text-gate" /> : <span aria-hidden="true" className="px-0.5 text-center text-[0.6875rem] leading-tight font-semibold text-fg-muted">{short}</span>}
    </button>
  )
  for (const s of result.slots) {
    if (s.group === 'ammo' && s.state !== 'pick') continue
    const pick = s.pick
    const full = slotLabel(s.id, s.demonHeart)
    if (s.state === 'locked') squares.push(blank(s.id, s.id, shortLabel(s.id), full, true))
    else if (s.id === 'armor') {
      PIECES.forEach((piece, i) => {
        const pieceId = pick?.pieces?.[i]
        squares.push(
          pieceId ? (
            <ItemSquare key={`armor-${piece}`} page={page} id={pieceId} slotLabel={copy.ARMOR_PIECE_LABELS[piece]} onSelect={() => onSelect('armor')} selected={selected === 'armor'} />
          ) : (
            blank(`armor-${piece}`, 'armor', copy.OVERVIEW_SHORT[piece], copy.ARMOR_PIECE_LABELS[piece])
          ),
        )
      })
    } else if (pick) squares.push(<ItemSquare key={s.id} page={page} id={pick.id} slotLabel={full} onSelect={() => onSelect(s.id)} selected={selected === s.id} />)
    else squares.push(blank(s.id, s.id, shortLabel(s.id), full))
  }
  return (
    <PixelPanel padded={false} className="space-y-2 p-3" data-overview="">
      <p className={LABEL}>{copy.OVERVIEW_LABEL}</p>
      <InventoryGrid label={copy.OVERVIEW_LABEL} columns={5}>
        {squares}
      </InventoryGrid>
      <p className="text-xs text-fg-muted">{copy.OVERVIEW_HINT}</p>
    </PixelPanel>
  )
}

/** UX_SPEC §3.5 RegenerateBar: changing stage or class rebuilds a stage-legal loadout in place. */
function RegenerateBar({
  eff,
  onRegenerate,
  fixedPicks,
  rebuiltNotice,
  onDismiss,
}: {
  eff: EffectiveInputs
  onRegenerate: LoadoutStepProps['onRegenerate']
  fixedPicks: number
  rebuiltNotice: string | null
  onDismiss: () => void
}) {
  const id = useId()
  const warnId = `${id}warning`
  const describedBy = fixedPicks > 0 ? warnId : undefined
  return (
    <PixelPanel padded={false} className="space-y-3 p-3" data-regenerate="">
      <p className={LABEL}>{copy.REGENERATE_TITLE}</p>
      {rebuiltNotice ? <RebuiltNotice text={rebuiltNotice} onDismiss={onDismiss} /> : null}
      {fixedPicks > 0 ? <FixedPicksWarning id={warnId} text={copy.rebuildWarning(fixedPicks)} /> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
        <div className="space-y-1">
          <label htmlFor={`${id}stage`} className="text-xs text-fg-muted">
            {copy.STAGE_LABEL}
          </label>
          <select id={`${id}stage`} value={eff.stage} aria-describedby={describedBy} onChange={(e) => onRegenerate({ stage: e.target.value as Stage })} className={FIELD}>
            {STAGES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}class`} className="text-xs text-fg-muted">
            {copy.CLASS_LABEL}
          </label>
          <select id={`${id}class`} value={eff.cls} aria-describedby={describedBy} onChange={(e) => onRegenerate({ cls: e.target.value as LoadoutClass })} className={FIELD}>
            {READINESS_CLASSES.map((c) => (
              <option key={c} value={c}>
                {copy.CLASS_NAMES[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </PixelPanel>
  )
}

function SlotCard(props: LoadoutStepProps & { slot: SlotResult; highlighted: boolean }) {
  const { slot: s, page, highlighted } = props
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const label = slotLabel(s.id, s.demonHeart)
  const pick = s.pick
  const ctx = segmentContext(page, {})
  const pinned = props.pins[s.id] !== undefined
  const nodeName = (n: string) => page.graph.nodeById.get(n)?.name ?? n
  const canSwap = s.state !== 'locked' && (s.pool?.eligible ?? 0) > 0
  return (
    <article
      id={slotCardId(s.id)}
      tabIndex={-1}
      aria-labelledby={`${bodyId}label`}
      data-slot={s.id}
      data-state={s.state}
      className={cx('flex scroll-mt-36 gap-3 border-2 bg-night-900 p-2.5 focus:outline-2 focus:outline-offset-2 focus:outline-ring md:p-3', highlighted ? 'border-gold-400' : 'border-panel-border', s.state === 'locked' && 'border-dashed border-earth-600')}
    >
      <div className="shrink-0">
        {s.state === 'locked' ? (
          <span aria-hidden="true" className="grid size-slot place-items-center border-2 border-slot-border bg-slot">
            <Lock className="size-5 text-gate" />
          </span>
        ) : pick ? (
          <ItemSquare page={page} id={pick.id} />
        ) : (
          <ItemSlot />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 id={`${bodyId}label`} className={LABEL}>
            {label}
          </h4>
          {s.quota ? <span className="border border-stone-600 px-1 text-[0.6875rem] leading-4 font-semibold text-fg-muted">{copy.quotaTag(s.fallback ? copy.FALLBACK_TAG : copy.QUOTA_CHIP[s.quota])}</span> : null}
          {s.demonHeart && s.state !== 'locked' ? (
            <AssumptionChip label={copy.DEMON_HEART_CHIP} title={buildAssumption.demonHeart(DEMON_HEART_SOURCE).title} detail={buildAssumption.demonHeart(DEMON_HEART_SOURCE).detail} sourceUrl={DEMON_HEART_SOURCE} />
          ) : null}
          {pick?.source === 'pinned' ? <span className="border border-gold-600 px-1 text-[0.6875rem] leading-4 font-semibold text-accent" data-pinned="">{copy.YOUR_PICK}</span> : null}
          {pick?.zeroPoints ? <ZeroPointsTag /> : null}
        </div>
        {pick ? (
          <>
            <p className="text-base leading-snug">
              <ItemName page={page} id={pick.id} name={pick.name} tap />
            </p>
            {pick.pieces ? <PieceList page={page} pick={pick} /> : null}
            <AvailabilityChips page={page} availability={pick.availability} ownedUnknown={pick.ownedUnknown} id={pick.id} />
            {pick.score ? (
              <p className="text-sm">
                <span className="sr-only">{copy.SCORE_FOR} </span>
                <ScoreFigure score={pick.score} />
                <span className="ml-1.5 text-xs text-fg-muted">{pick.score.label}</span>
              </p>
            ) : (
              <p className="text-sm text-fg-muted" data-not-scored="">
                {copy.NOT_SCORED_PIN((pick.scoreMissing ?? []).join(', '))}
              </p>
            )}
            {pick.score?.qualifier ? (
              <p className="text-xs text-fg-muted" data-qualifier="">
                {pick.score.qualifier}
              </p>
            ) : null}
            <NoAmmoLine score={pick.score} />
            <p className="text-sm leading-relaxed text-fg-muted" data-rationale="">
              <Segments segments={pick.rationale} ctx={ctx} />
            </p>
          </>
        ) : (
          <>
            {s.state === 'locked' ? (
              <p className="flex flex-wrap items-center gap-1.5">
                <GateGroup gates={[DEMON_HEART_GATE_NODE]} ctx={{ bossName: nodeName }} />
              </p>
            ) : null}
            <p className="text-sm leading-relaxed" data-empty="">
              <Segments segments={s.empty ?? []} ctx={ctx} />
            </p>
          </>
        )}
        {s.state !== 'locked' ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {pick || s.pool ? (
              <button type="button" aria-expanded={open} aria-controls={`${bodyId}body`} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-tap items-center gap-1.5 px-1 text-sm font-semibold text-link hover:text-accent-strong" data-breakdown-toggle={s.id}>
                <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform duration-(--dur-ui)', open && 'rotate-180')} />
                {open ? copy.HIDE_SCORE : copy.HOW_SCORED}
              </button>
            ) : null}
            {canSwap ? (
              <button type="button" id={swapButtonId(s.id)} onClick={() => props.onSwap(s.id)} aria-label={copy.swapSr(label)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-swap={s.id}>
                <Repeat aria-hidden="true" className="size-4" />
                {copy.SWAP}
              </button>
            ) : null}
            {pinned ? (
              <button type="button" onClick={() => props.onReset(s.id)} aria-label={copy.resetPickSr(label)} className="inline-flex min-h-tap items-center gap-1.5 px-1 text-sm font-semibold text-link hover:text-accent-strong" data-reset={s.id}>
                <RotateCcw aria-hidden="true" className="size-4" />
                {copy.RESET_PICK}
              </button>
            ) : null}
          </div>
        ) : null}
        {open ? (
          <div id={`${bodyId}body`} className="space-y-3 border-t-2 border-panel-border pt-3 text-sm" data-breakdown={s.id}>
            {pick?.score ? <PickBreakdown pick={pick} /> : null}
            {s.alternatives.length > 0 || pick ? <Alternatives {...props} label={label} /> : null}
            {s.disclosure ? (
              <div>
                <p className={LABEL}>{copy.POOL}</p>
                <p className="mt-1 text-fg-muted" data-disclosure="">
                  <Segments segments={s.disclosure} ctx={ctx} />
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

/** A set's three pieces, each linked. */
function PieceList({ page, pick }: { page: ReadinessPageData; pick: PickView }) {
  const ids = (pick.pieces ?? []).filter((x) => x > 0)
  return (
    <p className="text-xs text-fg-muted">
      {copy.PIECES}{' '}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? ', ' : ''}
          <ItemName page={page} id={id} className="font-normal" />
        </span>
      ))}
    </p>
  )
}

/** "How was this scored?": the formula, its parts (weights where they apply) and every effect. */
function PickBreakdown({ pick }: { pick: PickView }) {
  const score = pick.score
  if (!score) return null
  const counted = score.effects
  return (
    <>
      <div>
        <p className={LABEL}>{copy.FORMULA}</p>
        <p className="mt-1 font-semibold tabular-nums" data-formula="">
          {score.formulaText}
        </p>
      </div>
      {score.terms.length > 0 ? (
        <div>
          <p className={LABEL}>{copy.PARTS}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {score.terms.map((t) => (
              <div key={t.label} className="contents">
                <dt className="text-fg-muted">{t.label}</dt>
                <dd className="tabular-nums">
                  {t.value}
                  {t.weight !== undefined && t.contribution !== undefined ? <span className="ml-1.5 text-fg-muted">{copy.weightTerm(String(t.weight), t.contribution)}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {counted.length > 0 ? (
        <div>
          <p className={LABEL}>{copy.EFFECTS}</p>
          <ul className="mt-1 space-y-1">
            {counted.map((e, i) => (
              <li key={i} data-effect={e.status} className="flex flex-wrap items-baseline gap-x-2">
                <span className={e.status === 'special' || e.status === 'special-mismatch' ? 'italic' : undefined}>{e.status === 'special' || e.status === 'special-mismatch' ? `“${e.text}”` : e.text}</span>
                {e.from ? <span className="text-xs text-fg-muted">({e.from})</span> : null}
                <span className={cx('text-xs', e.status === 'counted' ? 'text-success' : 'text-fg-muted')}>{e.status === 'counted' && e.points ? `${e.points}` : copy.effectStatus[e.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

/**
 * The next-highest candidates (ties marked); "Use this" swaps one into the slot. Under a pinned pick
 * (B108 H2) the list is "other candidates", and any scoring above the pick is marked so.
 */
export function Alternatives(props: LoadoutStepProps & { slot: SlotResult; label: string }) {
  const { slot: s, page, label } = props
  const pinned = s.pick?.source === 'pinned'
  return (
    <div>
      <p className={LABEL}>{pinned ? copy.ALTERNATIVES_PINNED : copy.ALTERNATIVES}</p>
      {s.alternatives.length === 0 ? (
        <p className="mt-1 text-fg-muted">{copy.NO_ALTERNATIVES}</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {s.alternatives.map((alt) => (
            <li key={alt.key} data-alternative={alt.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ItemName page={page} id={alt.id} name={alt.name} tap />
              <ScoreFigure score={alt.score} className="text-sm" />
              {alt.tied ? <span className="border border-stone-600 px-1 text-[0.6875rem] leading-4 font-semibold text-fg-muted" data-tied="">{copy.TIED}</span> : null}
              {alt.higher ? <span className="border border-gold-600 px-1 text-[0.6875rem] leading-4 font-semibold text-accent" data-higher="">{copy.HIGHER}</span> : null}
              <AvailabilityChips page={page} availability={alt.availability} ownedUnknown={alt.ownedUnknown} id={alt.id} />
              <NoAmmoLine score={alt.score} />
              <button type="button" onClick={() => props.onUse(s.id, alt)} aria-label={copy.useThisSr(alt.name, label)} className="inline-flex min-h-tap items-center px-1 text-sm font-semibold text-link hover:text-accent-strong" data-use={alt.id}>
                {copy.USE_THIS}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
