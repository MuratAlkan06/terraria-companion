import { CalendarDays, Check, Flag, Footprints, Lock } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { SpriteIndex } from '../data-access/types'
import { cx } from './cx'
import { WORLD_EVIL_LABEL, type MapNode, type NodeState } from './nodeMap/graph'
import type { PlacedNode } from './nodeMap/layout'
import type { NodeStatus, NodeUnlock } from './nodeMap/progressView'
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
 * Progress (P5-S4, ./nodeMap/progressView): the ring fills gold with a check when defeated, turns
 * dashed with a dimmed check when skipped; a locked node is subdued with a lock glyph; a recommended
 * node gets a green border with the footprints glyph (the recommended-next icon); a reached
 * milestone a gold border with a check. Every state has its glyph — never colour alone. The status
 * in words is in the node's description (NodeMap).
 *
 * Unlock cascade (UX_SPEC §12): with `unlock`, the node plays its part after `delayMs` — the ring
 * fills gold, the node comes up from its locked look while its lock glyph lifts away, a new
 * recommendation's border and glyph come in. Reduced motion: the same, opacity/colour only.
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
  /** What the map shows for the node (defaults from `state`: not attempted = available). */
  status?: NodeStatus
  /** This node's part in a running unlock cascade. */
  unlock?: NodeUnlock
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

/** The status glyph in the node's corner (aria-hidden: the description says it in words). */
const STATUS_GLYPH: Partial<Record<NodeStatus, { icon: typeof Lock; className: string }>> = {
  defeated: { icon: Check, className: 'border-gold-300 bg-gold-400 text-night-950' },
  reached: { icon: Check, className: 'border-gold-300 bg-gold-400 text-night-950' },
  skipped: { icon: Check, className: 'border-stone-500 bg-stone-800 text-stone-300' },
  recommended: { icon: Footprints, className: 'border-forest-300 bg-night-950 text-forest-300' },
  locked: { icon: Lock, className: 'border-earth-600 bg-night-950 text-gate' },
}

function StatusGlyph({ status, kind, className, style, animated = false }: { status: NodeStatus; kind: MapNode['kind']; className?: string; style?: CSSProperties; animated?: boolean }) {
  const glyph = STATUS_GLYPH[status]
  if (!glyph) return null
  const Icon = glyph.icon
  return (
    <span
      aria-hidden="true"
      data-status-glyph={status}
      data-unlock={animated ? 'glyph' : undefined}
      // Bosses: inside the top-right corner, clear of the ring and the world tab; markers: on the corner.
      className={cx(
        'pointer-events-none absolute grid size-4 place-items-center border',
        kind === 'boss' ? 'top-0.5 right-0.5' : '-top-2 -right-2',
        glyph.className,
        className,
      )}
      style={style}
    >
      <Icon className="size-3" strokeWidth={3} />
    </span>
  )
}

/** The node's border colour for its status (the selection border wins). */
function statusBorder(node: MapNode, status: NodeStatus, selected: boolean): string | false {
  if (selected) return 'border-gold-400'
  if (status === 'recommended') return 'border-forest-300'
  if (node.kind === 'milestone' && status === 'reached') return 'border-gold-400'
  return node.kind === 'boss' && 'border-panel-border'
}

export function BossNode({ node, box, sprites, inPlay, selected, state, status: given, unlock, describedBy, controls, hit, onSelect, href }: BossNodeProps) {
  const defeatState = state ?? 'not-attempted'
  const status: NodeStatus = given ?? (state ?? 'available')
  const delay = unlock ? `${unlock.delayMs}ms` : undefined
  const style = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    '--hit-x': `${hit.x}px`,
    '--hit-y': `${hit.y}px`,
    // The border/background change of a new status waits for the node's turn in the cascade too.
    ...(unlock ? { animationDelay: delay, transitionDelay: delay } : {}),
  } as CSSProperties
  const common = {
    'data-node-id': node.id,
    'data-kind': node.kind,
    'data-in-play': inPlay ? 'true' : 'false',
    'data-defeat-state': defeatState,
    'data-status': status,
    'data-unlock': unlock?.unlock ? 'node' : undefined,
    'aria-label': node.name,
    'aria-describedby': describedBy,
    style,
    className: cx(
      BASE,
      KIND_CLASSES[node.kind],
      statusBorder(node, status, selected),
      selected && 'bg-night-700 shadow-pixel-drop',
      !inPlay ? 'border-dashed opacity-45' : status === 'locked' && 'opacity-60',
      unlock?.unlock && 'motion-safe:animate-unlock-node motion-reduce:animate-unlock-fade',
    ),
  }
  const content = (
    <>
      {node.kind === 'boss' ? (
        <>
          <span
            aria-hidden="true"
            data-unlock={unlock?.ring ? 'ring' : undefined}
            className={cx(
              'grid size-16 shrink-0 place-items-center border-2 transition-colors duration-(--dur-ui)',
              RING[defeatState],
              defeatState === 'skipped' && 'opacity-70',
              unlock?.ring && 'animate-ring-fill',
            )}
            style={unlock?.ring ? { animationDelay: delay } : undefined}
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
      {/* While unlocking: the lock lifts away (fades in place under reduced motion), then the new glyph comes in. */}
      {unlock?.unlock && status !== 'locked' ? (
        <StatusGlyph
          status="locked"
          kind={node.kind}
          animated
          className="motion-safe:animate-lock-release motion-reduce:animate-lock-fade"
          style={{ animationDelay: delay }}
        />
      ) : null}
      <StatusGlyph
        key={status}
        status={status}
        kind={node.kind}
        animated={!!unlock && status !== 'locked'}
        className={unlock && status !== 'locked' ? 'animate-unlock-glow' : undefined}
        style={unlock && status !== 'locked' ? { animationDelay: delay } : undefined}
      />
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
