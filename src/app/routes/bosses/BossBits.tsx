import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CuratedLabel } from '../../../components/CuratedLabel'
import { cx } from '../../../components/cx'
import { GateBadge } from '../../../components/GateBadge'
import { ItemSlot } from '../../../components/ItemSlot'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex } from '../../../data-access/types'
import { DIFFICULTY_LABEL, type ItemInfo, type Strategy, type TipSegment } from './bossPageModel'

/** Building blocks shared by the boss page's sections (UX_SPEC §3.7). */

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

/** Panel heading (same scale as the weapon page's panels) + optional "curated" marker. */
export function PanelHeading({ id, children, curated = false, aside }: { id: string; children: ReactNode; curated?: boolean; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} tabIndex={-1} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base">
        {children}
      </h2>
      {curated || aside ? (
        <span className="flex items-baseline gap-3 text-sm">
          {aside}
          {curated ? <CuratedLabel /> : null}
        </span>
      ) : null}
    </div>
  )
}

/** A 44px icon link to a claim's wiki source (one per tip / row), with the claim named for screen readers. */
export function SourceIconLink({ href, srLabel, className }: { href: string; srLabel: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Source on terraria.wiki.gg"
      className={cx('grid min-h-tap min-w-tap shrink-0 place-items-center text-link hover:text-accent-strong', className)}
    >
      <ExternalLink aria-hidden="true" className="size-4" />
      <span className="sr-only">{srLabel} on terraria.wiki.gg (opens in a new tab)</span>
    </a>
  )
}

export interface GateRef {
  /** Progression node id. */
  id: string
  name: string
  /** Its boss page or map position. */
  to?: string
}

/** Tooltip of an item with nothing to link (no name known, so not even a wiki search). */
export const NO_PAGE_TITLE = 'No linked page for this item'

/**
 * One item: its ItemSlot (sprite whole-number scaled into the slot) + visible name. The cell links to
 * the item's own page — /weapons/:id in-app, else its own wiki article, else the wiki's search for its
 * exact name — or is inert only when not even a name is known (never a dead local link, never a
 * guessed URL), saying so in its tooltip. GateBadges follow the name.
 */
export function ItemCell({
  item,
  sprites,
  stack,
  gates = [],
  slotFromMd = false,
  className,
}: {
  item: ItemInfo
  sprites: SpriteIndex | null
  stack?: number
  gates?: readonly GateRef[]
  /** Narrow table columns: show the slot art only from `md` up, so the name keeps a readable width on phones. */
  slotFromMd?: boolean
  className?: string
}) {
  const slot = (
    <span aria-hidden="true" className={cx('shrink-0', slotFromMd && 'max-md:hidden')}>
      <ItemSlot
        item={{
          name: item.name,
          stack,
          sprite:
            item.kind === 'weapon' ? (
              <SpriteImg src={item.sprite} sprites={sprites} damageClass={item.damageClass} box={32} />
            ) : (
              <SpriteImg src={item.sprite} sprites={sprites} placeholder="material" box={32} />
            ),
        }}
      />
    </span>
  )
  const name = (
    <span className="min-w-0">
      {stack !== undefined && stack > 1 ? <span className="sr-only">{stack} × </span> : null}
      {item.name}
    </span>
  )
  const body =
    item.link?.kind === 'internal' ? (
      <Link to={item.link.to} className={cx('flex min-h-tap min-w-0 items-center gap-3', LINK)}>
        {slot}
        {name}
      </Link>
    ) : item.link?.kind === 'external' ? (
      <a href={item.link.href} target="_blank" rel="noopener noreferrer" className={cx('flex min-h-tap min-w-0 items-center gap-3', LINK)}>
        {slot}
        {name}
        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
      </a>
    ) : (
      <span data-item-inert="" title={NO_PAGE_TITLE} className="flex min-h-tap min-w-0 items-center gap-3">
        {slot}
        {name}
      </span>
    )
  return (
    <span data-item-id={item.id} className={cx('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {body}
      {gates.map((g) => (
        <GateBadge key={g.id} name={g.name} to={g.to} />
      ))}
    </span>
  )
}

/** A difficulty chip (text, not colour alone). */
export function DifficultyChip({ difficulty }: { difficulty: NonNullable<Strategy['difficulty']> }) {
  return <span className="inline-block border-2 border-stone-600 px-1.5 text-xs font-semibold text-fg-muted">{DIFFICULTY_LABEL[difficulty]}</span>
}

/** A quote's words, with the real weapons it names linked to their pages (the words stay verbatim). */
export function QuoteText({ text, linkTip }: { text: string; linkTip?: (text: string) => TipSegment[] }) {
  if (!linkTip) return <>{text}</>
  return (
    <>
      {linkTip(text).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : part.item.link?.kind === 'internal' ? (
          <Link key={i} to={part.item.link.to} data-tip-link={part.item.id} className={LINK}>
            {part.text}
          </Link>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/** Curated tips: each one is a verbatim wiki quote with its own source link; weapon names link their pages. */
export function TipList({ tips, label, showDifficulty = false, linkTip }: { tips: readonly Strategy[]; label: string; showDifficulty?: boolean; linkTip?: (text: string) => TipSegment[] }) {
  return (
    <ul aria-label={label} className="space-y-2">
      {tips.map((tip) => (
        <li key={tip.text} data-tip="" className="flex items-start gap-2 border-l-2 border-gold-600 bg-night-900 py-1 pl-3">
          <p className="min-w-0 flex-1 py-2 text-sm leading-relaxed">
            {showDifficulty && tip.difficulty ? (
              <>
                <DifficultyChip difficulty={tip.difficulty} />{' '}
              </>
            ) : null}
            <QuoteText text={tip.text} linkTip={linkTip} />
          </p>
          <SourceIconLink href={tip.sourceUrl} srLabel="Source of this tip" />
        </li>
      ))}
    </ul>
  )
}
