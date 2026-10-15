import { CircleHelp, CircleMinus, CirclePlus, Info, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ConditionChip } from '../../../../components/ConditionChip'
import { CuratedLabel } from '../../../../components/CuratedLabel'
import { cx } from '../../../../components/cx'
import { EstimateLabel } from '../../../../components/EstimateLabel'
import { hasAssumptions } from '../../../../components/assumptions'
import { PixelPanel } from '../../../../components/PixelPanel'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { ConditionIndex } from '../../../../data-access/types'
import type { ReadinessFactor, ReadinessLine, SummaryEntry, Tone } from '../../../../scoring/readiness'
import { ESTIMATE_CONTEXT, type AssumptionText, type EstimateKey, type Segment } from '../../../../scoring/readinessCopy'
import { SourceIconLink } from '../BossBits'
import { bossPageHref } from '../bossNav'
import { wikiArticleTitle, type ItemInfo } from '../bossPageModel'
import * as copy from './readinessUiCopy'

/**
 * ReadinessFactorCard (UX_SPEC §3.1/§3.8/§8; SCORING_SPEC §6): one factor — its title, the inputs it
 * was computed from (Unknown ones named), and its tagged lines, each with its reason and sources.
 * Structurally there is NO verdict, grade or probability prop: a factor is only explanation lines
 * (UX_SPEC §8 "Copy rule enforced structurally"). Lines render their segments: numbers with the
 * EstimateLabel of their AssumptionsTip right after them, items / bosses / sets linked, conditions as
 * requirement chips, Unknown through UnknownValue, wiki text in quotation marks. Gates never sit
 * inside a sentence (AMENDMENTS-015 B96c): a line's gated items are listed after it, each with ONE gate
 * chip naming every boss it needs, joined by "and" (all are needed) — compact at 375, never a stack.
 */

export interface SegmentContext {
  info: (id: number) => ItemInfo
  conditions: ConditionIndex
  /** AssumptionsTip content per estimate key (from the analysis / the suggestions). */
  estimates: Partial<Record<EstimateKey, AssumptionText[]>>
  /** Armor set slug → its wiki article. */
  setUrl: (id: string) => string | undefined
  bossName: (id: string) => string
}

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

export function Segments({ segments, ctx }: { segments: readonly Segment[]; ctx: SegmentContext }) {
  return (
    <>
      {segments.map((seg, i) => (
        <SegmentView key={i} seg={seg} ctx={ctx} />
      ))}
    </>
  )
}

function SegmentView({ seg, ctx }: { seg: Segment; ctx: SegmentContext }) {
  switch (seg.kind) {
    case 'text':
      return <>{seg.text}</>
    case 'num': {
      const assumptions = seg.estimate ? ctx.estimates[seg.estimate] : undefined
      return (
        <>
          <span className="font-semibold tabular-nums">{seg.text}</span>
          {seg.estimate && assumptions && hasAssumptions(assumptions) ? (
            <>
              {' '}
              <EstimateLabel assumptions={assumptions} context={ESTIMATE_CONTEXT[seg.estimate]} />
            </>
          ) : null}
        </>
      )
    }
    case 'item': {
      const item = ctx.info(seg.id)
      const name = item.link?.kind === 'internal' ? (
        <Link to={item.link.to} className={LINK}>
          {seg.text}
        </Link>
      ) : item.link?.kind === 'external' ? (
        <a href={item.link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
          {seg.text}
          <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
        </a>
      ) : (
        <>{seg.text}</>
      )
      return <span data-item-ref={seg.id}>{name}</span>
    }
    case 'boss': {
      const to = bossPageHref(seg.id)
      return to ? (
        <Link to={to} className={LINK}>
          {seg.text}
        </Link>
      ) : (
        <>{seg.text}</>
      )
    }
    case 'set': {
      const href = ctx.setUrl(seg.id)
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
          {seg.text}
          <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
        </a>
      ) : (
        <>{seg.text}</>
      )
    }
    case 'cond':
      return <ConditionChip name={seg.text} href={ctx.conditions.byId.get(seg.id)?.wikiUrl} className="mx-0.5 align-middle" />
    case 'unknown':
      return <UnknownValue field={seg.field} sourceUrl={seg.sourceUrl} />
    case 'quote':
      return <span data-quote="" className="italic">“{seg.text}”</span>
  }
}

const TONE_ICON: Record<Tone, { icon: typeof Info; className: string }> = {
  easier: { icon: CirclePlus, className: 'text-success' },
  harder: { icon: CircleMinus, className: 'text-negative' },
  info: { icon: Info, className: 'text-night-200' },
  unknown: { icon: CircleHelp, className: 'text-unknown' },
}

/** Tone glyph (shape differs per tone — never colour alone) + its words for screen readers. */
export function ToneMark({ tone }: { tone: Tone }) {
  const { icon: Icon, className } = TONE_ICON[tone]
  return (
    <>
      <Icon aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', className)} />
      <span className="sr-only">{copy.TONE_LABEL[tone]}</span>
    </>
  )
}

/**
 * One gate chip for everything an item needs: the GateBadge look (lock glyph + "After …", never colour
 * alone) with every boss named in words, "A, B and C" — every gate is needed. It wraps as text, so three
 * gates at 375 stay one compact chip, not a stack of badges (B96c). Not a link: the bosses are linked
 * where a sentence names them (the owned-gated line, the boss map link in the setup).
 */
export function GateGroup({ gates, ctx }: { gates: readonly string[]; ctx: Pick<SegmentContext, 'bossName'> }) {
  return (
    <span data-gate-group={gates.join('+')} className="inline-flex max-w-full items-start gap-1 border-2 border-earth-600 bg-night-900 px-1.5 py-0.5 text-xs font-semibold text-gate">
      <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <span className="sr-only">{copy.GATES_SR_LEAD}</span>
        <span aria-hidden="true">{copy.GATES_LEAD}</span>
        {copy.gateNames(gates.map(ctx.bossName))}
      </span>
    </span>
  )
}

/** The gated items a line names, after the line: "{Item}: [After A and B]" — one row per item, never inside the sentence. */
export function GateNotes({ segments, ctx }: { segments: readonly Segment[]; ctx: SegmentContext }) {
  const seen = new Set<number>()
  const gated = segments.filter((seg): seg is Extract<Segment, { kind: 'item' }> => {
    if (seg.kind !== 'item' || seg.availability?.status !== 'gated' || seen.has(seg.id)) return false
    seen.add(seg.id)
    return true
  })
  if (gated.length === 0) return null
  return (
    <span className="mt-1 block space-y-1">
      {gated.map((seg) => (
        <span key={seg.id} data-gate-note={seg.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
          <span>{seg.text}:</span>
          <GateGroup gates={seg.availability?.missing ?? []} ctx={ctx} />
        </span>
      ))}
    </span>
  )
}

/** The wiki articles a line already links inline (items, sets, conditions), by article title. */
function inlineArticles(segments: readonly Segment[], ctx: SegmentContext): Set<string> {
  const out = new Set<string>()
  for (const seg of segments) {
    const link = seg.kind === 'item' ? ctx.info(seg.id).link : undefined
    const href = link?.kind === 'external' ? link.href : seg.kind === 'set' ? ctx.setUrl(seg.id) : seg.kind === 'cond' ? ctx.conditions.byId.get(seg.id)?.wikiUrl : undefined
    if (href) out.add(wikiArticleTitle(href) ?? href)
  }
  return out
}

/** A line's source icons: one per article, none for an article the line already links inline (B96d). */
function lineSources(line: ReadinessLine, ctx: SegmentContext): string[] {
  const seen = inlineArticles(line.segments, ctx)
  const out: string[] = []
  for (const url of line.sources) {
    const article = wikiArticleTitle(url) ?? url
    if (seen.has(article)) continue
    seen.add(article)
    out.push(url)
  }
  return out.slice(0, 2)
}

export function LineItem({ line, ctx, aside }: { line: ReadinessLine; ctx: SegmentContext; aside?: ReactNode }) {
  return (
    <li data-line={line.id} data-tone={line.tone} {...(line.editorial ? { 'data-editorial': '' } : {})} className="flex items-start gap-2">
      <ToneMark tone={line.tone} />
      <div className="min-w-0 flex-1">
        <p className="py-0.5 text-sm leading-relaxed">
          {aside}
          <Segments segments={line.segments} ctx={ctx} />
          {line.editorial ? <span className="ml-1.5 inline-block border border-stone-600 px-1 text-[0.6875rem] leading-4 font-semibold text-fg-muted">{copy.CURATED_TAG}</span> : null}
        </p>
        <GateNotes segments={line.segments} ctx={ctx} />
      </div>
      {lineSources(line, ctx).map((url) => (
        <SourceIconLink key={url} href={url} srLabel={copy.sourceArticle(wikiArticleTitle(url) ?? url)} className="-my-2" />
      ))}
    </li>
  )
}

export interface ReadinessFactorCardProps {
  factor: ReadinessFactor
  ctx: SegmentContext
  headingId: string
}

export function ReadinessFactorCard({ factor, ctx, headingId }: ReadinessFactorCardProps) {
  const { used, total, unknownInputs } = factor.computedFrom
  const editorial = factor.lines.some((l) => l.editorial)
  return (
    <PixelPanel as="section" aria-labelledby={headingId} data-factor={factor.id} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">
          {factor.title}
        </h3>
        {editorial ? <CuratedLabel explanation={copy.MOBILITY_CURATED} className="text-sm" /> : null}
      </div>
      {total > 0 ? (
        <p data-computed-from={`${used}/${total}`} className="text-xs text-fg-muted">
          {copy.computedFrom(used, total)}
          {unknownInputs.length > 0 ? <span className="block">{copy.unknownInputs(unknownInputs)}</span> : null}
        </p>
      ) : null}
      <ul className="space-y-2.5">
        {factor.lines.map((line) => (
          <LineItem key={line.id} line={line} ctx={ctx} />
        ))}
      </ul>
    </PixelPanel>
  )
}

/** SummaryCard (UX_SPEC §3.8): two columns, exactly the easier / harder lines of the factors; zero outcome language. */
export function SummaryCard({ easier, harder, factorTitle, ctx, headingId }: { easier: readonly SummaryEntry[]; harder: readonly SummaryEntry[]; factorTitle: (id: string) => string; ctx: SegmentContext; headingId: string }) {
  const column = (title: string, tone: 'easier' | 'harder', entries: readonly SummaryEntry[]) => {
    const { icon: Icon, className } = TONE_ICON[tone]
    return (
    <div data-summary={tone} className="min-w-0 space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className={cx('size-5 shrink-0', className)} />
        {title}
      </h4>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">{copy.SUMMARY_EMPTY}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(({ factor, line }) => (
            <li key={line.id} className="border-l-2 border-panel-border pl-2 text-sm leading-relaxed">
              <span className="block text-xs text-fg-muted">
                <span className="sr-only">{copy.FACTOR_FOR} </span>
                {factorTitle(factor)}
              </span>
              <Segments segments={line.segments} ctx={ctx} />
              <GateNotes segments={line.segments} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
    </div>
    )
  }
  return (
    <PixelPanel as="section" aria-labelledby={headingId} tone="gold" data-summary-card="" className="space-y-3">
      <h3 id={headingId} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">
        {copy.SUMMARY_TITLE}
      </h3>
      <p className="text-xs text-fg-muted">{copy.SUMMARY_NOTE}</p>
      {/* Side by side from lg only: at md the analysis pane is ~350px wide (2-pane), too narrow for two columns. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {column(copy.EASIER_TITLE, 'easier', easier)}
        {column(copy.HARDER_TITLE, 'harder', harder)}
      </div>
    </PixelPanel>
  )
}
