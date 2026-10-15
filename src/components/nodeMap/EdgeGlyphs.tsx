import { Check } from 'lucide-react'
import { EDGE_STYLES, markerId, type EdgeMarker, type EdgeType } from './edgeStyles'

/**
 * SVG pieces shared by the map and its legend, so both draw the exact same symbols: endpoint
 * marker shapes, the per-type icon badge, and a short sample of a line style.
 */

/** Marker shape in a 10×10 box, tip/centre at (10, 5) or (5, 5). */
function MarkerShape({ marker, color }: { marker: EdgeMarker; color: string }) {
  switch (marker) {
    case 'arrow':
      return <path d="M0 0L10 5L0 10Z" style={{ fill: color }} />
    case 'chevron':
      return <path d="M1 0.5L9 5L1 9.5" style={{ fill: 'none', stroke: color, strokeWidth: 2.25 }} />
    case 'dot':
      return <circle cx="5" cy="5" r="3.5" style={{ fill: 'var(--color-surface-sunken)', stroke: color, strokeWidth: 2 }} />
    case 'diamond':
      return <path d="M0 5L5 0L10 5L5 10Z" style={{ fill: color }} />
    case 'bar':
      return <path d="M7 0V10" style={{ stroke: color, strokeWidth: 3 }} />
  }
}

/** Where on the 10×10 shape the line ends (the marker's reference point). */
const REF_X: Readonly<Record<EdgeMarker, number>> = { arrow: 9, chevron: 8, dot: 8.5, diamond: 9, bar: 7 }

/** One <marker> per edge type for the map's <defs>. Sized in map units so it scales with zoom. */
export function EdgeMarkerDefs() {
  return (
    <defs>
      {Object.values(EDGE_STYLES).map((style) => (
        <marker
          key={style.type}
          id={markerId(style.type)}
          viewBox="0 0 10 10"
          refX={REF_X[style.marker]}
          refY="5"
          markerWidth="11"
          markerHeight="11"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <MarkerShape marker={style.marker} color={style.color} />
        </marker>
      ))}
    </defs>
  )
}

export const BADGE_SIZE = 16
const BADGE_GAP = 2
/** A met gate's check badge: smaller than a type badge, centred in its slot. */
const MET_SIZE = 12

/** One type's badge (a BADGE_SIZE square at the origin): framed icon, in the type's colour. */
function TypeBadge({ type }: { type: EdgeType }) {
  const Icon = EDGE_STYLES[type].icon
  return (
    <>
      <rect x="0.75" y="0.75" width={BADGE_SIZE - 1.5} height={BADGE_SIZE - 1.5} style={{ fill: 'var(--color-night-950)', stroke: 'currentColor', strokeWidth: 1.5 }} />
      <Icon x={3} y={3} width={10} height={10} strokeWidth={2.5} aria-hidden="true" />
    </>
  )
}

/** A met required gate (design review P5-S4 M3): a small check where the padlock was, so an opened line never reads as locked. */
function MetGateBadge() {
  const offset = (BADGE_SIZE - MET_SIZE) / 2
  return (
    <g transform={`translate(${offset} ${offset})`} data-gate-met="">
      <rect x="0.75" y="0.75" width={MET_SIZE - 1.5} height={MET_SIZE - 1.5} style={{ fill: 'var(--color-night-950)', stroke: 'currentColor', strokeWidth: 1.5 }} />
      <Check x={2} y={2} width={8} height={8} strokeWidth={3} aria-hidden="true" />
    </g>
  )
}

/**
 * Icon badges for one link, centred on (x, y): one per type, in precedence order — the "icon"
 * half of UX_SPEC §9's "line style + icon, not colour alone". A required gate shows its padlock only
 * while the gate is unmet; once met (`gateMet`), a small check. `gateDelayMs`: the gate was met in a
 * running unlock cascade — the padlock fades out as the check fades in, at that delay.
 */
export function EdgeBadges({
  types,
  x,
  y,
  dimmed = false,
  gateMet = false,
  gateDelayMs,
}: {
  types: readonly EdgeType[]
  x: number
  y: number
  dimmed?: boolean
  gateMet?: boolean
  gateDelayMs?: number
}) {
  const width = types.length * BADGE_SIZE + (types.length - 1) * BADGE_GAP
  return (
    <g transform={`translate(${x - width / 2} ${y - BADGE_SIZE / 2})`} opacity={dimmed ? 0.4 : 1}>
      {types.map((type, i) => {
        const gate = type === 'required-gate'
        const met = gate && gateMet
        const delay = { animationDelay: `${gateDelayMs}ms` }
        return (
          <g
            key={type}
            transform={`translate(${i * (BADGE_SIZE + BADGE_GAP)} 0)`}
            style={{ color: EDGE_STYLES[type].color }}
            data-badge={type}
            data-gate={gate ? (met ? 'met' : 'closed') : undefined}
          >
            {!met ? (
              <TypeBadge type={type} />
            ) : gateDelayMs === undefined ? (
              <MetGateBadge />
            ) : (
              <>
                <g data-unlock="gate" className="animate-lock-fade" style={delay}>
                  <TypeBadge type={type} />
                </g>
                <g data-unlock="gate" className="animate-unlock-glow" style={delay}>
                  <MetGateBadge />
                </g>
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

/**
 * A short horizontal sample of a type's line, marker and icon (legend rows). With `host`: the type
 * never draws a line of its own on the map, only its icon badge on its host's line — so the sample
 * is that: the host's line and marker, with the host's and this type's badges on it, as the map
 * draws such a link. `gateMet` (a required gate): its met form, the check in place of the padlock.
 */
export function EdgeSample({ type, host, gateMet = false, className }: { type: EdgeType; host?: EdgeType; gateMet?: boolean; className?: string }) {
  if (host) {
    const line = EDGE_STYLES[host]
    return (
      <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden="true" className={className} data-edge-sample-host={host}>
        <line x1="2" y1="10" x2="52" y2="10" style={{ stroke: line.color, strokeWidth: line.strokeWidth, strokeDasharray: line.dash, strokeLinecap: line.lineCap }} />
        <g transform={`translate(${52 - REF_X[line.marker] + 0.5} 4.5) scale(1.1)`}>
          <MarkerShape marker={line.marker} color={line.color} />
        </g>
        <EdgeBadges types={[host, type]} x={25} y={10} />
      </svg>
    )
  }
  const style = EDGE_STYLES[type]
  return (
    <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden="true" className={className} data-edge-sample-gate={gateMet ? 'met' : undefined}>
      <line
        x1="2"
        y1="10"
        x2="36"
        y2="10"
        style={{ stroke: style.color, strokeWidth: style.strokeWidth, strokeDasharray: style.dash, strokeLinecap: style.lineCap }}
      />
      <g transform={`translate(${36 - REF_X[style.marker] + 0.5} 4.5) scale(1.1)`}>
        <MarkerShape marker={style.marker} color={style.color} />
      </g>
      <g transform="translate(46 2)" style={{ color: style.color }}>
        {gateMet && type === 'required-gate' ? <MetGateBadge /> : <TypeBadge type={type} />}
      </g>
    </svg>
  )
}
