import { CircleDashed, Footprints, Lock, Split, Zap, type LucideIcon } from 'lucide-react'
import type { ProgressionEdge } from '../../data-access/types'

export type EdgeType = ProgressionEdge['type']

/**
 * The progression map's edge vocabulary (UX_SPEC §3.7, §9, §11; PRD P5-S1 AC2). Every edge type
 * differs by LINE STYLE, ENDPOINT MARKER and ICON — never by colour alone — and the legend is
 * generated from this same table, so the map and its legend can't disagree.
 *
 * Colours are the `--edge-*` design tokens (src/styles/tokens.css). Widths and dash patterns are in
 * map units (they scale with zoom like the rest of the map).
 */
export type EdgeMarker = 'arrow' | 'chevron' | 'dot' | 'diamond' | 'bar'

export interface EdgeStyle {
  type: EdgeType
  /** Legend label. */
  label: string
  /** One-line legend explanation. */
  description: string
  /** CSS colour (a design token). */
  color: string
  strokeWidth: number
  /** SVG stroke-dasharray; undefined = solid. */
  dash?: string
  /** Round caps turn a short-dash pattern into dots. */
  lineCap: 'butt' | 'round'
  marker: EdgeMarker
  icon: LucideIcon
  /** The icon in words, for copy that points at its badge ("shown as its lightning badge"). */
  iconName: string
}

/**
 * Drawing precedence when one pair of nodes carries several types (e.g. Hardmode → Duke Fishron is
 * both a required gate and an early challenge): the first listed type draws the line, every type
 * shows its icon.
 */
export const EDGE_PRECEDENCE: readonly EdgeType[] = [
  'required-gate',
  'recommended-next',
  'alternative-route',
  'optional',
  'early-challenge-possible',
]

export const EDGE_STYLES: Readonly<Record<EdgeType, EdgeStyle>> = {
  'required-gate': {
    type: 'required-gate',
    label: 'Required gate',
    description: 'Must be done first: it unlocks what follows.',
    color: 'var(--edge-required)',
    strokeWidth: 3,
    lineCap: 'butt',
    marker: 'arrow',
    icon: Lock,
    iconName: 'padlock',
  },
  'recommended-next': {
    type: 'recommended-next',
    label: 'Recommended next',
    description: 'The usual next step; not strictly required.',
    color: 'var(--edge-recommended)',
    strokeWidth: 2.5,
    dash: '9 6',
    lineCap: 'butt',
    marker: 'chevron',
    icon: Footprints,
    iconName: 'footprints',
  },
  optional: {
    type: 'optional',
    label: 'Optional',
    description: 'Not needed to progress; worth it for its rewards.',
    color: 'var(--edge-optional)',
    strokeWidth: 2.5,
    dash: '0.5 6',
    lineCap: 'round',
    marker: 'dot',
    icon: CircleDashed,
    iconName: 'dashed circle',
  },
  'alternative-route': {
    type: 'alternative-route',
    label: 'Alternative route',
    description: 'Either/or: your world has one or the other.',
    color: 'var(--edge-alt)',
    strokeWidth: 2.5,
    dash: '14 4 3 4',
    lineCap: 'butt',
    marker: 'diamond',
    icon: Split,
    iconName: 'split arrow',
  },
  'early-challenge-possible': {
    type: 'early-challenge-possible',
    label: 'Early challenge possible',
    description: 'Can be fought earlier than usual, at a much harder difficulty.',
    color: 'var(--edge-early)',
    strokeWidth: 2,
    dash: '3 3',
    lineCap: 'butt',
    marker: 'bar',
    icon: Zap,
    iconName: 'lightning',
  },
}

/**
 * A required gate once it's met (design review P5-S4 M3): the map swaps its padlock badge for a small
 * check, so an opened line never reads as locked. The legend's row for that form.
 */
export const GATE_MET = {
  label: 'Required gate, met',
  description: 'Its gate is marked done: the padlock turns into a check.',
} as const

/** Sorts types by drawing precedence (unknown types never occur: EdgeType is a closed enum). */
export function byPrecedence(types: Iterable<EdgeType>): EdgeType[] {
  return [...new Set(types)].sort((a, b) => EDGE_PRECEDENCE.indexOf(a) - EDGE_PRECEDENCE.indexOf(b))
}

/** SVG marker element id for a type (one <marker> per type, see NodeMap's <defs>). */
export const markerId = (type: EdgeType) => `edge-marker-${type}`
