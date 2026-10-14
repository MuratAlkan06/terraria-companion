import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../components/cx'
import { ItemSlot } from '../../../components/ItemSlot'
import { asRarity } from '../../../components/rarity'
import { SpriteImg } from '../../../components/SpriteImg'
import { ENTITY_TYPES } from '../../../search/entityTypes'
import type { GuideData } from './guideData'
import type { Mention, Rich, SlotMention } from './guideModel'
import { mentionTarget, mentionText, type MentionTarget } from './mentionTargets'

/**
 * Guide links (PRD P6-S8 AC1/AC2): inline prose links and linked ItemSlot cells. Targets come from
 * ./mentionTargets.ts; wiki links open in a new tab and say so; an unresolvable mention is plain
 * text — never a dead link.
 */
const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

/** "(opens in a new tab)" marker for wiki links: an icon plus screen-reader text. */
function ExternalMark() {
  return (
    <>
      <ExternalLink aria-hidden="true" className="ml-0.5 inline-block size-3.5 align-[-0.125em]" />
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  )
}

/** Link words with the new-tab marker glued to the last word, so the icon never wraps alone. */
function MarkedText({ text }: { text: string }) {
  const split = text.lastIndexOf(' ') + 1
  return (
    <>
      {text.slice(0, split)}
      <span className="whitespace-nowrap">
        {text.slice(split)}
        <ExternalMark />
      </span>
    </>
  )
}

/** A link to a resolved target (wiki links open in a new tab); plain text when unresolved. */
function TargetLink({ target, className, children }: { target: MentionTarget; className?: string; children: ReactNode }) {
  switch (target.kind) {
    case 'internal':
      return (
        <Link to={target.to} className={className}>
          {children}
        </Link>
      )
    case 'external':
      return (
        <a href={target.href} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
        </a>
      )
    case 'none':
      return <span>{children}</span>
  }
}

/** Prose with inline links. */
export function RichText({ rich, data }: { rich: Rich; data: GuideData }) {
  return (
    <>
      {rich.map((part, index) =>
        typeof part === 'string' ? (
          part
        ) : (
          <MentionLink key={index} mention={part} data={data} />
        ),
      )}
    </>
  )
}

function MentionLink({ mention, data }: { mention: Mention; data: GuideData }) {
  const target = mentionTarget(mention, data.docs)
  const words = mentionText(mention, data.docs)
  return (
    <TargetLink target={target} className={LINK}>
      {target.kind === 'external' ? <MarkedText text={words} /> : words}
    </TargetLink>
  )
}

/**
 * One linked ItemSlot with its visible name and kind (UX_SPEC §3.10 "ItemSlot inline links"; same
 * anatomy as the weapon page's recipe materials). Sprites come from the manifest entry whose `ref`
 * is the entity; anything else shows placeholder art.
 */
export function SlotCell({ mention, data }: { mention: SlotMention; data: GuideData }) {
  const target = mentionTarget(mention, data.docs)
  const doc = mention.kind === 'entity' ? data.docs.get(mention.ref) : undefined
  const ref = mention.kind === 'entity' ? mention.ref : `i:${mention.itemId}`
  const name = mention.kind === 'entity' ? (doc?.name ?? mention.name) : mention.text
  const typeInfo = doc ? ENTITY_TYPES[doc.type] : undefined
  const kind = typeInfo?.label ?? 'Item'
  const placeholder = typeInfo?.placeholder ?? 'material'
  const sprite = (
    <SpriteImg
      src={data.spriteByRef.get(ref)}
      sprites={data.sprites}
      damageClass={doc?.class}
      placeholder={placeholder === 'by-class' ? undefined : placeholder}
      box={32}
    />
  )
  const linked = target.kind !== 'none'
  const body = (
    <>
      {/* The visible name labels the cell; the slot is the picture. */}
      <span aria-hidden="true" className="shrink-0">
        <ItemSlot item={{ name, sprite, rarity: asRarity(doc?.rarity) }} />
      </span>
      <span className="min-w-0">
        <span className={cx('block leading-snug', linked && 'underline decoration-1 underline-offset-4')}>
          {target.kind === 'external' ? <MarkedText text={name} /> : name}
        </span>
        <span className="block text-xs text-fg-muted">
          {kind}
          {target.kind === 'external' ? ' · wiki' : null}
        </span>
      </span>
    </>
  )
  if (!linked) return <div className="flex min-h-tap items-center gap-3">{body}</div>
  return (
    <TargetLink target={target} className="flex min-h-tap items-center gap-3 text-link hover:text-accent-strong">
      {body}
    </TargetLink>
  )
}
