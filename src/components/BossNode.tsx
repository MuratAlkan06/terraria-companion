import { CalendarDays, Flag } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { SpriteIndex } from '../data-access/types'
import { cx } from './cx'
import { WORLD_EVIL_LABEL, type MapNode, type NodeState } from './nodeMap/graph'
import type { PlacedNode } from './nodeMap/layout'
import { SpriteImg } from './SpriteImg'

/**
 * BossNode (UX_SPEC §3.1/§3.7): one progression-map node, a real <button> positioned on the map —
 * or, for a boss with a page (P5-S2, `href`), a real link to that page (same look and hit area).
 * - Boss: sprite (B30 still thumbnail for heavy GIFs) inside a defeat-state RING, name below.
 * - Event / milestone: a compact marker (AMENDMENTS-001 A3: markers only) — flag or calendar glyph
 *   plus name, so markers never read as boss fights.
 * - World-evil alternatives carry a tab naming their world; a node from the other world evil is
 *   dimmed AND dashed (never colour alone).
 * - The visible text is the node's map label (graph SHORT_LABELS), wrapped between words only
 *   (`wrap-normal` overrides the global `overflow-wrap: anywhere`) inside NODE_LABEL_BOX; the
 *   button's accessible name is always the full name.
 *
 * State hooks for the unlock cascade (UX_SPEC §12, P5-S4): `data-defeat-state` drives the ring
 * (stone = not attempted, gold = defeated, dashed = skipped) and `data-in-play` the dimming; both
 * transition on opacity/colour only, so reduced motion simply makes them instant.
 *
 * Hit area: the ::before layer reaches half-way into the gap around the node (`--hit-x/--hit-y`),
 * so taps land on the nearest node and neighbouring targets never overlap.
 */
export interface BossNodeProps {
  node: MapNode
  box: PlacedNode
  sprites: SpriteIndex | null
  /** False when the node belongs to the other world evil. */
  inPlay: boolean
  selected: boolean
  state: NodeState | undefined
  /** Id of the element describing the node (kind, stage, connections). */
  describedBy: string
  /** Id of the details card this button opens. */
  controls: string
  /** Hit-area reach past the box, in map px per screen axis. */
  hit: { x: number; y: number }
  onSelect: (id: string) => void
  /**
   * The node's own page (P5-S2 boss pages): the node is then a LINK to it instead of a button that
   * opens the focus card. Same look, data hooks and hit area.
   */
  href?: string
}

/** Sprite box inside the ring (map px). */
const SPRITE_BOX = 56

const BASE =
  'group absolute flex border-2 text-fg shadow-pixel transition-[opacity,border-color,background-color] duration-(--dur-ui) ease-out-strong ' +
  "before:absolute before:-inset-x-(--hit-x) before:-inset-y-(--hit-y) before:content-[''] " +
  // The global 2px focus ring, kept 2px on screen at any zoom.
  'focus-visible:outline-(length:--map-ring) focus-visible:outline-offset-(length:--map-ring)'

const KIND_CLASSES: Readonly<Record<MapNode['kind'], string>> = {
  boss: 'flex-col items-center gap-1 bg-panel px-1 pt-1.5 pb-1 hover:bg-night-700',
  milestone: 'items-center gap-1.5 border-earth-400 bg-earth-900 px-2 hover:bg-earth-800',
  event: 'items-center gap-1.5 border-dashed border-night-400 bg-night-900 px-2 hover:bg-night-800',
}

const RING: Readonly<Record<'not-attempted' | NodeState, string>> = {
  'not-attempted': 'border-stone-600 bg-slot',
  defeated: 'border-gold-400 bg-gold-700/40',
  skipped: 'border-dashed border-stone-500 bg-slot',
}

export function BossNode({ node, box, sprites, inPlay, selected, state, describedBy, controls, hit, onSelect, href }: BossNodeProps) {
  const defeatState = state ?? 'not-attempted'
  const style = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    '--hit-x': `${hit.x}px`,
    '--hit-y': `${hit.y}px`,
  } as CSSProperties
  const common = {
    'data-node-id': node.id,
    'data-kind': node.kind,
    'data-in-play': inPlay ? 'true' : 'false',
    'data-defeat-state': defeatState,
    'aria-label': node.name,
    'aria-describedby': describedBy,
    style,
    className: cx(
      BASE,
      KIND_CLASSES[node.kind],
      node.kind === 'boss' && (selected ? 'border-gold-400' : 'border-panel-border'),
      node.kind !== 'boss' && selected && 'border-gold-400',
      selected && 'bg-night-700 shadow-pixel-drop',
      !inPlay && 'border-dashed opacity-45',
    ),
  }
  const content = (
    <>
      {node.kind === 'boss' ? (
        <>
          <span
            aria-hidden="true"
            className={cx('grid size-16 shrink-0 place-items-center border-2 transition-colors duration-(--dur-ui)', RING[defeatState])}
          >
            <SpriteImg src={node.boss?.sprite} sprites={sprites} placeholder="creature" box={SPRITE_BOX} />
          </span>
          <span aria-hidden="true" className="line-clamp-2 text-center text-xs leading-tight font-semibold wrap-normal" data-node-label="">
            {node.label}
          </span>
        </>
      ) : (
        <>
          {node.kind === 'milestone' ? (
            <Flag aria-hidden="true" className="size-4 shrink-0 text-gold-300" />
          ) : (
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-night-200" />
          )}
          <span aria-hidden="true" className="line-clamp-3 text-left text-xs leading-tight font-semibold wrap-normal" data-node-label="">
            {node.label}
          </span>
        </>
      )}
      {node.worldEvil ? (
        <span
          aria-hidden="true"
          className="absolute -top-2.5 left-1/2 -translate-x-1/2 border border-night-400 bg-night-950 px-1 text-xs leading-4 font-semibold tracking-wide whitespace-nowrap text-night-200 uppercase"
        >
          {WORLD_EVIL_LABEL[node.worldEvil]}
        </span>
      ) : null}
    </>
  )
  if (href) {
    return (
      <Link to={href} data-node-page="" {...common}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" aria-expanded={selected} aria-controls={selected ? controls : undefined} onClick={() => onSelect(node.id)} {...common}>
      {content}
    </button>
  )
}
