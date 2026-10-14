import { CalendarDays, ExternalLink, Flag, X } from 'lucide-react'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { CuratedLabel } from '../../../components/CuratedLabel'
import { cx } from '../../../components/cx'
import { EDGE_STYLES } from '../../../components/nodeMap/edgeStyles'
import {
  connectionsOf,
  isNodeActive,
  KIND_LABEL,
  stageName,
  WORLD_EVIL_LABEL,
  type Connection,
  type MapGraph,
  type NodeState,
  type WorldEvil,
} from '../../../components/nodeMap/graph'
import { NoBreak } from '../../../components/NoBreak'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import type { SpriteIndex } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import { DISPLAY_ONLY_NOTE, STATE_LABEL } from './focusCardCopy'

/**
 * The map's compact focus card (PRD P5-S1 AC4; UX_SPEC §3.7, §4d). Boss pages are P5-S2/S3, so a
 * node opens this card instead — never a dead local link: name, kind, stage, the summon text with
 * its source, the node's progress state (display only: this map marks nothing), its typed
 * connections (each with its own wiki source, and a button that moves the map to the other node)
 * and the node's wiki article.
 *
 * Non-modal: the map stays usable behind it. Esc or the close button closes it; the page returns
 * focus to the node.
 */
export interface BossFocusCardProps {
  id: string
  graph: MapGraph
  nodeId: string
  sprites: SpriteIndex | null
  worldEvil: WorldEvil | null
  state: NodeState | undefined
  onClose: () => void
  /** Move the map (and this card) to another node. */
  onJump: (id: string) => void
  headingRef?: Ref<HTMLHeadingElement>
  /** The card's root element (the page measures it to keep the map's nodes clear of it). */
  rootRef?: Ref<HTMLElement>
  className?: string
}

const headingId = (id: string) => `${id}-title`

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ConnectionList({ title, items, onJump, direction }: { title: string; items: Connection[]; onJump: (id: string) => void; direction: 'in' | 'out' | 'alt' }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      <ul className="space-y-1">
        {items.map(({ link, other }) => {
          const sources = [...new Set(link.edges.map((e) => e.sourceUrl))]
          const typeText = link.types.map((t) => EDGE_STYLES[t].label).join(' · ')
          const relation = direction === 'in' ? `${other.name} to this node` : direction === 'out' ? `this node to ${other.name}` : `this node or ${other.name}`
          return (
            <li key={link.id} data-connection={link.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="flex shrink-0 gap-0.5">
                {link.types.map((t) => {
                  const Icon = EDGE_STYLES[t].icon
                  return (
                    <span key={t} className="grid size-5 place-items-center border-[1.5px] bg-night-950" style={{ color: EDGE_STYLES[t].color, borderColor: 'currentColor' }}>
                      <Icon className="size-3" strokeWidth={2.5} />
                    </span>
                  )
                })}
              </span>
              <span className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onJump(other.id)}
                  className="min-h-tap text-left font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
                >
                  {other.name}
                  <span className="sr-only"> ({typeText}) — show on the map</span>
                </button>
                <span aria-hidden="true" className="-mt-2 block text-xs text-fg-muted">
                  {typeText}
                </span>
              </span>
              {sources.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Source on terraria.wiki.gg"
                  className="grid min-h-tap min-w-tap shrink-0 place-items-center text-link hover:text-accent-strong"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  <span className="sr-only">
                    Source for the connection from {relation} on terraria.wiki.gg (opens in a new tab)
                  </span>
                </a>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function BossFocusCard({ id, graph, nodeId, sprites, worldEvil, state, onClose, onJump, headingRef, rootRef, className }: BossFocusCardProps) {
  const node = graph.nodeById.get(nodeId)
  if (!node) return null
  const record = node.boss ?? node.node
  const stage = getField(record, 'stage')
  const summon = node.boss ? getField(node.boss, 'summon.text') : undefined
  const summonSource = node.boss?.summon.sourceUrl ?? node.boss?.wikiUrl
  const { before, after, alternatives } = connectionsOf(graph, nodeId)
  const inPlay = isNodeActive(node, worldEvil)

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }

  return (
    <section
      ref={rootRef}
      id={id}
      aria-labelledby={headingId(id)}
      onKeyDown={onKeyDown}
      data-focus-card={nodeId}
      className={cx('flex flex-col border-2 border-gold-600 bg-surface text-fg shadow-pixel-drop', className)}
    >
      <header className="flex items-start gap-3 border-b-2 border-panel-border p-3">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center border-2 border-slot-border bg-slot">
          {node.kind === 'boss' ? (
            <SpriteImg src={node.boss?.sprite} sprites={sprites} placeholder="creature" box={48} />
          ) : node.kind === 'milestone' ? (
            <Flag className="size-6 text-gold-300" />
          ) : (
            <CalendarDays className="size-6 text-night-200" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {KIND_LABEL[node.kind]}
            {node.kind === 'boss' ? null : ' · marker'}
          </p>
          <h2 ref={headingRef} id={headingId(id)} tabIndex={-1} className="text-lg leading-snug font-semibold text-shadow-pixel focus:outline-none">
            {node.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        <dl className="space-y-3 text-sm">
          {stage.status === 'not-applicable' ? null : (
            <Row term="Stage">
              {stage.status === 'unverified' ? (
                <UnknownValue field="stage" sourceUrl={node.wikiUrl} />
              ) : (
                <>
                  <NoBreak>
                    <span className="font-semibold">{stageName(String(stage.value))}</span>
                  </NoBreak>
                  {stage.status === 'editorial' ? (
                    <>
                      <span className="text-fg-muted"> · </span>
                      <CuratedLabel />
                    </>
                  ) : null}
                </>
              )}
            </Row>
          )}
          {node.worldEvil ? (
            <Row term="World">
              <span className="font-semibold">{WORLD_EVIL_LABEL[node.worldEvil]} worlds only</span>
              {inPlay ? null : <span className="text-fg-muted"> — not your chosen world evil</span>}
            </Row>
          ) : null}
          {summon && summon.status !== 'not-applicable' ? (
            <Row term="How to summon">
              {summon.status === 'unverified' ? (
                <UnknownValue field="summon.text" sourceUrl={summonSource} />
              ) : (
                <>
                  <p>{String(summon.value)}</p>
                  {summonSource ? <ProvenanceLink href={summonSource} srContext={`for how to summon ${node.name}`} /> : null}
                </>
              )}
            </Row>
          ) : null}
          <Row term="Your progress">
            <span data-defeat-state={state ?? 'not-attempted'} className="font-semibold">
              {STATE_LABEL[state ?? 'not-attempted']}
            </span>
            <span className="block text-xs text-fg-muted">{DISPLAY_ONLY_NOTE}</span>
          </Row>
        </dl>

        <ConnectionList title="Comes after" items={before} onJump={onJump} direction="in" />
        <ConnectionList title="Either this or" items={alternatives} onJump={onJump} direction="alt" />
        <ConnectionList title="Leads to" items={after} onJump={onJump} direction="out" />
      </div>

      <footer className="border-t-2 border-panel-border px-3">
        <ProvenanceLink href={node.wikiUrl} label={`${node.name} on terraria.wiki.gg`} />
      </footer>
    </section>
  )
}
