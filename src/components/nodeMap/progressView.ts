/**
 * Tracked progress → what the map shows (PRD P5-S4 AC1/AC2; UX_SPEC §3.7, §9, §12). Pure.
 *
 * NODE STATUS — from tc.v1.progress through src/scoring/progress.ts (tracked defeats only, B69/Q9;
 * a mark counts where countsInWorld says, AMENDMENTS-016 B128 — as for links):
 * - `defeated` / `skipped`: as marked (a gold ring with a check / a dimmed check).
 * - `locked`: a required gate isn't satisfied yet (subdued + lock glyph, never colour alone).
 * - `reached`: a milestone whose gates are all satisfied (B24: Hardmode once the Wall of Flesh falls).
 * - `recommended`: open, and the next step on from something done — a required-gate or
 *   recommended-next link from a satisfied node (green border + footprints glyph).
 * - `available`: open, nothing marks it as next.
 * A node is open when every DIRECT required-gate predecessor is satisfied: milestones and events are
 * satisfied through their own gates (recursively), so this is "all required-gate ancestors" for any
 * consistently tracked world — and, like the game's own checks, a tracked boss stands for its own
 * upstream.
 *
 * LINK STATUS: `locked` from or into a locked node (subdued: not reachable yet), `lit` for a
 * recommended-next link from a done, in-play node into an open one (the path glows), else `idle` — so a
 * marked boss of the other world evil, drawn dimmed, never leaves a glow behind (AMENDMENTS-015 B98).
 * OPEN GATES: the required-gate links whose gate is met (their source satisfied) — the map swaps
 * such a link's padlock badge for a check (design review P5-S4 M3), whatever its target's status.
 *
 * UNLOCK CASCADE (UX_SPEC §12 signature moment): diffing two states gives every element that
 * unlocked, filled its ring, lit up or had its gate met, each with a step along the graph direction
 * — a defeated node's ring at step 0, its outgoing links next, the nodes they open after them, and
 * so on (graph-topological; a node waits for every changed link into it). Steps are 50ms apart, each
 * animation 200ms. Within one step, siblings RIPPLE (design review P5-S4 M2): given the nodes' layout
 * positions, each is a further 25ms after the one before it along its layer, so a fan arrives as a
 * travelling wave — capped so the whole cascade stays within 700ms (fewer ms per sibling, down to
 * none, for a cascade already that long). Every element still starts after what caused it. Under
 * reduced motion every delay is 0 (no stagger, no ripple, opacity only).
 */
import { effectiveProgress, isNodeSatisfied, requiredPredecessors } from '../../scoring/progress'
import { groupOf, isNodeActive, type MapGraph, type MapLink, type NodeState, type WorldEvil } from './graph'

export type NodeStatus = 'defeated' | 'skipped' | 'reached' | 'recommended' | 'available' | 'locked'
export type LinkStatus = 'locked' | 'idle' | 'lit'

export interface MapProgress {
  nodes: ReadonlyMap<string, NodeStatus>
  /** Flow links, by link id. */
  links: ReadonlyMap<string, LinkStatus>
  /** Either/or fork branches, by member id. */
  branches: ReadonlyMap<string, LinkStatus>
  /** A locked node's unsatisfied gates (node ids), in data order. */
  unmet: ReadonlyMap<string, readonly string[]>
  /** Required-gate links (by link id) whose gate is met: their source is satisfied. */
  openGates: ReadonlySet<string>
}

/** Link types that make their target "the next step" once their source is done. */
const NEXT_TYPES = new Set(['required-gate', 'recommended-next'])

const isOpen = (status: NodeStatus | undefined) => status === 'recommended' || status === 'available'

/**
 * Flow links into a node as the map draws them: a non-root either/or member is reached through its
 * group root's incoming links (the fork), like the root itself.
 */
export function flowIncoming(graph: MapGraph, id: string): MapLink[] {
  const group = groupOf(graph, id)
  const target = group && group[0] !== id ? group[0] : id
  return graph.links.filter((l) => l.to === target)
}

export function mapProgress(graph: MapGraph, nodeStates: Readonly<Record<string, NodeState>>, worldEvil: WorldEvil | null): MapProgress {
  const progression = graph.progression
  const ep = effectiveProgress(progression, { worldEvil, nodeStates })
  const memo = new Map<string, boolean>()
  const satisfied = (id: string) => isNodeSatisfied(progression, ep, id, memo)
  // Done, as gates count it (AMENDMENTS-016 B128): satisfied, so a mark counts exactly where
  // progress.countsInWorld says it does. The other world's evil boss, marked under a chosen world evil,
  // still shows its own mark (drawn dimmed) but opens, recommends and lights nothing; under "Both" either counts.
  const done = satisfied

  const nodes = new Map<string, NodeStatus>()
  const unmet = new Map<string, readonly string[]>()
  for (const node of graph.nodes) {
    const tracked = nodeStates[node.id]
    const gates = requiredPredecessors(progression, node.id).filter((p) => !satisfied(p))
    if (gates.length > 0) unmet.set(node.id, gates)
    let status: NodeStatus
    if (tracked === 'defeated') status = 'defeated'
    else if (tracked === 'skipped') status = 'skipped'
    else if (gates.length > 0) status = 'locked'
    else if (node.kind === 'milestone') status = 'reached'
    else if (isNodeActive(node, worldEvil) && flowIncoming(graph, node.id).some((l) => l.types.some((t) => NEXT_TYPES.has(t)) && done(l.from))) status = 'recommended'
    else status = 'available'
    nodes.set(node.id, status)
  }

  const links = new Map<string, LinkStatus>()
  const openGates = new Set<string>()
  for (const link of graph.links) {
    if (link.types.includes('required-gate') && satisfied(link.from)) openGates.add(link.id)
    const group = groupOf(graph, link.to)
    const targets = group && group[0] === link.to ? group : [link.to]
    const statuses = targets.map((id) => nodes.get(id))
    if (nodes.get(link.from) === 'locked' || statuses.every((s) => s === 'locked')) links.set(link.id, 'locked')
    else if (
      link.types.includes('recommended-next') &&
      done(link.from) &&
      // an out-of-play source (the other world's evil boss, marked) lights nothing: its link is drawn dimmed (B98)
      isNodeActive(graph.nodeById.get(link.from)!, worldEvil) &&
      targets.some((id) => isOpen(nodes.get(id)) && isNodeActive(graph.nodeById.get(id)!, worldEvil))
    ) {
      links.set(link.id, 'lit')
    } else links.set(link.id, 'idle')
  }

  const branches = new Map<string, LinkStatus>()
  for (const group of graph.groups) {
    const trunk = graph.links.filter((l) => l.to === group[0]).map((l) => links.get(l.id))
    for (const member of group) {
      const status = nodes.get(member)
      const node = graph.nodeById.get(member)
      const locked = status === 'locked' || (trunk.length > 0 && trunk.every((t) => t === 'locked'))
      branches.set(member, locked ? 'locked' : trunk.includes('lit') && isOpen(status) && node && isNodeActive(node, worldEvil) ? 'lit' : 'idle')
    }
  }

  return { nodes, links, branches, unmet, openGates }
}

/**
 * Can this node be marked "skipped"? Only an optional boss: one the data reaches through an
 * `optional` link that gates nothing itself (no required-gate link out) — King Slime, Queen Bee,
 * Deerclops, Queen Slime, Duke Fishron, the Empress of Light. Skipping a node the main line needs
 * would leave the line locked, so it isn't offered there.
 */
export function canSkip(graph: MapGraph, id: string): boolean {
  const node = graph.nodeById.get(id)
  if (node?.kind !== 'boss') return false
  const edges = graph.progression.edges
  return edges.some((e) => e.to === id && e.type === 'optional') && !edges.some((e) => e.from === id && e.type === 'required-gate')
}

/* ------------------------------------------------------------------------------------------ */
/* Unlock cascade                                                                              */

/** UX_SPEC §12: 50ms stagger along the graph direction, 200ms ease-out-strong per element. */
export const UNLOCK_STAGGER_MS = 50
export const UNLOCK_DURATION_MS = 200
/** Design review P5-S4 M2: how much later each sibling within one step starts than the one before it. */
export const UNLOCK_RIPPLE_MS = 25
/** The ripple never stretches a cascade past this (ms until its last element has finished). */
export const UNLOCK_MAX_TOTAL_MS = 700

export interface NodeUnlock {
  step: number
  delayMs: number
  /** The ring fills gold (newly defeated). */
  ring: boolean
  /** Locked → open: the node comes up from its subdued look and drops its lock glyph. */
  unlock: boolean
  /** Newly recommended: its highlight appears. */
  highlight: boolean
}

export interface LinkUnlock {
  step: number
  delayMs: number
  /** Locked → open: the line comes up from its subdued look. */
  unlock: boolean
  /** Newly lit (recommended next from a done node): its glow appears. */
  lit: boolean
  /** A required gate newly met: its padlock badge turns into a check. */
  gate: boolean
}

export interface UnlockSchedule {
  nodes: ReadonlyMap<string, NodeUnlock>
  /** By link id. */
  links: ReadonlyMap<string, LinkUnlock>
  /** By either/or member id. */
  branches: ReadonlyMap<string, LinkUnlock>
  /** Until the last element finishes (ms). */
  durationMs: number
  /** How much later each sibling within a step starts than the one before it (ms; 0 = no ripple). */
  rippleMs: number
  size: number
}

export const EMPTY_SCHEDULE: UnlockSchedule = { nodes: new Map(), links: new Map(), branches: new Map(), durationMs: 0, rippleMs: 0, size: 0 }

export interface ScheduleOptions {
  reducedMotion?: boolean
  /**
   * Each node's position along its layer (layout cross-axis centre, map px): siblings within a step
   * ripple in this order. Absent: no ripple.
   */
  position?: ReadonlyMap<string, number>
}

/** Flow order: every node after all the nodes linking into it (Kahn; ties keep data order). */
export function flowOrder(graph: MapGraph): string[] {
  const ids = graph.nodes.map((n) => n.id)
  const preds = new Map(ids.map((id) => [id, new Set(flowIncoming(graph, id).map((l) => l.from).filter((f) => f !== id))]))
  const order: string[] = []
  const placed = new Set<string>()
  while (order.length < ids.length) {
    const next = ids.find((id) => !placed.has(id) && [...preds.get(id)!].every((p) => placed.has(p)))
    // A cycle can't occur in progression data; if it did, place the rest in data order.
    const id = next ?? ids.find((i) => !placed.has(i))!
    order.push(id)
    placed.add(id)
  }
  return order
}

const linkChange = (before: LinkStatus | undefined, after: LinkStatus | undefined, gate = false) => ({
  unlock: before === 'locked' && after !== undefined && after !== 'locked',
  lit: after === 'lit' && before !== 'lit',
  gate,
})
const changed = (c: { unlock: boolean; lit: boolean; gate: boolean }) => c.unlock || c.lit || c.gate

type StepOnly<T> = Omit<T, 'delayMs'>

/**
 * The cascade from `before` to `after` (same graph, same world evil): what unlocked, filled, lit or
 * had its gate met, with each element's step and delay. Re-locks (a reset, an un-marked defeat)
 * aren't part of it.
 */
export function unlockSchedule(graph: MapGraph, before: MapProgress, after: MapProgress, { reducedMotion = false, position }: ScheduleOptions = {}): UnlockSchedule {
  const flowLinkChange = (id: string) => linkChange(before.links.get(id), after.links.get(id), !before.openGates.has(id) && after.openGates.has(id))
  const nodeChange = (id: string) => {
    const was = before.nodes.get(id)
    const now = after.nodes.get(id)
    const change = {
      ring: now === 'defeated' && was !== 'defeated',
      unlock: was === 'locked' && now !== undefined && now !== 'locked',
      highlight: now === 'recommended' && was !== 'recommended' && was !== 'locked',
    }
    return change.ring || change.unlock || change.highlight ? change : undefined
  }

  const order = flowOrder(graph)
  const nodeSteps = new Map<string, StepOnly<NodeUnlock>>()
  const linkSteps = new Map<string, StepOnly<LinkUnlock>>()
  for (const id of order) {
    const change = nodeChange(id)
    const incoming = flowIncoming(graph, id)
    // Links whose source changed light up one step after it.
    let latest = -1
    for (const link of incoming) {
      const lc = flowLinkChange(link.id)
      const source = nodeSteps.get(link.from)
      if (!changed(lc)) continue
      if (source) {
        const step = linkSteps.get(link.id)?.step ?? source.step + 1
        linkSteps.set(link.id, { step, ...lc })
        latest = Math.max(latest, step)
      }
    }
    if (change) nodeSteps.set(id, { step: latest + 1, ...change })
    // Links that changed only because this node did (their source was already done) come in with
    // the causal link, one step before the node.
    for (const link of incoming) {
      if (linkSteps.has(link.id)) continue
      const lc = flowLinkChange(link.id)
      if (!changed(lc)) continue
      const step = Math.max(0, (nodeSteps.get(id)?.step ?? 1) - 1)
      linkSteps.set(link.id, { step, ...lc })
    }
  }

  const branchSteps = new Map<string, StepOnly<LinkUnlock>>()
  const trunkOf = (group: readonly string[]) => graph.links.filter((l) => l.to === group[0] && linkSteps.has(l.id))
  for (const group of graph.groups) {
    const trunk = trunkOf(group).map((l) => linkSteps.get(l.id)!)
    for (const member of group) {
      const lc = linkChange(before.branches.get(member), after.branches.get(member))
      if (!changed(lc)) continue
      const node = nodeSteps.get(member)
      const step = node ? Math.max(0, node.step - 1) : trunk.length ? Math.max(...trunk.map((t) => t.step)) : 0
      branchSteps.set(member, { step, ...lc })
    }
  }

  // Timing. Every element: its step's time plus its ripple offset (its rank among its siblings — the
  // same kind of element at the same step — along the layer), and never before what caused it has
  // started (one stagger per step after it). With no ripple that is exactly step × stagger.
  type Slot = { step: number; rank: number; preds: Slot[]; delayMs: number }
  const slot = (step: number): Slot => ({ step, rank: 0, preds: [], delayMs: 0 })
  const nodeSlots = new Map([...nodeSteps].map(([id, n]) => [id, slot(n.step)]))
  const linkSlots = new Map([...linkSteps].map(([id, l]) => [id, slot(l.step)]))
  const branchSlots = new Map([...branchSteps].map(([id, b]) => [id, slot(b.step)]))
  const linkById = new Map(graph.links.map((l) => [l.id, l]))
  for (const [id, s] of nodeSlots) {
    s.preds = [...flowIncoming(graph, id).flatMap((l) => linkSlots.get(l.id) ?? []), ...(branchSlots.has(id) ? [branchSlots.get(id)!] : [])]
  }
  for (const [id, s] of linkSlots) s.preds = nodeSlots.has(linkById.get(id)!.from) ? [nodeSlots.get(linkById.get(id)!.from)!] : []
  for (const group of graph.groups) {
    for (const member of group) {
      const s = branchSlots.get(member)
      if (s) s.preds = trunkOf(group).map((l) => linkSlots.get(l.id)!)
    }
  }
  // Ranks along the layer (position), ties in flow order.
  const flowIndex = new Map(order.map((id, i) => [id, i]))
  const at = (id: string) => position?.get(id) ?? 0
  const rankWithin = <K>(slots: ReadonlyMap<K, Slot>, keys: (key: K) => number[]) => {
    const bySteps = new Map<number, K[]>()
    for (const [key, s] of slots) bySteps.set(s.step, [...(bySteps.get(s.step) ?? []), key])
    for (const siblings of bySteps.values()) {
      const sorted = siblings.map((key) => ({ key, sort: keys(key) })).sort((a, b) => a.sort.reduce((d, v, i) => d || v - b.sort[i], 0))
      sorted.forEach(({ key }, rank) => (slots.get(key)!.rank = rank))
    }
  }
  if (position) {
    rankWithin(nodeSlots, (id) => [at(id), flowIndex.get(id) ?? 0])
    rankWithin(linkSlots, (id) => {
      const link = linkById.get(id)!
      return [at(link.to), at(link.from), flowIndex.get(link.to) ?? 0, flowIndex.get(link.from) ?? 0]
    })
    rankWithin(branchSlots, (id) => [at(id), flowIndex.get(id) ?? 0])
  }
  const slots = [...nodeSlots.values(), ...linkSlots.values(), ...branchSlots.values()].sort((a, b) => a.step - b.step)
  const time = (ripple: number) => {
    for (const s of slots) {
      const own = s.step * UNLOCK_STAGGER_MS + s.rank * ripple
      s.delayMs = s.preds.reduce((t, p) => (p.step < s.step ? Math.max(t, p.delayMs + (s.step - p.step) * UNLOCK_STAGGER_MS) : t), own)
    }
    return slots.length ? Math.max(...slots.map((s) => s.delayMs)) + UNLOCK_DURATION_MS : 0
  }
  // The largest ripple (≤ UNLOCK_RIPPLE_MS) that keeps the cascade within UNLOCK_MAX_TOTAL_MS.
  let rippleMs = 0
  if (position && !reducedMotion) {
    for (let r = UNLOCK_RIPPLE_MS; r > 0; r--) {
      if (time(r) <= UNLOCK_MAX_TOTAL_MS) {
        rippleMs = r
        break
      }
    }
  }
  const durationMs = reducedMotion ? (slots.length ? UNLOCK_DURATION_MS : 0) : time(rippleMs)
  const delayOf = (s: Slot) => (reducedMotion ? 0 : s.delayMs)
  const timed = <T extends { step: number }>(steps: ReadonlyMap<string, T>, slotsById: ReadonlyMap<string, Slot>) =>
    new Map([...steps].map(([id, v]) => [id, { ...v, delayMs: delayOf(slotsById.get(id)!) }]))

  return {
    nodes: timed(nodeSteps, nodeSlots),
    links: timed(linkSteps, linkSlots),
    branches: timed(branchSteps, branchSlots),
    durationMs,
    rippleMs,
    size: slots.length,
  }
}

/**
 * The same cascade `leadMs` later: every element waits while the camera frames it first (design
 * review P5-S4 M1 — one motion at a time).
 */
export function withLead(schedule: UnlockSchedule, leadMs: number): UnlockSchedule {
  if (leadMs <= 0 || schedule.size === 0) return schedule
  const shift = <T extends { delayMs: number }>(map: ReadonlyMap<string, T>) => new Map([...map].map(([id, v]) => [id, { ...v, delayMs: v.delayMs + leadMs }]))
  return { ...schedule, nodes: shift(schedule.nodes), links: shift(schedule.links), branches: shift(schedule.branches), durationMs: schedule.durationMs + leadMs }
}

/* ------------------------------------------------------------------------------------------ */
/* Words                                                                                       */

/** Status words: the map's node descriptions, the focus card and the boss pages' next steps. */
export const NODE_STATUS_LABEL: Readonly<Record<NodeStatus, string>> = {
  defeated: 'Defeated',
  skipped: 'Skipped',
  reached: 'Reached',
  recommended: 'Recommended next',
  available: 'Available',
  locked: 'Locked',
}

/**
 * What to mark for a locked node to open: its unsatisfied gates, with each milestone or event among
 * them expanded into the unsatisfied bosses behind it (milestones aren't marked — Hardmode opens
 * with the Wall of Flesh, Plantera with the three mechs). Ids, in gate order.
 */
export function bossesToMark(graph: MapGraph, progress: MapProgress, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (gate: string) => {
    if (seen.has(gate)) return
    seen.add(gate)
    const inner = graph.nodeById.get(gate)?.kind === 'boss' ? [] : (progress.unmet.get(gate) ?? [])
    if (inner.length === 0) out.push(gate)
    else inner.forEach(visit)
  }
  ;(progress.unmet.get(id) ?? []).forEach(visit)
  return out
}

/** One sentence for screen readers: the status, and what a locked node still needs marked. */
export function describeStatus(graph: MapGraph, progress: MapProgress, id: string): string {
  const status = progress.nodes.get(id)
  if (!status) return ''
  if (status !== 'locked') return `${NODE_STATUS_LABEL[status]}.`
  const names = bossesToMark(graph, progress, id).map((g) => graph.nodeById.get(g)?.name ?? g)
  return `Locked: needs ${names.join(', ')}.`
}

/** The nodes `after` opened that `before` had locked, in flow order (announcements). */
export function newlyOpened(graph: MapGraph, before: MapProgress, after: MapProgress): string[] {
  return flowOrder(graph).filter((id) => before.nodes.get(id) === 'locked' && after.nodes.get(id) !== 'locked')
}
