import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../../../../public/sprites/manifest.json'
import { NodeMap } from '../../../components/NodeMap'
import { NodeMapLegend } from '../../../components/NodeMapLegend'
import { EDGE_PRECEDENCE, EDGE_STYLES } from '../../../components/nodeMap/edgeStyles'
import { buildMapGraph, connectionsOf, edgeLegendForms, layoutInputs, stageName, type WorldEvil } from '../../../components/nodeMap/graph'
import { layoutGraph } from '../../../components/nodeMap/layout'
import { MAP_LAYOUT_OPTIONS } from '../../../components/nodeMap/mapConfig'
import { createDataAccess } from '../../../data-access'
import type { Boss, ProgressionData, ProgressionEdge, ProgressionNode, SpriteIndex } from '../../../data-access/types'
import bossesJson from '../../../data/bosses.json'
import progressionJson from '../../../data/progression.json'
import { APP_ROUTES, hasRoute } from '../../routes'
import { heroActions } from '../home/heroActions'
import { BossFocusCard } from './BossFocusCard'
import { BossMapWorkspace, WorldEvilToggle } from './BossMapPage'
import type { BossMapData } from './bossMapData'
import { DISPLAY_ONLY_NOTE, STATE_LABEL } from './focusCardCopy'

const raw = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const bosses = bossesJson as Boss[]
const progression: ProgressionData = { ...raw, nodeById: new Map(raw.nodes.map((n) => [n.id, n])) }
const graph = buildMapGraph(progression, bosses)
let sprites: SpriteIndex
let data: BossMapData

beforeAll(async () => {
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
  data = { progression, bosses, sprites }
})

/** No promise of later features in our own copy (forward-promise purge, AMENDMENTS-013). */
const FORWARD_PROMISE = /\b(yet|coming soon|so far|soon)\b/i
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** The world-evil radio that is checked (`data-world-evil` of the input carrying `checked`). */
const checkedWorldEvil = (html: string) =>
  [...html.matchAll(/<input type="radio" data-world-evil="([a-z]+)"[^>]*>/g)].filter((m) => m[0].includes(' checked=""')).map((m) => m[1])
/** Text as React renders it (HTML-escaped). */
const escaped = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const attr = escaped

function renderWorkspace(): string {
  return renderToStaticMarkup(createElement(BossMapWorkspace, { data }))
}

describe('/bosses route registration (P5-S1)', () => {
  it('ships /bosses while the "What Should I Do Next?" hero button stays absent (its panel is P5-S5)', () => {
    expect(hasRoute('bosses')).toBe(true)
    expect(APP_ROUTES.find((r) => r.id === 'bosses')?.features ?? []).not.toContain('recommend')
    expect(heroActions().map((a) => a.label)).not.toContain('What Should I Do Next?')
  })
})

describe('BossMapWorkspace (SSR: phone layout, nothing persisted)', () => {
  it('AC1: a node tree, not a list — every node a button in progression order, typed edges, stage bands', () => {
    const html = renderWorkspace()
    const layout = (() => {
      const input = layoutInputs(graph)
      return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS.vertical)
    })()
    const ids = [...html.matchAll(/<button[^>]*data-node-id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(layout.layers.flat())
    expect(ids).toHaveLength(raw.nodes.length)
    expect(html).toContain('role="group" aria-roledescription="map" aria-label="Boss progression map"')
    // Each node is described (kind, stage, connections) for screen readers.
    for (const id of ids) expect(html).toMatch(new RegExp(`aria-describedby="map-node-desc-${id}"[\\s\\S]*?<span id="map-node-desc-${id}" hidden="">[^<]+</span>`))
    // One marker per edge type; one drawn path per link (+ the fork's two branches).
    for (const type of EDGE_PRECEDENCE) expect(html).toContain(`<marker id="edge-marker-${type}"`)
    expect(html.match(/<path d="M[^"]*" data-edge-role=/g)).toHaveLength(graph.links.length + 2)
    expect(html.match(/data-band-label="\d"/g)).toHaveLength(5)
    expect(html).toContain('data-or-chip=""')
  })

  it('toolbar + controls: world-evil choice, legend toggle, on-screen zoom, fit all, go to start', () => {
    const html = renderWorkspace()
    expect(html.match(/<input type="radio"[^>]*>/g)).toHaveLength(3)
    expect(checkedWorldEvil(html)).toEqual(['both'])
    expect(html).toMatch(/<button type="button" aria-expanded="false"[^>]*>Legend/)
    for (const label of ['Zoom in', 'Zoom out', 'Fit all', 'Go to start']) expect(html).toContain(`aria-label="${label}"`)
  })

  it('AC4: no dead local links and nothing unshipped (boss pages, recommender, reset, defeat toggles)', () => {
    const html = renderWorkspace()
    expect(html).not.toMatch(/href="\/bosses/)
    expect(html).not.toMatch(/What Should I Do Next|Reset progress|Mark (as )?defeated/i)
    expect(text(html)).not.toMatch(FORWARD_PROMISE)
  })

  it('AC3: the world-evil setting switches the either/or branch (Crimson → Brain of Cthulhu on the path)', () => {
    // The page passes the persisted tc.v1.progress.worldEvil straight into the map (store → prop);
    // the store's write path is covered in src/app/progress.test.ts.
    const input = layoutInputs(graph)
    const options = MAP_LAYOUT_OPTIONS.vertical
    const layout = layoutGraph(input.nodes, input.edges, input.groups, options)
    const renderMap = (worldEvil: WorldEvil | null) =>
      renderToStaticMarkup(
        createElement(NodeMap, {
          graph,
          layout,
          options,
          sprites,
          worldEvil,
          nodeStates: {},
          selectedId: null,
          detailsId: 'details',
          minZoom: 0.3,
          initialZoom: 0.85,
          startId: 'pre-hardmode',
          bandLabel: (band: number) => String(band),
          onSelect: () => {},
        }),
      )
    const branch = (html: string, member: string) =>
      new RegExp(`data-edge-role="branch" data-edge-type="([a-z-]+)"[^>]*data-member="${member}" data-in-play="(true|false)"`).exec(html)?.slice(1)
    const inPlay = (html: string, id: string) => new RegExp(`data-node-id="${id}"[^>]*data-in-play="(true|false)"`).exec(html)?.[1]
    const state = (w: WorldEvil | null) => {
      const html = renderMap(w)
      return {
        nodes: [inPlay(html, 'eater-of-worlds'), inPlay(html, 'brain-of-cthulhu')],
        branches: [branch(html, 'eater-of-worlds'), branch(html, 'brain-of-cthulhu')],
      }
    }
    // "Both": a symmetric fork — both members on alternative-route branches, neither dimmed
    expect(state(null)).toEqual({ nodes: ['true', 'true'], branches: [['alternative-route', 'true'], ['alternative-route', 'true']] })
    expect(state('corruption')).toEqual({ nodes: ['true', 'false'], branches: [['recommended-next', 'true'], ['alternative-route', 'false']] })
    expect(state('crimson')).toEqual({ nodes: ['false', 'true'], branches: [['alternative-route', 'false'], ['recommended-next', 'true']] })
    // Out-of-play nodes are dimmed AND dashed (never colour alone).
    expect(renderMap('crimson')).toMatch(/data-node-id="eater-of-worlds"[^>]*class="[^"]*\bborder-dashed opacity-45\b/)
    // "Both" dims neither member (the symmetric fork); a chosen world dims the other one only
    expect(renderMap(null)).not.toMatch(/data-node-id="(eater-of-worlds|brain-of-cthulhu)"[^>]*class="[^"]*\bopacity-45\b/)
  })

  it('node labels: the short map label is drawn, wrapped between words only; the full name is the accessible name', () => {
    const html = renderWorkspace()
    const button = /<button[^>]*data-node-id="all-mechanical-bosses"[^>]*>[\s\S]*?<\/button>/.exec(html)![0]
    expect(button).toContain('aria-label="All mechanical bosses defeated"')
    expect(button).toMatch(/<span aria-hidden="true" class="[^"]*\bwrap-normal\b[^"]*" data-node-label="">All mech bosses<\/span>/)
    // every node label opts out of the global overflow-wrap:anywhere
    expect(html.match(/data-node-label=""/g)).toHaveLength(raw.nodes.length)
    expect([...html.matchAll(/<span aria-hidden="true" class="([^"]*)" data-node-label="">/g)].every((m) => m[1].split(' ').includes('wrap-normal'))).toBe(true)
    // the world tag uses the type scale (text-xs), not an off-scale 10px size
    expect(html).toMatch(/>Corruption<\/span>/)
    expect(html).not.toContain('text-[0.625rem]')
  })

  it('zoom controls: a column on the vertical map; a row along the bottom edge on the horizontal one', () => {
    expect(renderWorkspace()).toContain('data-map-controls="column"')
    const input = layoutInputs(graph)
    const options = MAP_LAYOUT_OPTIONS.horizontal
    const html = renderToStaticMarkup(
      createElement(NodeMap, {
        graph,
        layout: layoutGraph(input.nodes, input.edges, input.groups, options),
        options,
        sprites,
        worldEvil: null,
        nodeStates: {},
        selectedId: null,
        detailsId: 'details',
        minZoom: 0.3,
        initialZoom: 1,
        startId: 'pre-hardmode',
        bandLabel: (band: number) => String(band),
        onSelect: () => {},
        controlsRow: true,
      }),
    )
    expect(html).toContain('data-map-controls="row"')
    expect(html.match(/not-last:border-r-2/g)).toHaveLength(4)
    // the keyboard help names the layer as it is drawn: a column on the horizontal map, a row on the vertical
    expect(html).toContain('the up and down arrows step along a column.')
    expect(renderWorkspace()).toContain('the left and right arrows step along a row.')
  })

  it('the world-evil control is a labelled radio group with one checked option', () => {
    const html = renderToStaticMarkup(createElement(WorldEvilToggle, { value: 'corruption', onChange: () => {} }))
    expect(html).toContain('<legend')
    expect(html).toContain('World evil</legend>')
    expect([...html.matchAll(/data-world-evil="([a-z]+)"/g)].map((m) => m[1])).toEqual(['both', 'corruption', 'crimson'])
    expect(checkedWorldEvil(html)).toEqual(['corruption'])
  })
})

describe('NodeMapLegend (AC2)', () => {
  it('lists every edge type with its line sample, plus the node symbols', () => {
    const html = renderToStaticMarkup(createElement(NodeMapLegend, { titleId: 'legend-title' }))
    expect([...html.matchAll(/data-legend-edge="([a-z-]+)"/g)].map((m) => m[1])).toEqual([...EDGE_PRECEDENCE])
    for (const type of EDGE_PRECEDENCE) expect(html).toContain(EDGE_STYLES[type].label)
    expect([...html.matchAll(/data-legend-node="([a-z-]+)"/g)].map((m) => m[1])).toEqual(['boss', 'milestone', 'event', 'out-of-play'])
    expect(text(html)).not.toMatch(FORWARD_PROMISE)
  })

  it('on the real map, "early challenge possible" is shown as the map draws it: its badge on a required-gate line', () => {
    // (the page passes edgeLegendForms(graph); the SSR phone layout keeps the legend collapsed)
    const html = renderToStaticMarkup(createElement(NodeMapLegend, { titleId: 'legend-title', forms: edgeLegendForms(graph) }))
    const row = (type: string) => new RegExp(`<li data-legend-edge="${type}"[\\s\\S]*?</li>`).exec(html)![0]
    const early = row('early-challenge-possible')
    expect(early).toContain('data-edge-sample-host="required-gate"')
    expect(early).toContain('data-badge="required-gate"')
    expect(early).toContain('data-badge="early-challenge-possible"')
    // the sentence names the badge to look for (design review P5-S1)
    expect(text(early)).toContain('Shown as its lightning badge on a required gate line.')
    // every type that draws a line keeps its own sample
    for (const type of EDGE_PRECEDENCE.filter((t) => t !== 'early-challenge-possible')) expect(row(type)).not.toContain('data-edge-sample-host')
  })
})

describe('focus card from the real records (AC4: a node opens its details; no dead links)', () => {
  const render = (nodeId: string, props: Partial<Parameters<typeof BossFocusCard>[0]> = {}, g = graph) =>
    renderToStaticMarkup(
      createElement(BossFocusCard, {
        id: 'details',
        graph: g,
        nodeId,
        sprites,
        worldEvil: null,
        state: undefined,
        onClose: () => {},
        onJump: () => {},
        ...props,
      }),
    )

  it.each(raw.nodes.map((n) => [n.id, n]))('%s: name, stage, summon w/ source, display-only state, typed connections w/ sources, wiki link', (id, node) => {
    const html = render(id)
    expect(html).toContain(`>${node.name}</h2>`)
    expect(html).toContain(stageName(node.stage))
    expect(html).toContain('curated') // stage is curated overlay data (B33 wording)
    expect(html).toContain(STATE_LABEL['not-attempted'])
    expect(html).toContain(DISPLAY_ONLY_NOTE)
    expect(html).toContain(`href="${node.wikiUrl}"`)
    // Every link is external (the wiki) — never a local page that doesn't exist.
    expect(html).not.toMatch(/href="\//)
    const boss = node.bossId ? bosses.find((b) => b.id === node.bossId) : undefined
    if (boss?.summon.text) {
      expect(html).toContain('How to summon')
      expect(html).toContain(escaped(boss.summon.text))
      expect(html).toContain(`href="${boss.summon.sourceUrl}"`)
    } else {
      expect(html).not.toContain('How to summon')
    }
    const { before, after, alternatives } = connectionsOf(graph, id)
    for (const c of [...before, ...after, ...alternatives]) {
      expect(html).toContain(`data-connection="${attr(c.link.id)}"`)
      for (const e of c.link.edges) expect(html).toContain(`href="${e.sourceUrl}"`)
    }
  })

  it('world-evil nodes say which world they belong to, and when they are out of play', () => {
    expect(render('eater-of-worlds')).toContain('Corruption worlds only')
    expect(render('eater-of-worlds', { worldEvil: 'crimson' })).toContain('not your chosen world evil')
    expect(render('brain-of-cthulhu', { worldEvil: 'crimson' })).not.toContain('not your chosen world evil')
  })

  it('shows a stored state as stored (display only), and an unverified summon as Unknown', () => {
    expect(render('king-slime', { state: 'defeated' })).toContain(`>${STATE_LABEL.defeated}<`)
    const kingSlime = bosses.find((b) => b.id === 'king-slime')!
    const unverified: Boss = {
      ...kingSlime,
      summon: { ...kingSlime.summon, text: undefined, sourceUrl: undefined },
      _prov: { ...kingSlime._prov, unverifiedFields: [...kingSlime._prov.unverifiedFields, 'summon.text'] },
    }
    const g = buildMapGraph(raw, bosses.map((b) => (b.id === 'king-slime' ? unverified : b)))
    const html = render('king-slime', {}, g)
    expect(html).toContain('data-unknown-field="summon.text"')
    expect(html).toContain(`href="${kingSlime.wikiUrl}"`)
  })

  it('our own card copy makes no forward promise', () => {
    expect(DISPLAY_ONLY_NOTE).not.toMatch(FORWARD_PROMISE)
    for (const label of Object.values(STATE_LABEL)) expect(label).not.toMatch(FORWARD_PROMISE)
  })
})
