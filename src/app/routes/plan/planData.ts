/**
 * Feature B data (UX_SPEC §1 `chunk-plan`; ADR D7 lazy data). The planner reads, as lazy data chunks cached
 * for the session by the data-access layer:
 * - the BASE: the recipe index + groups, item names, the item-page index, the drop records, the progression
 *   graph and the conditions registry (loadAcquisitionData — the same indexes the item pages read), the
 *   search docs (each id's kind, name, sprite and page) and the sprite index;
 * - the RECORDS of the items a plan reaches, loaded as the walk reaches them: weapons, armor and accessories
 *   from their detail files, Items one ID-range shard at a time (never the whole corpus).
 * `resolvePlanGraph` builds, loads what the walk reported missing, and builds again until nothing is missing.
 */
import {
  loadAccessoryDetails,
  loadAcquisitionData,
  loadArmorDetails,
  loadDetailIndex,
  loadItemDetail,
  loadSearchDocs,
  loadSpriteIndex,
  NotFoundError,
  peekAcquisitionData,
  peekSearchDocs,
  peekSpriteIndex,
  type AcquisitionData,
  type AcquisitionNeeds,
} from '../../../data-access'
import type { SpriteIndex } from '../../../data-access/types'
import type { SearchDoc } from '../../../schemas'
import { resolveTarget, type SearchTarget } from '../../../search/links'
import { buildPlanGraph, type PlanGraph, type PlanLookup, type PlanRecord } from './planTree'

const NEEDS: AcquisitionNeeds = { recipes: true, drops: true, gates: true }

export interface PlanBase {
  acquisition: AcquisitionData
  /** Every searchable entity by ref ("i:22"). */
  docs: ReadonlyMap<string, SearchDoc>
  /** null = sprite index unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
}

let docsFor: { source: readonly SearchDoc[]; byRef: ReadonlyMap<string, SearchDoc> } | undefined
const docsByRef = (docs: readonly SearchDoc[]) => {
  if (docsFor?.source !== docs) docsFor = { source: docs, byRef: new Map(docs.map((d) => [d.id, d])) }
  return docsFor.byRef
}

export async function loadPlanBase(): Promise<PlanBase> {
  const [acquisition, docs, sprites] = await Promise.all([
    loadAcquisitionData(NEEDS),
    loadSearchDocs(),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { acquisition, docs: docsByRef(docs), sprites }
}

export function peekPlanBase(): PlanBase | undefined {
  const acquisition = peekAcquisitionData(NEEDS)
  const docs = peekSearchDocs()
  if (!acquisition || !docs) return undefined
  return { acquisition, docs: docsByRef(docs), sprites: peekSpriteIndex() ?? null }
}

// --- records --------------------------------------------------------------------------------------------

/** Item record kinds with a detail record (one shared item-ID space, DATA_SCHEMA_SPEC §3). */
const RECORD_TYPES: ReadonlySet<string> = new Set(['weapon', 'armor', 'accessory', 'item'])

/** Every record loaded this session (null = the dataset has no such item). */
const records = new Map<number, PlanRecord | null>()

export function planLookup(base: PlanBase): PlanLookup {
  return {
    record(id) {
      if (records.has(id)) return records.get(id)
      const doc = base.docs.get(`i:${id}`)
      return doc && RECORD_TYPES.has(doc.type) ? undefined : null
    },
    recipe: (id) => base.acquisition.recipes?.byId.get(id),
    group: (id) => base.acquisition.recipes?.groups.get(id),
    drop: (id) => base.acquisition.drops?.byId.get(id),
  }
}

export async function loadPlanRecords(base: PlanBase, ids: Iterable<number>): Promise<void> {
  const wanted = [...ids].filter((id) => !records.has(id))
  const typeOf = (id: number) => base.docs.get(`i:${id}`)?.type
  const collection = async (type: string, load: () => Promise<ReadonlyMap<number, PlanRecord>>) => {
    const list = wanted.filter((id) => typeOf(id) === type)
    if (list.length === 0) return
    const map = await load()
    for (const id of list) records.set(id, map.get(id) ?? null)
  }
  await Promise.all([
    collection('weapon', () => loadDetailIndex('weapons')),
    collection('armor', loadArmorDetails),
    collection('accessory', loadAccessoryDetails),
    ...wanted
      .filter((id) => typeOf(id) === 'item')
      .map((id) =>
        loadItemDetail(id).then(
          (item) => void records.set(id, item),
          (error: unknown) => {
            if (error instanceof NotFoundError) records.set(id, null)
            else throw error
          },
        ),
      ),
  ])
  for (const id of wanted) if (!records.has(id) && !RECORD_TYPES.has(typeOf(id) ?? '')) records.set(id, null)
}

/** Each walk loads at most the records it reports missing; a plan converges in a few rounds (depth-bounded). */
const MAX_ROUNDS = 40

export async function resolvePlanGraph(base: PlanBase, goalId: number, amount: number, choices: Readonly<Record<string, string>>): Promise<PlanGraph> {
  const lookup = planLookup(base)
  let graph = buildPlanGraph(goalId, amount, choices, lookup)
  for (let round = 0; graph.missing.size > 0 && round < MAX_ROUNDS; round++) {
    await loadPlanRecords(base, graph.missing)
    graph = buildPlanGraph(goalId, amount, choices, lookup)
  }
  return graph
}

/** The plan graph when every record it needs is already loaded (synchronous; for a ready first frame). */
export function peekPlanGraph(base: PlanBase, goalId: number, amount: number, choices: Readonly<Record<string, string>>): PlanGraph | undefined {
  const graph = buildPlanGraph(goalId, amount, choices, planLookup(base))
  return graph.missing.size === 0 ? graph : undefined
}

// --- display helpers ------------------------------------------------------------------------------------

export interface NodeInfo {
  name: string
  sprite?: string
  rarity?: SearchDoc['rarity']
  damageClass?: string
  /** Its page: a weapon / Item in-app, an armor piece / accessory its wiki article. */
  link?: SearchTarget
  wikiUrl?: string
}

/** Name, sprite and page of an item or "Any X" group (search docs first, then the record, then the item names). */
export function nodeInfo(base: PlanBase, key: string, record?: PlanRecord): NodeInfo {
  const group = /^grp:(.+)$/.exec(key)
  if (group) return { name: base.acquisition.recipes?.groups.get(group[1])?.name ?? group[1] }
  const id = Number(key.slice(2))
  const doc = base.docs.get(key)
  const name = doc?.name ?? record?.name ?? base.acquisition.names?.byId.get(id) ?? `Item #${id}`
  return {
    name,
    ...(doc?.sprite ?? record?.sprite ? { sprite: doc?.sprite ?? record?.sprite } : {}),
    ...(doc?.rarity !== undefined || record?.rarity !== undefined ? { rarity: doc?.rarity ?? record?.rarity } : {}),
    ...(doc?.class ? { damageClass: doc.class } : {}),
    ...(doc ? { link: resolveTarget(doc) } : {}),
    ...(doc?.wikiUrl ?? record?.wikiUrl ? { wikiUrl: doc?.wikiUrl ?? record?.wikiUrl } : {}),
  }
}

/** Step wording names (planTree StepNames) over the base. */
export function stepNames(base: PlanBase, graph: PlanGraph) {
  return {
    name: (key: string) => {
      const node = graph.nodes.get(key)
      return nodeInfo(base, key, node?.kind === 'item' ? node.record : undefined).name
    },
  }
}

/** A cached `nodeInfo` per plan graph (the views ask for the same nodes many times). */
export function makeInfo(base: PlanBase, graph: PlanGraph): (key: string) => NodeInfo {
  const cache = new Map<string, NodeInfo>()
  return (key) => {
    let info = cache.get(key)
    if (!info) {
      const node = graph.nodes.get(key)
      info = nodeInfo(base, key, node?.kind === 'item' ? node.record : undefined)
      cache.set(key, info)
    }
    return info
  }
}
