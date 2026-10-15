/* AMENDMENTS-004 B20 fishing (P6-S0): the "Fishing catches" article parser (parse/fishing.ts) and the
 * route builder (merge/fishing.ts) on HTML shaped like the 2026-10-15 revision; + the gating effect. */
import { describe, expect, it } from 'vitest'
import type { Condition, Prov } from '../../src/schemas'
import { parseFishingCatches } from '../parse/fishing'
import { buildFishingRoutes } from './fishing'
import { createGatingDeriver, type ExtraRoute } from './gating'
import type { ConditionOverlayEntry } from './overlays'

const def = (anchor: string, label: string, req = 'requirement') => `<tr><td><span id="${anchor}"></span><span class="i"><a href="#${anchor}" title="${label}"></a><span><span><a href="#${anchor}">${label}</a></span></span></span></td><td>${req}</td></tr>`
const defs = (caption: string, rows: string[]) => `<div><table class="terraria lined"><caption>${caption}\n</caption><tbody><tr><th>Condition</th><th>Requirements</th></tr>${rows.join('')}</tbody></table></div>`
const ref = (anchor: string, label: string) => `<li><span class="i"><a href="#${anchor}" title="${label}"></a><span><span><a href="#${anchor}">${label}</a></span></span></span></li>`
const height = (h: string) => `<li><span class="i"><span><span title="${h}">${h}</span></span></span></li>`
const item = (name: string, id: number, kind = 'Item') => `<span class="i -w"><a href="/wiki/${name}" title="${name}"></a><span><span><a href="/wiki/${name}" class="mw-redirect" title="${name}">${name}</a></span><span class="id">Internal <a href="/wiki/${kind}_IDs" title="${kind} IDs">${kind} ID</a>: ${id}</span></span></span>`
const catchRow = (catches: string, heights: string[], conds: string[]) => `<tr><td>${catches}</td><td><span class="chance" data-sort-value="100">1/1 (100%)</span></td><td> Uncommon</td><td>${heights.map(height).join('')}</td><td>${conds.length ? conds.join('') : '<span class="na">n/a</span>'}</td></tr>`
const table = (caption: string, general: string, rows: string[]) =>
  `<table class="terraria lined mw-collapsible"><caption><div><span id="${caption}"></span><h4 style="display:none;"><span class="mw-headline" id="${caption}">${caption}</span></h4>${caption}<sup class="reference"><a href="#x">[1]</a></sup></div></caption><tbody><tr><th colspan="5">General condition: ${general}</th></tr><tr><th>Fishing catch<sup class="reference"><a href="#n">[i]</a></sup></th><th>Chance</th><th>Catch quality</th><th>Heights</th><th>Other conditions</th></tr>${rows.join('')}</tbody></table>`
const h3 = (id: string) => `<h3><span class="mw-headline" id="${id}">${id}</span></h3>`

const HTML = [
  defs('1. Generic fishing conditions', [def('canfishinlava', 'Can fish in lava'), def('crate', 'Crate'), def('questfish', 'Quest fish'), def('water1000', '&gt;1000 tiles of liquid'), def('enemies', 'Enemies')]),
  defs('2. Bobber location', [def('height0', 'Space'), def('ocean', 'Ocean')]),
  defs('3. Biome', [def('corruption', 'Corruption'), def('dungeon', 'Dungeon', 'The player is in the Dungeon. Skeletron is defeated.'), def('snow', 'Snow biome(overridable)'), def('truesnow', 'Snow biome')]),
  defs('4. World status', [def('hardmode', 'Hardmode'), def('earlymode', 'Pre-Hardmode'), def('remix', 'Remix')]),
  h3('Lava'),
  table('Lava', ref('canfishinlava', 'Can fish in lava').replace(/<\/?li>/g, ''), [catchRow(item('Obsidian Crate', 4877), ['Any'], [ref('crate', 'Crate'), ref('earlymode', 'Pre-Hardmode')])]),
  h3('Water'),
  table('Enemy', ref('enemies', 'Enemies').replace(/<\/?li>/g, ''), [catchRow(item('Zombie Merman', 586, 'NPC'), ['Any'], [ref('earlymode', 'Pre-Hardmode')])]),
  table('Crate', ref('crate', 'Crate').replace(/<\/?li>/g, ''), [
    catchRow(item('Dungeon Crate', 3205), ['Any'], [ref('earlymode', 'Pre-Hardmode'), ref('dungeon', 'Dungeon')]),
    catchRow(item('Sky Crate', 3206), ['Space'], [ref('earlymode', 'Pre-Hardmode')]),
    catchRow(item('Ocean Crate', 5002), ['Any'], [ref('remix', 'Remix')]),
  ]),
  table('Corruption', ref('corruption', 'Corruption').replace(/<\/?li>/g, ''), [
    catchRow(item('Scaly Truffle', 2429), ['Cavern'], [ref('hardmode', 'Hardmode'), ref('truesnow', 'Snow biome')]),
    catchRow(item('Toxikarp', 3210), ['Any'], [ref('hardmode', 'Hardmode')]),
    catchRow(item('Ebonkoi', 2318), ['Any'], []),
  ]),
  table('Snow', ref('snow', 'Snow biome(overridable)').replace(/<\/?li>/g, ''), [catchRow(item('Frost Minnow', 2306), ['Any'], []), catchRow(item('Specular Fish', 2309), ['Underground', 'Cavern', 'Underworld'], [])]),
  table('Space', '<span class="na">n/a</span>', [catchRow(item('Harpyfish', 2461), ['Space', 'Surface'], [ref('questfish', 'Quest fish')])]),
  table('Pure biome', '<span class="na">n/a</span>', [catchRow(item('Salmon', 2298), ['Any'], [ref('water1000', '&gt;1000 tiles of liquid')]), catchRow(item('Specular Fish', 2309), ['Underground', 'Cavern', 'Underworld'], [])]),
].join('\n')

const entry = (id: string, labels: string[]): ConditionOverlayEntry => ({ id, name: id, kind: 'world-state', wikiTitle: 'X', description: id, match: { fishingConditions: labels } })
const MATCHERS = {
  fishing: new Map(
    [entry('hardmode', ['Hardmode']), entry('pre-hardmode', ['Pre-Hardmode']), entry('angler-quest', ['Quest fish']), entry('can-fish-in-lava', ['Can fish in lava']), entry('post-skeletron', ['Dungeon'])].flatMap((e) => (e.match?.fishingConditions ?? []).map((l) => [l, e] as const)),
  ),
}

describe('parseFishingCatches', () => {
  const parsed = parseFishingCatches(HTML)
  it('reads the four definition tables (anchor → label, group) and every 5-cell catch row with its category, table and general condition', () => {
    expect(parsed.definitions.get('dungeon')).toMatchObject({ label: 'Dungeon', group: 'biome', requirement: 'The player is in the Dungeon. Skeletron is defeated.' })
    expect(parsed.definitions.get('height0')?.group).toBe('bobber')
    expect(parsed.definitions.get('earlymode')).toMatchObject({ label: 'Pre-Hardmode', group: 'world' })
    expect(parsed.definitions.get('water1000')?.label).toBe('>1000 tiles of liquid')
    expect(parsed.rows).toHaveLength(13)
    const toxikarp = parsed.rows.find((r) => r.itemIds.includes(3210))
    expect(toxikarp).toMatchObject({ category: 'Water', table: 'Corruption', general: { anchor: 'corruption', label: 'Corruption' }, heights: ['Any'], conditions: [{ anchor: 'hardmode', label: 'Hardmode' }], quality: 'Uncommon' })
    expect(parsed.rows.find((r) => r.npcIds.includes(586))?.itemIds).toEqual([])
    expect(parsed.rows.find((r) => r.table === 'Space')?.general).toBeUndefined()
  })
})

describe('buildFishingRoutes', () => {
  const { byItem, report } = buildFishingRoutes(parseFishingCatches(HTML), MATCHERS)
  const routes = (id: number) => byItem.get(id)?.map((r) => r.acquisition)
  it('where = liquid / biome conditions (+ heights); mapped World status / generic conditions; NPC and Remix rows skipped', () => {
    expect(routes(3210)).toEqual([{ method: 'fishing', biomes: ['Corruption'], conditions: ['hardmode'] }])
    expect(routes(2318)).toEqual([{ method: 'fishing', biomes: ['Corruption'], conditions: [] }])
    expect(routes(2429)).toEqual([{ method: 'fishing', biomes: ['Corruption + Snow biome (Cavern)'], conditions: ['hardmode'] }])
    expect(routes(4877)).toEqual([{ method: 'fishing', biomes: ['Lava'], conditions: ['can-fish-in-lava', 'pre-hardmode'] }])
    expect(routes(3205)).toEqual([{ method: 'fishing', biomes: ['Dungeon'], conditions: ['post-skeletron', 'pre-hardmode'] }]) // the Dungeon's own requirement
    expect(routes(3206)).toEqual([{ method: 'fishing', biomes: ['Space'], conditions: ['pre-hardmode'] }])
    expect(routes(2306)).toEqual([{ method: 'fishing', biomes: ['Snow biome'], conditions: [] }]) // "(overridable)" is priority mechanics, not a place
    expect(routes(2461)).toEqual([{ method: 'fishing', biomes: ['Space, Surface'], conditions: ['angler-quest'] }])
    expect(byItem.has(5002)).toBe(false)
    expect(report.skipped).toEqual(new Map([['NPC catch (no item)', 1], ['Remix special seed only (seed worlds not modeled)', 1]]))
  })
  it('rows with the same conditions merge into one route listing every place; an unmapped label makes the conditions Unknown', () => {
    expect(routes(2309)).toEqual([{ method: 'fishing', biomes: ['Snow biome (Underground, Cavern, Underworld)', 'Pure biome (Underground, Cavern, Underworld)'], conditions: [] }])
    expect(byItem.get(2298)).toEqual([{ acquisition: { method: 'fishing', biomes: ['Pure biome'], conditions: [] }, unmapped: ['>1000 tiles of liquid'] }])
    expect(report.unmapped).toEqual(new Map([['>1000 tiles of liquid', 1]]))
  })
})

describe('§7b: a fishing route is an unknown route (fishing-route-ungated)', () => {
  const prov: Prov = { gameVersion: '1.4.5.8', sources: [{ kind: 'curated', overlay: 't', url: 'https://terraria.wiki.gg/wiki/T', fetchedAt: '2026-10-15' }], verified: true, unverifiedFields: [], editorialFields: [] }
  const ctx = (extra: Map<number, ExtraRoute[]>) =>
    createGatingDeriver({
      recipesByResult: new Map([[1, [{ id: 'r1', resultItemId: 1, resultAmount: 1, stations: [], conditions: [], ingredients: [{ amount: 1, ref: { kind: 'item', itemId: 2 } }], _prov: prov }]]]),
      dropsByItem: new Map(),
      groups: new Map(),
      conditions: new Map<string, Condition>(),
      extraRoutes: new Map<number, ExtraRoute[]>([...extra, [2, [{ kind: 'gather', conditions: [] }]]]),
    })
  it('blocks a gated minimum, never a gate-free route', () => {
    // item 1: crafted gate-free from item 2 → exact even with a fishing route
    expect(ctx(new Map<number, ExtraRoute[]>([[1, [{ kind: 'unknown', blocker: 'fishing-route-ungated' }]]]))(1)).toMatchObject({ ok: true, gatedBy: { bosses: [], conditions: [] } })
    // item 3: fishing only → Unknown with the fishing blocker
    expect(ctx(new Map<number, ExtraRoute[]>([[3, [{ kind: 'unknown', blocker: 'fishing-route-ungated' }]]]))(3)).toEqual({ ok: false, blockers: ['fishing-route-ungated'] })
  })
})
