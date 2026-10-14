import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../../../../public/sprites/manifest.json'
import { BossNode } from '../../../components/BossNode'
import { MapDrawing, NodeMap } from '../../../components/NodeMap'
import { NodeMapLegend } from '../../../components/NodeMapLegend'
import { CASCADE_LEAD_MS, crossPositions } from '../../../components/nodeMap/cascadeCamera'
import { EDGE_PRECEDENCE, EDGE_STYLES, GATE_MET } from '../../../components/nodeMap/edgeStyles'
import { buildScene } from '../../../components/nodeMap/scene'
import { buildMapGraph, connectionsOf, edgeLegendForms, layoutInputs, stageName, type WorldEvil } from '../../../components/nodeMap/graph'
import { layoutGraph } from '../../../components/nodeMap/layout'
import { MAP_LAYOUT_OPTIONS } from '../../../components/nodeMap/mapConfig'
import { createDataAccess } from '../../../data-access'
import type { Boss, ProgressionData, ProgressionEdge, ProgressionNode, SpriteIndex } from '../../../data-access/types'
import { BOSS_PAGE_IDS, hasBossPage } from '../../../schemas/bossPages'
import bossesJson from '../../../data/bosses.json'
import progressionJson from '../../../data/progression.json'
import { APP_ROUTES, hasRoute } from '../../routes'
import { heroActions } from '../home/heroActions'
import { canSkip, mapProgress, unlockSchedule, withLead } from '../../../components/nodeMap/progressView'
import { UndoToast } from '../../../components/UndoToast'
import { BossFocusCard } from './BossFocusCard'
import { BossMapWorkspace, WorldEvilToggle } from './BossMapPage'
import type { BossMapData } from './bossMapData'
import { DefeatControl } from './DefeatControl'
import * as copy from './focusCardCopy'
import { MARKER_NOTE, STATE_LABEL } from './focusCardCopy'

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

function renderWorkspace(focusId?: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BossMapWorkspace, { data, focusId })))
}

/** Local hrefs in the markup (links into this site). */
const localHrefs = (html: string) => [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])
const PAGE_HREF = new RegExp(`^/bosses/(${BOSS_PAGE_IDS.join('|')})$`)

describe('/bosses route registration (P5-S1)', () => {
  it('ships /bosses while the "What Should I Do Next?" hero button stays absent (its panel is P5-S5)', () => {
    expect(hasRoute('bosses')).toBe(true)
    expect(APP_ROUTES.find((r) => r.id === 'bosses')?.features ?? []).not.toContain('recommend')
    expect(heroActions().map((a) => a.label)).not.toContain('What Should I Do Next?')
  })
})

describe('BossMapWorkspace (SSR: phone layout, nothing persisted)', () => {
  it('AC1: a node tree, not a list — every node a button (or, with a page, a link) in progression order, typed edges, stage bands', () => {
    const html = renderWorkspace()
    const layout = (() => {
      const input = layoutInputs(graph)
      return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS.vertical)
    })()
    const ids = [...html.matchAll(/<(?:button|a)[^>]*data-node-id="([^"]+)"/g)].map((m) => m[1])
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

  it('AC4: no dead local links; the recommender stays absent (P5-S5); the toolbar’s overflow menu ships (P5-S4 reset)', () => {
    const html = renderWorkspace()
    for (const href of localHrefs(html)) expect(href).toMatch(PAGE_HREF)
    expect(html).not.toMatch(/What Should I Do Next/i)
    expect(html).toMatch(/<button[^>]*aria-label="More map options"[^>]*data-map-options=""/)
    expect(text(html)).not.toMatch(FORWARD_PROMISE)
  })

  it('P5-S1 AC4 / P5-S2 / P5-S3: a boss node is a link to its page; every event / milestone node stays a card button', () => {
    const html = renderWorkspace()
    for (const node of raw.nodes) {
      const element = new RegExp(`<(button|a)[^>]*data-node-id="${node.id}"[^>]*>`).exec(html)!
      expect(hasBossPage(node.id), node.id).toBe(node.kind === 'boss')
      if (hasBossPage(node.id)) {
        expect(element[1], node.id).toBe('a')
        expect(element[0]).toContain(`href="/bosses/${node.id}"`)
        expect(element[0]).not.toContain('aria-expanded')
      } else {
        expect(element[1], node.id).toBe('button')
        expect(element[0]).toContain('aria-expanded="false"')
      }
    }
    expect(html).toContain('Enter opens a node’s details, or its page when it has one.')
  })

  it('P5-S2 AC3: ?node=<id> opens the map on that node with its card open (a page node’s card links back to its page)', () => {
    const html = renderWorkspace('eye-of-cthulhu')
    expect(html).toContain('data-focus-card="eye-of-cthulhu"')
    const pageLink = /<a[^>]*data-page-link=""[^>]*>([^<]*)/.exec(html)
    expect(pageLink?.[0]).toContain('href="/bosses/eye-of-cthulhu"')
    expect(pageLink?.[1]).toBe('Open the Eye of Cthulhu page')
    // P5-S3: Hardmode bosses have pages too
    expect(/<a[^>]*data-page-link=""[^>]*>([^<]*)/.exec(renderWorkspace('plantera'))?.[0]).toContain('href="/bosses/plantera"')
    // a name that starts with "The" reads naturally ("Open The Twins page", never "the The Twins")
    expect(/<a[^>]*data-page-link=""[^>]*>([^<]*)/.exec(renderWorkspace('the-twins'))?.[1]).toBe('Open The Twins page')
    // events and milestones stay map markers (A3): the card, no page link
    const event = renderWorkspace('pumpkin-moon')
    expect(event).toContain('data-focus-card="pumpkin-moon"')
    expect(event).not.toContain('data-page-link')
    expect(/<button[^>]*data-node-id="pumpkin-moon"[^>]*>/.exec(event)?.[0]).toContain('aria-expanded="true"')
    // An unknown id is ignored: no card, the usual opening view.
    expect(renderWorkspace('not-a-node')).not.toContain('data-focus-card')
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
        nodeStates: {},
        onClose: () => {},
        onJump: () => {},
        ...props,
      }),
    )

  it.each(raw.nodes.map((n) => [n.id, n]))('%s: name, stage, summon w/ source, progress (boss: defeat control; marker: status), typed connections w/ sources, wiki link', (id, node) => {
    const html = render(id)
    expect(html).toContain(`>${node.name}</h2>`)
    expect(html).toContain(stageName(node.stage))
    expect(html).toContain('curated') // stage is curated overlay data (B33 wording)
    if (node.kind === 'boss') {
      // P5-S4: the three-state control (Skipped only for optional bosses), nothing checked but "Not attempted"
      expect(html).toContain(`data-defeat-control="${id}"`)
      expect(html).toContain(STATE_LABEL['not-attempted'])
      expect(html).toMatch(/<input type="radio" data-defeat-option="not-attempted"[^>]*checked=""/)
      expect(html).not.toContain(MARKER_NOTE)
    } else {
      // milestones and events follow the bosses that gate them: a status, no control
      expect(html).not.toContain('data-defeat-control')
      expect(html).toContain('data-node-status="')
      expect(html).toContain(MARKER_NOTE)
    }
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

  it('shows a stored state as stored (its option checked), and an unverified summon as Unknown', () => {
    expect(render('king-slime', { nodeStates: { 'king-slime': 'defeated' } })).toMatch(/<input type="radio" data-defeat-option="defeated"[^>]*checked=""/)
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

  it('our own card / reset copy makes no forward promise', () => {
    const strings = Object.values(copy).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'object' ? Object.values(v) : []))
    for (const label of [...strings, copy.resetDescription(2), copy.lockedNote(['Hardmode']), copy.stateAnnouncement('Plantera', 'defeated', ['Golem'], false)]) {
      expect(label).not.toMatch(FORWARD_PROMISE)
    }
  })
})

describe('P5-S4 defeat tracking on the map', () => {
  const input = layoutInputs(graph)
  const options = MAP_LAYOUT_OPTIONS.vertical
  const layout = layoutGraph(input.nodes, input.edges, input.groups, options)
  const renderMap = (nodeStates: Record<string, 'defeated' | 'skipped'>, cascadeBaseline?: Record<string, 'defeated' | 'skipped'>) =>
    renderToStaticMarkup(
      createElement(NodeMap, {
        graph,
        layout,
        options,
        sprites,
        worldEvil: null,
        nodeStates,
        cascadeBaseline,
        selectedId: null,
        detailsId: 'details',
        minZoom: 0.3,
        initialZoom: 0.85,
        startId: 'pre-hardmode',
        bandLabel: (band: number) => String(band),
        onSelect: () => {},
      }),
    )
  const nodeTag = (html: string, id: string) => new RegExp(`<(?:a|button)[^>]*data-node-id="${id}"[^>]*>`).exec(html)![0]
  const nodeMarkup = (html: string, id: string) => new RegExp(`<(a|button)[^>]*data-node-id="${id}"[\\s\\S]*?</(a|button)>`).exec(html)![0]
  const edgeTag = (html: string, linkId: string) => new RegExp(`<path [^>]*data-link-id="${escaped(linkId)}"[^>]*>`).exec(html)![0]
  const delay = (tag: string) => /animation-delay:(\d+)ms/.exec(tag)?.[1]

  it('AC2: statuses drawn per node and line — glyph + words, never colour alone', () => {
    const html = renderMap({ 'wall-of-flesh': 'defeated' })
    expect(nodeTag(html, 'wall-of-flesh')).toContain('data-status="defeated"')
    expect(nodeTag(html, 'hardmode')).toContain('data-status="reached"')
    expect(nodeTag(html, 'the-twins')).toContain('data-status="recommended"')
    expect(nodeTag(html, 'plantera')).toContain('data-status="locked"')
    expect(nodeTag(html, 'plantera')).toMatch(/class="[^"]*\bopacity-60\b/)
    expect(nodeMarkup(html, 'plantera')).toContain('data-status-glyph="locked"')
    expect(nodeMarkup(html, 'the-twins')).toContain('data-status-glyph="recommended"')
    expect(nodeMarkup(html, 'wall-of-flesh')).toContain('data-status-glyph="defeated"')
    // the status in words leads each node's description
    expect(html).toContain('<span id="map-node-desc-plantera" hidden="">Locked: needs Skeletron Prime, The Destroyer, The Twins. Boss, Mid-Hardmode.')
    expect(html).toContain('<span id="map-node-desc-the-twins" hidden="">Recommended next. Boss, Early Hardmode.')
    // lines: subdued while locked, open once their gate is
    expect(edgeTag(html, 'hardmode->the-twins')).toContain('data-edge-status="idle"')
    expect(edgeTag(html, 'all-mechanical-bosses->plantera')).toContain('data-edge-status="locked"')
    expect(edgeTag(html, 'all-mechanical-bosses->plantera')).toContain('opacity:0.3')
    // a fresh map: every Hardmode line locked; the start's recommended-next line glows
    const fresh = renderMap({})
    expect(edgeTag(fresh, 'hardmode->the-twins')).toContain('data-edge-status="locked"')
    expect(fresh).toContain('data-edge-halo="pre-hardmode-&gt;eye-of-cthulhu"')
    expect(fresh).not.toContain('data-unlock')
  })

  it('H1: a cascade waits for the camera — until the map is measured and has framed it, the last-shown state stays drawn', () => {
    // (server render: the map is never measured, so the cascade stays pending)
    const html = renderMap({ 'wall-of-flesh': 'defeated' }, {})
    expect(nodeTag(html, 'wall-of-flesh')).toContain('data-defeat-state="not-attempted"')
    expect(nodeTag(html, 'hardmode')).toContain('data-status="locked"')
    expect(edgeTag(html, 'hardmode->the-twins')).toContain('data-edge-status="locked"')
    expect(html).not.toContain('data-unlock')
    expect(html).toContain('<span id="map-node-desc-hardmode" hidden="">Locked: needs Wall of Flesh.')
    // no baseline (or nothing changed since it): the current states, no cascade
    expect(nodeTag(renderMap({ 'wall-of-flesh': 'defeated' }), 'wall-of-flesh')).toContain('data-defeat-state="defeated"')
    expect(renderMap({ 'wall-of-flesh': 'defeated' }, { 'wall-of-flesh': 'defeated' })).not.toContain('data-unlock')
  })

  it('UX §12 + M1/M2: once framed, the cascade plays after the camera’s lead — ring, link, Hardmode, then the fan rippling along its row; Plantera untouched', () => {
    const after = mapProgress(graph, { 'wall-of-flesh': 'defeated' }, null)
    const cascade = withLead(unlockSchedule(graph, mapProgress(graph, {}, null), after, { position: crossPositions(layout) }), CASCADE_LEAD_MS)
    const svg = renderToStaticMarkup(createElement(MapDrawing, { layout, scene: buildScene(graph, layout, null), progress: after, cascade }))
    const node = (id: string, state?: 'defeated') =>
      renderToStaticMarkup(
        createElement(BossNode, {
          node: graph.nodeById.get(id)!,
          box: layout.nodes.get(id)!,
          sprites,
          inPlay: true,
          selected: false,
          state,
          status: after.nodes.get(id),
          unlock: cascade.nodes.get(id),
          describedBy: 'd',
          controls: 'c',
          hit: { x: 0, y: 0 },
          onSelect: () => {},
        }),
      )
    const lead = CASCADE_LEAD_MS
    expect(node('wall-of-flesh', 'defeated')).toMatch(new RegExp(`data-unlock="ring"[^>]*style="animation-delay:${lead}ms"`))
    expect(delay(edgeTag(svg, 'wall-of-flesh->hardmode'))).toBe(String(lead + 50))
    expect(nodeTag(node('hardmode'), 'hardmode')).toContain('data-unlock="node"')
    expect(delay(nodeTag(node('hardmode'), 'hardmode'))).toBe(String(lead + 100))
    const fan = ['queen-slime', 'the-twins', 'the-destroyer', 'skeletron-prime', 'duke-fishron', 'pirate-invasion', 'solar-eclipse'].sort(
      (a, b) => layout.nodes.get(a)!.x - layout.nodes.get(b)!.x,
    )
    fan.forEach((id, i) => {
      expect(delay(edgeTag(svg, `hardmode->${id}`)), id).toBe(String(lead + 150 + 25 * i))
      expect(delay(nodeTag(node(id), id)), id).toBe(String(lead + 200 + 25 * i))
      expect(nodeTag(node(id), id)).toMatch(/motion-safe:animate-unlock-node motion-reduce:animate-unlock-fade/)
      // the lock lifts away as the node opens
      expect(node(id)).toMatch(/data-status-glyph="locked" data-unlock="glyph"[^>]*animate-lock-release/)
    })
    expect(cascade.nodes.has('plantera')).toBe(false)
    expect(edgeTag(svg, 'all-mechanical-bosses->plantera')).not.toContain('data-unlock')
  })

  it('M3: a required gate’s padlock badge shows only while the gate is unmet — once met, a check; mid-cascade the padlock fades into it', () => {
    const badge = (html: string, linkId: string) => new RegExp(`<g data-badge-link="${escaped(linkId)}"[\\s\\S]*?data-badge="required-gate" data-gate="(met|closed)"`).exec(html)?.[1]
    const fresh = renderMap({})
    expect(badge(fresh, 'wall-of-flesh->hardmode')).toBe('closed')
    expect(badge(fresh, 'hardmode->the-twins')).toBe('closed')
    const wof = renderMap({ 'wall-of-flesh': 'defeated' })
    for (const id of ['the-twins', 'queen-slime', 'duke-fishron']) expect(badge(wof, `hardmode->${id}`), id).toBe('met')
    expect(badge(wof, 'wall-of-flesh->hardmode')).toBe('met')
    expect(badge(wof, 'all-mechanical-bosses->plantera')).toBe('closed') // still to do
    // Duke Fishron's line keeps its lightning badge beside the check
    expect(/<g data-badge-link="hardmode-&gt;duke-fishron"[\s\S]*?<\/g><\/g><\/g>/.exec(wof)?.[0]).toContain('data-badge="early-challenge-possible"')
    // met gates draw the small check, never the padlock
    const met = /<g data-badge-link="hardmode-&gt;the-twins"[\s\S]*?data-gate="met">([\s\S]*?)<\/g><\/g>/.exec(wof)![1]
    expect(met).toContain('data-gate-met=""')
    expect(met).not.toContain('lucide-lock')
    // during a cascade: both, the padlock fading out as the check fades in, at the line's delay
    const after = mapProgress(graph, { 'wall-of-flesh': 'defeated' }, null)
    const cascade = unlockSchedule(graph, mapProgress(graph, {}, null), after)
    const svg = renderToStaticMarkup(createElement(MapDrawing, { layout, scene: buildScene(graph, layout, null), progress: after, cascade }))
    const swap = /<g data-badge-link="hardmode-&gt;the-twins"[\s\S]*?data-gate="met">([\s\S]*?)<\/g><\/g><\/g>/.exec(svg)![1]
    expect(swap).toMatch(/<g data-unlock="gate" class="animate-lock-fade" style="animation-delay:150ms">[\s\S]*lucide-lock/)
    expect(swap).toMatch(/<g data-unlock="gate" class="animate-unlock-glow" style="animation-delay:150ms"><g [^>]*data-gate-met=""/)
  })

  it('AC1: the card’s control offers Skipped only for optional bosses (and keeps it for a node already marked skipped)', () => {
    const offered = raw.nodes
      .filter((n) => n.kind === 'boss')
      .filter((n) => renderToStaticMarkup(createElement(BossFocusCard, { id: 'd', graph, nodeId: n.id, sprites, worldEvil: null, nodeStates: {}, onClose: () => {}, onJump: () => {} })).includes('data-defeat-option="skipped"'))
      .map((n) => n.id)
      .sort()
    expect(offered).toEqual(['deerclops', 'duke-fishron', 'empress-of-light', 'king-slime', 'queen-bee', 'queen-slime'])
    for (const id of offered) expect(canSkip(graph, id), id).toBe(true)
    for (const id of ['wall-of-flesh', 'the-twins', 'moon-lord', 'eye-of-cthulhu', 'eater-of-worlds']) expect(canSkip(graph, id), id).toBe(false)
    const legacy = renderToStaticMarkup(createElement(BossFocusCard, { id: 'd', graph, nodeId: 'plantera', sprites, worldEvil: null, nodeStates: { plantera: 'skipped' }, onClose: () => {}, onJump: () => {} }))
    expect(legacy).toMatch(/data-defeat-option="skipped"[^>]*checked=""/)
  })

  it('a locked boss says which gates the map waits for; a marker card shows its status from its gates', () => {
    const card = (nodeId: string, nodeStates: Record<string, 'defeated'>) =>
      renderToStaticMarkup(createElement(BossFocusCard, { id: 'd', graph, nodeId, sprites, worldEvil: null, nodeStates, onClose: () => {}, onJump: () => {} }))
    // milestone gates are expanded into the bosses to mark
    expect(card('plantera', { 'wall-of-flesh': 'defeated' })).toContain(escaped(copy.lockedNote(['Skeletron Prime', 'The Destroyer', 'The Twins'])))
    expect(card('queen-slime', {})).toContain(escaped(copy.lockedNote(['Wall of Flesh'])))
    expect(card('plantera', { 'wall-of-flesh': 'defeated', 'the-twins': 'defeated', 'the-destroyer': 'defeated', 'skeletron-prime': 'defeated' })).not.toContain('data-locked-note')
    expect(card('hardmode', {})).toContain('data-node-status="locked"')
    expect(card('hardmode', {})).toContain(escaped(copy.lockedNote(['Wall of Flesh'])))
    expect(card('hardmode', { 'wall-of-flesh': 'defeated' })).toContain('data-node-status="reached"')
    expect(card('all-mechanical-bosses', { 'wall-of-flesh': 'defeated', 'the-twins': 'defeated', 'the-destroyer': 'defeated', 'skeletron-prime': 'defeated' })).toContain('data-node-status="reached"')
  })

  it('AC3 copy: the confirmation names the count and the unaffected data; the undo toast is a polite status with its one action', () => {
    expect(copy.resetDescription(1)).toBe('This clears defeat tracking for 1 boss. Saved builds and plans are not affected.')
    expect(copy.resetDescription(4)).toBe('This clears defeat tracking for 4 bosses. Saved builds and plans are not affected.')
    expect(copy.UNDO_WINDOW_MS).toBe(6000)
    const open = renderToStaticMarkup(createElement(UndoToast, { open: true, message: copy.resetDone(4), undoLabel: copy.UNDO_LABEL, onUndo: () => {}, onClose: () => {}, durationMs: copy.UNDO_WINDOW_MS }))
    expect(open).toMatch(/<div role="status"[^>]*><div data-undo-toast=""/)
    expect(open).toContain('Defeat tracking cleared for 4 bosses.')
    expect(open).toMatch(/<button type="button" data-undo-action=""[^>]*>[\s\S]*Undo<\/button>/)
    const closed = renderToStaticMarkup(createElement(UndoToast, { open: false, message: '', undoLabel: copy.UNDO_LABEL, onUndo: () => {}, onClose: () => {}, durationMs: copy.UNDO_WINDOW_MS }))
    expect(closed).toMatch(/<div role="status" class="w-full max-w-sm"><\/div>/)
  })

  it('announcements name the state and what it opened (screen-reader equivalent of the cascade)', () => {
    expect(copy.stateAnnouncement('Wall of Flesh', 'defeated', ['Hardmode', 'Queen Slime', 'The Twins'], true)).toBe('Wall of Flesh marked defeated. Now open: Hardmode, Queen Slime and The Twins.')
    expect(copy.stateAnnouncement('King Slime', 'skipped', [], true)).toBe('King Slime marked skipped.')
    expect(copy.stateAnnouncement('King Slime', null, [], false)).toBe(`King Slime marked not attempted. ${copy.UNSAVED_NOTE}`)
  })

  it('the legend explains every progress state with its glyph', () => {
    const html = renderToStaticMarkup(createElement(NodeMapLegend, { titleId: 'legend-title' }))
    expect([...html.matchAll(/data-legend-status="([a-z-]+)"/g)].map((m) => m[1])).toEqual(['defeated', 'skipped', 'recommended', 'locked'])
    expect(text(html)).not.toMatch(FORWARD_PROMISE)
  })

  it('M3 legend: right after the required gate (its padlock), the met gate with its check — drawn as the map draws it', () => {
    const html = renderToStaticMarkup(createElement(NodeMapLegend, { titleId: 'legend-title', forms: edgeLegendForms(graph) }))
    expect([...html.matchAll(/data-legend-(?:edge|gate)="([a-z-]+)"/g)].map((m) => m[1]).slice(0, 3)).toEqual(['required-gate', 'met', 'recommended-next'])
    const met = /<li data-legend-gate="met"[\s\S]*?<\/li>/.exec(html)![0]
    expect(met).toContain('data-edge-sample-gate="met"')
    expect(met).toContain('data-gate-met=""')
    expect(met).not.toContain('lucide-lock')
    expect(text(met)).toContain(`${GATE_MET.label} ${GATE_MET.description}`)
    expect(/<li data-legend-edge="required-gate"[\s\S]*?<\/li>/.exec(html)![0]).toContain('lucide-lock')
  })

  it('M4: the chosen progress option is never colour alone — whichever it is, its segment is filled and leads with a check; the rest are outline-only', () => {
    const segments = (state: 'defeated' | 'skipped' | undefined) => {
      const html = renderToStaticMarkup(createElement(DefeatControl, { graph, nodeId: 'king-slime', worldEvil: null, nodeStates: state ? { 'king-slime': state } : {} }))
      return [...html.matchAll(/<label data-chosen="(true|false)" class="([^"]*)">([\s\S]*?)<\/label>/g)].map((m) => ({
        chosen: m[1] === 'true',
        className: m[2],
        option: /data-defeat-option="([a-z-]+)"/.exec(m[3])![1],
        checked: /<input[^>]*checked=""/.test(m[3]),
        glyph: m[3].includes('data-chosen-glyph=""'),
      }))
    }
    for (const [state, option] of [[undefined, 'not-attempted'], ['defeated', 'defeated'], ['skipped', 'skipped']] as const) {
      const all = segments(state)
      expect(all.map((s) => s.option)).toEqual(['not-attempted', 'defeated', 'skipped'])
      for (const s of all) {
        const isChosen = s.option === option
        expect([s.chosen, s.checked, s.glyph], `${option}: ${s.option}`).toEqual([isChosen, isChosen, isChosen])
        // chosen: a fill; the rest: no fill (the control's outline only)
        if (isChosen) expect(s.className).toMatch(/\bbg-(night-600|gold-700\/60)\b/)
        else expect(s.className).toMatch(/\bbg-transparent\b/)
      }
    }
  })

  it('H1 copy: when the card closes for the cascade, its announcement goes with it — the page repeats it and says why', () => {
    expect(copy.cascadeUncoverAnnouncement({ name: 'Wall of Flesh', state: 'defeated' }, ['Hardmode', 'Queen Slime'], true)).toBe(
      `Wall of Flesh marked defeated. Now open: Hardmode and Queen Slime. ${copy.CARD_CLOSED_FOR_CASCADE}`,
    )
    // a deep link's card (marked on the boss page): what opened, then why
    expect(copy.cascadeUncoverAnnouncement(null, ['Hardmode'], true)).toBe(`Now open: Hardmode. ${copy.CARD_CLOSED_FOR_CASCADE}`)
    expect(copy.cascadeUncoverAnnouncement(null, [], true)).toBe(copy.CARD_CLOSED_FOR_CASCADE)
    expect(copy.cascadeUncoverAnnouncement({ name: 'Plantera', state: 'defeated' }, [], false)).toBe(`Plantera marked defeated. ${copy.UNSAVED_NOTE} ${copy.CARD_CLOSED_FOR_CASCADE}`)
    expect(copy.CARD_CLOSED_FOR_CASCADE).not.toMatch(FORWARD_PROMISE)
  })
})
