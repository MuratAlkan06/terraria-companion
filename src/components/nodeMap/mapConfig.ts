import type { GraphLayout, LayoutOptions, Orientation } from './layout'

/**
 * Map geometry and zoom rules (UX_SPEC §3.7, §7, §9), in map px.
 *
 * Orientation: phones and tablets read the tree top→bottom (vertical); desktop, where the screen is
 * wide, reads it left→right (horizontal). Same layout algorithm, axes swapped.
 */
export const MAP_LAYOUT_OPTIONS: Readonly<Record<Orientation, LayoutOptions>> = {
  vertical: { orientation: 'vertical', layerGap: 64, nodeGap: 20, groupGap: 40, laneWidth: 14, bandLeadIn: 36, crossLeadIn: 0, margin: 20 },
  horizontal: { orientation: 'horizontal', layerGap: 92, nodeGap: 20, groupGap: 40, laneWidth: 14, bandLeadIn: 20, crossLeadIn: 40, margin: 24 },
}

/** Zoom the map opens at (never below the active minimum): names stay readable on a phone. */
export const INITIAL_ZOOM: Readonly<Record<Orientation, number>> = { vertical: 0.85, horizontal: 1 }

/**
 * What the map opens framed on (./opening.ts). Desktop (`region`): the whole opening region — the
 * start through the first either/or fork — fitted to the map, never above INITIAL_ZOOM, so the fork
 * is on screen on a laptop too. Phones (`start`): the start centred at INITIAL_ZOOM, where names stay
 * readable (the region is wider than a phone at that zoom).
 */
export const OPENING_FRAME: Readonly<Record<Orientation, 'region' | 'start'>> = { vertical: 'start', horizontal: 'region' }

/** The bottom strip a row of zoom controls takes (screen px): 44px buttons + 4px border + its 8px offset + an 8px gap. */
export const CONTROLS_ROW_INSET = 64

/** UX_SPEC §9: touch targets ≥ 44×44 CSS px. */
export const TAP_TARGET_PX = 44
export const MAX_ZOOM = 2
/** Lowest zoom for a fine pointer (mouse), where the 44px touch rule does not bind. */
export const POINTER_MIN_ZOOM = 0.3

/**
 * How far each node's hit area reaches past its box (map px): half the gap to every neighbour,
 * so neighbouring hit areas touch but never overlap.
 */
export function hitPadding(options: LayoutOptions): { main: number; cross: number } {
  return { main: options.layerGap / 2, cross: Math.min(options.nodeGap, options.groupGap) / 2 }
}

/**
 * The tap-target floor: the smallest zoom at which every node's hit area (box + hit padding) is
 * still ≥ 44px on screen. Touch screens never zoom out past it ("node tap targets ≥ 44px at any
 * zoom", UX_SPEC §7).
 */
export function tapFloorZoom(layout: GraphLayout, options: LayoutOptions): number {
  const pad = hitPadding(options)
  let smallest = Infinity
  for (const n of layout.nodes.values()) {
    const main = (layout.orientation === 'vertical' ? n.height : n.width) + pad.main * 2
    const cross = (layout.orientation === 'vertical' ? n.width : n.height) + pad.cross * 2
    smallest = Math.min(smallest, main, cross)
  }
  return Number.isFinite(smallest) ? Math.min(1, TAP_TARGET_PX / smallest) : 1
}
