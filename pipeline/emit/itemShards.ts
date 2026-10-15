/**
 * P6-S0 item-detail sharding (DATA_SCHEMA_SPEC §5 "items.detail.<n>.json by ID ranges +
 * items.detail.index.json"; src/schemas ItemDetailIndex). The core file items.detail.json keeps the
 * records the shipped app surfaces load in full (the caller's `core` ids: ammo, potions, every item a
 * boss record references); every other item goes to the shard of its ID range. Pure + deterministic:
 * records keep their input order (sorted by id), files are listed core first, then by shard number.
 */
import { ITEM_DETAIL_CORE_FILE, type ItemDetailIndex } from '../../src/schemas'

export const ITEM_SHARD_SIZE = 1000
export const itemShardFile = (n: number): string => `items.detail.${n}.json`
export const ITEM_SHARD_FILE = /^items\.detail\.(\d+)\.json$/

export function shardItems<T extends { id: number }>(items: readonly T[], core: ReadonlySet<number>, shardSize = ITEM_SHARD_SIZE): { files: Map<string, T[]>; index: ItemDetailIndex } {
  const sorted = [...items].sort((a, b) => a.id - b.id)
  const files = new Map<string, T[]>([[ITEM_DETAIL_CORE_FILE, []]])
  const shards = new Map<number, T[]>()
  for (const item of sorted) {
    if (core.has(item.id)) (files.get(ITEM_DETAIL_CORE_FILE) as T[]).push(item)
    else {
      const n = Math.floor(item.id / shardSize)
      shards.set(n, [...(shards.get(n) ?? []), item])
    }
  }
  for (const [n, list] of [...shards].sort((a, b) => a[0] - b[0])) files.set(itemShardFile(n), list)
  return { files, index: { shardSize, files: [...files].map(([file, list]) => ({ file, ids: list.map((i) => i.id) })) } }
}

/** items.detail.index.json text: one file entry per line (compact, diff-friendly). */
export const serializeItemIndex = (index: ItemDetailIndex): string =>
  `{"shardSize":${index.shardSize},"files":[\n${index.files.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`

export interface ShardCheck {
  ok: boolean
  problems: string[]
}

/**
 * Index ⇄ files consistency (validate): every listed file exists and holds exactly its listed ids in
 * order; every id appears once; a shard holds only ids of its range; no shard file is unlisted.
 */
export function checkItemShards(index: ItemDetailIndex, records: ReadonlyMap<string, readonly { id?: unknown }[] | undefined>, presentShardFiles: readonly string[]): ShardCheck {
  const problems: string[] = []
  const seen = new Set<number>()
  const listed = new Set(index.files.map((f) => f.file))
  for (const f of presentShardFiles) if (!listed.has(f)) problems.push(`${f} is not listed in the item index`)
  for (const entry of index.files) {
    const recs = records.get(entry.file)
    if (!recs) {
      problems.push(`${entry.file} is listed in the item index but missing`)
      continue
    }
    const ids = recs.map((r) => r.id)
    if (ids.length !== entry.ids.length || ids.some((id, i) => id !== entry.ids[i])) problems.push(`${entry.file} records do not equal its index ids`)
    const m = ITEM_SHARD_FILE.exec(entry.file)
    for (const id of entry.ids) {
      if (seen.has(id)) problems.push(`item ${id} is listed in more than one item file`)
      seen.add(id)
      if (m && Math.floor(id / index.shardSize) !== Number(m[1])) problems.push(`item ${id} is outside the id range of ${entry.file}`)
    }
  }
  return { ok: problems.length === 0, problems }
}
