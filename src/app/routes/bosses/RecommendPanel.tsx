import { CircleCheck, Footprints, Lock, X } from 'lucide-react'
import type { ComponentProps, KeyboardEvent, ReactNode, Ref } from 'react'
import { cx } from '../../../components/cx'
import { EDGE_STYLES } from '../../../components/nodeMap/edgeStyles'
import { stageName, WORLD_EVIL_LABEL, type MapNode, type WorldEvil } from '../../../components/nodeMap/graph'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex } from '../../../data-access/types'
import { SourceIconLink } from './BossBits'
import { NodeStatusTag } from './DefeatControl'
import { lockedNote } from './focusCardCopy'
import type { Recommendation, RecommendItem } from './recommend'
import * as copy from './recommendCopy'

/**
 * RecommendPanel — "What Should I Do Next?" (PRD P5-S5; UX_SPEC §3.7, §4d, §7, §8, §9). Two lists
 * from ./recommend: "Required before you can progress" and "Recommended order", each fight with its
 * map status, a one-line reason, the wiki sentence behind it (with its source) and a node-jump button
 * that moves the map to it and opens its card. A context line names what the lists are based on: the
 * marked bosses (or a fresh start), the world evil and, when it disagrees, the selected stage.
 *
 * Shells (BossMapPage): a docked side drawer beside the map from lg (`RecommendDrawer`, non-modal —
 * the map stays usable), a BottomSheet below. `/bosses?recommend=1` opens it (UX_SPEC §10.11).
 */

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

/**
 * The toolbar / map-corner button. Short label below lg, where it shares a row with the other map
 * controls; the hidden label is display:none, so the accessible name is always the visible one. Spreads
 * its props (a Radix trigger passes its own).
 */
export function RecommendToggle({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-recommend-toggle=""
      {...props}
      className={cx(
        'group inline-flex min-h-tap items-center gap-2 border-2 border-gold-600 bg-panel px-3 text-sm font-semibold text-accent-strong shadow-pixel transition-colors duration-(--dur-ui) hover:bg-night-700 aria-expanded:bg-night-700',
        className,
      )}
    >
      <Footprints aria-hidden="true" className="size-4 shrink-0" />
      <span className="lg:hidden">{copy.TOGGLE_SHORT}</span>
      <span className="max-lg:hidden">{copy.PANEL_TITLE}</span>
    </button>
  )
}

/** The lg side drawer: docked right of the map, heading focused on open, Esc or Close return focus to the toggle. */
export function RecommendDrawer({
  id,
  titleId,
  headingRef,
  onClose,
  children,
}: {
  id: string
  titleId: string
  headingRef?: Ref<HTMLHeadingElement>
  onClose: () => void
  children: ReactNode
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }
  return (
    <aside id={id} aria-labelledby={titleId} onKeyDown={onKeyDown} data-recommend-panel="drawer" className="flex w-88 shrink-0 flex-col border-l-2 border-panel-border bg-surface">
      <header className="flex items-center gap-3 border-b-2 border-panel-border py-2 pr-2 pl-4">
        <h2 ref={headingRef} id={titleId} tabIndex={-1} className="min-w-0 flex-1 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none">
          {copy.PANEL_TITLE}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.CLOSE_PANEL}
          className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </aside>
  )
}

export interface RecommendContentProps {
  recommendation: Recommendation
  worldEvil: WorldEvil | null
  sprites: SpriteIndex | null
  /** Move the map to a node and open its card. */
  onJump: (id: string) => void
  /** Prefix for the section heading ids (one panel per page). */
  idPrefix: string
}

export function RecommendContent({ recommendation: r, worldEvil, sprites, onJump, idPrefix }: RecommendContentProps) {
  const requiredId = `${idPrefix}-required`
  const recommendedId = `${idPrefix}-recommended`
  return (
    <div data-recommend="" data-recommend-state={r.state} className="space-y-5 text-sm">
      <div data-recommend-context="" className="space-y-1 text-fg-muted">
        <p>{r.state === 'fresh' ? copy.FRESH_CONTEXT : copy.progressContext(stageName(r.progressStage))}</p>
        <p>{copy.worldContext(worldEvil ? WORLD_EVIL_LABEL[worldEvil] : null)}</p>
        {r.stageNote ? (
          <p data-stage-note={r.stageNote.relation} className="border-l-2 border-gold-600 pl-2 text-fg">
            {copy.stageNote(stageName(r.stageNote.selected), stageName(r.progressStage), r.stageNote.relation)}
          </p>
        ) : null}
      </div>

      {r.state === 'complete' ? (
        <div data-recommend-complete="" className="flex items-start gap-3 border-2 border-gold-600 bg-night-900 p-3">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="space-y-1">
            <p className="font-semibold text-fg">{copy.COMPLETE_TITLE}</p>
            <p className="text-fg-muted">{r.allMarked ? copy.COMPLETE_ALL : copy.COMPLETE_AHEAD}</p>
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby={requiredId} data-recommend-list="required" className="space-y-2">
            <h3 id={requiredId} className="flex items-center gap-2 font-semibold text-fg">
              <Lock aria-hidden="true" className="size-4 shrink-0 text-gate" />
              {copy.REQUIRED_TITLE}
            </h3>
            <p className="text-xs text-fg-muted">{copy.REQUIRED_INTRO}</p>
            {r.required.length > 0 ? (
              <ol className="space-y-2">
                {r.required.map((item, i) => (
                  <ItemRow key={item.key} item={item} showQuote={showsQuote(r.required, i)} sprites={sprites} onJump={onJump} />
                ))}
              </ol>
            ) : (
              <p data-recommend-empty="required" className="border-2 border-panel-border bg-night-900 p-3">
                {copy.requiredDone(r.goal?.name ?? '')}
              </p>
            )}
          </section>

          <section aria-labelledby={recommendedId} data-recommend-list="recommended" className="space-y-2">
            <h3 id={recommendedId} className="flex items-center gap-2 font-semibold text-fg">
              <Footprints aria-hidden="true" className="size-4 shrink-0 text-success" />
              {copy.RECOMMENDED_TITLE}
            </h3>
            <p className="text-xs text-fg-muted">{copy.RECOMMENDED_INTRO}</p>
            {r.recommended.length > 0 ? (
              <ol className="space-y-2">
                {r.recommended.map((item, i) => (
                  <ItemRow key={item.key} item={item} showQuote={showsQuote(r.recommended, i)} sprites={sprites} onJump={onJump} />
                ))}
              </ol>
            ) : (
              <p data-recommend-empty="recommended" className="border-2 border-panel-border bg-night-900 p-3">
                {copy.NOTHING_ELSE}
              </p>
            )}
          </section>
        </>
      )}

      {/* Only beside lists: the completion state has no reasons or quotes to explain. */}
      {r.state === 'complete' ? null : <p data-recommend-sources="" className="border-t-2 border-panel-border pt-2 text-xs text-fg-muted">{copy.SOURCES_NOTE}</p>}
    </div>
  )
}

/**
 * Whether a row quotes its wiki sentence; otherwise the row keeps only its source link, beside the
 * reason. Not quoted:
 * - a fight still open from an earlier stage (design review P5-S5 M3): the sentence was written for
 *   that stage ("a small gap … before facing the mechanical bosses") and can read against what is
 *   tracked now, so the row says only our templated reason;
 * - a sentence already quoted by a row above it in the same list (the three mechanical bosses share
 *   Plantera's).
 */
const showsQuote = (items: readonly RecommendItem[], index: number) => {
  const { evidence, earlier } = items[index]
  return evidence !== undefined && !earlier && !items.slice(0, index).some((other) => !other.earlier && other.evidence?.text === evidence.text)
}

function JumpButton({ node, onJump }: { node: MapNode; onJump: (id: string) => void }) {
  return (
    <button type="button" data-recommend-jump={node.id} onClick={() => onJump(node.id)} className={cx('min-h-tap text-left font-semibold', LINK)}>
      {node.name}
      <span className="sr-only">{copy.SHOW_ON_MAP}</span>
    </button>
  )
}

/**
 * A fight still open from an earlier stage: "Optional", whatever its map status — the map may still
 * ring it "Recommended next" (Queen Slime, opened by Hardmode), which would contradict the reason
 * beside it (design review P5-S5 M3).
 */
function OptionalTag() {
  const Icon = EDGE_STYLES.optional.icon
  return (
    <span data-recommend-tag="optional" className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-fg-muted">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
      {copy.OPTIONAL_TAG}
    </span>
  )
}

function ItemRow({ item, showQuote, sprites, onJump }: { item: RecommendItem; showQuote: boolean; sprites: SpriteIndex | null; onJump: (id: string) => void }) {
  const [first] = item.nodes
  const names = item.nodes.map((n) => n.name).join(` ${copy.OR} `)
  const reason = (
    <p data-recommend-reason="" className="text-fg">
      {item.reason}
    </p>
  )
  return (
    <li data-recommend-item={item.key} data-kind={item.kind} className={cx('space-y-1.5 border-2 bg-night-900 p-3', item.kind === 'required' ? 'border-earth-600' : 'border-panel-border')}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center border-2 border-slot-border bg-slot">
          <SpriteImg src={first.boss?.sprite} sprites={sprites} placeholder="creature" box={32} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 leading-tight">
            {item.nodes.map((node, i) => (
              <span key={node.id} className="inline-flex items-center gap-x-1.5">
                {i > 0 ? <span className="text-fg-muted">{copy.OR}</span> : null}
                <JumpButton node={node} onJump={onJump} />
              </span>
            ))}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span>{[...new Set(item.nodes.map((n) => stageName(n.stage)))].join(' / ')}</span>
            {item.earlier ? <OptionalTag /> : <NodeStatusTag status={item.status} />}
          </p>
        </div>
      </div>
      {item.evidence && !showQuote ? (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{reason}</div>
          <SourceIconLink href={item.evidence.sourceUrl} srLabel={copy.sourceLabel(names)} />
        </div>
      ) : (
        reason
      )}
      {item.needs.length > 0 ? (
        <p data-recommend-needs="" className="flex items-start gap-1.5 text-xs text-fg-muted">
          <Lock aria-hidden="true" className="mt-px size-3.5 shrink-0 text-gate" />
          {lockedNote(item.needs)}
        </p>
      ) : null}
      {item.evidence && showQuote ? (
        <div className="flex items-start gap-1">
          <p data-recommend-evidence="" className="min-w-0 flex-1 py-2 text-xs text-fg-muted">
            “{item.evidence.lead}
            {item.evidence.text}
            {item.evidence.trail}”
          </p>
          <SourceIconLink href={item.evidence.sourceUrl} srLabel={copy.sourceLabel(names)} />
        </div>
      ) : null}
    </li>
  )
}
