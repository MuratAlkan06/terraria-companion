import { ArrowRight, ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { ConditionChip } from '../../../../components/ConditionChip'
import { cx } from '../../../../components/cx'
import { GatedSection } from '../../../../components/GatedSection'
import { PixelPanel } from '../../../../components/PixelPanel'
import type { SpriteIndex } from '../../../../data-access/types'
import type { ImproveResult, Suggestion, SuggestionGroup } from '../../../../scoring/improve'
import { ItemCell } from '../BossBits'
import { bossMapHref, bossPageHref } from '../bossNav'
import { GateNotes, Segments, type SegmentContext } from './ReadinessFactorCard'
import * as copy from './readinessUiCopy'

/**
 * ImprovePanel (UX_SPEC §3.8; PRD P5-S7 AC1–AC3; PRD §9 Feature A AC2): per targeted component, the
 * obtainable-now upgrades (tracked defeats only) and, apart, GatedSections "After you defeat {Boss}"
 * keyed by the exact bosses each upgrade still needs. Every suggestion links its page and "Show Me How
 * to Get It" — the weapon page's acquisition section in-app, else the item's wiki article (Feature B's
 * planner, P6-S5, is not shipped: no dead link).
 */
export interface ImprovePanelProps {
  result: ImproveResult
  ctx: SegmentContext
  sprites: SpriteIndex | null
  /** Set slug → wiki article (armor-set suggestions open their set's page). */
  setUrl: (id: string) => string | undefined
  idPrefix: string
}

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

/**
 * The weapon page's acquisition section heading id (AcquisitionView ACQUISITION_TITLE_ID — kept as a
 * literal so the readiness chunk doesn't pull the weapon page in; readiness.test pins the parity).
 */
export const ACQUISITION_ANCHOR = 'acq-title'

export function ImprovePanel({ result, ctx, sprites, setUrl, idPrefix }: ImprovePanelProps) {
  const sctx = { ...ctx, estimates: { ...ctx.estimates, ...result.estimates } }
  return (
    <div data-improve="" className="space-y-4">
      <p className="text-sm text-fg-muted">{copy.IMPROVE_INTRO}</p>
      {result.groups.map((group) => (
        <GroupView key={group.target} group={group} ctx={sctx} sprites={sprites} setUrl={setUrl} headingId={`${idPrefix}-${group.target}`} />
      ))}
    </div>
  )
}

function GroupView({ group, ctx, sprites, setUrl, headingId }: { group: SuggestionGroup; ctx: SegmentContext; sprites: SpriteIndex | null; setUrl: (id: string) => string | undefined; headingId: string }) {
  return (
    <PixelPanel as="section" aria-labelledby={headingId} data-improve-group={group.target} className="space-y-3">
      <div className="space-y-1">
        <h4 id={headingId} className="font-semibold text-accent">
          {group.title}
        </h4>
        <p className="text-sm text-fg-muted">
          <Segments segments={group.basis} ctx={ctx} />
        </p>
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{copy.OBTAINABLE_NOW}</h5>
        {group.obtainable.length > 0 ? (
          <ul className="space-y-2">
            {group.obtainable.map((s) => (
              <SuggestionRow key={s.key} s={s} ctx={ctx} sprites={sprites} setUrl={setUrl} />
            ))}
          </ul>
        ) : (
          <p data-improve-empty="" className="text-sm">
            <Segments segments={group.empty ?? []} ctx={ctx} />
          </p>
        )}
      </div>
      {group.gated.map((g) => (
        <GatedSection key={g.missing.join('+')} id={`${headingId}-after-${g.missing.join('-')}`} gates={g.missing.map((id, i) => ({ id, name: g.names[i], to: bossPageHref(id) ?? bossMapHref(id) }))} as="h5">
          <ul className="space-y-2">
            {g.items.map((s) => (
              <SuggestionRow key={s.key} s={s} ctx={ctx} sprites={sprites} setUrl={setUrl} />
            ))}
          </ul>
        </GatedSection>
      ))}
      {group.disclosureText.length > 0 ? (
        <p data-improve-disclosure="" className="text-xs text-fg-muted">
          <Segments segments={group.disclosureText} ctx={ctx} />
        </p>
      ) : null}
    </PixelPanel>
  )
}

function SuggestionRow({ s, ctx, sprites, setUrl }: { s: Suggestion; ctx: SegmentContext; sprites: SpriteIndex | null; setUrl: (id: string) => string | undefined }) {
  const info = ctx.info(s.id)
  const set = s.setId ? setUrl(s.setId) : undefined
  const item = s.kind === 'armor-set' ? { ...info, name: s.name, ...(set ? { link: { kind: 'external' as const, href: set } } : {}) } : info
  const howTo = item.link?.kind === 'internal' ? { kind: 'internal' as const, to: `${item.link.to}#${ACQUISITION_ANCHOR}` } : item.link
  return (
    <li data-suggestion={s.key} className="space-y-1 border-2 border-panel-border bg-night-900 p-2">
      <ItemCell item={item} sprites={sprites} />
      <p className="text-sm">
        <Segments segments={s.rationale} ctx={ctx} />
        <GateNotes segments={s.rationale} ctx={ctx} />
      </p>
      {s.availability.conditions.length > 0 ? (
        <p className="flex flex-wrap gap-1">
          {s.availability.conditions.map((c) => (
            <ConditionChip key={c} name={ctx.conditions.byId.get(c)?.name ?? c} href={ctx.conditions.byId.get(c)?.wikiUrl} requires />
          ))}
        </p>
      ) : null}
      {howTo?.kind === 'internal' ? (
        <Link to={howTo.to} data-show-how={s.key} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)}>
          {copy.SHOW_HOW}
          <span className="sr-only">{copy.showHowContext(item.name)}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : howTo?.kind === 'external' ? (
        <a href={howTo.href} target="_blank" rel="noopener noreferrer" data-show-how={s.key} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)}>
          {copy.SHOW_HOW}
          <span className="sr-only">
            {copy.showHowContext(item.name)}
            {copy.NEW_TAB}
          </span>
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      ) : null}
    </li>
  )
}
