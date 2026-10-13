/* §7b gatedBy derivation: derivable only when every input is verified; minimum over routes. */
import { describe, expect, it } from 'vitest'
import type { Condition, DropSource, Prov, ProgressionEdge, ProgressionNode, Recipe, RecipeGroup } from '../../src/schemas'
import { createGatingDeriver, type GatingContext } from './gating'

const prov = (unverifiedFields: string[] = []): Prov => ({
  gameVersion: '1.4.5.8',
  sources: [{ kind: 'curated', overlay: 'test', url: 'https://terraria.wiki.gg/wiki/Test', fetchedAt: '2026-10-13' }],
  verified: unverifiedFields.length === 0,
  unverifiedFields,
  editorialFields: [],
})
const recipe = (id: string, resultItemId: number, ings: number[], extra: Partial<Recipe> = {}): Recipe => ({
  id,
  resultItemId,
  resultAmount: 1,
  stations: [],
  conditions: [],
  ingredients: ings.map((itemId) => ({ amount: 1, ref: { kind: 'item', itemId } })),
  _prov: prov(),
  ...extra,
})
const drop = (id: string, itemId: number, source: DropSource['source'], extra: Partial<DropSource> = {}, unverified: string[] = []): DropSource => ({
  id,
  itemId,
  source,
  quantity: { min: 1, max: 1 },
  rates: { classic: 1 },
  conditions: [],
  _prov: prov(unverified),
  ...extra,
})
const cond = (id: string, satisfiedByNode?: string): Condition => ({ id, name: id, kind: 'world-state', ...(satisfiedByNode ? { satisfiedByNode } : {}), description: id, wikiUrl: 'https://terraria.wiki.gg/wiki/Test', _prov: prov() })
const node = (id: string, stage: ProgressionNode['stage']): ProgressionNode => ({ id, kind: 'boss', bossId: id, name: id, stage, wikiUrl: 'https://terraria.wiki.gg/wiki/Test', _prov: prov() })
const gate = (from: string, to: string): ProgressionEdge => ({ from, to, type: 'required-gate', sourceUrl: 'https://terraria.wiki.gg/wiki/Test', _prov: prov() })

const GRAPH = {
  nodes: new Map([node('eye-of-cthulhu', 'early-prehm'), node('wall-of-flesh', 'late-prehm'), node('plantera', 'mid-hm'), node('moon-lord', 'endgame')].map((n) => [n.id, n])),
  edges: [gate('wall-of-flesh', 'plantera'), gate('plantera', 'moon-lord')],
  bossNode: new Map([['moon-lord', 'moon-lord'], ['plantera', 'plantera'], ['eye-of-cthulhu', 'eye-of-cthulhu']]),
}

/** `graph: null` = progression graph pending (P2-S6). */
function ctx(recipes: Recipe[], drops: DropSource[], graph: GatingContext['graph'] | null = GRAPH, groups: RecipeGroup[] = []): GatingContext {
  const by = <T,>(l: T[], k: (t: T) => number) => {
    const m = new Map<number, T[]>()
    for (const t of l) m.set(k(t), [...(m.get(k(t)) ?? []), t])
    return m
  }
  return {
    recipesByResult: by(recipes, (r) => r.resultItemId),
    dropsByItem: by(drops, (d) => d.itemId),
    groups: new Map(groups.map((g) => [g.id, g])),
    conditions: new Map([cond('hardmode', 'wall-of-flesh'), cond('post-moon-lord', 'moon-lord'), cond('full-moon')].map((c) => [c.id, c])),
    ...(graph ? { graph } : {}),
  }
}
const ML = { npcName: 'Moon Lord', bossId: 'moon-lord' }
const PLANTERA = { npcName: 'Plantera', bossId: 'plantera' }

describe('createGatingDeriver', () => {
  it('derives a crafted item from boss-dropped ingredients: bosses reduced against the required-gate DAG, stage = max', () => {
    const derive = createGatingDeriver(ctx([recipe('3-a', 3, [1, 2])], [drop('1-ml', 1, ML), drop('2-pl', 2, PLANTERA)]))
    expect(derive(3)).toEqual({ ok: true, gatedBy: { bosses: ['moon-lord'], conditions: [], stage: 'endgame' } })
  })

  it('B9 recipe conditions: satisfiedByNode → boss gate; other conditions stay conditions', () => {
    const derive = createGatingDeriver(ctx([recipe('3-a', 3, [1], { conditions: ['hardmode', 'full-moon'] })], [drop('1-eoc', 1, { npcName: 'Eye of Cthulhu', bossId: 'eye-of-cthulhu' })]))
    expect(derive(3)).toEqual({ ok: true, gatedBy: { bosses: ['eye-of-cthulhu', 'wall-of-flesh'], conditions: ['full-moon'], stage: 'late-prehm' } })
  })

  it('takes the minimum over routes (any obtainable route suffices) and over group members', () => {
    const groups: RecipeGroup[] = [{ id: 'any-x', name: 'Any X', memberItemIds: [1, 2], _prov: prov() }]
    const recipes = [recipe('3-a', 3, [1]), { ...recipe('3-b', 3, []), ingredients: [{ amount: 1, ref: { kind: 'group' as const, groupId: 'any-x' } }] }]
    const derive = createGatingDeriver(ctx(recipes, [drop('1-ml', 1, ML), drop('2-eoc', 2, { npcName: 'Eye of Cthulhu', bossId: 'eye-of-cthulhu' })], GRAPH, groups))
    expect(derive(3)).toMatchObject({ ok: true, gatedBy: { bosses: ['eye-of-cthulhu'], stage: 'early-prehm' } })
  })

  it('is NOT derivable when any input is unverified — and says why', () => {
    const derive = createGatingDeriver(
      ctx(
        [recipe('3-a', 3, [99]), recipe('4-a', 4, [5]), recipe('5-a', 5, [4])],
        [
          drop('6-zombie', 6, { npcName: 'Zombie', npcIds: [3] }),
          drop('7-bag', 7, { npcName: 'Treasure Bag (Plantera)', treasureBag: true }, {}, ['source.bossId']),
          drop('8-x', 8, ML, { conditions: [] }, ['conditions']),
        ],
      ),
    )
    expect(derive(3)).toEqual({ ok: false, blockers: ['no-known-route'] }) // ingredient 99 has no route
    expect(derive(4)).toEqual({ ok: false, blockers: ['cycle'] }) // only route needs the item itself
    expect(derive(6)).toEqual({ ok: false, blockers: ['drop-source-ungated'] })
    expect(derive(7)).toEqual({ ok: false, blockers: ['boss-attribution-pending'] })
    expect(derive(8)).toEqual({ ok: false, blockers: ['drop-conditions-unknown'] })
  })

  it('§7b minimum over routes is exact only when every route is derivable — unless the best route is gate-free', () => {
    const ZOMBIE = { npcName: 'Zombie', npcIds: [3] }
    const groups: RecipeGroup[] = [{ id: 'any-y', name: 'Any Y', memberItemIds: [1, 99], _prov: prov() }]
    const derive = createGatingDeriver(
      ctx(
        [recipe('12-a', 12, []), recipe('11-a', 11, [12]), { ...recipe('13-a', 13, []), ingredients: [{ amount: 1, ref: { kind: 'group' as const, groupId: 'any-y' } }] }],
        [drop('1-ml', 1, ML), drop('10-ml', 10, ML), drop('10-z', 10, ZOMBIE), drop('11-z', 11, ZOMBIE)],
        GRAPH,
        groups,
      ),
    )
    // Moon Lord drop + an enemy drop: the enemy route could be less gated → Unknown, never "requires Moon Lord"
    expect(derive(10)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'drop-source-ungated'] })
    // a gate-free derived route is already the minimum, whatever the other routes are
    expect(derive(11)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    // a group is a minimum over its members: one member without a route makes it Unknown too
    expect(derive(13)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'no-known-route'] })
  })

  it('cycles: a cycle grounded by another route takes the grounded value; an ungrounded cycle is an unverified input', () => {
    const derive = createGatingDeriver(
      ctx(
        // 20 ⇄ 21 (Shimmer-like round trip), 20 also dropped by Plantera
        [recipe('20-a', 20, [21]), recipe('21-a', 21, [20]),
          // 22 ⇄ 23 with no route into the cycle; 24 = Moon Lord drop OR crafted from 22
          recipe('22-a', 22, [23]), recipe('23-a', 23, [22]), recipe('24-a', 24, [22])],
        [drop('20-pl', 20, PLANTERA), drop('24-ml', 24, ML)],
      ),
    )
    expect(derive(20)).toEqual({ ok: true, gatedBy: { bosses: ['plantera'], conditions: [], stage: 'mid-hm' } })
    expect(derive(21)).toEqual({ ok: true, gatedBy: { bosses: ['plantera'], conditions: [], stage: 'mid-hm' } })
    expect(derive(22)).toEqual({ ok: false, blockers: ['cycle'] })
    expect(derive(24)).toEqual({ ok: false, blockers: ['alternative-route-unverified'] })
  })

  it('without the progression graph (P2-S6 pending) any boss gate is underivable; gate-free routes still derive', () => {
    const derive = createGatingDeriver(ctx([recipe('3-a', 3, [1], { conditions: ['hardmode'] }), recipe('4-a', 4, [1], { conditions: ['full-moon'] })], [drop('1-x', 1, ML)], null))
    expect(derive(3)).toEqual({ ok: false, blockers: ['progression-graph-pending'] })
    const noBoss = createGatingDeriver(ctx([recipe('4-a', 4, [], { conditions: ['full-moon'] })], [], null))
    expect(noBoss(4)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: ['full-moon'], stage: 'early-prehm' } })
  })
})
