/**
 * Referential integrity + derived-field consistency (DATA_SCHEMA_SPEC §7a, §1 denormalization
 * rule, AMENDMENTS-001 A5). Pure functions over a strictly-parsed Dataset.
 *
 * Rules: 1 recipes · 2 drops · 3 Boss.dropIds (and A5 Enemy.dropIds) · 4 Boss↔Node ·
 * 5 boss summon/prep/suggestion refs (gating in suggestions.ts) · 6 armor sets ·
 * 7 tinkering symmetry · 9 slug registries · Item.isStation consistency ·
 * present+listed values (E_UNVERIFIED_VALUE_EMITTED). Rule 8 lives in graph.ts,
 * rule 10 (A1-demoted) in labDowngrade.ts, rule 12 in the schemas.
 */
import {
  isCoveredBy,
  resolvePath,
  type Accessory,
  type ArmorPiece,
  type ArmorSet,
  type Boss,
  type Buff,
  type Condition,
  type CustomScenario,
  type DropSource,
  type Enemy,
  type Item,
  type ProgressionNode,
  type Recipe,
  type RecipeGroup,
  type Weapon,
} from '../../src/schemas'
import { COLLECTION_KEYS, ITEM_COLLECTIONS, recordRef, type Dataset, type ItemCollectionKey } from './dataset'
import { danglingRef, duplicateId, type PipelineError } from './errors'

/** Tinkerer's Workshop game item ID (terraria.wiki.gg Cargo Items: itemid 398). */
export const TINKERERS_WORKSHOP_ITEM_ID = 398

type AnyItem = Weapon | ArmorPiece | Accessory | Item

export interface DatasetIndex {
  itemById: Map<number, { key: ItemCollectionKey; record: AnyItem }>
  weapons: Map<number, Weapon>
  armor: Map<number, ArmorPiece>
  accessories: Map<number, Accessory>
  armorSets: Map<string, ArmorSet>
  enemies: Map<string, Enemy>
  recipes: Map<string, Recipe>
  recipeGroups: Map<string, RecipeGroup>
  drops: Map<string, DropSource>
  bosses: Map<string, Boss>
  nodes: Map<string, ProgressionNode>
  buffs: Map<string, Buff>
  conditions: Map<string, Condition>
  scenarios: Map<string, CustomScenario>
}

const byId = <T extends { id: string | number }>(records: readonly T[]) =>
  new Map(records.map((r) => [r.id, r] as [T['id'], T]))

export function buildIndex(ds: Dataset): DatasetIndex {
  const itemById: DatasetIndex['itemById'] = new Map()
  for (const key of ITEM_COLLECTIONS) for (const record of ds[key]) if (!itemById.has(record.id)) itemById.set(record.id, { key, record })
  return {
    itemById,
    weapons: byId(ds.weapons),
    armor: byId(ds.armor),
    accessories: byId(ds.accessories),
    armorSets: byId(ds.armorSets),
    enemies: byId(ds.enemies),
    recipes: byId(ds.recipes),
    recipeGroups: byId(ds.recipeGroups),
    drops: byId(ds.drops),
    bosses: byId(ds.bosses),
    nodes: byId(ds.nodes),
    buffs: byId(ds.buffs),
    conditions: byId(ds.conditions),
    scenarios: byId(ds.scenarios),
  }
}

/** E_DUPLICATE_ID: item IDs + slugs unique across the four item collections; ids unique per collection. */
export function checkDuplicates(ds: Dataset): PipelineError[] {
  const errors: PipelineError[] = []
  const itemIds = new Map<number, ItemCollectionKey>()
  const itemSlugs = new Map<string, string>()
  for (const key of ITEM_COLLECTIONS) {
    for (const r of ds[key]) {
      const first = itemIds.get(r.id)
      if (first !== undefined) errors.push(duplicateId('items(all)', `i:${r.id}`, `item ID already used in ${first}`))
      else itemIds.set(r.id, key)
      const slugOwner = itemSlugs.get(r.slug)
      if (slugOwner !== undefined) errors.push(duplicateId('items(all)', `i:${r.id}`, `slug "${r.slug}" already used by ${slugOwner}`))
      else itemSlugs.set(r.slug, `i:${r.id}`)
    }
  }
  for (const key of COLLECTION_KEYS) {
    if ((ITEM_COLLECTIONS as readonly string[]).includes(key) || key === 'edges') continue
    const seen = new Set<string>()
    for (const r of ds[key] as readonly { id: string }[]) {
      if (seen.has(r.id)) errors.push(duplicateId(key, recordRef(key, r), 'duplicate id'))
      seen.add(r.id)
    }
  }
  return errors
}

class Checker {
  readonly errors: PipelineError[] = []
  readonly ix: DatasetIndex
  constructor(ix: DatasetIndex) {
    this.ix = ix
  }

  dangling(fromRef: string, field: string, toRef: string, detail: string) {
    this.errors.push(danglingRef(fromRef, field, toRef, detail))
  }
  item(fromRef: string, field: string, id: number) {
    if (!this.ix.itemById.has(id)) this.dangling(fromRef, field, `i:${id}`, 'item not found')
  }
  condition(fromRef: string, field: string, slug: string) {
    if (!this.ix.conditions.has(slug)) this.dangling(fromRef, field, `cond:${slug}`, 'condition not in conditions registry')
  }
  node(fromRef: string, field: string, slug: string) {
    if (!this.ix.nodes.has(slug)) this.dangling(fromRef, field, `node:${slug}`, 'progression node not found')
  }
  buff(fromRef: string, field: string, slug: string) {
    if (!this.ix.buffs.has(slug)) this.dangling(fromRef, field, `buff:${slug}`, 'buff not found')
  }
  /** Declared derived set must equal the set derived from the source of truth. */
  sameSet(fromRef: string, field: string, declared: readonly (string | number)[], derived: Map<string | number, string>, toRef: (v: string | number) => string) {
    const declaredSet = new Set(declared)
    for (const v of declaredSet) {
      if (!derived.has(v)) this.dangling(fromRef, field, toRef(v), 'declared but not derivable from its source of truth')
    }
    for (const [v, why] of derived) {
      if (!declaredSet.has(v)) this.dangling(fromRef, field, toRef(v), `derived from ${why} but not declared`)
    }
  }
}

function checkRecipes(c: Checker, ds: Dataset) {
  for (const r of ds.recipes) {
    const ref = `rcp:${r.id}`
    c.item(ref, 'resultItemId', r.resultItemId)
    r.ingredients.forEach((ing, i) => {
      if (ing.ref.kind === 'item') c.item(ref, `ingredients.${i}.ref.itemId`, ing.ref.itemId)
      else if (!c.ix.recipeGroups.has(ing.ref.groupId)) c.dangling(ref, `ingredients.${i}.ref.groupId`, `grp:${ing.ref.groupId}`, 'recipe group not found')
    })
    r.stations.forEach((s, i) => {
      if (s.kind === 'item') c.item(ref, `stations.${i}.itemId`, s.itemId)
      else c.condition(ref, `stations.${i}.condition`, s.condition)
    })
  }
  for (const g of ds.recipeGroups) g.memberItemIds.forEach((id, i) => c.item(`grp:${g.id}`, `memberItemIds.${i}`, id))
}

function checkDrops(c: Checker, ds: Dataset) {
  for (const d of ds.drops) {
    const ref = `drop:${d.id}`
    c.item(ref, 'itemId', d.itemId)
    if (d.source.bossId !== undefined && !c.ix.bosses.has(d.source.bossId)) c.dangling(ref, 'source.bossId', `boss:${d.source.bossId}`, 'boss not found')
    d.conditions.forEach((s, i) => c.condition(ref, `conditions.${i}`, s))
  }
}

function checkItemCommon(c: Checker, ds: Dataset) {
  for (const key of ITEM_COLLECTIONS) {
    for (const r of ds[key]) {
      const ref = `i:${r.id}`
      r.acquisition.forEach((a, i) => {
        const at = `acquisition.${i}`
        if (a.method === 'craft') {
          a.recipeIds.forEach((rid, j) => {
            const recipe = c.ix.recipes.get(rid)
            if (!recipe) c.dangling(ref, `${at}.recipeIds.${j}`, `rcp:${rid}`, 'recipe not found')
            else if (recipe.resultItemId !== r.id) c.dangling(ref, `${at}.recipeIds.${j}`, `rcp:${rid}`, `recipe produces i:${recipe.resultItemId}, not ${ref}`)
          })
        } else if (a.method === 'drop') {
          a.dropIds.forEach((did, j) => {
            const drop = c.ix.drops.get(did)
            if (!drop) c.dangling(ref, `${at}.dropIds.${j}`, `drop:${did}`, 'drop source not found')
            else if (drop.itemId !== r.id) c.dangling(ref, `${at}.dropIds.${j}`, `drop:${did}`, `drop yields i:${drop.itemId}, not ${ref}`)
          })
        } else if (a.method === 'purchase' || a.method === 'fishing') {
          a.conditions.forEach((s, j) => c.condition(ref, `${at}.conditions.${j}`, s))
        }
      })
      if (r.gatedBy) {
        r.gatedBy.bosses.forEach((s, i) => c.node(ref, `gatedBy.bosses.${i}`, s))
        r.gatedBy.conditions.forEach((s, i) => c.condition(ref, `gatedBy.conditions.${i}`, s))
      }
    }
  }
}

function checkItems(c: Checker, ds: Dataset) {
  const stationUse = new Map<number, string>()
  for (const r of ds.recipes) for (const s of r.stations) if (s.kind === 'item' && !stationUse.has(s.itemId)) stationUse.set(s.itemId, `rcp:${r.id}`)
  for (const item of ds.items) {
    const ref = `i:${item.id}`
    item.buffGrants?.forEach((g, i) => c.buff(ref, `buffGrants.${i}.buffId`, g.buffId))
    if (item.summonsBossNode !== undefined) c.node(ref, 'summonsBossNode', item.summonsBossNode)
    const usedBy = stationUse.get(item.id)
    if (item.isStation && usedBy === undefined) c.dangling(ref, 'isStation', ref, 'declared true but no recipe uses it as a station')
    if (!item.isStation && usedBy !== undefined) c.dangling(ref, 'isStation', usedBy, 'declared false but this recipe uses it as a station')
  }
}

function checkWeaponsAndScenarios(c: Checker, ds: Dataset) {
  for (const w of ds.weapons) {
    const ref = `i:${w.id}`
    const lab = w.labBehavior
    if (lab.kind === 'archetype' && lab.modifiers?.dot) c.buff(ref, 'labBehavior.modifiers.dot.buffId', lab.modifiers.dot.buffId)
    if (lab.kind === 'custom-scenario') {
      const scenario = c.ix.scenarios.get(lab.scenarioId)
      if (!scenario) c.dangling(ref, 'labBehavior.scenarioId', `scn:${lab.scenarioId}`, 'custom scenario not found')
      else if (!scenario.weaponIds.includes(w.id)) c.dangling(ref, 'labBehavior.scenarioId', `scn:${lab.scenarioId}`, 'scenario does not list this weapon in weaponIds')
    }
  }
  for (const s of ds.scenarios) {
    s.weaponIds.forEach((id, i) => {
      if (!c.ix.weapons.has(id)) c.dangling(`scn:${s.id}`, `weaponIds.${i}`, `i:${id}`, 'weapon not found')
    })
  }
}

const SLOT_FIELD = { head: 'helmets', chest: 'chest', legs: 'legs' } as const

function checkArmor(c: Checker, ds: Dataset) {
  for (const set of ds.armorSets) {
    const ref = `set:${set.id}`
    const expectSlot = (field: string, id: number, slot: ArmorPiece['slot']) => {
      const piece = c.ix.armor.get(id)
      if (!piece) return c.dangling(ref, field, `i:${id}`, 'armor piece not found')
      if (piece.slot !== slot) c.dangling(ref, field, `i:${id}`, `expected a ${slot} piece, found ${piece.slot}`)
      if (piece.setId !== set.id) c.dangling(ref, field, `i:${id}`, `piece back-ref setId is ${piece.setId === undefined ? 'absent' : `"${piece.setId}"`}`)
    }
    const helmets = new Set<number>()
    set.pieces.helmets.forEach((id, i) => {
      if (helmets.has(id)) c.errors.push(duplicateId('armorSets', ref, `helmet i:${id} listed twice`))
      helmets.add(id)
      expectSlot(`pieces.helmets.${i}`, id, 'head')
    })
    expectSlot('pieces.chest', set.pieces.chest, 'chest')
    expectSlot('pieces.legs', set.pieces.legs, 'legs')
    // variants ⇄ helmets bijection
    const variantHelmets = new Set<number>()
    set.variants.forEach((v, i) => {
      if (variantHelmets.has(v.helmetId)) c.errors.push(duplicateId('armorSets', ref, `more than one variant for helmet i:${v.helmetId}`))
      variantHelmets.add(v.helmetId)
      if (!helmets.has(v.helmetId)) c.dangling(ref, `variants.${i}.helmetId`, `i:${v.helmetId}`, 'variant helmet is not in pieces.helmets')
    })
    for (const id of helmets) if (!variantHelmets.has(id)) c.dangling(ref, 'variants', `i:${id}`, 'helmet has no set-bonus variant')
  }
  for (const piece of ds.armor) {
    if (piece.setId === undefined) continue
    const ref = `i:${piece.id}`
    const set = c.ix.armorSets.get(piece.setId)
    if (!set) {
      c.dangling(ref, 'setId', `set:${piece.setId}`, 'armor set not found')
      continue
    }
    const field = SLOT_FIELD[piece.slot]
    const listed = field === 'helmets' ? set.pieces.helmets.includes(piece.id) : set.pieces[field] === piece.id
    if (!listed) c.dangling(ref, 'setId', `set:${set.id}`, `set does not list this piece under pieces.${field}`)
  }
}

function checkAccessories(c: Checker, ds: Dataset) {
  const combined = new Map<number, Map<number, string>>()
  const upgrades = new Map<number, Map<number, string>>()
  for (const r of ds.recipes) {
    const atTinkerer = r.stations.some((s) => s.kind === 'item' && s.itemId === TINKERERS_WORKSHOP_ITEM_ID)
    if (!atTinkerer || !c.ix.accessories.has(r.resultItemId)) continue
    for (const ing of r.ingredients) {
      if (ing.ref.kind !== 'item' || !c.ix.accessories.has(ing.ref.itemId)) continue
      const from = combined.get(r.resultItemId) ?? new Map<number, string>()
      from.set(ing.ref.itemId, `rcp:${r.id}`)
      combined.set(r.resultItemId, from)
      const to = upgrades.get(ing.ref.itemId) ?? new Map<number, string>()
      to.set(r.resultItemId, `rcp:${r.id}`)
      upgrades.set(ing.ref.itemId, to)
    }
  }
  for (const a of ds.accessories) {
    const ref = `i:${a.id}`
    c.sameSet(ref, 'combinedFrom', a.combinedFrom, combined.get(a.id) ?? new Map(), (v) => `i:${v}`)
    c.sameSet(ref, 'upgradesTo', a.upgradesTo, upgrades.get(a.id) ?? new Map(), (v) => `i:${v}`)
  }
}

function checkBossesAndNodes(c: Checker, ds: Dataset) {
  const dropsByBoss = new Map<string, Map<string, string>>()
  for (const d of ds.drops) {
    if (d.source.bossId === undefined) continue
    const m = dropsByBoss.get(d.source.bossId) ?? new Map<string, string>()
    m.set(d.id, `drop:${d.id}.source.bossId`)
    dropsByBoss.set(d.source.bossId, m)
  }
  for (const b of ds.bosses) {
    const ref = `boss:${b.id}`
    const node = c.ix.nodes.get(b.nodeId)
    if (!node) c.dangling(ref, 'nodeId', `node:${b.nodeId}`, 'progression node not found')
    else {
      if (node.kind !== 'boss' || node.bossId !== b.id) c.dangling(ref, 'nodeId', `node:${b.nodeId}`, `asymmetric: node kind "${node.kind}", bossId ${node.bossId === undefined ? 'absent' : `"${node.bossId}"`}`)
      if (node.worldEvil !== b.worldEvil) c.dangling(ref, 'worldEvil', `node:${b.nodeId}`, `boss worldEvil "${b.worldEvil ?? 'absent'}" differs from node "${node.worldEvil ?? 'absent'}"`)
    }
    b.summon.items.forEach((id, i) => c.item(ref, `summon.items.${i}`, id))
    b.summon.conditions.forEach((s, i) => c.condition(ref, `summon.conditions.${i}`, s))
    b.prepChecklist?.forEach((p, i) => p.itemIds?.forEach((id, j) => c.item(ref, `prepChecklist.${i}.itemIds.${j}`, id)))
    b.suggestedEquipment?.forEach((s, i) => {
      const at = `suggestedEquipment.${i}`
      s.weapons.forEach((id, j) => {
        if (!c.ix.weapons.has(id)) c.dangling(ref, `${at}.weapons.${j}`, `i:${id}`, 'weapon not found')
      })
      s.accessories.forEach((id, j) => {
        if (!c.ix.accessories.has(id)) c.dangling(ref, `${at}.accessories.${j}`, `i:${id}`, 'accessory not found')
      })
      s.armorSetIds.forEach((id, j) => {
        if (!c.ix.armorSets.has(id)) c.dangling(ref, `${at}.armorSetIds.${j}`, `set:${id}`, 'armor set not found')
      })
      s.buffs.forEach((id, j) => c.buff(ref, `${at}.buffs.${j}`, id))
    })
    for (const id of b.dropIds) {
      if (!c.ix.drops.has(id)) c.dangling(ref, 'dropIds', `drop:${id}`, 'drop source not found')
    }
    c.sameSet(ref, 'dropIds', b.dropIds.filter((id) => c.ix.drops.has(id)), dropsByBoss.get(b.id) ?? new Map(), (v) => `drop:${v}`)
  }
  for (const n of ds.nodes) {
    if (n.bossId === undefined) continue
    const boss = c.ix.bosses.get(n.bossId)
    if (!boss) c.dangling(`node:${n.id}`, 'bossId', `boss:${n.bossId}`, 'boss not found')
    else if (boss.nodeId !== n.id) c.dangling(`node:${n.id}`, 'bossId', `boss:${n.bossId}`, `asymmetric: boss nodeId is "${boss.nodeId}"`)
  }
  for (const cond of ds.conditions) {
    if (cond.satisfiedByNode !== undefined) c.node(`cond:${cond.id}`, 'satisfiedByNode', cond.satisfiedByNode)
  }
}

/** A5: Enemy.dropIds is derived from non-boss DropSources whose source names or ids match the enemy. */
function checkEnemies(c: Checker, ds: Dataset) {
  for (const e of ds.enemies) {
    const ref = `enemy:${e.id}`
    const derived = new Map<string, string>()
    for (const d of ds.drops) {
      if (d.source.bossId !== undefined) continue
      const idMatch = e.npcIds !== undefined && d.source.npcIds?.some((id) => e.npcIds?.includes(id))
      if (d.source.npcName === e.name || idMatch) derived.set(d.id, `drop:${d.id}.source`)
    }
    for (const id of e.dropIds) {
      if (!c.ix.drops.has(id)) c.dangling(ref, 'dropIds', `drop:${id}`, 'drop source not found')
    }
    c.sameSet(ref, 'dropIds', e.dropIds.filter((id) => c.ix.drops.has(id)), derived, (v) => `drop:${v}`)
  }
}

/**
 * §2 nullability policy: "present + listed is FORBIDDEN at emit". Required arrays cannot be
 * absent, so for them the spec's Unknown encoding is empty + listed (§2.2: `acquisition`
 * "empty ⇒ 'acquisition' ∈ unverifiedFields"); an empty, unlisted acquisition would claim
 * "no way to obtain" and is rejected.
 */
export function checkUnverifiedValues(ds: Dataset): PipelineError[] {
  const errors: PipelineError[] = []
  for (const key of ITEM_COLLECTIONS) {
    for (const r of ds[key]) {
      if (r.acquisition.length === 0 && !r._prov.unverifiedFields.includes('acquisition')) {
        errors.push({
          code: 'E_SCHEMA',
          ref: `i:${r.id}`,
          zodIssues: [],
          message: `i:${r.id} acquisition: empty acquisition must be listed in _prov.unverifiedFields (§2.2)`,
        })
      }
    }
  }
  for (const key of COLLECTION_KEYS) {
    for (const record of ds[key] as readonly { _prov: { unverifiedFields: string[] } }[]) {
      const ref = recordRef(key, record)
      for (const field of record._prov.unverifiedFields) {
        if (field === '_prov' || isCoveredBy(['_prov'], field)) continue
        const value = resolvePath(record, field)
        if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
          errors.push({
            code: 'E_UNVERIFIED_VALUE_EMITTED',
            ref,
            field,
            message: `${ref} ${field}: value is present but listed in _prov.unverifiedFields (strip the value or drop the listing)`,
          })
        }
      }
    }
  }
  return errors
}

export function checkIntegrity(ds: Dataset): PipelineError[] {
  const c = new Checker(buildIndex(ds))
  checkRecipes(c, ds)
  checkDrops(c, ds)
  checkItemCommon(c, ds)
  checkItems(c, ds)
  checkWeaponsAndScenarios(c, ds)
  checkArmor(c, ds)
  checkAccessories(c, ds)
  checkBossesAndNodes(c, ds)
  checkEnemies(c, ds)
  return [...checkDuplicates(ds), ...c.errors, ...checkUnverifiedValues(ds)]
}
