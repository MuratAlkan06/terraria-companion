/**
 * search-docs.json (DATA_SCHEMA_SPEC §2.10, §7a-11): one SearchDoc per searchable entity the
 * dataset contains. Each later dataset slice appends its entity type here; validate requires
 * every searchable entity to appear exactly once.
 */
import type { Enemy, SearchDoc, Weapon } from '../../src/schemas'

export function buildSearchDocs(ds: { weapons: readonly Weapon[]; enemies: readonly Enemy[] }): SearchDoc[] {
  const docs: SearchDoc[] = []
  for (const w of [...ds.weapons].sort((a, b) => a.id - b.id)) {
    docs.push({
      id: `i:${w.id}`,
      name: w.name,
      type: 'weapon',
      ...(w.damageClass ? { class: w.damageClass } : {}),
      ...(w.stage ? { stage: w.stage } : {}),
      ...(w.rarity !== undefined ? { rarity: w.rarity } : {}),
      tags: w.tags,
    })
  }
  for (const e of [...ds.enemies].sort((a, b) => a.id.localeCompare(b.id))) {
    docs.push({ id: `enemy:${e.id}`, name: e.name, type: 'enemy', ...(e.stage ? { stage: e.stage } : {}), tags: [] })
  }
  return docs
}
