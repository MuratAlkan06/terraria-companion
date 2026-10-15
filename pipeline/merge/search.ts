/**
 * search-docs.json (DATA_SCHEMA_SPEC §2.10, §7a-11): one SearchDoc per searchable entity the
 * dataset contains. Each later dataset slice appends its entity type here; validate requires
 * every searchable entity to appear exactly once. P2-S6 adds bosses (PRD P2-S6 AC4); P2-S7 adds the
 * ammo items (type "item") and the buffs (type "buff"), and every doc carries its entity's
 * `wikiUrl` (AMENDMENTS-007 B31). P2-S8 adds armor pieces ("armor"), accessories ("accessory", tags =
 * the record's tags + its categories) and armor sets ("set", tags = the variants' classes other than
 * "other" — AMENDMENTS-011 B52 `classes ?? [class]`, so hybrids are tagged with every class —, stage =
 * the set's stage). B70: potions are items (type "item") like the ammo.
 */
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Enemy, Item, SearchDoc, Weapon } from '../../src/schemas'

export interface SearchDocInput {
  weapons: readonly Weapon[]
  enemies: readonly Enemy[]
  bosses: readonly Boss[]
  items?: readonly Item[]
  buffs?: readonly Buff[]
  armor?: readonly ArmorPiece[]
  accessories?: readonly Accessory[]
  armorSets?: readonly ArmorSet[]
}

export function buildSearchDocs(ds: SearchDocInput): SearchDoc[] {
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
      wikiUrl: w.wikiUrl,
    })
  }
  for (const i of [...(ds.items ?? [])].sort((a, b) => a.id - b.id)) {
    docs.push({
      id: `i:${i.id}`,
      name: i.name,
      type: 'item',
      ...(i.stage ? { stage: i.stage } : {}),
      ...(i.rarity !== undefined ? { rarity: i.rarity } : {}),
      tags: i.tags,
      wikiUrl: i.wikiUrl,
    })
  }
  for (const a of [...(ds.armor ?? [])].sort((x, y) => x.id - y.id)) {
    docs.push({ id: `i:${a.id}`, name: a.name, type: 'armor', ...(a.stage ? { stage: a.stage } : {}), ...(a.rarity !== undefined ? { rarity: a.rarity } : {}), tags: a.tags, wikiUrl: a.wikiUrl })
  }
  for (const a of [...(ds.accessories ?? [])].sort((x, y) => x.id - y.id)) {
    docs.push({ id: `i:${a.id}`, name: a.name, type: 'accessory', ...(a.stage ? { stage: a.stage } : {}), ...(a.rarity !== undefined ? { rarity: a.rarity } : {}), tags: [...new Set([...a.tags, ...a.categories])].sort(), wikiUrl: a.wikiUrl })
  }
  for (const s of [...(ds.armorSets ?? [])].sort((x, y) => x.id.localeCompare(y.id))) {
    const classes = [...new Set(s.variants.flatMap((v) => v.classes ?? [v.class]).filter((c) => c !== 'other'))].sort()
    docs.push({ id: `set:${s.id}`, name: s.name, type: 'set', ...(s.stage ? { stage: s.stage } : {}), tags: classes, wikiUrl: s.wikiUrl })
  }
  for (const e of [...ds.enemies].sort((a, b) => a.id.localeCompare(b.id))) {
    docs.push({ id: `enemy:${e.id}`, name: e.name, type: 'enemy', ...(e.stage ? { stage: e.stage } : {}), tags: [], wikiUrl: e.wikiUrl })
  }
  for (const b of [...ds.bosses].sort((a, b) => a.id.localeCompare(b.id))) {
    docs.push({ id: `boss:${b.id}`, name: b.name, type: 'boss', stage: b.stage, tags: b.worldEvil ? [b.worldEvil] : [], wikiUrl: b.wikiUrl })
  }
  for (const b of [...(ds.buffs ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    docs.push({ id: `buff:${b.id}`, name: b.name, type: 'buff', tags: b.isDebuff ? ['debuff'] : [], wikiUrl: b.wikiUrl })
  }
  return docs
}
