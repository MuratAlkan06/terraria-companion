import { ChevronRight, CircleAlert, RotateCw, Sparkles } from 'lucide-react'
import { buttonClass } from '../../../../components/buttonStyles'
import { cx } from '../../../../components/cx'
import { EmptyState } from '../../../../components/States'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import type { ImproveResult } from '../../../../scoring/improve'
import type { ReadinessAnalysis } from '../../../../scoring/readiness'
import { FACTOR_TITLES } from '../../../../scoring/readinessCopy'
import type { ReadinessSetup } from '../../../../storage/readiness'
import { ImprovePanel } from './ImprovePanel'
import type { ReadinessPageData } from './readinessData'
import { ReadinessFactorCard, Segments, SummaryCard, type SegmentContext } from './ReadinessFactorCard'
import { segmentContext } from './readinessUi'
import * as copy from './readinessUiCopy'

/**
 * AnalysisPane (UX_SPEC §3.8, §6; SCORING_SPEC §6/§7): the analysis of the SNAPSHOT (the inputs last
 * analyzed). States: guided start (nothing in the loadout yet — a start, not an error), ready
 * (inputs, no analysis yet), analyzed. When the inputs or the marked bosses change after an analysis,
 * the old one stays visible, dimmed, marked "Out of date", with a sticky Re-analyze bar — never
 * silently replaced; re-analysis swaps it atomically. The dimming is a hatched, dashed frame around
 * the old analysis, never text opacity, so every line keeps its contrast (B96c); the out-of-date
 * sentence exists once, in the bar (B96d). Arriving with another boss chosen, the heading names that
 * boss and says the old analysis below is for the previous one.
 */
export interface AnalysisPaneProps {
  page: ReadinessPageData
  analysis?: ReadinessAnalysis
  improve?: ImproveResult
  /** The setup the shown analysis was made from. */
  analyzedSetup?: ReadinessSetup
  analyzedAt?: string
  /** The boss the setup names now (may differ from the analyzed one). */
  currentBossId?: string | null
  stale: 'setup' | 'progress' | null
  hasItems: boolean
  improveOpen: boolean
  onToggleImprove: () => void
  onReanalyze: () => void
  /** Analyze from the "Ready to analyze" card (the setup's own button may be scrolled far away). */
  onAnalyze?: () => void
  onGuidedAdd: () => void
  ids: { title: string; region: string; improve: string }
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function AnalysisPane(props: AnalysisPaneProps) {
  const { page, analysis, analyzedSetup, ids } = props
  if (!analysis || !analyzedSetup) {
    return (
      // md+: follows beside the long setup while it's edited — never an empty column (B96c).
      <section aria-label={copy.ANALYSIS_REGION} data-analysis-state={props.hasItems ? 'ready' : 'guided'} className="space-y-4 md:sticky md:top-20">
        {props.hasItems ? (
          <EmptyState
            titleId={ids.title}
            title={copy.READY_TITLE}
            art={<Sparkles className="size-10 text-accent" />}
            actions={
              props.onAnalyze ? (
                <button type="button" onClick={props.onAnalyze} data-ready-analyze="" className={buttonClass('primary')}>
                  {copy.ANALYZE}
                </button>
              ) : undefined
            }
          >
            <p>{copy.READY_BODY}</p>
          </EmptyState>
        ) : (
          <EmptyState
            titleId={ids.title}
            title={copy.GUIDED_TITLE}
            art={<Sparkles className="size-10 text-accent" />}
            actions={
              <button type="button" onClick={props.onGuidedAdd} data-guided-add="" className={buttonClass('primary')}>
                {copy.GUIDED_ACTION}
              </button>
            }
          >
            <ol className="list-decimal space-y-1 pl-5 text-left">
              {copy.GUIDED_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </EmptyState>
        )}
      </section>
    )
  }

  const bossName = (id: string) => page.engine.bosses.get(id)?.name ?? id
  const ctx = segmentContext(page, analysis.estimates)
  const plainCtx: SegmentContext = { ...ctx, info: page.info }
  // Arrived with another boss chosen (a boss page's "Check readiness"): name it; the old analysis is the previous boss's.
  const otherBoss = props.stale === 'setup' && props.currentBossId && props.currentBossId !== analysis.bossId ? props.currentBossId : null
  const staleId = `${ids.region}-stale`
  return (
    // md+: beside a longer setup, the analysis scrolls until its foot is in view, then stays (as the setup does beside a longer analysis).
    <section
      aria-labelledby={ids.title}
      data-analysis-state={props.stale ? 'stale' : 'analyzed'}
      className="relative space-y-4 md:sticky md:bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+1rem)] md:self-end lg:bottom-4"
    >
      <header className="space-y-1">
        <h2 id={ids.title} tabIndex={-1} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base">
          {otherBoss ? copy.analysisPendingTitle(bossName(otherBoss)) : copy.analysisTitle(bossName(analysis.bossId))}
        </h2>
        <p className="text-sm text-fg-muted">
          {otherBoss ? <span data-previous-analysis="" className="block">{copy.previousAnalysis(bossName(analysis.bossId))}</span> : null}
          {copy.analysisMeta(copy.DIFFICULTY_NAMES[analysis.difficulty], copy.CLASS_NAMES[analysis.cls])}
          {props.analyzedAt ? <span className="block text-xs">{copy.analyzedOn(formatWhen(props.analyzedAt))}</span> : null}
        </p>
      </header>

      <div
        id={ids.region}
        data-analysis=""
        className={cx(
          'space-y-4',
          // Out of date: a dashed frame on a hatched ground around the old analysis — never text opacity (B96c).
          props.stale && 'border-2 border-dashed border-gold-600 bg-[repeating-linear-gradient(135deg,var(--color-night-950)_0_6px,var(--color-night-800)_6px_12px)] p-2 md:p-3',
        )}
        aria-describedby={props.stale ? staleId : undefined}
      >
        {analysis.notCounted.length > 0 ? (
          <PixelPanel as="section" aria-labelledby={`${ids.region}-not-counted`} tone="earth" data-not-counted-list="" className="space-y-2">
            <h3 id={`${ids.region}-not-counted`} className="flex items-center gap-2 font-semibold text-gate">
              <CircleAlert aria-hidden="true" className="size-5" />
              {copy.NOT_COUNTED_TITLE}
            </h3>
            <p className="text-sm">{copy.notCountedIntro(analysis.notCounted.length)}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {analysis.notCounted.map((n) => (
                <li key={`${n.entry.slot.kind}-${'index' in n.entry.slot ? n.entry.slot.index : ''}-${n.entry.id}`} data-not-counted-item={n.entry.id}>
                  {/* the bosses are named in the sentence itself: no badge repeated beside the item */}
                  <Segments segments={n.segments.map((s) => (s.kind === 'item' ? { ...s, availability: undefined } : s))} ctx={plainCtx} />
                </li>
              ))}
            </ul>
          </PixelPanel>
        ) : null}

        <SummaryCard easier={analysis.summary.easier} harder={analysis.summary.harder} factorTitle={(id) => FACTOR_TITLES[id as keyof typeof FACTOR_TITLES]} ctx={ctx} headingId={`${ids.region}-summary`} />

        {analysis.factors.map((f) => (
          <ReadinessFactorCard key={f.id} factor={f} ctx={ctx} headingId={`${ids.region}-factor-${f.id}`} />
        ))}

        <details data-assumptions="" className="group border-2 border-panel-border bg-panel p-3 text-sm">
          <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-1 font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-(--dur-ui) group-open:rotate-90" />
            {copy.ASSUMPTIONS_TITLE}
          </summary>
          <ul className="mt-2 space-y-2">
            {analysis.assumptions.map((a) => (
              <li key={a.id} data-analysis-assumption={a.id}>
                <p className="font-semibold">{a.title}</p>
                <p className="text-fg-muted">{a.detail}</p>
                {a.sourceUrl ? <ProvenanceLink href={a.sourceUrl} label="Rule source, on the wiki" srContext={`(${a.title})`} className="text-xs" /> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-muted">{copy.constantsFooter(analysis.constantsVersion)}</p>
        </details>

        {props.improve ? (
          <section aria-labelledby={`${ids.improve}-title`} className="space-y-3">
            <h3 id={`${ids.improve}-title`} className="sr-only">
              {copy.IMPROVE_TITLE}
            </h3>
            <button type="button" aria-expanded={props.improveOpen} aria-controls={ids.improve} onClick={props.onToggleImprove} data-improve-toggle="" className={buttonClass('secondary')}>
              <ChevronRight aria-hidden="true" className={cx('size-5 transition-transform duration-(--dur-ui)', props.improveOpen && 'rotate-90')} />
              {copy.IMPROVE}
            </button>
            <div id={ids.improve} hidden={!props.improveOpen}>
              {props.improveOpen ? <ImprovePanel result={props.improve} ctx={ctx} sprites={page.sprites} idPrefix={ids.improve} /> : null}
            </div>
          </section>
        ) : null}
      </div>
      {/* Last in the section: a sticky-bottom bar stays in view while any of the analysis is. Its sentence is the only one saying "out of date". */}
      {props.stale ? <ReRunBar reason={props.stale} messageId={staleId} onReanalyze={props.onReanalyze} /> : null}
    </section>
  )
}

/** ReRunBar (UX_SPEC §3.8/§7): sticky while the analysis is out of date — above the phone tab bar, near the bottom on desktop. */
function ReRunBar({ reason, messageId, onReanalyze }: { reason: 'setup' | 'progress'; messageId: string; onReanalyze: () => void }) {
  return (
    <div
      data-rerun-bar={reason}
      className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-(--z-hud) flex flex-wrap items-center justify-between gap-3 border-2 border-gold-500 bg-surface p-3 shadow-pixel-drop lg:bottom-4"
    >
      <p id={messageId} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
        <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {reason === 'setup' ? copy.STALE_SETUP : copy.STALE_PROGRESS}
      </p>
      <button type="button" onClick={onReanalyze} data-reanalyze="" className={buttonClass('primary')}>
        <RotateCw aria-hidden="true" className="size-5" />
        {copy.REANALYZE}
      </button>
    </div>
  )
}
