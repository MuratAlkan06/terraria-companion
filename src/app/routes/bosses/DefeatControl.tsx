import { Check, Footprints, Lock, SkipForward, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { cx } from '../../../components/cx'
import type { MapGraph, NodeState, WorldEvil } from '../../../components/nodeMap/graph'
import { bossesToMark, canSkip, mapProgress, newlyOpened, NODE_STATUS_LABEL, type NodeStatus } from '../../../components/nodeMap/progressView'
import { useProgressStore } from '../../progressStore'
import { lockedNote, PROGRESS_LEGEND, STATE_LABEL, stateAnnouncement, UNSAVED_NOTE } from './focusCardCopy'

/**
 * Defeat tracking (PRD P5-S4 AC1; UX_SPEC §3.7 "defeat-state toggle", §9): the three-state control on
 * boss pages and on the map's focus cards — Not attempted / Defeated / Skipped, "Skipped" only for an
 * optional boss (progressView.canSkip) or one already marked skipped. Native radios in a fieldset
 * (arrow keys move the choice). The chosen option is never told by colour alone (design review P5-S4
 * M4): whichever it is, its segment is filled and leads with a check; the others are outline-only.
 *
 * The shown state comes from the caller's props (the shared progress store, so every surface agrees);
 * a change writes to the store (tc.v1.progress, saved at once) and is announced politely with what it
 * opened on the map. A locked boss says which gates the map is still waiting for; an unsaved change
 * says so.
 */
export interface DefeatControlProps {
  graph: MapGraph
  nodeId: string
  worldEvil: WorldEvil | null
  nodeStates: Readonly<Record<string, NodeState>>
  className?: string
}

type Choice = 'not-attempted' | NodeState

/** The chosen segment's fill: the defeated gold of the map's ring, else the raised night fill. */
const CHOSEN_FILL: Readonly<Record<Choice, string>> = {
  'not-attempted': 'bg-night-600 text-fg',
  defeated: 'bg-gold-700/60 text-accent-strong',
  skipped: 'bg-night-600 text-fg',
}

function withState(nodeStates: Readonly<Record<string, NodeState>>, id: string, state: NodeState | null): Record<string, NodeState> {
  const { [id]: _previous, ...others } = nodeStates
  return state ? { ...others, [id]: state } : others
}

export function DefeatControl({ graph, nodeId, worldEvil, nodeStates, className }: DefeatControlProps) {
  const name = useId()
  const setNodeState = useProgressStore((s) => s.setNodeState)
  const unsaved = useProgressStore((s) => s.persistError)
  const [announcement, setAnnouncement] = useState('')
  const node = graph.nodeById.get(nodeId)
  if (!node) return null
  const current: Choice = nodeStates[nodeId] ?? 'not-attempted'
  const choices: Choice[] = canSkip(graph, nodeId) || current === 'skipped' ? ['not-attempted', 'defeated', 'skipped'] : ['not-attempted', 'defeated']
  const progress = mapProgress(graph, nodeStates, worldEvil)
  const gates = progress.nodes.get(nodeId) === 'locked' ? bossesToMark(graph, progress, nodeId).map((g) => graph.nodeById.get(g)?.name ?? g) : []

  const choose = (choice: Choice) => {
    const state = choice === 'not-attempted' ? null : choice
    const after = mapProgress(graph, withState(nodeStates, nodeId, state), worldEvil)
    const opened = newlyOpened(graph, progress, after).map((id) => graph.nodeById.get(id)?.name ?? id)
    const saved = setNodeState(nodeId, state)
    setAnnouncement(stateAnnouncement(node.name, state, opened, saved))
  }

  return (
    <fieldset data-defeat-control={nodeId} className={cx('min-w-0 space-y-1.5', className)}>
      <legend className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{PROGRESS_LEGEND}</legend>
      <div className="grid w-full max-w-md auto-cols-fr grid-flow-col border-2 border-panel-border shadow-pixel">
        {choices.map((choice) => {
          const checked = choice === current
          return (
            <label
              key={choice}
              data-chosen={checked ? 'true' : 'false'}
              className={cx(
                'relative flex min-h-tap cursor-pointer items-center justify-center gap-1.5 px-2 py-1 text-center text-sm leading-tight font-semibold not-last:border-r-2 not-last:border-panel-border',
                'transition-colors duration-(--dur-ui) has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring has-focus-visible:outline-solid',
                checked ? CHOSEN_FILL[choice] : 'bg-transparent text-fg-muted hover:bg-night-700 hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice}
                checked={checked}
                onChange={() => choose(choice)}
                data-defeat-option={choice}
                className="sr-only"
              />
              {checked ? <Check aria-hidden="true" data-chosen-glyph="" className="size-4 shrink-0" strokeWidth={3} /> : null}
              {STATE_LABEL[choice]}
            </label>
          )
        })}
      </div>
      {gates.length > 0 ? (
        <p data-locked-note="" className="flex items-start gap-1.5 text-xs text-fg-muted">
          <Lock aria-hidden="true" className="mt-px size-3.5 shrink-0 text-gate" />
          {lockedNote(gates)}
        </p>
      ) : null}
      {unsaved ? <p className="text-xs text-negative">{UNSAVED_NOTE}</p> : null}
      <p role="status" className="sr-only" data-defeat-announcer="">
        {announcement}
      </p>
    </fieldset>
  )
}

const STATUS_ICON: Partial<Record<NodeStatus, LucideIcon>> = {
  defeated: Check,
  reached: Check,
  skipped: SkipForward,
  recommended: Footprints,
  locked: Lock,
}

/**
 * A node's map status as a compact tag (glyph + word): boss pages' next steps and the focus card of
 * a milestone or event, which follow the bosses that gate them instead of being marked.
 */
export function NodeStatusTag({ status, size = 'xs', className }: { status: NodeStatus; size?: 'xs' | 'sm'; className?: string }) {
  const Icon = STATUS_ICON[status]
  return (
    <span
      data-node-status={status}
      className={cx(
        'inline-flex items-center gap-1 font-semibold whitespace-nowrap',
        size === 'sm' ? 'text-sm' : 'text-xs',
        status === 'defeated' || status === 'reached' ? 'text-accent' : status === 'recommended' ? 'text-success' : status === 'locked' ? 'text-gate' : 'text-fg-muted',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} /> : null}
      {NODE_STATUS_LABEL[status]}
    </span>
  )
}
