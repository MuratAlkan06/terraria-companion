/**
 * E_SUGGESTION_GATING (DATA_SCHEMA_SPEC §7a-5): every item a boss's suggestedEquipment
 * recommends must be obtainable BEFORE that boss — each of its gates (gatedBy.bosses, plus
 * gatedBy.conditions mapped through Condition.satisfiedByNode) must be strictly upstream of
 * the boss's node in the required-gate DAG. Feature A honesty, enforced at build time.
 *
 * A suggested item whose gating is UNKNOWN (gatedBy absent + listed in unverifiedFields)
 * also fails: unknown gating is never "obtainable now" (§2.2). Absent + unlisted gatedBy
 * means no gates apply.
 */
import { isCoveredBy, setPieceIds, type Accessory, type ArmorPiece, type Boss, type Weapon } from '../../src/schemas'
import type { Dataset } from './dataset'
import type { PipelineError } from './errors'
import { requiredGateUpstream } from './graph'

type Suggestable = Weapon | Accessory | ArmorPiece

/** The required-gate context the suggestion rule reads (built once per dataset). */
export interface SuggestionContext {
  upstream: ReadonlyMap<string, ReadonlySet<string>>
  nodeForCondition: ReadonlyMap<string, string>
}

export function suggestionContext(ds: Dataset): SuggestionContext {
  return {
    upstream: requiredGateUpstream(ds.nodes, ds.edges),
    nodeForCondition: new Map(ds.conditions.flatMap((c) => (c.satisfiedByNode ? [[c.id, c.satisfiedByNode] as const] : []))),
  }
}

/**
 * Why `item` may NOT be suggested for `boss` (one reason per offending gate), or [] when it is
 * verified obtainable before the boss.
 */
export function suggestionGateFailures(item: Suggestable, boss: Pick<Boss, 'nodeId'>, ctx: SuggestionContext): string[] {
  if (!item.gatedBy) {
    return isCoveredBy(item._prov.unverifiedFields, 'gatedBy') ? ['gating is unknown (gatedBy unverified), so it cannot be shown as obtainable before this boss'] : []
  }
  const before = ctx.upstream.get(boss.nodeId) ?? new Set<string>()
  const gates = new Set(item.gatedBy.bosses)
  for (const cond of item.gatedBy.conditions) {
    const node = ctx.nodeForCondition.get(cond)
    if (node) gates.add(node)
  }
  return [...gates]
    .filter((gate) => !before.has(gate))
    .map((gate) =>
      gate === boss.nodeId
        ? `gated behind node:${gate}, the boss itself`
        : `gated behind node:${gate}, which is not strictly upstream of node:${boss.nodeId} in the required-gate graph`,
    )
}

export function checkSuggestionGating(ds: Dataset): PipelineError[] {
  const errors: PipelineError[] = []
  const ctx = suggestionContext(ds)
  const weapons = new Map(ds.weapons.map((w) => [w.id, w]))
  const accessories = new Map(ds.accessories.map((a) => [a.id, a]))
  const armor = new Map(ds.armor.map((a) => [a.id, a]))
  const sets = new Map(ds.armorSets.map((s) => [s.id, s]))

  for (const boss of ds.bosses) {
    if (!boss.suggestedEquipment) continue
    const suggested = new Map<number, Suggestable>()
    for (const s of boss.suggestedEquipment) {
      for (const id of s.weapons) if (weapons.has(id)) suggested.set(id, weapons.get(id) as Weapon)
      for (const id of s.accessories) if (accessories.has(id)) suggested.set(id, accessories.get(id) as Accessory)
      for (const setId of s.armorSetIds) {
        const set = sets.get(setId)
        if (!set) continue
        for (const id of setPieceIds(set)) {
          const piece = armor.get(id)
          if (piece) suggested.set(id, piece)
        }
      }
    }
    for (const [id, item] of suggested) {
      const itemRef = `i:${id}`
      for (const detail of suggestionGateFailures(item, boss, ctx)) {
        errors.push({ code: 'E_SUGGESTION_GATING', bossId: boss.id, itemRef, message: `boss:${boss.id} suggests ${itemRef} (${item.name}): ${detail}` })
      }
    }
  }
  return errors
}
