/* §7b gatedBy derivation: derivable only when every input is verified; minimum over routes. */
import { describe, expect, it } from 'vitest'
import type { Condition, DropSource, Prov, ProgressionEdge, ProgressionNode, Recipe, RecipeGroup } from '../../src/schemas'
import { containerKey, createGatingDeriver, type GatingContext } from './gating'

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

  it('AMENDMENTS-005 B22: a stage-transition gate contributes its unlocksStage (WoF drops are early-hm), other gates their own stage', () => {
    const WOF = { npcName: 'Wall of Flesh', bossId: 'wall-of-flesh' }
    const graph = { ...GRAPH, nodes: new Map([...GRAPH.nodes].map(([id, n]) => [id, id === 'wall-of-flesh' ? { ...n, unlocksStage: 'early-hm' as const } : n])), bossNode: new Map([...GRAPH.bossNode, ['wall-of-flesh', 'wall-of-flesh']]) }
    const derive = createGatingDeriver(ctx([recipe('5-a', 5, [4, 6])], [drop('4-wof', 4, WOF), drop('6-eoc', 6, { npcName: 'Eye of Cthulhu', bossId: 'eye-of-cthulhu' })], graph))
    expect(derive(4)).toEqual({ ok: true, gatedBy: { bosses: ['wall-of-flesh'], conditions: [], stage: 'early-hm' } }) // Breaker Blade's case
    expect(derive(5)).toEqual({ ok: true, gatedBy: { bosses: ['eye-of-cthulhu', 'wall-of-flesh'], conditions: [], stage: 'early-hm' } })
    expect(derive(6)).toEqual({ ok: true, gatedBy: { bosses: ['eye-of-cthulhu'], conditions: [], stage: 'early-prehm' } })
    // without the field the gate's own stage applies (the P2-S6 behavior B22 fixes)
    expect(createGatingDeriver(ctx([], [drop('4-wof', 4, WOF)], { ...GRAPH, bossNode: graph.bossNode }))(4)).toMatchObject({ gatedBy: { stage: 'late-prehm' } })
  })

  it('without the progression graph (P2-S6 pending) any boss gate is underivable; gate-free routes still derive', () => {
    const derive = createGatingDeriver(ctx([recipe('3-a', 3, [1], { conditions: ['hardmode'] }), recipe('4-a', 4, [1], { conditions: ['full-moon'] })], [drop('1-x', 1, ML)], null))
    expect(derive(3)).toEqual({ ok: false, blockers: ['progression-graph-pending'] })
    const noBoss = createGatingDeriver(ctx([recipe('4-a', 4, [], { conditions: ['full-moon'] })], [], null))
    expect(noBoss(4)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: ['full-moon'], stage: 'early-prehm' } })
  })
})

describe('AMENDMENTS-014 B68 / AMENDMENTS-015 B78 sources: vendors, containers, gatherables, either-or, sufficient bounds', () => {
  const CHEST_URL = 'https://terraria.wiki.gg/wiki/Chests'
  const SEED_URL = 'https://terraria.wiki.gg/wiki/I_am_error'
  const ORB_URL = 'https://terraria.wiki.gg/wiki/Shadow_Orb'
  const HEART_URL = 'https://terraria.wiki.gg/wiki/Crimson_Heart'
  const fromPage = (id: string, itemId: number, npcName: string, url: string, conditions: string[] = []): DropSource => ({
    ...drop(id, itemId, { npcName }, { conditions }),
    _prov: { ...prov(), sources: [{ kind: 'cargo:Drops', url, fetchedAt: '2026-10-14' }] },
  })
  const SLIME = { npcName: 'Green Slime', npcIds: [1] }
  const conds = new Map(
    [cond('hardmode', 'wall-of-flesh'), cond('post-moon-lord', 'moon-lord'), cond('full-moon'), cond('corruption-world'), cond('crimson-world'), cond('iron-ore-world'), cond('lead-ore-world'), cond('night')].map((c) => [c.id, c]),
  )
  const base = (recipes: Recipe[], drops: DropSource[], groups: RecipeGroup[] = []): GatingContext => ({ ...ctx(recipes, drops, GRAPH, groups), conditions: conds })

  it('a gatherable route is gate-free (or carries its own conditions); an unknown vendor route blocks only a gated best', () => {
    const derive = createGatingDeriver({
      ...base([recipe('3-a', 3, [1, 2])], [drop('4-ml', 4, ML)]),
      extraRoutes: new Map([
        [1, [{ kind: 'gather', conditions: [] }]],
        [2, [{ kind: 'gather', conditions: ['night'] }]],
        [4, [{ kind: 'unknown', blocker: 'vendor-availability-unknown' }]],
        [5, [{ kind: 'gather', conditions: [] }, { kind: 'unknown', blocker: 'vendor-conditions-unknown' }]],
      ]),
    })
    expect(derive(1)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    expect(derive(3)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: ['night'], stage: 'early-prehm' } })
    // Moon Lord drop + an unknown vendor route: the vendor could be less gated → Unknown
    expect(derive(4)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'vendor-availability-unknown'] })
    expect(derive.sufficient(4)).toEqual({ bosses: ['moon-lord'], conditions: [], stage: 'endgame' })
    // a gate-free gather route beats any unknown route
    expect(derive(5)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
  })

  it('purchase: the NPC\'s availability (conditions, the minimum over "one of these items", NPCs it needs) + the shop row', () => {
    const derive = createGatingDeriver({
      ...base([], [drop('7-ml', 7, ML)]),
      extraRoutes: new Map([
        [10, [{ kind: 'purchase', conditions: [], requiresNpcs: ['Merchant'] }]],
        [11, [{ kind: 'purchase', conditions: ['hardmode'], requiresNpcs: ['Arms Dealer'] }]],
        [12, [{ kind: 'purchase', conditions: [], requiresNpcs: ['Picky'] }]],
        [13, [{ kind: 'purchase', conditions: [], requiresNpcs: ['Nobody'] }]],
        [6, [{ kind: 'gather', conditions: [] }]],
      ]),
      npcs: new Map([
        ['Merchant', { conditions: [] }],
        // has a gate-free item (6) or a Moon Lord item (7) → the minimum is gate-free
        ['Arms Dealer', { conditions: [], requiresAnyOf: [[6, 7]], requiresNpcs: ['Merchant'] }],
        ['Picky', { conditions: ['full-moon'], requiresAnyOf: [[7]] }],
      ]),
    })
    expect(derive(10)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    expect(derive(11)).toEqual({ ok: true, gatedBy: { bosses: ['wall-of-flesh'], conditions: [], stage: 'late-prehm' } })
    expect(derive(12)).toEqual({ ok: true, gatedBy: { bosses: ['moon-lord'], conditions: ['full-moon'], stage: 'endgame' } })
    expect(derive(13)).toEqual({ ok: false, blockers: ['vendor-availability-unknown'] })
  })

  it('containers gate drops matched by name AND article (a seed-page row with the same name stays ungated); world-specific loot adds its condition', () => {
    const derive = createGatingDeriver({
      ...base([], [fromPage('20-chest', 20, 'Chest', CHEST_URL), fromPage('21-chest-seed', 21, 'Chest', SEED_URL), fromPage('22-chest', 22, 'Chest', CHEST_URL)]),
      containers: new Map([[containerKey('Chest', CHEST_URL), { conditions: [] }]]),
      containerItemConditions: new Map([[22, ['iron-ore-world']]]),
    })
    expect(derive(20)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    expect(derive(21)).toEqual({ ok: false, blockers: ['drop-source-ungated'] })
    expect(derive(22)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: ['iron-ore-world'], stage: 'early-prehm' } })
  })

  it('either-or conditions: an exhaustive group drops out; other differing conditions are not expressible', () => {
    const drops = [fromPage('30-orb', 30, 'Shadow Orb', ORB_URL), fromPage('30-heart', 30, 'Crimson Heart', HEART_URL), fromPage('31-orb', 31, 'Shadow Orb', ORB_URL), fromPage('31-moon', 31, 'Chest', CHEST_URL, ['full-moon'])]
    const containers = new Map([
      [containerKey('Shadow Orb', ORB_URL), { conditions: ['corruption-world'] }],
      [containerKey('Crimson Heart', HEART_URL), { conditions: ['crimson-world'] }],
      [containerKey('Chest', CHEST_URL), { conditions: [] }],
    ])
    const derive = createGatingDeriver({ ...base([], drops), containers, exhaustive: [['corruption-world', 'crimson-world']] })
    expect(derive(30)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } }) // Musket Ball's case
    expect(derive(31)).toEqual({ ok: false, blockers: ['condition-alternatives'] })
    expect(derive.sufficient(31)).toBeDefined()
    // without the reviewed group no side is ever picked
    expect(createGatingDeriver({ ...base([], drops), containers })(30)).toEqual({ ok: false, blockers: ['condition-alternatives'] })
  })

  describe('AMENDMENTS-016 B141 (option A): the gate-free exception means free of BOSS/PROGRESSION gates; ride-along conditions stay on the route', () => {
    const GOLD_URL = 'https://terraria.wiki.gg/wiki/Gold_Chest'
    const RIDE = ['underground', 'cavern', 'lava-layer', 'bottom-250-tiles', 'first-destruction', 'subsequent-destructions']
    const MIMIC = { npcName: 'Mimic', npcIds: [85] }
    const conditions = new Map([...conds, ...[...RIDE, 'pre-hardmode', 'gold-ore-world', 'platinum-ore-world'].map((id) => [id, cond(id)] as const)])
    const chests = new Map([
      [containerKey('Gold Chest', GOLD_URL), { conditions: [] }],
      [containerKey('Shadow Orb', ORB_URL), { conditions: ['corruption-world'] }],
    ])
    const drops = [
      // Meteorite Bar (50): a bottom-250-tiles Gold Chest + an unreviewed source (Shadow Chest-like) → Space Gun (51) crafted from it
      fromPage('50-gold', 50, 'Gold Chest', GOLD_URL, ['bottom-250-tiles']), drop('50-mimic', 50, MIMIC),
      // Mace (52): the three layer variants of one Gold Chest row + an enemy drop
      fromPage('52-u', 52, 'Gold Chest', GOLD_URL, ['underground']), fromPage('52-c', 52, 'Gold Chest', GOLD_URL, ['cavern']), fromPage('52-l', 52, 'Gold Chest', GOLD_URL, ['lava-layer']), drop('52-mimic', 52, MIMIC),
      // Musket (53): the Shadow Orb destruction sequence (corruption-world stays: it is not a ride-along condition)
      fromPage('53-first', 53, 'Shadow Orb', ORB_URL, ['first-destruction']), fromPage('53-later', 53, 'Shadow Orb', ORB_URL, ['subsequent-destructions']),
      // 54: a Cavern Gold Chest beats a night-only chest; 55: the Musket case with an unreviewed crate route
      fromPage('54-c', 54, 'Gold Chest', GOLD_URL, ['cavern']), fromPage('54-n', 54, 'Gold Chest', GOLD_URL, ['night']),
      fromPage('55-first', 55, 'Shadow Orb', ORB_URL, ['first-destruction']), fromPage('55-later', 55, 'Shadow Orb', ORB_URL, ['subsequent-destructions']), drop('55-crate', 55, { npcName: 'Corrupt Crate' }),
      // 56–58: progression-type and unlisted conditions keep breaking the exception
      fromPage('56-hm', 56, 'Gold Chest', GOLD_URL, ['hardmode', 'cavern']), drop('56-mimic', 56, MIMIC),
      fromPage('57-pre', 57, 'Gold Chest', GOLD_URL, ['pre-hardmode']), drop('57-mimic', 57, MIMIC),
      fromPage('58-moon', 58, 'Gold Chest', GOLD_URL, ['full-moon', 'cavern']), drop('58-mimic', 58, MIMIC),
      // Gold / Platinum Bars (19 / 706): Cavern Gold Chest loot of their world, also from unreviewed crates
      fromPage('19-gold', 19, 'Gold Chest', GOLD_URL, ['cavern']), drop('19-crate', 19, { npcName: 'Wooden Crate' }),
      fromPage('706-gold', 706, 'Gold Chest', GOLD_URL, ['cavern']), drop('706-crate', 706, { npcName: 'Wooden Crate' }),
    ]
    const recipes = [recipe('51-a', 51, [50]), recipe('60-a', 60, [52]), recipe('61-a', 61, [62, 19]), recipe('61-b', 61, [62, 706])]
    const context = (rideAlong?: string[]): GatingContext => ({
      ...base(recipes, drops),
      conditions,
      containers: chests,
      containerItemConditions: new Map([[19, ['gold-ore-world']], [706, ['platinum-ore-world']]]),
      exhaustive: [['gold-ore-world', 'platinum-ore-world']],
      extraRoutes: new Map([[62, [{ kind: 'gather', conditions: [] }]]]), // Flinx Fur
      ...(rideAlong ? { rideAlong } : {}),
    })
    const derive = createGatingDeriver(context(RIDE))
    const early = (conditions: string[]) => ({ ok: true, gatedBy: { bosses: [], conditions, stage: 'early-prehm' } })

    it('a ride-along route is still the minimum while another route is unknown — and its conditions ride along (Meteorite Bar → Space Gun)', () => {
      expect(derive(50)).toEqual(early(['bottom-250-tiles']))
      expect(derive(51)).toEqual(early(['bottom-250-tiles']))
    })

    it('an either-or among ride-along conditions is always satisfiable and drops out (Mace → Flaming Mace)', () => {
      expect(derive(52)).toEqual(early([]))
      expect(derive(60)).toEqual(early([]))
    })

    it('the destruction sequence drops out between alternatives; a non-ride-along condition (corruption-world) stays — and still breaks the exception (Musket + a crate)', () => {
      expect(derive(53)).toEqual(early(['corruption-world']))
      expect(derive(55)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'drop-source-ungated'] })
    })

    it('alternatives are compared on their other conditions: a Cavern chest beats a night-only one, and its condition rides along', () => {
      expect(derive(54)).toEqual(early(['cavern']))
    })

    it('progression-type conditions still gate: hardmode (node-mapped) and pre-hardmode; an unlisted condition (full moon) still breaks the exception', () => {
      for (const id of [56, 57, 58]) expect(derive(id), String(id)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'drop-source-ungated'] })
      expect(derive.sufficient(56)).toEqual({ bosses: ['wall-of-flesh'], conditions: ['cavern'], stage: 'late-prehm' })
    })

    it('sufficient bounds over an exhaustive group: Gold Bars in Gold worlds OR Platinum Bars in Platinum worlds, both from Cavern chests (Flinx Staff)', () => {
      expect(derive(19)).toMatchObject({ ok: false })
      expect(derive.sufficient(19)).toEqual({ bosses: [], conditions: ['cavern', 'gold-ore-world'], stage: 'early-prehm' })
      expect(derive(61)).toEqual(early(['cavern']))
    })

    it('without the reviewed list the derivation is exactly the old one: every condition breaks the exception', () => {
      const old = createGatingDeriver(context())
      for (const id of [50, 51, 52, 60, 61]) expect(old(id), String(id)).toMatchObject({ ok: false })
      expect(old(53)).toEqual({ ok: false, blockers: ['condition-alternatives'] })
      expect(old(54)).toEqual({ ok: false, blockers: ['condition-alternatives'] })
    })
  })

  it('sufficient bounds: Iron Bars in Iron worlds OR Lead Bars in Lead worlds make "Any Iron Bar" gate-free even though both bars have unknown routes; one specific bar stays Unknown', () => {
    const groups: RecipeGroup[] = [{ id: 'any-iron-bar', name: 'Any Iron Bar', memberItemIds: [22, 704], _prov: prov() }]
    const recipes = [{ ...recipe('40-a', 40, []), ingredients: [{ amount: 1, ref: { kind: 'group' as const, groupId: 'any-iron-bar' } }] }, recipe('41-a', 41, [22])]
    const drops = [fromPage('22-chest', 22, 'Chest', CHEST_URL), fromPage('704-chest', 704, 'Chest', CHEST_URL), drop('22-slime', 22, SLIME), drop('704-slime', 704, SLIME)]
    const derive = createGatingDeriver({
      ...base(recipes, drops, groups),
      containers: new Map([[containerKey('Chest', CHEST_URL), { conditions: [] }]]),
      containerItemConditions: new Map([[22, ['iron-ore-world']], [704, ['lead-ore-world']]]),
      exhaustive: [['iron-ore-world', 'lead-ore-world']],
    })
    expect(derive(22)).toEqual({ ok: false, blockers: ['alternative-route-unverified', 'drop-source-ungated'] })
    expect(derive.sufficient(22)).toEqual({ bosses: [], conditions: ['iron-ore-world'], stage: 'early-prehm' })
    expect(derive(40)).toEqual({ ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    expect(derive(41)).toMatchObject({ ok: false })
    expect(derive.sufficient(41)).toEqual({ bosses: [], conditions: ['iron-ore-world'], stage: 'early-prehm' })
  })
})
