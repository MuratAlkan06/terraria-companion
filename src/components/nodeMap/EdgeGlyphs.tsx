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

/**
 * Icon badges for one link, centred on (x, y): one per type, in precedence order — the "icon"
 * half of UX_SPEC §9's "line style + icon, not colour alone".
 */
export function EdgeBadges({ types, x, y, dimmed = false }: { types: readonly EdgeType[]; x: number; y: number; dimmed?: boolean }) {
  const width = types.length * BADGE_SIZE + (types.length - 1) * BADGE_GAP
  return (
    <g transform={`translate(${x - width / 2} ${y - BADGE_SIZE / 2})`} opacity={dimmed ? 0.4 : 1}>
      {types.map((type, i) => {
        const style = EDGE_STYLES[type]
        const Icon = style.icon
        return (
          <g key={type} transform={`translate(${i * (BADGE_SIZE + BADGE_GAP)} 0)`} style={{ color: style.color }} data-badge={type}>
            <rect
              x="0.75"
              y="0.75"
              width={BADGE_SIZE - 1.5}
              height={BADGE_SIZE - 1.5}
              style={{ fill: 'var(--color-night-950)', stroke: 'currentColor', strokeWidth: 1.5 }}
            />
            <Icon x={3} y={3} width={10} height={10} strokeWidth={2.5} aria-hidden="true" />
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
 * draws such a link.
 */
export function EdgeSample({ type, host, className }: { type: EdgeType; host?: EdgeType; className?: string }) {
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
  const Icon = style.icon
  return (
    <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden="true" className={className}>
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
        <rect x="0.75" y="0.75" width={BADGE_SIZE - 1.5} height={BADGE_SIZE - 1.5} style={{ fill: 'var(--color-night-950)', stroke: 'currentColor', strokeWidth: 1.5 }} />
        <Icon x={3} y={3} width={10} height={10} strokeWidth={2.5} aria-hidden="true" />
      </g>
    </svg>
  )
}
