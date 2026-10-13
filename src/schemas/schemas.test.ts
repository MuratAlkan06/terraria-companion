import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../storage/settings'
import {
  Accessory,
  Acquisition,
  ArchetypeParams,
  ArmorPiece,
  Boss,
  ChecklistsV1,
  DomainKey,
  DropSource,
  DurationTicks,
  Enemy,
  Gaps,
  Item,
  LabBehavior,
  LabModifiers,
  LoadoutSlots,
  NpcId,
  RecipeStation,
  PlainText,
  Prov,
  ProgressionNode,
  ReadinessV1,
  Recipe,
  SearchDoc,
  SettingsV1,
  SpriteManifest,
  TypedRef,
  Weapon,
} from './index'

const prov = { gameVersion: '1.4.5.8', sources: [{ kind: 'cargo:Items', url: 'https://terraria.wiki.gg/wiki/Minishark', fetchedAt: '2026-10-12' }], verified: true, unverifiedFields: [], editorialFields: [] }
const limitation = { kind: 'limitation', inGameBehavior: 'Fires bullets.', reason: 'Not modeled.', sourceUrl: 'https://terraria.wiki.gg/wiki/Minishark' }

const weapon = {
  id: 98,
  name: 'Minishark',
  slug: 'minishark',
  type: 'weapon',
  tags: [],
  wikiUrl: 'https://terraria.wiki.gg/wiki/Minishark',
  acquisition: [{ method: 'purchase', npcName: 'Arms Dealer', priceCopper: 350000, conditions: [] }],
  damageClass: 'ranged',
  damage: 6,
  critPct: 0,
  useTimeTicks: 8,
  knockback: 0,
  labBehavior: limitation,
  _prov: prov,
}

describe('entity schemas (AC1)', () => {
  it('parses a weapon carrying id, stats, acquisition, source URL and provenance markers', () => {
    expect(Weapon.safeParse(weapon).success).toBe(true)
  })

  it('A1: weapon combat stats are optional (absent + listed = Unknown)', () => {
    const { damage: _d, critPct: _c, useTimeTicks: _u, knockback: _k, damageClass: _dc, ...rest } = weapon
    const unknownStats = { ...rest, _prov: { ...prov, verified: false, unverifiedFields: ['damage', 'critPct', 'useTimeTicks', 'knockback', 'damageClass'] } }
    expect(Weapon.safeParse(unknownStats).success).toBe(true)
  })

  it('A1: labBehavior, id, name, slug, type, wikiUrl and _prov stay required', () => {
    for (const key of ['labBehavior', 'id', 'name', 'slug', 'type', 'wikiUrl', '_prov'] as const) {
      const { [key]: _omitted, ...rest } = weapon
      expect(Weapon.safeParse(rest).success, key).toBe(false)
    }
  })

  it('A1: ArmorPiece.defense is optional', () => {
    const piece = { ...weapon, type: 'armor', slot: 'head', effects: [], labBehavior: undefined }
    const { labBehavior: _l, damage: _d, critPct: _c, useTimeTicks: _u, knockback: _k, damageClass: _dc, ...armor } = piece
    expect(ArmorPiece.safeParse(armor).success).toBe(true)
    expect(ArmorPiece.safeParse({ ...armor, defense: 3 }).success).toBe(true)
  })

  it('A1: boss curated fields and summon text are optional; attackPatternTags may be empty', () => {
    const boss = {
      id: 'wall-of-flesh',
      name: 'Wall of Flesh',
      nodeId: 'wall-of-flesh',
      wikiUrl: 'https://terraria.wiki.gg/wiki/Wall_of_Flesh',
      stage: 'late-prehm',
      summon: { items: [267], conditions: ['underworld'] },
      location: { biomes: [], time: 'any' },
      statsByDifficulty: {},
      dropIds: [],
      _prov: { ...prov, verified: false, unverifiedFields: ['attackPatternTags', 'suggestedEquipment', 'prepChecklist', 'strategies'] },
    }
    expect(Boss.safeParse(boss).success).toBe(true)
    expect(Boss.safeParse({ ...boss, attackPatternTags: [] }).success).toBe(true)
  })

  it('rejects unknown keys everywhere (strictObject)', () => {
    expect(Weapon.safeParse({ ...weapon, dps: 100 }).success).toBe(false)
    expect(Weapon.safeParse({ ...weapon, _prov: { ...prov, note: 'x' } }).success).toBe(false)
  })

  it('rejects a non-wiki source URL', () => {
    expect(Weapon.safeParse({ ...weapon, wikiUrl: 'https://example.com/wiki/Minishark' }).success).toBe(false)
  })
})

describe('AMENDMENTS-002 schema deltas', () => {
  const dropProv = { ...prov, sources: [{ kind: 'cargo:Drops', url: 'https://terraria.wiki.gg/wiki/Creeper', fetchedAt: '2026-10-12' }] }
  const drop = { id: '1329-creeper-741638a5', itemId: 1329, source: { npcName: 'Creeper', npcIds: [267] }, quantity: { min: 2, max: 5 }, rates: { classic: 1 }, conditions: [], _prov: dropProv }

  it('B1: drop quantity is uniform {min,max} or per-difficulty', () => {
    expect(DropSource.safeParse(drop).success).toBe(true)
    const perDifficulty = { classic: { min: 2, max: 5 }, expert: { min: 1, max: 3 }, master: { min: 1, max: 2 } }
    expect(DropSource.safeParse({ ...drop, quantity: perDifficulty }).success).toBe(true)
    expect(DropSource.safeParse({ ...drop, quantity: { expert: { min: 1, max: 3 } } }).success).toBe(true)
    expect(DropSource.safeParse({ ...drop, quantity: { min: 5, max: 2 } }).success).toBe(false)
    expect(DropSource.safeParse({ ...drop, quantity: { classic: { min: 1, max: 1 }, normal: { min: 1, max: 1 } } }).success).toBe(false)
  })

  it('B2: ammoStats accepts a positive velocityMultiplier', () => {
    const item = {
      ...weapon,
      id: 97,
      name: 'Musket Ball',
      slug: 'musket-ball',
      type: 'item',
      category: 'ammo',
      isStation: false,
      ammoStats: { ammoClass: 'bullet', damage: 7, velocityBonusTps: 15, velocityMultiplier: 2 },
    }
    const { labBehavior: _l, damage: _d, critPct: _c, useTimeTicks: _u, knockback: _k, damageClass: _dc, ...musketBall } = item
    expect(Item.safeParse(musketBall).success).toBe(true)
    expect(Item.safeParse({ ...musketBall, ammoStats: { ...musketBall.ammoStats, velocityMultiplier: 0 } }).success).toBe(false)
  })

  it('B3: a recipe station may be a group of interchangeable station items', () => {
    expect(RecipeStation.safeParse({ kind: 'group', groupId: 'iron-or-lead-anvil' }).success).toBe(true)
    expect(RecipeStation.safeParse({ kind: 'group', groupId: 'Iron or Lead Anvil' }).success).toBe(false)
  })

  it('B4: loot and other acquisition routes carry conditions (default empty)', () => {
    const loot = Acquisition.parse({ method: 'loot', containers: ['Gold Chest'], locations: ['Cavern'] })
    expect(loot).toEqual({ method: 'loot', containers: ['Gold Chest'], locations: ['Cavern'], conditions: [] })
    expect(Acquisition.safeParse({ method: 'other', description: 'Mined from ore.', sourceUrl: 'https://terraria.wiki.gg/wiki/Cobalt_Ore', conditions: ['hardmode'] }).success).toBe(true)
  })

  it('B5: durations are fixed ticks or an inclusive {minTicks,maxTicks} range', () => {
    expect(DurationTicks.safeParse(240).success).toBe(true)
    expect(DurationTicks.safeParse({ minTicks: 60, maxTicks: 240 }).success).toBe(true)
    expect(DurationTicks.safeParse({ minTicks: 240, maxTicks: 60 }).success).toBe(false)
    expect(LabModifiers.safeParse({ dot: { buffId: 'on-fire', durationTicks: { minTicks: 60, maxTicks: 240 } } }).success).toBe(true)
  })

  it('B7: armor pieces and accessories never carry maxStack; weapons may (thrown/consumable)', () => {
    const { labBehavior: _l, damage: _d, critPct: _c, useTimeTicks: _u, knockback: _k, damageClass: _dc, ...base } = weapon
    const armor = { ...base, type: 'armor', slot: 'head', effects: [] }
    expect(ArmorPiece.safeParse(armor).success).toBe(true)
    expect(ArmorPiece.safeParse({ ...armor, maxStack: 9999 }).success).toBe(false)
    const accessory = { ...base, type: 'accessory', categories: ['mobility'], effects: [{ kind: 'stat', stat: 'move-speed-pct', value: 8 }], combinedFrom: [], upgradesTo: [] }
    expect(Accessory.safeParse(accessory).success).toBe(true)
    expect(Accessory.safeParse({ ...accessory, maxStack: 1 }).success).toBe(false)
    expect(Weapon.safeParse({ ...weapon, maxStack: 9999 }).success).toBe(true)
  })
})

describe('A5 enemy entity', () => {
  it('parses Enemy and accepts enemy TypedRefs and SearchDoc type "enemy"', () => {
    const enemy = { id: 'voodoo-demon', npcIds: [66], name: 'Voodoo Demon', dropIds: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Voodoo_Demon', _prov: prov }
    expect(Enemy.safeParse(enemy).success).toBe(true)
    expect(TypedRef.safeParse('enemy:voodoo-demon').success).toBe(true)
    expect(TypedRef.safeParse('enemy:Voodoo').success).toBe(false)
    expect(SearchDoc.safeParse({ id: 'enemy:voodoo-demon', name: 'Voodoo Demon', type: 'enemy', tags: [] }).success).toBe(true)
  })
})

describe('AMENDMENTS-003 schema deltas', () => {
  it('B10: npcIds accept negative variant netIDs and reject zero (DropSource, Enemy, Boss)', () => {
    const drop = { id: '23-green-slime-741638a5', itemId: 23, source: { npcName: 'Green Slime' }, quantity: { min: 1, max: 2 }, rates: { classic: 1 }, conditions: [], _prov: prov }
    const enemy = { id: 'green-slime', name: 'Green Slime', dropIds: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Green_Slime', _prov: prov }
    const boss = { id: 'wall-of-flesh', name: 'Wall of Flesh', nodeId: 'wall-of-flesh', wikiUrl: 'https://terraria.wiki.gg/wiki/Wall_of_Flesh', stage: 'late-prehm', summon: { items: [], conditions: [] }, location: { biomes: [], time: 'any' }, statsByDifficulty: {}, dropIds: [], _prov: prov }
    const accepts = (npcIds: number[]) => [
      DropSource.safeParse({ ...drop, source: { ...drop.source, npcIds } }).success,
      Enemy.safeParse({ ...enemy, npcIds }).success,
      Boss.safeParse({ ...boss, npcIds }).success,
    ]
    expect(accepts([-3])).toEqual([true, true, true])
    expect(accepts([-26, 3])).toEqual([true, true, true])
    expect(accepts([0])).toEqual([false, false, false])
    expect(accepts([-3, 0])).toEqual([false, false, false])
    expect(accepts([1.5])).toEqual([false, false, false])
    expect(NpcId.safeParse(0).error?.issues[0].message).toBe('B10: NPC id must be nonzero')
  })

  it('B9: Recipe.conditions holds availability conditions and defaults to empty', () => {
    const recipe = { id: '5134-1a2b3c4d', resultItemId: 5134, resultAmount: 1, stations: [{ kind: 'environment', condition: 'shimmer', name: 'Shimmer' }], ingredients: [{ amount: 1, ref: { kind: 'item', itemId: 5011 } }], _prov: prov }
    expect(Recipe.parse(recipe).conditions).toEqual([])
    expect(Recipe.parse({ ...recipe, conditions: ['post-moon-lord'] }).conditions).toEqual(['post-moon-lord'])
    expect(Recipe.safeParse({ ...recipe, conditions: ['Post Moon Lord'] }).success).toBe(false)
  })
})

describe('sprite manifest (A10 / D3)', () => {
  const file = { path: '/sprites/weapons/4956.png', ref: 'i:4956', wikiFileUrl: 'https://terraria.wiki.gg/wiki/File:Zenith.png', sha1: '6d467f'.padEnd(40, '0'), bytes: 1200, width: 56, height: 56, rights: 're-logic' }
  it('records each file with its wiki file page and Re-Logic rights', () => {
    expect(SpriteManifest.safeParse({ fallbackMode: false, rightsNote: 'Terraria content © Re-Logic.', files: [file] }).success).toBe(true)
  })
  it('rejects non-wiki provenance, other rights and paths outside /sprites/<type>/<id>.<png|gif>', () => {
    const bad = (over: Record<string, unknown>) => SpriteManifest.safeParse({ fallbackMode: false, rightsNote: 'x', files: [{ ...file, ...over }] }).success
    expect(bad({ wikiFileUrl: 'https://example.com/Zenith.png' })).toBe(false)
    expect(bad({ rights: 'cc-by-nc-sa' })).toBe(false)
    expect(bad({ path: '/sprites/weapons/zenith.webp' })).toBe(false)
  })
})

describe('provenance rules (§2.1)', () => {
  it('verified:true requires no unverified fields', () => {
    expect(Prov.safeParse({ ...prov, unverifiedFields: ['damage'] }).success).toBe(false)
    expect(Prov.safeParse({ ...prov, verified: false, unverifiedFields: ['damage'] }).success).toBe(true)
  })

  it('iteminfo sources need a revision id; curated sources need an overlay slug', () => {
    const src = { url: 'https://terraria.wiki.gg/wiki/Module:Iteminfo/data', fetchedAt: '2026-10-12' }
    expect(Prov.safeParse({ ...prov, sources: [{ ...src, kind: 'iteminfo' }] }).success).toBe(false)
    expect(Prov.safeParse({ ...prov, sources: [{ ...src, kind: 'iteminfo', rev: 1023241 }] }).success).toBe(true)
    expect(Prov.safeParse({ ...prov, sources: [{ ...src, kind: 'curated' }] }).success).toBe(false)
    expect(Prov.safeParse({ ...prov, sources: [{ ...src, kind: 'curated', overlay: 'lab-archetypes' }] }).success).toBe(true)
  })

  it('A15: wiki-derived strings must be plain text', () => {
    for (const bad of ['<b>Minishark</b>', '[[Minishark]]', '{{item|Minishark}}', "'''bold'''", 'a&nbsp;b']) {
      expect(PlainText.safeParse(bad).success, bad).toBe(false)
    }
    for (const ok of ["Tinkerer's Workshop", "'You are a terrible person'", '20% chance to save ammo']) {
      expect(PlainText.safeParse(ok).success, ok).toBe(true)
    }
    expect(Weapon.safeParse({ ...weapon, name: '<span>Minishark</span>' }).success).toBe(false)
  })
})

describe('Weapon Lab behavior (§2.4)', () => {
  it('has exactly 9 archetype arms (homing is a modifier, not an arm)', () => {
    expect(ArchetypeParams.options.map((o) => o.shape.archetype.value).sort()).toEqual(
      ['bow-gun', 'explosive-aoe', 'magic-bolt', 'minion-sentry', 'piercing-beam', 'returning', 'swing-melee', 'thrust', 'whip'],
    )
  })

  it('§7a-12 conditional refinements', () => {
    const beam = { archetype: 'piercing-beam', mode: 'pierce-projectile', pierce: 3 }
    expect(ArchetypeParams.safeParse(beam).success).toBe(true)
    expect(ArchetypeParams.safeParse({ ...beam, pierce: undefined }).success).toBe(false)
    expect(ArchetypeParams.safeParse({ archetype: 'piercing-beam', mode: 'channel-beam', tickRateTicks: 6 }).success).toBe(true)
    expect(ArchetypeParams.safeParse({ archetype: 'piercing-beam', mode: 'channel-beam', tickRateTicks: 6, pierce: 2 }).success).toBe(false)

    const sentry = { archetype: 'minion-sentry', variant: 'sentry', slotCost: 1, aiClass: 'ranged-shot', attackRateTicks: 30, sentryRangeTiles: 20 }
    expect(ArchetypeParams.safeParse(sentry).success).toBe(true)
    expect(ArchetypeParams.safeParse({ ...sentry, sentryRangeTiles: undefined }).success).toBe(false)
    expect(ArchetypeParams.safeParse({ ...sentry, variant: 'minion' }).success).toBe(false)

    const boom = { archetype: 'explosive-aoe', blastRadiusTiles: 3, trigger: 'timed', fuseTicks: 180, falloff: 'none' }
    expect(ArchetypeParams.safeParse(boom).success).toBe(true)
    expect(ArchetypeParams.safeParse({ ...boom, fuseTicks: undefined }).success).toBe(false)
    expect(ArchetypeParams.safeParse({ ...boom, trigger: 'impact' }).success).toBe(false)
  })

  it('limitation behavior requires in-game text, reason and a wiki source', () => {
    expect(LabBehavior.safeParse(limitation).success).toBe(true)
    expect(LabBehavior.safeParse({ ...limitation, sourceUrl: undefined }).success).toBe(false)
  })
})

describe('progression + reports', () => {
  it('§7a-4: a node has bossId iff it is a boss node', () => {
    const node = { id: 'hardmode', kind: 'milestone', name: 'Hardmode', stage: 'early-hm', wikiUrl: 'https://terraria.wiki.gg/wiki/Hardmode', _prov: prov }
    expect(ProgressionNode.safeParse(node).success).toBe(true)
    expect(ProgressionNode.safeParse({ ...node, bossId: 'wall-of-flesh' }).success).toBe(false)
    expect(ProgressionNode.safeParse({ ...node, kind: 'boss' }).success).toBe(false)
  })

  it('Gaps enforces zero unhandled weapons', () => {
    const gaps = {
      generatedAt: '2026-10-12T00:00:00Z',
      gameVersion: '1.4.5.8',
      summary: { perEntity: {}, labCoverage: { archetype: 1, customScenario: 0, limitation: 4, unhandled: 0 } },
      entries: [],
    }
    expect(Gaps.safeParse(gaps).success).toBe(true)
    expect(Gaps.safeParse({ ...gaps, summary: { ...gaps.summary, labCoverage: { ...gaps.summary.labCoverage, unhandled: 1 } } }).success).toBe(false)
  })
})

describe('P2-S7 schema deltas (ammo, buffs provenance, B22, B30, B31)', () => {
  const ammoItem = { id: 23, name: 'Gel', slug: 'gel', type: 'item', tags: [], wikiUrl: 'https://terraria.wiki.gg/wiki/Gel', acquisition: [], category: 'ammo', isStation: false, ammoStats: { ammoClass: 'gel' }, _prov: { ...prov, verified: false, unverifiedFields: ['acquisition', 'ammoStats.damage'] } }

  it('A2: ammoStats.damage is optional (Gel: Unknown); a dual-role weapon carries ammoStats (Snowball)', () => {
    expect(Item.safeParse(ammoItem).success).toBe(true)
    expect(Item.safeParse({ ...ammoItem, ammoStats: { ammoClass: 'gel', damage: -1 } }).success).toBe(false)
    expect(Weapon.safeParse({ ...weapon, ammoStats: { ammoClass: 'snowball', damage: 8, velocityBonusTps: 26.25, knockback: 5.75 } }).success).toBe(true)
    expect(Weapon.safeParse({ ...weapon, ammoStats: { ammoClass: 'snowball', speed: 7 } }).success).toBe(false)
  })

  it('wiki-article provenance requires the article revision (like iteminfo / wiki-module)', () => {
    const source = { kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Buff_IDs', fetchedAt: '2026-10-13' }
    expect(Prov.safeParse({ ...prov, sources: [{ ...source, rev: 1029302 }] }).success).toBe(true)
    expect(Prov.safeParse({ ...prov, sources: [source] }).success).toBe(false)
  })

  it('B22: ProgressionNode.unlocksStage is an optional Stage', () => {
    const node = { id: 'wall-of-flesh', kind: 'boss', bossId: 'wall-of-flesh', name: 'Wall of Flesh', stage: 'late-prehm', wikiUrl: 'https://terraria.wiki.gg/wiki/Wall_of_Flesh', _prov: prov }
    expect(ProgressionNode.safeParse({ ...node, unlocksStage: 'early-hm' }).success).toBe(true)
    expect(ProgressionNode.safeParse({ ...node, unlocksStage: 'hardmode' }).success).toBe(false)
  })

  it('B30: a manifest file may list a /sprites/thumbs/<type>/<id>.png thumbnail; B31: a search doc may carry a wiki URL', () => {
    const file = { path: '/sprites/bosses/113.gif', ref: 'boss:wall-of-flesh', wikiFileUrl: 'https://terraria.wiki.gg/wiki/File:Wall_of_Flesh.gif', sha1: 'b'.repeat(40), bytes: 668777, width: 210, height: 420, rights: 're-logic' }
    const manifest = (thumbnail: unknown) => SpriteManifest.safeParse({ fallbackMode: false, rightsNote: 'x', files: [{ ...file, thumbnail }] }).success
    expect(manifest({ path: '/sprites/thumbs/bosses/113.png', width: 53, height: 105 })).toBe(true)
    expect(manifest({ path: '/sprites/bosses/113.png', width: 53, height: 105 })).toBe(false)
    expect(manifest({ path: '/sprites/thumbs/bosses/113.gif', width: 53, height: 105 })).toBe(false)
    const doc = { id: 'i:97', name: 'Musket Ball', type: 'item', tags: ['bullets'] }
    expect(SearchDoc.safeParse({ ...doc, wikiUrl: 'https://terraria.wiki.gg/wiki/Musket_Ball' }).success).toBe(true)
    expect(SearchDoc.safeParse({ ...doc, wikiUrl: 'https://example.com/Musket_Ball' }).success).toBe(false)
  })
})

describe('persistence schemas (§8a + A4/A6/A7)', () => {
  const env = (data: unknown) => ({ v: 1, savedAt: '2026-10-12T12:00:00.000Z', gameVersion: '1.4.5.8', data })
  const slots = (accessories: number) => ({
    mainWeapon: 98,
    altWeapon: null,
    helmet: null,
    chest: null,
    legs: null,
    accessories: Array.from({ length: accessories }, () => null),
    ammo: [97],
    buffs: [],
    summon: null,
  })

  it('domain keys include readiness and checklists', () => {
    expect(DomainKey.options).toEqual(expect.arrayContaining(['readiness', 'checklists']))
  })

  it('LoadoutSlots allows 5 to 7 accessory slots (A4)', () => {
    expect(LoadoutSlots.safeParse(slots(4)).success).toBe(false)
    for (const n of [5, 6, 7]) expect(LoadoutSlots.safeParse(slots(n)).success).toBe(true)
    expect(LoadoutSlots.safeParse(slots(8)).success).toBe(false)
  })

  it('A6: ReadinessV1 requires stage', () => {
    const data = { bossId: 'wall-of-flesh', stage: 'late-prehm', difficulty: 'expert', class: 'ranged', loadout: slots(6), analyzedAt: null }
    expect(ReadinessV1.safeParse(env(data)).success).toBe(true)
    const { stage: _s, ...noStage } = data
    expect(ReadinessV1.safeParse(env(noStage)).success).toBe(false)
  })

  it('A7: ChecklistsV1 maps checklist ids to checked entry ids', () => {
    expect(ChecklistsV1.safeParse(env({ byKey: { 'boss:wall-of-flesh:prep': ['potions'] } })).success).toBe(true)
    expect(ChecklistsV1.safeParse(env({ byKey: { x: 'potions' } })).success).toBe(false)
  })

  it('SettingsV1 accepts exactly what the P1 storage module writes', () => {
    expect(SettingsV1.safeParse(env(DEFAULT_SETTINGS)).success).toBe(true)
    expect(SettingsV1.safeParse(env({ ...DEFAULT_SETTINGS, extra: true })).success).toBe(false)
  })
})
