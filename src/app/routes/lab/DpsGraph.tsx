import type { Assumptions } from '../../../components/assumptions'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import type { LabGraphHud } from '../../../lab/labSession'
import { dpsGraphModel, dpsGraphSummary } from './dpsGraphModel'
import { formatInt, HUD_PANEL } from './hudStyles'

/**
 * DpsGraph (UX_SPEC §3.4 bottom strip, PRD P3-S3 AC2): the last 30 seconds of the engine's
 * per-second damage, as bars; the current second so far is an outlined bar (outline, not colour,
 * tells it apart). Updates as the numbers change with no decorative animation, so reduced motion
 * needs no special case (UX_SPEC §9: "DpsGraph still updates"). The bars are drawing only
 * (aria-hidden); the same numbers are in text beside them.
 */
const SLOT = 10
const HEIGHT = 40

export function DpsGraph({ graph, assumptions, compact }: { graph: LabGraphHud; assumptions: Assumptions; compact: boolean }) {
  const model = dpsGraphModel(graph)
  const { bars, scaleMax, peak, latest, windowSeconds } = model
  const offset = windowSeconds - bars.length
  const empty = peak === 0
  return (
    <section aria-label="Damage per second graph" className={cx(HUD_PANEL, compact ? 'p-1.5' : 'p-2')} data-dps-graph="">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
        <p className="inline-flex items-center gap-1 font-semibold text-fg">
          Damage per second
          <EstimateLabel assumptions={assumptions} context="damage per second graph" />
        </p>
        {empty ? (
          <p className="text-fg-muted" data-graph-empty="">
            Attack to draw the graph
          </p>
        ) : (
          <p className="text-fg-muted tabular-nums">
            peak <span className="font-semibold text-fg" data-graph="peak">{formatInt(peak)}</span>
            {latest !== null ? (
              <>
                {' · last second '}
                <span className="font-semibold text-fg" data-graph="latest">
                  {formatInt(latest)}
                </span>
              </>
            ) : null}
          </p>
        )}
      </div>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${windowSeconds * SLOT} ${HEIGHT}`}
        preserveAspectRatio="none"
        className={cx('mt-1 block w-full', compact ? 'h-8' : 'h-10')}
        data-graph-bars={bars.length}
      >
        <line x1={0} y1={HEIGHT - 0.5} x2={windowSeconds * SLOT} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {bars.map((bar, i) => {
          const h = scaleMax > 0 ? (bar.damage / scaleMax) * (HEIGHT - 2) : 0
          const x = (offset + i) * SLOT + 1
          return bar.partial ? (
            <rect
              key={bar.second}
              x={x + 0.5}
              y={HEIGHT - 1 - h}
              width={SLOT - 3}
              height={h}
              className="fill-none stroke-accent"
              strokeWidth={1.5}
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
              data-bar="partial"
            />
          ) : (
            <rect key={bar.second} x={x} y={HEIGHT - 1 - h} width={SLOT - 2} height={h} className="fill-accent" data-bar={bar.damage} />
          )
        })}
      </svg>
      <p className="sr-only">{dpsGraphSummary(model)}</p>
    </section>
  )
}
