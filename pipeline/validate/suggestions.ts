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
import { isCoveredBy, type Accessory, type ArmorPiece, type Weapon } from '../../src/schemas'
import type { Dataset } from './dataset'
import type { PipelineError } from './errors'
import { requiredGateUpstream } from './graph'

type Suggestable = Weapon | Accessory | ArmorPiece

export function checkSuggestionGating(ds: Dataset): PipelineError[] {
  const errors: PipelineError[] = []
  const upstream = requiredGateUpstream(ds.nodes, ds.edges)
  const nodeForCondition = new Map(ds.conditions.flatMap((c) => (c.satisfiedByNode ? [[c.id, c.satisfiedByNode] as const] : [])))
  const weapons = new Map(ds.weapons.map((w) => [w.id, w]))
  const accessories = new Map(ds.accessories.map((a) => [a.id, a]))
  const armor = new Map(ds.armor.map((a) => [a.id, a]))
  const sets = new Map(ds.armorSets.map((s) => [s.id, s]))

  for (const boss of ds.bosses) {
    if (!boss.suggestedEquipment) continue
    const before = upstream.get(boss.nodeId) ?? new Set<string>()
    const suggested = new Map<number, Suggestable>()
    for (const s of boss.suggestedEquipment) {
      for (const id of s.weapons) if (weapons.has(id)) suggested.set(id, weapons.get(id) as Weapon)
      for (const id of s.accessories) if (accessories.has(id)) suggested.set(id, accessories.get(id) as Accessory)
      for (const setId of s.armorSetIds) {
        const set = sets.get(setId)
        if (!set) continue
        for (const id of [...set.pieces.helmets, set.pieces.chest, set.pieces.legs]) {
          const piece = armor.get(id)
          if (piece) suggested.set(id, piece)
        }
      }
    }
    for (const [id, item] of suggested) {
      const itemRef = `i:${id}`
      const fail = (detail: string) =>
        errors.push({
          code: 'E_SUGGESTION_GATING',
          bossId: boss.id,
          itemRef,
          message: `boss:${boss.id} suggests ${itemRef} (${item.name}): ${detail}`,
        })
      if (!item.gatedBy) {
        if (isCoveredBy(item._prov.unverifiedFields, 'gatedBy')) fail('gating is unknown (gatedBy unverified), so it cannot be shown as obtainable before this boss')
        continue
      }
      const gates = new Set(item.gatedBy.bosses)
      for (const cond of item.gatedBy.conditions) {
        const node = nodeForCondition.get(cond)
        if (node) gates.add(node)
      }
      for (const gate of gates) {
        if (!before.has(gate)) {
          fail(
            gate === boss.nodeId
              ? `gated behind node:${gate}, the boss itself`
              : `gated behind node:${gate}, which is not strictly upstream of node:${boss.nodeId} in the required-gate graph`,
          )
        }
      }
    }
  }
  return errors
}
