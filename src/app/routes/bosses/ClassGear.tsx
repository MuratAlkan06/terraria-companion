import { ChevronRight, CircleHelp } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../components/cx'
import { PixelPanel } from '../../../components/PixelPanel'
import { UnknownValue } from '../../../components/UnknownValue'
import type { ArmorSet, Boss, ConditionIndex, SpriteIndex } from '../../../data-access/types'
import type { MapGraph, NodeState, WorldEvil } from '../../../components/nodeMap/graph'
import { effectiveProgress, isNodeSatisfied } from '../../../scoring/progress'
import { useDelayedFlag, useResource } from '../../useResource'
import { ItemCell, PanelHeading, TipList, type GateRef } from './BossBits'
import { bossMapHref, bossPageHref } from './bossNav'
import { loadGearData, peekGearData, type GearData } from './bossPageData'
import { CLASS_LABEL, classGear, curatedList, declaredGapReason, GEAR_CLASSES, gearClassField, prepGuideFor, strategyGroups, type GearClass, type GearEntry, type ItemInfo, type Strategy, type TipSegment } from './bossPageModel'
import type { GapEntry } from '../../../data-access/types'

/**
 * PerClassGear (UX_SPEC §3.7; PRD P5-S2 AC1/AC2): four class tabs. Each tab shows the class's
 * curated gear — real entities as ItemSlots linking their pages, each gated item with a GateBadge
 * naming what must be defeated first (E_SUGGESTION_GATING guarantees those gates come before this
 * boss) — and the class's curated tips (verbatim wiki quotes with sources).
 *
 * When the boss's suggested gear is Unknown (absent + listed; for every pre-Hardmode boss no item is
 * verified obtainable before it), ONE Unknown block above the tabs says so in plain words (M2) —
 * the overlay's stated reason one tap away — and points to a guide's curated picks where one covers
 * this fight (M3); the tabs then carry the class tips only, the weapons they name linked to their
 * pages. Never an invented pick.
 *
 * When the gear is curated (P5-S3: a weapon passes E_SUGGESTION_GATING and a quoted tip recommends
 * it), a class without an entry is either Unknown on its own path (`suggestedEquipment.<class>`
 * listed — the same Unknown block inside that tab, with its own stated reason) or, if unlisted,
 * simply has no curated pick.
 */
export interface ClassGearProps {
  boss: Boss
  graph: MapGraph
  conditions: ConditionIndex
  gaps: readonly GapEntry[] | undefined
  itemOf: (id: number) => ItemInfo
  /** Links the real weapons a quoted tip names (BossPageData.linkTip). */
  linkTip?: (text: string) => TipSegment[]
  sprites: SpriteIndex | null
  /**
   * Tracked progress: a satisfied gate drops its GateBadge, live (UX_SPEC §8, §10.5) — a boss marked
   * defeated, a milestone once its bosses are (src/scoring/progress.ts, tracked defeats only).
   */
  nodeStates: Readonly<Record<string, NodeState>>
  worldEvil?: WorldEvil | null
  titleId: string
  /** Gear data injected directly (tests); the page loads it when the boss has gear entries. */
  gearData?: GearData
}

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

export function ClassGear({ boss, graph, conditions, gaps, itemOf, linkTip, sprites, nodeStates, worldEvil = null, titleId, gearData }: ClassGearProps) {
  const [tab, setTab] = useState<GearClass>('melee')
  const gear = curatedList(boss, 'suggestedEquipment')
  const strategies = curatedList(boss, 'strategies')
  const tips = strategyGroups(strategies.status === 'curated' ? strategies.entries : [])
  const reason = gear.status === 'unknown' ? declaredGapReason(gaps, boss, 'suggestedEquipment') : undefined
  const guide = gear.status === 'unknown' ? prepGuideFor(boss.id) : undefined

  return (
    <PixelPanel as="section" aria-labelledby={titleId} data-section="gear" className="space-y-4">
      <PanelHeading id={titleId} curated={gear.status === 'curated' || strategies.status === 'curated'}>
        Gear &amp; class tips
      </PanelHeading>
      {gear.status === 'unknown' ? (
        <div data-gear-unknown="" className="flex gap-3 border-2 border-dashed border-stone-500 bg-hatch-unknown p-3">
          <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="font-semibold text-fg">
              Suggested gear: <UnknownValue field="suggestedEquipment" sourceUrl={boss.wikiUrl} />
            </p>
            <p>We can’t verify which weapons you can get before this fight, so we don’t suggest any. The class tips below quote the wiki’s own gear advice, and the weapons they name link to their pages.</p>
            {guide ? (
              <p data-prep-guide="">
                The{' '}
                <Link to={guide.to} className={cx('font-semibold', LINK)}>
                  {guide.title}
                </Link>{' '}
                guide has curated weapon picks for each class.
              </p>
            ) : null}
            {reason ? <WhyUnknown reason={reason} /> : null}
          </div>
        </div>
      ) : gear.status === 'curated' ? (
        // P5-S3: what the gear slots are (and why a class can read Unknown) — the basis of every pick.
        <p data-gear-basis="" className="text-sm text-fg-muted">
          Suggested gear lists only weapons a quoted wiki tip recommends that are verified as obtainable before this fight. A class
          without one reads Unknown.
        </p>
      ) : null}

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as GearClass)}>
        {/* The four tabs share the width; below ~340px they scroll sideways (UX_SPEC §7) instead of wrapping. */}
        <Tabs.List aria-label="Class" className="flex overflow-x-auto overscroll-x-contain border-b-2 border-panel-border">
          {GEAR_CLASSES.map((cls) => (
            <Tabs.Trigger
              key={cls}
              value={cls}
              data-class-tab={cls}
              className={cx(
                'min-h-tap flex-1 shrink-0 border-b-2 border-transparent px-2 text-sm font-semibold whitespace-nowrap text-fg-muted hover:text-fg',
                'focus-visible:-outline-offset-2 data-[state=active]:border-gold-400 data-[state=active]:text-accent',
              )}
            >
              {CLASS_LABEL[cls]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {GEAR_CLASSES.map((cls) => (
          // forceMount: every class's tips are in the document (hidden when inactive), so they are
          // findable in-page and render server-side.
          <Tabs.Content key={cls} value={cls} forceMount className="space-y-4 pt-4 data-[state=inactive]:hidden" data-class-panel={cls}>
            {gear.status === 'curated' ? (
              <ClassGearSlots boss={boss} cls={cls} gaps={gaps} graph={graph} conditions={conditions} itemOf={itemOf} sprites={sprites} nodeStates={nodeStates} worldEvil={worldEvil} gearData={gearData} />
            ) : null}
            <ClassTips cls={cls} tips={tips.byClass[cls]} unknown={strategies.status === 'unknown'} boss={boss} linkTip={linkTip} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </PixelPanel>
  )
}

function ClassTips({ cls, tips, unknown, boss, linkTip }: { cls: GearClass; tips: readonly Strategy[]; unknown: boolean; boss: Boss; linkTip?: (text: string) => TipSegment[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{CLASS_LABEL[cls]} tips from the wiki</h3>
      {unknown ? (
        <p className="text-sm">
          Tips: <UnknownValue field="strategies" sourceUrl={boss.wikiUrl} />
        </p>
      ) : tips.length === 0 ? (
        <p className="text-sm text-fg-muted">No curated {CLASS_LABEL[cls].toLowerCase()} tip for this fight.</p>
      ) : (
        <TipList tips={tips} label={`${CLASS_LABEL[cls]} tips`} showDifficulty linkTip={linkTip} />
      )}
    </div>
  )
}

/** The stated reason behind an Unknown, one tap away. */
function WhyUnknown({ reason }: { reason: string }) {
  return (
    <details className="group text-fg-muted">
      <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-1 font-semibold text-fg hover:text-accent-strong [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-(--dur-ui) group-open:rotate-90" />
        Why we can’t tell
      </summary>
      <p className="pb-1">{reason}</p>
    </details>
  )
}

/** One class's gear is Unknown while other classes have curated picks (P5-S3 honest partial). */
function ClassGearUnknown({ boss, cls, reason }: { boss: Boss; cls: GearClass; reason: string | undefined }) {
  const label = CLASS_LABEL[cls].toLowerCase()
  return (
    <div data-gear-class-unknown={cls} className="flex gap-3 border-2 border-dashed border-stone-500 bg-hatch-unknown p-3">
      <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold text-fg">
          Suggested {label} gear: <UnknownValue field={gearClassField(cls)} sourceUrl={boss.wikiUrl} />
        </p>
        <p>None of the {label} weapons the wiki recommends here is verified as obtainable before this fight. The {label} tips below quote its advice.</p>
        {reason ? <WhyUnknown reason={reason} /> : null}
      </div>
    </div>
  )
}

// --- gear slots (only when the boss has curated gear) ----------------------------------------

function ClassGearSlots(props: {
  boss: Boss
  cls: GearClass
  gaps: readonly GapEntry[] | undefined
  graph: MapGraph
  conditions: ConditionIndex
  itemOf: (id: number) => ItemInfo
  sprites: SpriteIndex | null
  nodeStates: Readonly<Record<string, NodeState>>
  worldEvil: WorldEvil | null
  gearData?: GearData
}) {
  const resource = useResource('boss-gear', loadGearData, peekGearData)
  const showLoader = useDelayedFlag(!props.gearData && resource.status === 'loading')
  const data = props.gearData ?? (resource.status === 'ready' ? resource.data : undefined)
  const own = classGear(props.boss, props.cls)
  if (own.status === 'unknown') return <ClassGearUnknown boss={props.boss} cls={props.cls} reason={declaredGapReason(props.gaps, props.boss, gearClassField(props.cls))} />
  if (own.status !== 'curated') return <p className="text-sm text-fg-muted">No curated {CLASS_LABEL[props.cls].toLowerCase()} gear for this fight.</p>
  if (!data) {
    if (resource.status === 'error') {
      return (
        <p role="status" className="text-sm text-negative">
          Couldn’t load the gear details.{' '}
          <button type="button" onClick={resource.retry} className="min-h-tap font-semibold text-link underline">
            Retry
          </button>
        </p>
      )
    }
    return showLoader ? <p role="status" className="text-sm text-fg-muted">Loading gear…</p> : <div aria-hidden="true" className="min-h-16" />
  }
  return (
    <div className="space-y-4">
      {own.entries.map((entry, i) => (
        <GearEntrySlots key={i} {...props} entry={entry} data={data} />
      ))}
    </div>
  )
}

function GearGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</h3>
      {/* Natural-width entries that wrap as a whole: an item keeps its GateBadge on its line while the row has room. */}
      <ul aria-label={label} className="flex flex-wrap gap-x-6 gap-y-1">
        {children}
      </ul>
    </div>
  )
}

function GearEntrySlots({ entry, data, graph, conditions, itemOf, sprites, nodeStates, worldEvil }: { entry: GearEntry; data: GearData; graph: MapGraph; conditions: ConditionIndex; itemOf: (id: number) => ItemInfo; sprites: SpriteIndex | null; nodeStates: Readonly<Record<string, NodeState>>; worldEvil: WorldEvil | null }) {
  const ep = effectiveProgress(graph.progression, { worldEvil, nodeStates })
  const memo = new Map<string, boolean>()
  const gatesOf = (gatedBy: { bosses: string[]; conditions: string[] } | undefined): GateRef[] => {
    if (!gatedBy) return []
    const nodes = [...gatedBy.bosses, ...gatedBy.conditions.flatMap((c) => conditions.byId.get(c)?.satisfiedByNode ?? [])]
    return [...new Set(nodes)]
      .filter((id) => !isNodeSatisfied(graph.progression, ep, id, memo))
      .map((id) => ({ id, name: graph.nodeById.get(id)?.name ?? id, to: bossPageHref(id) ?? bossMapHref(id) }))
  }
  const itemGates = (id: number) => gatesOf((data.weapons.get(id) ?? data.accessories.get(id) ?? data.armor.get(id))?.gatedBy)
  const setGates = (set: ArmorSet) => {
    const seen = new Map<string, GateRef>()
    for (const piece of [...set.pieces.helmets, set.pieces.chest, set.pieces.legs]) for (const g of gatesOf(data.armor.get(piece)?.gatedBy)) seen.set(g.id, g)
    return [...seen.values()]
  }
  return (
    <div data-gear-entry={entry.class} className="space-y-3 border-2 border-panel-border bg-night-900 p-3">
      <GearGroup label="Weapons">
        {entry.weapons.map((id) => (
          <li key={id}>
            <ItemCell item={itemOf(id)} sprites={sprites} gates={itemGates(id)} />
          </li>
        ))}
      </GearGroup>
      {entry.armorSetIds.length > 0 ? (
        <GearGroup label="Armor">
          {entry.armorSetIds.map((setId) => {
            const set = data.sets.get(setId)
            if (!set) return <li key={setId} className="text-sm text-fg-muted">{setId}</li>
            return (
              <li key={setId}>
                <ItemCell item={{ ...itemOf(set.pieces.chest), name: set.name, link: { kind: 'external', href: set.wikiUrl } }} sprites={sprites} gates={setGates(set)} />
              </li>
            )
          })}
        </GearGroup>
      ) : null}
      {entry.accessories.length > 0 ? (
        <GearGroup label="Accessories">
          {entry.accessories.map((id) => (
            <li key={id}>
              <ItemCell item={itemOf(id)} sprites={sprites} gates={itemGates(id)} />
            </li>
          ))}
        </GearGroup>
      ) : null}
      {entry.buffs.length > 0 ? (
        <GearGroup label="Buffs">
          {entry.buffs.map((slug) => {
            const buff = data.buffs.get(slug)
            return (
              <li key={slug} className="flex min-h-tap items-center text-sm">
                {buff ? (
                  <a href={buff.wikiUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {buff.name}
                    <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
                  </a>
                ) : (
                  slug
                )}
              </li>
            )
          })}
        </GearGroup>
      ) : null}
      {entry.note ? <p className="text-sm text-fg-muted">{entry.note}</p> : null}
    </div>
  )
}
