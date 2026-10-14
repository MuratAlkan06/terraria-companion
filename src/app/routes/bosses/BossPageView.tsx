import { CalendarDays, CircleHelp, Flag, Map as MapIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CuratedLabel } from '../../../components/CuratedLabel'
import { cx } from '../../../components/cx'
import { FavoriteStar } from '../../../components/FavoriteStar'
import { EDGE_STYLES, type EdgeType } from '../../../components/nodeMap/edgeStyles'
import { isNodeActive, stageName, WORLD_EVIL_LABEL, type Connection, type MapNode, type NodeState, type WorldEvil } from '../../../components/nodeMap/graph'
import { NoBreak } from '../../../components/NoBreak'
import { PartiallyVerifiedBadge } from '../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../components/PixelPanel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import { meta } from '../../../data/meta'
import { getField } from '../../../schemas/getField'
import { humanizeSlug } from '../db/weapons/weaponDisplay'
import { ItemCell, PanelHeading, SourceIconLink, TipList } from './BossBits'
import { BossDrops } from './BossDrops'
import { bossMapHref, bossPageHref } from './bossNav'
import type { BossPageData } from './bossPageData'
import { ATTACK_TAG_LABEL, bossDropSections, bossPageUnknowns, curatedList, isMultiForm, nextSteps, SECTION_IDS, statField, statsView, stepPhrase, strategyGroups, TIME_LABEL } from './bossPageModel'
import { ClassGear } from './ClassGear'
import type { GearData } from './bossPageData'
import { PrepChecklist } from './PrepChecklist'
import { PAGE_DISPLAY_ONLY_NOTE, STATE_LABEL } from './focusCardCopy'

/**
 * Boss page body (PRD P5-S2 AC1–AC4; UX_SPEC §3.7, §7): pure presentation over BossPageData, so tests
 * render it for every boss with a page. Sections, in reading order:
 *   header (full-size art, name, stage, world, progress — display only) ·
 *   how to summon + where & when · prep checklist · gear & class tips · attack patterns & survival
 *   tips · drops · [rail from lg] stats · before / after this fight (links back into the map).
 * Every data claim carries its source; curated (editorial) content is labeled "curated"; Unknown is
 * the only rendering of unverified values.
 */
export interface BossPageViewProps {
  data: BossPageData
  worldEvil: WorldEvil | null
  /** Tracked progress (tc.v1.progress; display only in P5-S2): this boss's state, and gates already passed. */
  nodeStates: Readonly<Record<string, NodeState>>
  headingId: string
  /** Gear details injected directly (tests). */
  gearData?: GearData
}

export function BossPageView({ data, worldEvil, nodeStates, headingId, gearData }: BossPageViewProps) {
  const { boss, graph, sprites, conditions, itemOf } = data
  const drops = bossDropSections(boss, data.drops, itemOf)
  const unknowns = bossPageUnknowns(boss, drops.rows)
  const node = graph.nodeById.get(boss.nodeId)

  return (
    <div className="space-y-4 md:space-y-6">
      <BossHeader data={data} node={node} worldEvil={worldEvil} state={nodeStates[boss.nodeId]} headingId={headingId} unknowns={unknowns} />
      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4 md:space-y-6">
          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            <SummonPanel data={data} />
            <WherePanel data={data} />
          </div>
          <PrepChecklist boss={boss} itemOf={itemOf} sprites={sprites} titleId={SECTION_IDS.prep} />
          <ClassGear boss={boss} graph={graph} conditions={conditions} gaps={data.gaps} itemOf={itemOf} linkTip={data.linkTip} sprites={sprites} nodeStates={nodeStates} titleId={SECTION_IDS.gear} gearData={gearData} />
          <AttackPatterns data={data} />
          <BossDrops boss={boss} sections={drops} conditions={conditions} sprites={sprites} titleId={SECTION_IDS.drops} />
        </div>
        <aside aria-label={`${boss.name}: stats and next steps`} className="min-w-0 space-y-4 md:space-y-6">
          <NextStepsPanel data={data} />
          <StatsPanel data={data} />
        </aside>
      </div>
    </div>
  )
}

// --- header ---------------------------------------------------------------------------------

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{term}</dt>
      <dd className="flex min-h-6 flex-wrap items-center gap-x-1">{children}</dd>
    </div>
  )
}

function BossHeader({ data, node, worldEvil, state, headingId, unknowns }: { data: BossPageData; node: MapNode | undefined; worldEvil: WorldEvil | null; state: NodeState | undefined; headingId: string; unknowns: ReturnType<typeof bossPageUnknowns> }) {
  const { boss, sprites } = data
  const stage = getField(boss, 'stage')
  return (
    <PixelPanel as="header" data-section="header" className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <div className="grid size-36 shrink-0 place-items-center self-center border-2 border-slot-border bg-slot shadow-pixel md:self-start">
        {/* Boss page: the full sprite file (animated GIF), never the still thumbnail (B30). */}
        <SpriteImg src={boss.sprite} sprites={sprites} placeholder="creature" box={128} full />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <FavoriteStar entityRef={`boss:${boss.id}`} name={boss.name} className="float-right -mt-2.5 -mr-2 ml-2" />
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Boss</p>
          <h1 id={headingId} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
            {boss.name}
          </h1>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          <Fact term="Game stage">
            {stage.status === 'unverified' ? (
              <UnknownValue field="stage" sourceUrl={boss.wikiUrl} />
            ) : (
              <>
                <NoBreak>
                  <span className="font-semibold">{stageName(String(stage.value))}</span>
                </NoBreak>
                {stage.status === 'editorial' ? (
                  <>
                    <span className="text-fg-muted">·</span>
                    <CuratedLabel />
                  </>
                ) : null}
              </>
            )}
          </Fact>
          {boss.worldEvil ? (
            <Fact term="World">
              <span className="font-semibold">{WORLD_EVIL_LABEL[boss.worldEvil]} worlds only</span>
              {node && !isNodeActive(node, worldEvil) ? <span className="text-fg-muted">— not your chosen world evil</span> : null}
            </Fact>
          ) : null}
          <Fact term="Your progress">
            <span data-defeat-state={state ?? 'not-attempted'} className="font-semibold">
              {STATE_LABEL[state ?? 'not-attempted']}
            </span>
            <span className="basis-full text-xs text-fg-muted">{PAGE_DISPLAY_ONLY_NOTE}</span>
          </Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProvenanceLink href={boss.wikiUrl} label={`${boss.name} on terraria.wiki.gg`} />
          <PartiallyVerifiedBadge items={unknowns} />
        </div>
      </div>
    </PixelPanel>
  )
}

// --- summon + where & when -----------------------------------------------------------------

function SummonPanel({ data }: { data: BossPageData }) {
  const { boss, itemOf, sprites, conditions } = data
  const text = getField(boss, 'summon.text')
  const source = boss.summon.sourceUrl ?? boss.wikiUrl
  return (
    <PixelPanel as="section" aria-labelledby={SECTION_IDS.summon} data-section="summon" className="space-y-3">
      <PanelHeading id={SECTION_IDS.summon}>How to summon</PanelHeading>
      {text.status === 'unverified' ? (
        <p>
          <UnknownValue field="summon.text" sourceUrl={boss.wikiUrl} />
        </p>
      ) : text.status === 'not-applicable' ? null : (
        <p className="leading-relaxed">{String(text.value)}</p>
      )}
      {boss.summon.items.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Summoning item{boss.summon.items.length > 1 ? 's' : ''}</h3>
          <ul className="flex flex-wrap gap-x-4">
            {boss.summon.items.map((id) => (
              <li key={id}>
                <ItemCell item={itemOf(id)} sprites={sprites} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {boss.summon.conditions.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Conditions</h3>
          <ul className="flex flex-wrap gap-2">
            {boss.summon.conditions.map((slug) => {
              const condition = conditions.byId.get(slug)
              return (
                <li key={slug} data-condition={slug} className="inline-flex min-h-tap items-center border-2 border-panel-border bg-night-900 text-sm font-semibold">
                  {condition ? (
                    <a href={condition.wikiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap items-center px-2 text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
                      {condition.name}
                      <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="px-2">{humanizeSlug(slug)}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <ProvenanceLink href={source} srContext={`for how to summon ${boss.name}`} />
    </PixelPanel>
  )
}

function WherePanel({ data }: { data: BossPageData }) {
  const { boss } = data
  const biomes = getField(boss, 'location.biomes')
  const time = getField(boss, 'location.time')
  const text = getField(boss, 'location.text')
  return (
    <PixelPanel as="section" aria-labelledby={SECTION_IDS.where} data-section="where" className="space-y-3">
      <PanelHeading id={SECTION_IDS.where}>Where &amp; when</PanelHeading>
      <dl className="space-y-3">
        <div className="space-y-1">
          <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Where it is fought</dt>
          <dd>
            {biomes.status === 'unverified' ? (
              <UnknownValue field="location.biomes" sourceUrl={boss.wikiUrl} />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {(boss.location.biomes ?? []).map((b) => (
                  <li key={b} className="border-2 border-panel-border bg-night-900 px-2 py-1 text-sm font-semibold">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {time.status === 'not-applicable' ? null : (
          <div className="space-y-1">
            <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">When</dt>
            <dd className="font-semibold">{time.status === 'unverified' ? <UnknownValue field="location.time" sourceUrl={boss.wikiUrl} /> : TIME_LABEL[time.value as keyof typeof TIME_LABEL]}</dd>
          </div>
        )}
        {text.status === 'verified' || text.status === 'editorial' ? <p className="text-sm">{String(text.value)}</p> : null}
      </dl>
      <ProvenanceLink href={boss.wikiUrl} srContext={`for where and when ${boss.name} is fought`} />
    </PixelPanel>
  )
}

// --- attack patterns + survival tips --------------------------------------------------------

function AttackPatterns({ data }: { data: BossPageData }) {
  const { boss } = data
  const tags = curatedList(boss, 'attackPatternTags')
  const strategies = curatedList(boss, 'strategies')
  const groups = strategyGroups(strategies.status === 'curated' ? strategies.entries : [])
  return (
    <PixelPanel as="section" aria-labelledby={SECTION_IDS.patterns} data-section="patterns" className="space-y-4">
      <PanelHeading id={SECTION_IDS.patterns} curated={tags.status === 'curated' || strategies.status === 'curated'}>
        Attack patterns &amp; survival tips
      </PanelHeading>
      {tags.status === 'unknown' ? (
        <p>
          Attack patterns: <UnknownValue field="attackPatternTags" sourceUrl={boss.wikiUrl} />
        </p>
      ) : tags.status === 'curated' ? (
        // Plain labelled tags (M6): descriptive words, not chips that look pressable.
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Behavior</h3>
          <ul aria-label="Attack patterns" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {tags.entries.map((tag) => (
              <li key={tag} data-attack-tag={tag} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 shrink-0 bg-gold-400" />
                {ATTACK_TAG_LABEL[tag]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {strategies.status === 'unknown' ? (
        <p>
          Survival tips: <UnknownValue field="strategies" sourceUrl={boss.wikiUrl} />
        </p>
      ) : (
        <>
          {groups.general.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Survival tips from the wiki</h3>
              <TipList tips={groups.general} label="Survival tips" linkTip={data.linkTip} />
            </div>
          ) : null}
          {groups.byDifficulty.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">In Expert and Master Mode</h3>
              <TipList tips={groups.byDifficulty} label="Expert and Master Mode tips" showDifficulty linkTip={data.linkTip} />
            </div>
          ) : null}
        </>
      )}
      <ProvenanceLink href={boss.wikiUrl} srContext={`for the attack patterns of ${boss.name}`} />
    </PixelPanel>
  )
}

// --- stats (rail) ---------------------------------------------------------------------------

const STAT_ROWS = [
  ['hp', 'Health'],
  ['defense', 'Defense'],
  ['contactDamage', 'Contact damage'],
] as const

function StatsPanel({ data }: { data: BossPageData }) {
  const { boss } = data
  const view = statsView(boss, data.gaps)
  return (
    <PixelPanel as="section" aria-labelledby={SECTION_IDS.stats} data-section="stats" className="space-y-3">
      <PanelHeading id={SECTION_IDS.stats}>Stats</PanelHeading>
      {view.kind === 'none' ? (
        // H1: not one value verified → one honest line with the stated reason, not nine Unknown cells.
        <div data-stats-unknown="" className="flex gap-3 border-2 border-dashed border-stone-500 bg-hatch-unknown p-3 text-sm">
          <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              Health, defense and contact damage: <UnknownValue field="statsByDifficulty" sourceUrl={boss.wikiUrl} />
            </p>
            <p>
              Stats not verified for Terraria {meta.gameVersion} —{' '}
              {view.reason ?? 'the wiki’s figures for this boss couldn’t be confirmed for this version, so none are shown.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Phones: a 28% label column and 12px cells, so an Unknown cell fits its column from 360px. */}
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Base stats of {boss.name} by difficulty</caption>
            <thead>
              <tr className="text-left text-xs text-fg-muted">
                <th scope="col" className="w-[28%] py-1 pr-1 font-semibold md:w-[34%] md:pr-2 lg:w-[28%] lg:pr-1">
                  <span className="sr-only">Stat</span>
                </th>
                {(['classic', 'expert', 'master'] as const).map((d) => (
                  <th key={d} scope="col" className="px-0.5 py-1 font-semibold md:px-1">
                    {d === 'classic' ? 'Classic' : d === 'expert' ? 'Expert' : 'Master'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAT_ROWS.map(([key, label]) => (
                <tr key={key} className="border-t border-border">
                  <th scope="row" className="py-1.5 pr-1 text-left font-normal text-fg-muted max-md:text-xs md:pr-2">
                    {label}
                  </th>
                  {(['classic', 'expert', 'master'] as const).map((d) => {
                    const field = statField(d, key)
                    const cell = getField(boss, field)
                    return cell.status === 'unverified' ? (
                      // The lg rail (20rem) is as narrow as a phone column: Unknown cells shrink there too. A
                      // panel-coloured side border keeps neighbouring hatched cells (and their "Unknown") apart.
                      <td key={d} className="border-x-2 border-panel bg-hatch-unknown px-0.5 py-1.5 max-md:text-xs md:px-1 lg:px-0.5 lg:text-xs lg:[&_[data-unknown-field]]:px-0.5">
                        <UnknownValue field={field} sourceUrl={boss.wikiUrl} inCell />
                      </td>
                    ) : (
                      <td key={d} className="px-0.5 py-1.5 tabular-nums max-md:text-xs md:px-1">
                        {cell.status === 'not-applicable' ? (
                          <span className="text-fg-muted">
                            {key === 'contactDamage' ? 'none' : 'n/a'}
                            <span className="sr-only"> (not applicable)</span>
                          </span>
                        ) : (
                          Number(cell.value).toLocaleString('en-US')
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {isMultiForm(boss) ? <p className="text-xs text-fg-muted">Base stats of the boss’s first form.</p> : null}
        </>
      )}
      <ProvenanceLink href={boss.wikiUrl} srContext={`for the stats of ${boss.name}`} />
    </PixelPanel>
  )
}

// --- before / after this fight (rail) -------------------------------------------------------

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

function NodeIcon({ node }: { node: MapNode }) {
  if (node.kind === 'milestone') return <Flag aria-hidden="true" className="size-4 shrink-0 text-gold-300" />
  if (node.kind === 'event') return <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-night-200" />
  return null
}

/**
 * One connected node: its page (if it has one), the relation in plain words (M1; the map legend's
 * icons alongside), "Show on map", and the edge's quoted note + source.
 */
function StepItem({ connection, phrase, partners = [], opens = [] }: { connection: Connection; phrase: string; partners?: readonly MapNode[]; opens?: readonly Connection[] }) {
  const { link, other } = connection
  const page = other.kind === 'boss' ? bossPageHref(other.id) : undefined
  const edge = link.edges[0]
  return (
    <li data-step={other.id} className="space-y-1 border-2 border-panel-border bg-night-900 p-3">
      <div className="flex flex-wrap items-center gap-x-2">
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
        <NodeIcon node={other} />
        {page ? (
          <Link to={page} className={cx('inline-flex min-h-tap items-center font-semibold', LINK)}>
            {other.name}
          </Link>
        ) : (
          <span className="font-semibold">{other.name}</span>
        )}
      </div>
      <p data-step-phrase="" className="text-sm text-fg-muted">
        {phrase}
      </p>
      {partners.map((p) => (
        <p key={p.id} className="flex flex-wrap items-center gap-x-1 text-sm">
          or
          {bossPageHref(p.id) ? (
            <Link to={bossPageHref(p.id) as string} className={cx('inline-flex min-h-tap items-center font-semibold', LINK)}>
              {p.name}
            </Link>
          ) : (
            <span className="font-semibold">{p.name}</span>
          )}
          {p.worldEvil ? <span className="text-fg-muted">({WORLD_EVIL_LABEL[p.worldEvil]} worlds)</span> : null}
        </p>
      ))}
      {edge?.note ? (
        <div className="flex items-start gap-1">
          <p className="min-w-0 flex-1 py-2 text-xs text-fg-muted">“{edge.note}”</p>
          <SourceIconLink href={edge.sourceUrl} srLabel={`Source for the connection to ${other.name}`} />
        </div>
      ) : null}
      <Link to={bossMapHref(other.id)} data-map-link={other.id} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)}>
        <MapIcon aria-hidden="true" className="size-4" />
        Show {other.name} on the map
      </Link>
      {opens.length > 0 ? <OpensPointer from={other} opens={opens} /> : null}
    </li>
  )
}

/** How an opened step reads beside its name: only what changes the plan (optional, or early at a cost). */
function opensNote(types: readonly EdgeType[]): string | undefined {
  if (types.includes('early-challenge-possible')) return 'can be fought early'
  return types.includes('optional') ? 'optional' : undefined
}

/**
 * The Duke-Fishron-style pointer under a milestone step (Hardmode after the Wall of Flesh): what the
 * marker opens, straight from the progression graph's links out of it, each a link to its place on
 * the map — so the page names the next fights instead of stopping at a world change.
 */
function OpensPointer({ from, opens }: { from: MapNode; opens: readonly Connection[] }) {
  return (
    <div data-step-opens={from.id} className="space-y-1 border-t-2 border-panel-border pt-2">
      <p className="text-sm">From {from.name}, the path continues with:</p>
      <ul aria-label={`What ${from.name} opens`} className="flex flex-wrap gap-x-4">
        {opens.map(({ link, other }) => {
          const note = opensNote(link.types)
          return (
            <li key={link.id} data-opens={other.id} className="inline-flex items-center gap-1.5 text-sm">
              <Link to={bossMapHref(other.id)} data-map-link={other.id} className={cx('inline-flex min-h-tap items-center gap-1.5 font-semibold', LINK)}>
                <MapIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">Show </span>
                {other.name}
                <span className="sr-only"> on the map</span>
              </Link>
              {other.kind === 'event' ? <span className="text-xs text-fg-muted">event</span> : null}
              {note ? <span className="text-xs text-fg-muted">{note}</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NextStepsPanel({ data }: { data: BossPageData }) {
  const { boss, graph } = data
  const steps = nextSteps(graph, boss.nodeId)
  const self = graph.nodeById.get(boss.nodeId)?.name ?? boss.name
  const after = (c: Connection, from = self) => stepPhrase(c.link.types, 'after', { self: from, other: c.other.name })
  const before = (c: Connection) => stepPhrase(c.link.types, 'before', { self, other: c.other.name })
  const alternative = (c: Connection) => (c.other.worldEvil ? `In ${WORLD_EVIL_LABEL[c.other.worldEvil]} worlds instead` : stepPhrase(c.link.types, 'after', { self, other: c.other.name }))
  return (
    <PixelPanel as="section" aria-labelledby={SECTION_IDS.next} data-section="next" className="space-y-4">
      <PanelHeading id={SECTION_IDS.next}>After {boss.name}</PanelHeading>
      {steps.after.length > 0 ? (
        <ul aria-label={`What ${boss.name} leads to`} className="space-y-2">
          {steps.after.map(({ connection, partners, opens }) => (
            <StepItem key={connection.link.id} connection={connection} phrase={after(connection)} partners={partners} opens={opens} />
          ))}
        </ul>
      ) : steps.continueFrom ? (
        <div className="space-y-2">
          <p className="text-sm">
            Nothing on the map requires this fight. From {steps.continueFrom.from.name}, the path continues with:
          </p>
          <ul aria-label="Where the path continues" className="space-y-2">
            {steps.continueFrom.next.map((c) => (
              <StepItem key={c.link.id} connection={c} phrase={after(c, steps.continueFrom?.from.name)} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">The map shows no step after this fight.</p>
      )}
      {steps.alternatives.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Either this or</h3>
          <ul aria-label={`Either ${boss.name} or`} className="space-y-2">
            {steps.alternatives.map((c) => (
              <StepItem key={c.link.id} connection={c} phrase={alternative(c)} />
            ))}
          </ul>
        </div>
      ) : null}
      {steps.before.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Before this fight</h3>
          <ul aria-label={`What comes before ${boss.name}`} className="space-y-2">
            {steps.before.map((c) => (
              <StepItem key={c.link.id} connection={c} phrase={before(c)} />
            ))}
          </ul>
        </div>
      ) : null}
      <Link to={bossMapHref(boss.nodeId)} data-map-link={boss.nodeId} className={cx('inline-flex min-h-tap items-center gap-1.5 font-semibold', LINK)}>
        <MapIcon aria-hidden="true" className="size-4" />
        Show {boss.name} on the map
      </Link>
    </PixelPanel>
  )
}
