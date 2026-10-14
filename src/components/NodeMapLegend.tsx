import { CalendarDays, Check, Flag, Footprints, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { EdgeSample } from './nodeMap/EdgeGlyphs'
import { EDGE_PRECEDENCE, EDGE_STYLES, GATE_MET, type EdgeType } from './nodeMap/edgeStyles'

/**
 * NodeMapLegend (UX_SPEC §3.7, PRD P5-S1 AC2): every edge type with its line, endpoint marker and
 * icon — drawn by the same components as the map, from the same style table — plus the node kinds,
 * the either/or convention and the tracked-progress states (P5-S4: each with its glyph, as BossNode
 * draws it). Rendered inside the map's collapsible legend panel. A type that the
 * map only ever shows as a badge on another type's line (`forms`, graph.edgeLegendForms) is shown in
 * that form, so the legend never teaches a line the map doesn't draw.
 */
export interface NodeMapLegendProps {
  titleId: string
  className?: string
  /** Types drawn only as a badge on a host type's line (graph.edgeLegendForms). */
  forms?: Partial<Record<EdgeType, { host: EdgeType }>>
  /** Extra content under the key (e.g. the data source link). */
  footer?: ReactNode
}

function NodeKindSample({ kind }: { kind: 'boss' | 'milestone' | 'event' | 'out-of-play' }) {
  const base = 'grid h-5 w-16 shrink-0 place-items-center border-2'
  switch (kind) {
    case 'boss':
      return <span aria-hidden="true" className={cx(base, 'border-panel-border bg-panel')}><span className="size-3 border-2 border-stone-600 bg-slot" /></span>
    case 'milestone':
      return <span aria-hidden="true" className={cx(base, 'border-earth-400 bg-earth-900')}><Flag className="size-3 text-gold-300" /></span>
    case 'event':
      return <span aria-hidden="true" className={cx(base, 'border-dashed border-night-400 bg-night-900')}><CalendarDays className="size-3 text-night-200" /></span>
    case 'out-of-play':
      return <span aria-hidden="true" className={cx(base, 'border-dashed border-panel-border bg-panel opacity-45')}><span className="size-3 border-2 border-stone-600 bg-slot" /></span>
  }
}

const NODE_ROWS = [
  { kind: 'boss', label: 'Boss', description: 'A boss fight. Select it for how to summon it.' },
  { kind: 'milestone', label: 'Milestone', description: 'A point in the game, not a fight.' },
  { kind: 'event', label: 'Event', description: 'An invasion or moon event (marker only).' },
  { kind: 'out-of-play', label: 'Other world evil', description: 'Dimmed and dashed: not in a world of your chosen evil.' },
] as const

/** A node-state sample: a small node with the status glyph BossNode puts in its corner. */
function StatusSample({ status }: { status: (typeof STATUS_ROWS)[number]['status'] }) {
  const base = 'relative grid h-5 w-16 shrink-0 place-items-center border-2 bg-panel'
  const glyph = 'absolute -top-1.5 -right-1.5 grid size-3.5 place-items-center border'
  switch (status) {
    case 'defeated':
      return (
        <span aria-hidden="true" className={cx(base, 'border-panel-border')}>
          <span className="size-3 border-2 border-gold-400 bg-gold-700/40" />
          <span className={cx(glyph, 'border-gold-300 bg-gold-400 text-night-950')}><Check className="size-2.5" strokeWidth={3} /></span>
        </span>
      )
    case 'skipped':
      return (
        <span aria-hidden="true" className={cx(base, 'border-panel-border')}>
          <span className="size-3 border-2 border-dashed border-stone-500 bg-slot opacity-70" />
          <span className={cx(glyph, 'border-stone-500 bg-stone-800 text-stone-300')}><Check className="size-2.5" strokeWidth={3} /></span>
        </span>
      )
    case 'recommended':
      return (
        <span aria-hidden="true" className={cx(base, 'border-forest-300')}>
          <span className="size-3 border-2 border-stone-600 bg-slot" />
          <span className={cx(glyph, 'border-forest-300 bg-night-950 text-forest-300')}><Footprints className="size-2.5" strokeWidth={3} /></span>
        </span>
      )
    case 'locked':
      return (
        <span aria-hidden="true" className={cx(base, 'border-panel-border opacity-60')}>
          <span className="size-3 border-2 border-stone-600 bg-slot" />
          <span className={cx(glyph, 'border-earth-600 bg-night-950 text-gate')}><Lock className="size-2.5" strokeWidth={3} /></span>
        </span>
      )
  }
}

const STATUS_ROWS = [
  { status: 'defeated', label: 'Defeated', description: 'Marked defeated: gold ring with a check. Milestones it completes turn gold too.' },
  { status: 'skipped', label: 'Skipped', description: 'An optional boss you passed by: dashed ring, dimmed check.' },
  { status: 'recommended', label: 'Recommended next', description: 'Open, and the next step from something you’ve done: green border, footprints.' },
  { status: 'locked', label: 'Locked', description: 'A required gate isn’t marked done: subdued, with a padlock.' },
] as const

export function NodeMapLegend({ titleId, className, forms = {}, footer }: NodeMapLegendProps) {
  return (
    <section aria-labelledby={titleId} className={cx('space-y-3 text-sm', className)}>
      <h2 id={titleId} className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Legend
      </h2>
      <ul className="space-y-2" aria-label="Connection types">
        {EDGE_PRECEDENCE.flatMap((type) => {
          const style = EDGE_STYLES[type]
          const host = forms[type]?.host
          const row = (
            <li key={type} data-legend-edge={type} className="flex items-start gap-2">
              <EdgeSample type={type} host={host} className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-semibold">{style.label}</span>
                <span className="block text-xs text-fg-muted">
                  {style.description}
                  {host ? ` Shown as its ${style.iconName} badge on a ${EDGE_STYLES[host].label.toLowerCase()} line.` : null}
                </span>
              </span>
            </li>
          )
          if (type !== 'required-gate') return [row]
          // The padlock only marks a gate still to do (design review P5-S4 M3).
          return [
            row,
            <li key="gate-met" data-legend-gate="met" className="flex items-start gap-2">
              <EdgeSample type="required-gate" gateMet className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-semibold">{GATE_MET.label}</span>
                <span className="block text-xs text-fg-muted">{GATE_MET.description}</span>
              </span>
            </li>,
          ]
        })}
      </ul>
      <ul className="space-y-2 border-t-2 border-panel-border pt-3" aria-label="Map symbols">
        {NODE_ROWS.map((row) => (
          <li key={row.kind} data-legend-node={row.kind} className="flex items-start gap-2">
            <NodeKindSample kind={row.kind} />
            <span>
              <span className="block font-semibold">{row.label}</span>
              <span className="block text-xs text-fg-muted">{row.description}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="space-y-2 border-t-2 border-panel-border pt-3" aria-label="Your progress">
        {STATUS_ROWS.map((row) => (
          <li key={row.status} data-legend-status={row.status} className="flex items-start gap-2">
            <StatusSample status={row.status} />
            <span>
              <span className="block font-semibold">{row.label}</span>
              <span className="block text-xs text-fg-muted">{row.description}</span>
            </span>
          </li>
        ))}
      </ul>
      {footer}
    </section>
  )
}
