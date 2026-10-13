/* Boss registry + progression graph (P2-S6) on synthetic Cargo NPCs rows and cached articles
 * shaped like the 2026-10-13 sync. Curated text must be verbatim on its cited article. */
import { describe, expect, it } from 'vitest'
import { Boss, ProgressionEdge, ProgressionNode, type DropSource } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { ImageInfoFetch } from '../fetch/images'
import type { Iteminfo } from '../parse/iteminfo'
import { bossAttribution, bossImageFiles, buildBosses, buildProgression } from './bosses'
import { Evidence } from './evidence'
import { BossesOverlay, ProgressionOverlay } from './overlays'

const npcstat = (n: number, e: number, m: number) =>
  `<span class="npcstat"><span class="m-normal m-journey">${n}</span><span class="ssep">/</span><span class="m-expert mode-exclusive expert"><span class="s">${e}</span></span><span class="ssep">/</span><span class="m-master mode-exclusive master"><span class="s">${m}</span></span></span>`
const all = (v: number) => `<span class="npcstat"><span class="m-all">${v}</span></span>`
const OUTDATED = "[[Category:Pages with information based on outdated versions of Terraria's source code]]"

const NPC_ROWS: CargoRow[] = [
  { _page: 'King Slime', nameraw: 'King Slime', name: '[[King Slime]]', npcid: '50', type: 'boss^slime', environment: 'Forest/Slime Rain', image: '<span class="npcimg">[[File:King Slime.gif|link=]]</span>', life: npcstat(2000, 2800, 3570), defense: all(10), damage: npcstat(40, 64, 96) },
  { _page: 'Wall of Flesh', nameraw: 'Wall of Flesh', name: '[[Wall of Flesh]]', npcid: '113', type: 'boss', environment: 'The Underworld', image: '[[File:Wall of Flesh.gif|link=]]', life: npcstat(8000, 11200, 14280), defense: '', damage: '' },
  { _page: 'Wall of Flesh', nameraw: 'Wall of Flesh', name: '[[Wall of Flesh]]<div class="note-text ">(Wall of Flesh Eye)</div>', npcid: '114', type: 'boss', environment: 'The Underworld', image: '[[File:Wall of Flesh Eye.gif|link=]]', life: npcstat(8000, 11200, 14280), defense: '0', damage: '' },
  { _page: 'Wall of Flesh', nameraw: 'The Hungry', name: '[[The Hungry]]', npcid: '115', type: 'enemy', environment: 'The Underworld', image: '', life: '', defense: '', damage: '' },
  { _page: 'Plantera', nameraw: 'Plantera', name: '[[Plantera]]', npcid: '262', type: 'boss', environment: 'Underground Jungle', image: '[[File:Plantera (First form).gif|link=]]', life: npcstat(30000, 42000, 53550), defense: '36', damage: `${npcstat(50, 100, 150)} ${OUTDATED}` },
]

const article = (title: string, revid: number, text: string): [string, Article] => [title, { title, resolvedTitle: title, revid, html: `<div class="mw-parser-output"><p>${text}</p></div>`, fetchedAt: '2026-10-13T05:30:00.000Z' }]
const ARTICLES = new Map<string, Article>([
  article('King Slime', 101, 'King Slime can be summoned by using the Slime Crown, in any biome at any time. When unable to reach the player, he may teleport to their location. Fighting King Slime is not required for game progression.'),
  article('Wall of Flesh', 102, 'The Wall of Flesh can be summoned by dropping a Guide Voodoo Doll into lava in The Underworld while the Guide is alive.'),
  article('Plantera', 103, 'After all three mechanical bosses have been defeated, Plantera&#39;s Bulbs will randomly spawn in the Underground Jungle.'),
  article('Hardmode', 104, 'A world permanently changes into Hardmode after the Wall of Flesh is defeated for the first time, granting players new challenges.'),
  article('Pre-Hardmode', 105, 'Pre-Hardmode is the initial state of a world.'),
])
const evidence = new Evidence(ARTICLES)

const iteminfo = {
  rev: 1023241,
  fetchedAt: '2026-10-13T02:44:40.000Z',
  items: new Map(),
  idsByName: new Map([['Slime Crown', [560]], ['Guide Voodoo Doll', [267]]]),
  wikiIdFromName: new Map(),
} as unknown as Iteminfo

const img = (file: string): ImageInfoFetch['found'] extends Map<string, infer V> ? V : never => ({ file, title: `File:${file}`, url: `https://terraria.wiki.gg/images/${file}?abcdef`, descriptionUrl: `https://terraria.wiki.gg/wiki/File:${file.replaceAll(' ', '_')}`, sha1: 'a'.repeat(40), bytes: 100, width: 40, height: 30, mime: 'image/gif' })
const images: ImageInfoFetch = { found: new Map(['King Slime.gif', 'Wall of Flesh.gif'].map((f) => [f, img(f)])), missing: [], fetchedAt: '2026-10-13T05:31:00.000Z' }

const overlay = (over: Partial<Record<string, unknown>>[] = []) =>
  BossesOverlay.parse({
    overlay: 'bosses',
    authoredAt: '2026-10-13',
    notes: [],
    entries: [
      { id: 'king-slime', name: 'King Slime', page: 'King Slime', stage: 'early-prehm', primary: { npcId: 50 },
        summon: { items: ['Slime Crown'], conditions: [], quote: 'King Slime can be summoned by using the Slime Crown, in any biome at any time.' },
        time: { value: 'any', quote: 'in any biome at any time' },
        attackPatternTags: [{ tag: 'teleports', quote: 'When unable to reach the player, he may teleport to their location.' }], ...over[0] },
      { id: 'wall-of-flesh', name: 'Wall of Flesh', page: 'Wall of Flesh', stage: 'late-prehm', primary: { npcId: 113 },
        statsUnknown: 'Mouth and eyes share one health pool but have different defense.',
        summon: { items: ['Guide Voodoo Doll'], conditions: ['underworld'], quote: 'The Wall of Flesh can be summoned by dropping a Guide Voodoo Doll into lava in The Underworld while the Guide is alive.' },
        attackPatternTags: [], ...over[1] },
      { id: 'plantera', name: 'Plantera', page: 'Plantera', stage: 'mid-hm', primary: { npcId: 262 },
        summon: { items: [], conditions: ['post-mechanical-bosses'], quote: "After all three mechanical bosses have been defeated, Plantera's Bulbs will randomly spawn in the Underground Jungle." },
        attackPatternTags: [], ...over[2] },
    ],
  })

const prov = { gameVersion: '1.4.5.8' as const, sources: [{ kind: 'cargo:Drops' as const, url: 'https://terraria.wiki.gg/wiki/King_Slime', fetchedAt: '2026-10-13' }], verified: true, unverifiedFields: [], editorialFields: [] }
const DROPS: DropSource[] = [
  { id: '2585-king-slime-741638a5', itemId: 2585, source: { npcName: 'King Slime', npcIds: [50], bossId: 'king-slime' }, quantity: { min: 1, max: 1 }, rates: { classic: 0.25 }, conditions: [], _prov: prov },
  { id: '216-zombie-741638a5', itemId: 216, source: { npcName: 'Zombie', npcIds: [3] }, quantity: { min: 1, max: 1 }, rates: { classic: 0.02 }, conditions: [], _prov: prov },
]

const build = (o = overlay()) => buildBosses({ overlay: o, npcRows: NPC_ROWS, npcsFetchedAt: '2026-10-13T02:47:00.000Z', dropsFetchedAt: '2026-10-13T02:46:00.000Z', drops: DROPS, evidence, iteminfo, images })

describe('buildBosses', () => {
  const out = build()
  const byId = (id: string) => out.bosses.find((b) => b.id === id) as Boss

  it('emits schema-valid bosses: Cargo NPCs stats per difficulty, npcIds of every boss-typed row, environment as biomes, derived dropIds', () => {
    for (const b of out.bosses) expect(() => Boss.parse(b)).not.toThrow()
    expect(byId('king-slime')).toMatchObject({
      nodeId: 'king-slime',
      npcIds: [50],
      wikiUrl: 'https://terraria.wiki.gg/wiki/King_Slime',
      summon: { items: [560], conditions: [], text: 'King Slime can be summoned by using the Slime Crown, in any biome at any time.', sourceUrl: 'https://terraria.wiki.gg/wiki/King_Slime' },
      location: { biomes: ['Forest', 'Slime Rain'], time: 'any' },
      statsByDifficulty: { classic: { hp: 2000, defense: 10, contactDamage: 40 }, expert: { hp: 2800, defense: 10, contactDamage: 64 }, master: { hp: 3570, defense: 10, contactDamage: 96 } },
      attackPatternTags: ['teleports'],
      dropIds: ['2585-king-slime-741638a5'],
    })
    expect(byId('wall-of-flesh').npcIds).toEqual([113, 114]) // The Hungry is an enemy, not a boss part
  })

  it('verified-or-Unknown: multi-part stats, outdated contact damage, unstated time and A1-staged fields are absent + listed', () => {
    const wof = byId('wall-of-flesh')
    expect(wof.statsByDifficulty).toEqual({})
    expect(wof.location.time).toBeUndefined()
    expect(wof._prov.unverifiedFields).toEqual(['attackPatternTags', 'location.time', 'prepChecklist', 'statsByDifficulty.classic', 'statsByDifficulty.expert', 'statsByDifficulty.master', 'strategies', 'suggestedEquipment'])
    const plantera = byId('plantera')
    expect(plantera.statsByDifficulty.classic).toEqual({ hp: 30000, defense: 36 })
    expect(plantera._prov.unverifiedFields).toEqual(expect.arrayContaining(['statsByDifficulty.classic.contactDamage', 'statsByDifficulty.master.contactDamage']))
    expect(out.stats.find((r) => r.id === 'plantera')?.reasons).toEqual(['contact damage: flagged by the wiki as based on outdated source code'])
    const ks = byId('king-slime')
    expect(ks._prov.verified).toBe(false) // A1 staging: prep/suggested equipment/strategies are Unknown
    expect(ks._prov.editorialFields).toEqual(['attackPatternTags', 'stage'])
    expect(ks._prov.sources).toContainEqual({ kind: 'curated', overlay: 'bosses', url: 'https://terraria.wiki.gg/wiki/King_Slime', rev: 101, fetchedAt: '2026-10-13' })
  })

  it('sprites: the representative row image → /sprites/bosses/<npcId>; a missing image → placeholder + missing-sprite gap', () => {
    expect(byId('king-slime').sprite).toBe('/sprites/bosses/50.gif')
    expect(out.sprites.find((s) => s.ref === 'boss:king-slime')).toMatchObject({ path: '/sprites/bosses/50.gif', wikiFileUrl: 'https://terraria.wiki.gg/wiki/File:King_Slime.gif', rights: 're-logic' })
    expect(byId('plantera').sprite).toBeUndefined()
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'boss:plantera', kind: 'missing-sprite' }))
    expect(bossImageFiles(overlay(), NPC_ROWS)).toEqual(['King Slime.gif', 'Wall of Flesh.gif', 'Wall of Flesh Eye.gif', 'Plantera (First form).gif'])
  })

  it('curated text must be verbatim on its article; summon items must resolve; the primary row must exist', () => {
    expect(() => build(overlay([{ summon: { items: ['Slime Crown'], conditions: [], quote: 'King Slime can be summoned at night only by using the Slime Crown.' } }]))).toThrow(/quote not found verbatim on "King Slime" rev 101/)
    expect(() => build(overlay([{ attackPatternTags: [{ tag: 'burrows', quote: 'King Slime burrows through blocks.' }] }]))).toThrow(/attackPatternTags.burrows/)
    expect(() => build(overlay([{ summon: { items: ['Gel Crown'], conditions: [], quote: 'in any biome at any time' } }]))).toThrow(/summon item "Gel Crown"/)
    expect(() => build(overlay([{ primary: { npcId: 51 } }]))).toThrow(/matches 0 Cargo NPCs rows/)
  })

  it('bossAttribution maps each registry article to its boss and boss-typed NPC ids', () => {
    expect(bossAttribution(overlay(), NPC_ROWS).get('Wall of Flesh')).toEqual({ id: 'wall-of-flesh', npcIds: new Set([113, 114]) })
  })
})

describe('buildProgression', () => {
  const progression = (edges: unknown[]) =>
    ProgressionOverlay.parse({
      overlay: 'progression',
      authoredAt: '2026-10-13',
      notes: [],
      nodes: [
        { id: 'pre-hardmode', kind: 'milestone', name: 'Pre-Hardmode', stage: 'early-prehm', page: 'Pre-Hardmode' },
        { id: 'hardmode', kind: 'milestone', name: 'Hardmode', stage: 'early-hm', page: 'Hardmode' },
      ],
      edges,
    })
  const gate = { from: 'wall-of-flesh', to: 'hardmode', type: 'required-gate', page: 'Hardmode', quote: 'A world permanently changes into Hardmode after the Wall of Flesh is defeated for the first time' }

  it('boss nodes 1:1 with the registry + milestone markers; edges carry the verbatim quote as note and the article as sourceUrl', () => {
    const { nodes, edges } = buildProgression({ overlay: progression([gate, { from: 'pre-hardmode', to: 'king-slime', type: 'optional', page: 'King Slime', quote: 'Fighting King Slime is not required for game progression.' }]), bosses: overlay(), evidence })
    for (const n of nodes) expect(() => ProgressionNode.parse(n)).not.toThrow()
    for (const e of edges) expect(() => ProgressionEdge.parse(e)).not.toThrow()
    expect(nodes.map((n) => `${n.id}:${n.kind}`)).toEqual(['hardmode:milestone', 'king-slime:boss', 'plantera:boss', 'pre-hardmode:milestone', 'wall-of-flesh:boss'])
    expect(nodes.find((n) => n.id === 'wall-of-flesh')).toMatchObject({ bossId: 'wall-of-flesh', stage: 'late-prehm', wikiUrl: 'https://terraria.wiki.gg/wiki/Wall_of_Flesh' })
    expect(edges.find((e) => e.type === 'required-gate')).toMatchObject({
      from: 'wall-of-flesh',
      to: 'hardmode',
      note: gate.quote,
      sourceUrl: 'https://terraria.wiki.gg/wiki/Hardmode',
      _prov: { verified: true, sources: [{ kind: 'curated', overlay: 'progression', url: 'https://terraria.wiki.gg/wiki/Hardmode', rev: 104, fetchedAt: '2026-10-13' }] },
    })
  })

  it('an edge quote that is not on its article fails the build', () => {
    expect(() => buildProgression({ overlay: progression([{ ...gate, quote: 'Hardmode starts after the Eye of Cthulhu is defeated.' }]), bosses: overlay(), evidence })).toThrow(/quote not found verbatim on "Hardmode"/)
  })
})
