/**
 * Validate-stage input model: the merged + derived entity collections (ADR-001 D2,
 * DATA_SCHEMA_SPEC §7c "validate"), plus optional list projections and search docs.
 *
 * On disk a dataset is a directory of JSON arrays (progression.json is `{ nodes, edges }`)
 * and a `dataset.json` manifest. Missing collection files are empty collections, so a
 * dataset may be a subset (e.g. the P2-S1 sample).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod'
import {
  Accessory,
  ArmorPiece,
  ArmorSet,
  Boss,
  Buff,
  Condition,
  CustomScenario,
  DropSource,
  Enemy,
  Item,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  Slug,
  Weapon,
} from '../../src/schemas'
import type { PipelineError } from './errors'

export const COLLECTIONS = {
  weapons: { file: 'weapons.json', schema: Weapon },
  armor: { file: 'armor.json', schema: ArmorPiece },
  accessories: { file: 'accessories.json', schema: Accessory },
  items: { file: 'items.json', schema: Item },
  armorSets: { file: 'armor-sets.json', schema: ArmorSet },
  enemies: { file: 'enemies.json', schema: Enemy },
  recipes: { file: 'recipes.json', schema: Recipe },
  recipeGroups: { file: 'recipe-groups.json', schema: RecipeGroup },
  drops: { file: 'drops.json', schema: DropSource },
  bosses: { file: 'bosses.json', schema: Boss },
  nodes: { file: 'progression.json#nodes', schema: ProgressionNode },
  edges: { file: 'progression.json#edges', schema: ProgressionEdge },
  buffs: { file: 'buffs.json', schema: Buff },
  conditions: { file: 'conditions.json', schema: Condition },
  scenarios: { file: 'lab-scenarios.json', schema: CustomScenario },
} as const

export type CollectionKey = keyof typeof COLLECTIONS
export const COLLECTION_KEYS = Object.keys(COLLECTIONS) as CollectionKey[]

export type Dataset = { [K in CollectionKey]: z.infer<(typeof COLLECTIONS)[K]['schema']>[] }

/** The four item collections sharing one game-item-ID space (§3). */
export const ITEM_COLLECTIONS = ['weapons', 'armor', 'accessories', 'items'] as const
export type ItemCollectionKey = (typeof ITEM_COLLECTIONS)[number]

export const LIST_FILES = {
  weapons: 'weapons.list.json',
  armor: 'armor.list.json',
  accessories: 'accessories.list.json',
  items: 'items.list.json',
} as const satisfies Record<ItemCollectionKey, string>

export const SEARCH_DOCS_FILE = 'search-docs.json'
export const MANIFEST_FILE = 'dataset.json'

/** Pipeline-only manifest describing a dataset directory. */
export const DatasetManifest = z.strictObject({
  name: Slug,
  description: z.string().min(1),
  iteminfo: z.strictObject({ rev: z.int().positive(), syncedTo: z.string().min(1) }),
  notes: z.array(z.string()),
})
export type DatasetManifest = z.infer<typeof DatasetManifest>

export interface RawDataset {
  manifest: unknown
  collections: Partial<Record<CollectionKey, unknown>>
  lists: Partial<Record<ItemCollectionKey, unknown>>
  searchDocs?: unknown
}

/** Stable display ref for a record (TypedRef where one exists). */
export function recordRef(key: CollectionKey, record: unknown): string {
  const r = (typeof record === 'object' && record !== null ? record : {}) as Record<string, unknown>
  switch (key) {
    case 'weapons':
    case 'armor':
    case 'accessories':
    case 'items':
      return `i:${String(r.id)}`
    case 'armorSets':
      return `set:${String(r.id)}`
    case 'enemies':
      return `enemy:${String(r.id)}`
    case 'recipes':
      return `rcp:${String(r.id)}`
    case 'recipeGroups':
      return `grp:${String(r.id)}`
    case 'drops':
      return `drop:${String(r.id)}`
    case 'bosses':
      return `boss:${String(r.id)}`
    case 'nodes':
      return `node:${String(r.id)}`
    case 'edges':
      return `edge:${String(r.from)}->${String(r.to)}(${String(r.type)})`
    case 'buffs':
      return `buff:${String(r.id)}`
    case 'conditions':
      return `cond:${String(r.id)}`
    case 'scenarios':
      return `scn:${String(r.id)}`
  }
}

const fileError = (file: string, message: string): PipelineError => ({
  code: 'E_SCHEMA',
  ref: `file:${file}`,
  zodIssues: [],
  message: `file:${file}: ${message}`,
})

function readJson(dir: string, file: string, errors: PipelineError[]): unknown {
  const path = join(dir, file)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (cause) {
    errors.push(fileError(file, `invalid JSON (${(cause as Error).message})`))
    return undefined
  }
}

/** Reads a dataset directory. File-level problems are returned as E_SCHEMA errors. */
export function loadDatasetDir(dir: string): { raw: RawDataset; errors: PipelineError[] } {
  const errors: PipelineError[] = []
  if (!existsSync(dir)) {
    return { raw: { manifest: undefined, collections: {}, lists: {} }, errors: [fileError(dir, 'dataset directory not found')] }
  }
  const known = new Set<string>([MANIFEST_FILE, SEARCH_DOCS_FILE, 'progression.json', ...Object.values(LIST_FILES)])
  for (const { file } of Object.values(COLLECTIONS)) known.add(file)
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.json') && !known.has(file)) errors.push(fileError(file, 'unknown dataset file'))
  }

  const collections: RawDataset['collections'] = {}
  for (const key of COLLECTION_KEYS) {
    const { file } = COLLECTIONS[key]
    if (file.startsWith('progression.json#')) continue
    const value = readJson(dir, file, errors)
    if (value !== undefined) collections[key] = value
  }
  const progression = readJson(dir, 'progression.json', errors)
  if (progression !== undefined) {
    if (typeof progression !== 'object' || progression === null || Array.isArray(progression)) {
      errors.push(fileError('progression.json', 'expected an object { nodes, edges }'))
    } else {
      const { nodes, edges, ...extra } = progression as Record<string, unknown>
      if (Object.keys(extra).length > 0) errors.push(fileError('progression.json', `unexpected keys ${Object.keys(extra).join(', ')}`))
      if (nodes !== undefined) collections.nodes = nodes
      if (edges !== undefined) collections.edges = edges
    }
  }

  const lists: RawDataset['lists'] = {}
  for (const [key, file] of Object.entries(LIST_FILES) as [ItemCollectionKey, string][]) {
    const value = readJson(dir, file, errors)
    if (value !== undefined) lists[key] = value
  }

  return {
    raw: { manifest: readJson(dir, MANIFEST_FILE, errors), collections, lists, searchDocs: readJson(dir, SEARCH_DOCS_FILE, errors) },
    errors,
  }
}

/** Strict-parses every record of every collection. Records that fail are omitted from the result. */
export function parseCollections(collections: RawDataset['collections']): { dataset: Dataset; errors: PipelineError[] } {
  const errors: PipelineError[] = []
  const dataset = Object.fromEntries(COLLECTION_KEYS.map((k) => [k, []])) as unknown as Dataset
  for (const key of COLLECTION_KEYS) {
    const value = collections[key]
    if (value === undefined) continue
    const { file, schema } = COLLECTIONS[key]
    if (!Array.isArray(value)) {
      errors.push(fileError(file, 'expected a JSON array of records'))
      continue
    }
    const out = dataset[key] as unknown[]
    value.forEach((record: unknown, index) => {
      const result = schema.safeParse(record)
      if (result.success) {
        out.push(result.data)
      } else {
        const candidate = recordRef(key, record)
        const ref = candidate.includes('undefined') ? `${file}[${index}]` : candidate
        errors.push({
          code: 'E_SCHEMA',
          ref,
          zodIssues: result.error.issues,
          message: `${ref} (${file}[${index}]) failed strict schema validation (${result.error.issues.length} issue(s))`,
        })
      }
    })
  }
  return { dataset, errors }
}
