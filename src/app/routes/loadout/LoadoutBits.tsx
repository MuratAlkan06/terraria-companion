import { RotateCcw, TriangleAlert, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ConditionChip } from '../../../components/ConditionChip'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { hasAssumptions } from '../../../components/assumptions'
import { ItemSlot } from '../../../components/ItemSlot'
import { RarityText } from '../../../components/RarityText'
import { asRarity } from '../../../components/rarity'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import type { Availability } from '../../../scoring/candidates'
import { ESTIMATE_CONTEXT } from '../../../scoring/readinessCopy'
import type { PickScore } from '../../../scoring/recommend'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { GateGroup } from '../bosses/readiness/ReadinessFactorCard'
import * as copy from './loadoutCopy'
import { recordOf, spriteOf, tooltipFor } from './loadoutView'

/**
 * Shared pieces of the loadout builder's steps (UX_SPEC §3.5, §8): choice chips, a score figure with
 * its EstimateLabel, an item's name / sprite / tooltip, and its availability as the builder's progress
 * makes it (gate chip, Unknown marker, requirement chips) — never colour alone.
 */

export const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'
export const LABEL = 'block text-xs font-semibold tracking-wide text-fg-muted uppercase'
export const FIELD = 'min-h-tap w-full border-2 border-panel-border bg-surface-sunken px-3 text-base text-fg focus:border-gold-600'

export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
  aside,
  awaiting,
}: {
  legend: string
  name: string
  /** undefined: nothing chosen yet (the stage a link left open, B108(c)). */
  value: T | undefined
  options: readonly { value: T; label: string; description?: string }[]
  onChange: (v: T) => void
  hint?: ReactNode
  aside?: ReactNode
  /** The group waits for a choice (B108(c) M4): a gold frame, never colour alone — the hint says so. */
  awaiting?: boolean
}) {
  return (
    <fieldset className={cx('space-y-1.5', awaiting && 'border-l-4 border-gold-600 pl-3')} data-field={name} {...(awaiting ? { 'data-awaiting': '' } : {})}>
      <legend className={LABEL}>{legend}</legend>
      {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'inline-flex min-h-tap cursor-pointer flex-col justify-center border-2 px-3 py-1 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
              value === o.value ? 'border-gold-400 bg-night-700 text-accent shadow-slot-selected' : 'border-panel-border bg-night-900 text-fg hover:bg-night-800',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            <span>{o.label}</span>
            {o.description ? <span className="text-xs font-normal text-fg-muted">{o.description}</span> : null}
          </label>
        ))}
      </div>
      {aside}
    </fieldset>
  )
}

/** A score's number, its unit and — for an estimate — the "est." chip with its AssumptionsTip. */
export function ScoreFigure({ score, className }: { score: PickScore; className?: string }) {
  const unit = copy.SCORE_UNIT[score.kind]
  const assumptions = score.assumptions ?? []
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-1', className)} data-score={score.kind}>
      <span className="font-semibold text-fg tabular-nums">{score.text}</span>
      {unit ? <span className="text-fg-muted">{unit}</span> : null}
      {score.estimate && hasAssumptions(assumptions) ? <EstimateLabel assumptions={assumptions} context={ESTIMATE_CONTEXT[score.estimate]} className="self-center" /> : null}
    </span>
  )
}

/** An item's name, linked to its page (weapons: ours; others: their wiki article). */
/** B108 M7: a link that is a pick's main tap target gets the 44px minimum height (`tap`). */
const TAP = 'inline-flex min-h-tap items-center'

export function ItemName({ page, id, name, className, tap }: { page: ReadinessPageData; id: number; name?: string; className?: string; tap?: boolean }) {
  const info = page.info(id)
  const rarity = asRarity(recordOf(page.engine, id)?.rarity)
  const text = <RarityText rarity={rarity}>{name ?? info.name}</RarityText>
  if (info.link?.kind === 'internal')
    return (
      <Link to={info.link.to} className={cx(LINK, 'font-semibold', tap && TAP, className)} data-item-link={id}>
        {text}
      </Link>
    )
  if (info.link?.kind === 'external')
    return (
      <a href={info.link.href} target="_blank" rel="noopener noreferrer" className={cx(LINK, 'font-semibold', tap && TAP, className)} data-item-link={id}>
        {text}
        <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
      </a>
    )
  return <span className={cx('font-semibold', className)}>{text}</span>
}

/** An inventory square with the item's sprite and its Terraria-style tooltip (PRD P4-S2 AC5). */
export function ItemSquare({ page, id, onSelect, selected, slotLabel }: { page: ReadinessPageData; id: number; onSelect?: () => void; selected?: boolean; slotLabel?: string }) {
  const s = spriteOf(page.engine, id)
  const r = recordOf(page.engine, id)
  const tooltip = tooltipFor(page.engine, id)
  const name = r?.name ?? page.info(id).name
  return (
    <ItemSlot
      item={{ name: slotLabel ? copy.overviewFilled(slotLabel, name) : name, sprite: <SpriteImg src={s.src} sprites={page.sprites} damageClass={s.damageClass} placeholder={s.placeholder} box={32} />, rarity: asRarity(r?.rarity) }}
      {...(tooltip ? { tooltip } : {})}
      {...(onSelect ? { onSelect, selected: selected ?? false } : {})}
    />
  )
}

/**
 * B108 H1: before a rebuild — whenever a slot holds a fixed pick, the fields that rebuild say so
 * (referenced by `aria-describedby`, so it is heard on focus too).
 */
export function FixedPicksWarning({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs leading-relaxed text-fg" data-rebuild-warning="">
      <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0 text-accent" />
      <span>{text}</span>
    </p>
  )
}

/**
 * B108 H1: after a rebuild that reset fixed picks — a VISIBLE notice where the change was made (the
 * page's live region announces the same words, so this one isn't a live region of its own).
 * Dismiss removes the notice with its own button, so focus moves first (FavoritesSaveNoticeView's
 * pattern): back to where it was before it entered the notice — usually the field that rebuilt — or,
 * when that is gone, to the control Tab would reach next.
 */
export function RebuiltNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const self = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <div
      ref={self}
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) returnFocus.current = event.relatedTarget as HTMLElement | null
      }}
      className="flex items-start gap-2 border-l-4 border-gold-600 bg-night-900 py-1 pr-1 pl-3 text-sm"
      data-rebuilt-notice=""
    >
      <RotateCcw aria-hidden="true" className="mt-2.5 size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 py-2 leading-snug">{text}</p>
      <button
        type="button"
        onClick={() => {
          const back = returnFocus.current
          const target = back?.isConnected ? back : focusAfter(self.current)
          onDismiss()
          target?.focus()
        }}
        aria-label={copy.REBUILT_DISMISS}
        className="grid min-h-tap min-w-tap shrink-0 place-items-center text-fg-muted hover:text-fg"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The first rendered tab stop after `el` in document order (a radio group's stop is its checked radio). */
function focusAfter(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  for (const c of document.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (el.contains(c) || !(el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) || c.getClientRects().length === 0) continue
    if (c instanceof HTMLInputElement && c.type === 'radio' && c.name) return document.querySelector<HTMLElement>(`input[type="radio"][name="${CSS.escape(c.name)}"]:checked`) ?? c
    return c
  }
  return null
}

/** B108 M9: an ammo weapon's estimate without ammo, said in the row (not only in its AssumptionsTip). */
export function NoAmmoLine({ score }: { score: PickScore | undefined }) {
  if (!score?.noAmmo) return null
  return (
    <p className="text-xs text-fg-muted" data-no-ammo="">
      {copy.NO_AMMO}
    </p>
  )
}

/** B108(a): a pick adding 0 counted points, named on its card. */
export function ZeroPointsTag() {
  return (
    <span className="inline-flex items-center border border-stone-600 px-1 text-[0.6875rem] leading-4 font-semibold text-fg-muted" data-zero-points="">
      {copy.ZERO_POINTS_TAG}
    </span>
  )
}

/** What the builder's progress makes of an item: gated (one chip naming every boss), Unknown, requirement chips, owned. */
export function AvailabilityChips({ page, availability, ownedUnknown, id }: { page: ReadinessPageData; availability: Availability; ownedUnknown?: boolean; id: number }) {
  const nodeName = (n: string) => page.graph.nodeById.get(n)?.name ?? n
  const chips: ReactNode[] = []
  if (availability.status === 'gated') chips.push(<GateGroup key="gate" gates={availability.missing} ctx={{ bossName: nodeName }} />)
  if (availability.status === 'unknown')
    chips.push(
      <span key="unknown" className="inline-flex items-center gap-1 text-xs text-fg-muted" data-availability="unknown">
        {copy.AVAILABILITY} <UnknownValue field="gatedBy" sourceUrl={recordOf(page.engine, id)?.wikiUrl} />
      </span>,
    )
  if (ownedUnknown)
    chips.push(
      <span key="owned" className="inline-flex items-center border border-forest-500 px-1 text-[0.6875rem] leading-4 font-semibold text-success" data-owned="">
        {copy.OWNED_TAG}
      </span>,
    )
  for (const c of availability.conditions) chips.push(<ConditionChip key={`c-${c}`} name={page.conditions.byId.get(c)?.name ?? c} href={page.conditions.byId.get(c)?.wikiUrl} requires />)
  if (chips.length === 0) return null
  return <span className="flex flex-wrap items-center gap-1.5">{chips}</span>
}
