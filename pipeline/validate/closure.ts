/**
 * P6-S0 crafting-tree closure (dataset manifest `itemClosure`): every item a recipe (result, item
 * ingredient, item station), a recipe group (member — ingredient and B3 station groups) or a drop names
 * is an emitted item record (weapons / armor / accessories / items) OR carries a declared stage gap
 * for that item (`ref: "i:<id>"`, `field: "id"`: an excluded Cargo Items row, an Iteminfo item without
 * any Cargo row). The recursive crafting trees and the acquisition planner (PRD P6-S4/S5) then never
 * meet an undeclared hole: a node is either a page or a stated gap. Undeclared → E_DANGLING_REF.
 */
import type { GapEntry } from '../../src/schemas'
import { ITEM_COLLECTIONS, type Dataset } from './dataset'
import { danglingRef, type PipelineError } from './errors'

export interface ClosureRef {
  fromRef: string
  field: string
  itemId: number
}

export interface ClosureReport {
  /** Every item reference of recipes, recipe groups and drops. */
  refs: ClosureRef[]
  /** Distinct referenced item ids by outcome. */
  emitted: Set<number>
  declared: Set<number>
  undeclared: Set<number>
}

export function itemReferences(ds: Pick<Dataset, 'recipes' | 'recipeGroups' | 'drops'>): ClosureRef[] {
  const refs: ClosureRef[] = []
  for (const r of ds.recipes) {
    const ref = `rcp:${r.id}`
    refs.push({ fromRef: ref, field: 'resultItemId', itemId: r.resultItemId })
    r.ingredients.forEach((ing, i) => {
      if (ing.ref.kind === 'item') refs.push({ fromRef: ref, field: `ingredients.${i}.ref.itemId`, itemId: ing.ref.itemId })
    })
    r.stations.forEach((s, i) => {
      if (s.kind === 'item') refs.push({ fromRef: ref, field: `stations.${i}.itemId`, itemId: s.itemId })
    })
  }
  for (const g of ds.recipeGroups) g.memberItemIds.forEach((id, i) => refs.push({ fromRef: `grp:${g.id}`, field: `memberItemIds.${i}`, itemId: id }))
  for (const d of ds.drops) refs.push({ fromRef: `drop:${d.id}`, field: 'itemId', itemId: d.itemId })
  return refs
}

export function itemClosure(ds: Dataset, stageGaps: readonly GapEntry[]): ClosureReport {
  const emittedIds = new Set<number>()
  for (const key of ITEM_COLLECTIONS) for (const r of ds[key]) emittedIds.add(r.id)
  const declaredRefs = new Set(stageGaps.filter((g) => g.field === 'id').map((g) => g.ref))
  const refs = itemReferences(ds)
  const report: ClosureReport = { refs, emitted: new Set(), declared: new Set(), undeclared: new Set() }
  for (const r of refs) {
    if (emittedIds.has(r.itemId)) report.emitted.add(r.itemId)
    else if (declaredRefs.has(`i:${r.itemId}`)) report.declared.add(r.itemId)
    else report.undeclared.add(r.itemId)
  }
  return report
}

export function checkItemClosure(ds: Dataset, stageGaps: readonly GapEntry[]): PipelineError[] {
  const report = itemClosure(ds, stageGaps)
  if (report.undeclared.size === 0) return []
  return report.refs
    .filter((r) => report.undeclared.has(r.itemId))
    .map((r) => danglingRef(r.fromRef, r.field, `i:${r.itemId}`, 'neither an emitted item record nor a declared gap (P6-S0 crafting closure, manifest itemClosure)'))
}
