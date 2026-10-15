/* AMENDMENTS-016 B131(b): P6-S4 "Crafting Tree Viewer" is satisfied by the planner's tree IF the plan PREVIEW shows the
 * recursive tree before saving. This renders the real `/plan/new?item=:id` route (no plan saved) from the shipped
 * data and checks the preview carries the same recursive tree renderer (PlanTreeView, read-only) — every level of a
 * deep chain, alternatives, stations — and that its accessory / armor nodes link in-app (B131(b)). */
import { Tooltip } from 'radix-ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { loadPlanBase, resolvePlanGraph, type PlanBase } from './planData'
import PlanNewPage from './PlanNewPage'
import { usePlansStore } from './plansStore'
import { idOf } from './planTestData'
import { itemKey } from './planTree'

let base: PlanBase
const NE = idOf("Night's Edge")
const ANKH = idOf('Ankh Shield')
const ZENITH = idOf('Zenith')

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // the sprite manifest is fetched: absent under Node → placeholder art
  base = await loadPlanBase()
  // the preview's walk, loaded as the page's own loader does (so the route renders on its first frame)
  for (const id of [NE, ANKH, ZENITH]) await resolvePlanGraph(base, id, 1, {})
}, 120_000)

const preview = (id: number) =>
  renderToStaticMarkup(
    createElement(
      Tooltip.Provider,
      null,
      createElement(MemoryRouter, { initialEntries: [`/plan/new?item=${id}`] }, createElement(Routes, null, createElement(Route, { path: '/plan/new', element: createElement(PlanNewPage) }))),
    ),
  )
const nodes = (html: string) => [...html.matchAll(/data-plan-node="([^"]+)"/g)].map((m) => m[1])

describe('B131(b): the plan preview shows the recursive crafting tree BEFORE saving (P6-S4 via the planner)', () => {
  it("Night's Edge: the preview (no plan saved) renders the tree — goal → swords → bars → ores, open, read-only", async () => {
    const before = usePlansStore.getState().plans.length
    const html = preview(NE)
    expect(html).toContain(`data-plan-preview="${NE}"`)
    expect(html).toContain('data-plan-tree=""')
    const keys = nodes(html)
    // the recursion reaches the raw materials, several levels down (Night's Edge → Muramasa/Blade of Grass/… → bars → ores)
    for (const name of ["Night's Edge", 'Muramasa', 'Demonite Bar', 'Demonite Ore', 'Hellstone Bar']) expect(keys, name).toContain(itemKey(idOf(name)))
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-label="What goes into Night&#x27;s Edge"/)
    // read-only: no way chooser in the preview; "Make My Plan" saves it
    expect(html).not.toContain('data-choose=')
    expect(html).toContain('data-make-plan=""')
    expect(usePlansStore.getState().plans.length).toBe(before) // rendering the preview saved nothing
  })

  it('a deep chain (Zenith) renders completely in the preview — its ten swords and what they are made of', () => {
    const html = preview(ZENITH)
    const keys = nodes(html)
    expect(keys.length).toBeGreaterThan(25)
    const swords = ['Terra Blade', 'Meowmere', 'Star Wrath', 'Influx Waver', "The Horseman's Blade", 'Seedler', 'Starfury', 'Enchanted Sword', 'Bee Keeper', 'Copper Shortsword']
    for (const name of swords) expect(keys, name).toContain(itemKey(idOf(name)))
    // and below them: Terra Blade's own parts (a third level)
    expect(keys).toContain(itemKey(idOf("True Night's Edge")))
  })

  it('an accessory goal (Ankh Shield): the combination chain is in the preview tree, and its accessory nodes link their pages in-app (B131(b))', () => {
    const html = preview(ANKH)
    const keys = nodes(html)
    for (const name of ['Ankh Shield', 'Ankh Charm', 'Obsidian Shield', 'Cobalt Shield', 'Medicated Bandage']) expect(keys, name).toContain(itemKey(idOf(name)))
    expect(html).toContain(`href="/accessories/${idOf('Ankh Charm')}"`)
    expect(html).not.toMatch(/href="https:\/\/terraria\.wiki\.gg\/wiki\/Ankh_Charm"/)
  })
})
