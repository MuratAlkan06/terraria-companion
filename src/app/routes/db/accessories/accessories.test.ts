/* Accessory database (PRD P6-S2 AC1–AC3; AMENDMENTS-016 B131(b)): filters (category / stage / name), effects incl. the
 * B54 kinds, which classes the effects count for, the combination tree from the RECIPES (alternatives as "or", every
 * node a link — the Ankh Shield chain), and every accessory page server-rendered from the shipped data through the
 * app's own loaders (Unknown markers ⇄ badge, no dead links, Unknown-heavy, AC3 verified-with-source-or-Unknown) —
 * and the copy audit. */
import { Tooltip } from 'radix-ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { loadRecipeIndex } from '../../../../data-access'
import type { Accessory, RecipeIndex } from '../../../../data-access/types'
import { auditCopy } from '../../../../scoring/copyAudit'
import { APP_ROUTES } from '../../../routes'
import { resolveArmorId } from '../armor/armorModel'
import { loadArmorData } from '../armor/armorData'
import AccessoriesListPage from './AccessoriesListPage'
import * as copy from './accessoryCopy'
import { loadAccessoryData, loadAccessorySections, type AccessoryData } from './accessoryData'
import AccessoryDetailPage from './AccessoryDetailPage'
import {
  buildAccessoryFacets,
  categoryBuckets,
  combinationTree,
  comboNodeCount,
  EMPTY_ACCESSORY_FILTERS,
  loadoutFit,
  matchesAccessory,
  parseAccessoryFilters,
  toggleAccessoryFilter,
  upgradeTree,
  writeAccessoryFilters,
  type ComboNode,
} from './accessoryModel'
import { accessoryHref } from './accessoryNav'

let data: AccessoryData
let recipes: RecipeIndex
let armor: Awaited<ReturnType<typeof loadArmorData>>
const byName = (name: string): Accessory => {
  const a = data.list.find((x) => x.name === name)
  if (!a) throw new Error(`fixture accessory missing: ${name}`)
  return a
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // the sprite manifest is fetched: absent under Node → placeholder art
  data = await loadAccessoryData()
  armor = await loadArmorData()
  recipes = await loadRecipeIndex()
  // warm every page's sections, so each renders on its first frame (as on back navigation)
  await Promise.all(data.list.map((a) => loadAccessorySections(a)))
}, 120_000)

const renderAt = (path: string) =>
  renderToStaticMarkup(
    createElement(
      Tooltip.Provider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: '/accessories', element: createElement(AccessoriesListPage) }), createElement(Route, { path: '/accessories/:id', element: createElement(AccessoryDetailPage) })),
      ),
    ),
  )
const markers = (html: string) => [...html.matchAll(/data-unknown-field="([^"]+)"/g)].map((m) => m[1])
const badgeCount = (html: string) => {
  const m = /show which (?:(\d+) values are|value is) unknown/.exec(html)
  return m ? (m[1] ? Number(m[1]) : 1) : 0
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const ownWords = (html: string) => text(html.replace(/<span data-wiki-text=""[^>]*>[^<]*<\/span>/g, ' ')).replace(/\(not yet verified(, show details)?\)/g, ' ')
const src = () => ({ accessories: data.accessories, recipes: recipes.byId, groups: recipes.groups })

describe('data and filters (AC1: list / filter by category and stage)', () => {
  it('352 accessories; the curated categories plus "Unknown" (chip "Category: Unknown") for the four the data leaves unverified', () => {
    expect(data.list).toHaveLength(352)
    const unknown = data.list.filter((a) => categoryBuckets(a).includes('unknown'))
    expect(unknown.map((a) => a.name).sort()).toEqual(['Chaos Cylinder', 'Clothier Voodoo Doll', 'Guide Voodoo Doll', 'Razortip'])
    const facets = buildAccessoryFacets(data.list, EMPTY_ACCESSORY_FILTERS)
    expect(facets.find((f) => f.id === 'category')?.options.map((o) => o.value)).toEqual(['mobility', 'defense', 'offense', 'utility', 'unknown'])
    // the facet's own label says "Category": the unknown bucket never reads "Category: Category unknown"
    expect(facets.find((f) => f.id === 'category')?.options.at(-1)?.label).toBe('Unknown')
    expect(facets.find((f) => f.id === 'stage')?.options.reduce((n, o) => n + o.count, 0)).toBe(352)
  })

  it('URL state: parse / write / toggle; an accessory in two categories matches either', () => {
    const f = parseAccessoryFilters(new URLSearchParams('category=offense,bogus,mobility&stage=unknown&q= boots '))
    expect(f).toEqual({ category: ['mobility', 'offense'], stage: ['unknown'], q: 'boots' })
    expect(writeAccessoryFilters(new URLSearchParams(), f).toString()).toBe('category=mobility%2Coffense&stage=unknown&q=boots')
    expect(toggleAccessoryFilter(f, 'category', 'offense').category).toEqual(['mobility'])
    const two = data.list.find((a) => categoryBuckets(a).length === 2)!
    for (const c of categoryBuckets(two)) expect(matchesAccessory(two, { ...EMPTY_ACCESSORY_FILTERS, category: [c] })).toBe(true)
  })

  it('the list: filters narrow by category and stage (counted per option); zero results is the designed empty state (the window-virtualized rows render in the browser only)', () => {
    const mobility = data.list.filter((a) => matchesAccessory(a, { ...EMPTY_ACCESSORY_FILTERS, category: ['mobility'] }))
    expect(mobility.length).toBe(buildAccessoryFacets(data.list, EMPTY_ACCESSORY_FILTERS).find((f) => f.id === 'category')?.options.find((o) => o.value === 'mobility')?.count)
    expect(mobility.every((a) => categoryBuckets(a).includes('mobility'))).toBe(true)
    const empty = renderAt('/accessories?q=zzzz')
    expect(empty).toContain(copy.EMPTY_TITLE)
    expect(text(empty)).toContain('Showing 0 of 352 accessories')
  })
})

describe('effects (AC1 exact effects incl. B54 kinds; AC3 verified-with-source or Unknown)', () => {
  it('B54 kinds in the builder’s words: fishing power, whip tag slots, lava immunity, reach, potion cooldown, armor penetration', () => {
    const cases: [string, RegExp][] = [
      ['Angler Earring', /\+10 fishing power/],
      ['Lava Charm', /\+420 ticks \(7 seconds\) of lava immunity/], // ticks with seconds, the wing pages' pattern
      ['Toolbelt', /\+1 tiles of reach|\+\d+ tiles of reach/],
      ["Philosopher's Stone", /−25% healing potion cooldown/],
      ['Shark Tooth Necklace', /\+5 armor penetration/],
      ['Silver Bracer', /\+\d+ whip tag slots?/],
    ]
    for (const [name, re] of cases) {
      const html = renderAt(accessoryHref(byName(name).id))
      expect(text(html), name).toMatch(re)
    }
    expect(text(renderAt(accessoryHref(byName('Lava Charm').id)))).toContain(copy.TICKS_NOTE)
  })

  it('wiki-text effects are quoted, each with its source; wings show flight time and an Unknown vertical speed (never 0)', () => {
    const ankh = renderAt(accessoryHref(byName('Ankh Shield').id))
    expect(ankh).toContain('“Grants immunity to knockback and fire blocks”')
    expect(text(ankh)).toContain('+5 defense')
    const wings = byName('Demon Wings')
    const html = renderAt(accessoryHref(wings.id))
    expect(text(html)).toContain(copy.flightTime(100))
    expect(html).toContain('data-unknown-field="wingStats.verticalSpeedTps"')
    // the wiki-text effect's source is the Wings article, not the item's own: linked beside it
    expect(html).toContain('href="https://terraria.wiki.gg/wiki/Wings"')
  })

  it('AC3: an accessory whose effects are unverified shows Unknown — never an invented effect; its class notes say why', () => {
    const razortip = byName('Razortip')
    const html = renderAt(accessoryHref(razortip.id))
    expect(markers(html)).toEqual(expect.arrayContaining(['categories', 'effects', 'stage', 'acquisition', 'gatedBy']))
    expect(html).toContain('data-fit="unknown"')
    expect(html).toContain('data-unknown-heavy=""')
    expect(loadoutFit(razortip)).toEqual({ kind: 'unknown' })
  })

  it('AC1 loadout notes: each effect under the class it counts for — explicit scope, implied scope (mana → magic), curated keyword match — else every class', () => {
    const fit = (name: string) => {
      const f = loadoutFit(byName(name))
      return f.kind === 'known' ? f.groups.map((g) => [g.scope ?? 'all', g.stats.length, g.specials.map((s) => s.curated)]) : f.kind
    }
    expect(fit('Ankh Shield')).toEqual([['all', 1, [false, false]]])
    expect(fit('Ranger Emblem')).toEqual([['ranged', 1, []]])
    const manaFlower = loadoutFit(byName('Mana Flower'))
    expect(manaFlower.kind === 'known' && manaFlower.groups.some((g) => g.scope === 'magic')).toBe(true)
    const html = renderAt(accessoryHref(byName('Ranger Emblem').id))
    expect(html).toContain('data-fit="ranged"')
    expect(text(html)).toContain('Ranged only')
  })
})

describe('AC2: an accessory with an upgrade path renders its full combination tree, every node clickable (the Ankh Shield chain)', () => {
  const ids = (node: ComboNode): number[] => [node.id, ...node.recipes.flatMap((r) => r.ingredients.flatMap((i) => (i.kind === 'accessory' ? ids(i.node) : [])))]

  it('Ankh Shield → Obsidian Shield (→ Cobalt Shield + Obsidian Skull) + Ankh Charm (→ five → their parts); every accessory node links its page', () => {
    const shield = byName('Ankh Shield')
    const tree = combinationTree(shield.id, src())
    const names = ids(tree).map((id) => data.accessories.get(id)?.name)
    for (const n of ['Obsidian Shield', 'Cobalt Shield', 'Obsidian Skull', 'Ankh Charm', 'Armor Bracing', 'Medicated Bandage', 'The Plan', 'Countercurse Mantra', 'Reflective Shades']) expect(names, n).toContain(n)
    expect(comboNodeCount(tree)).toBe(20)
    // a Shimmer transmutation (Armor Polish ⇄ Vitamins) is not a combination: those two are leaves here
    const polish = combinationTree(byName('Armor Polish').id, src())
    expect(polish.recipes).toEqual([])
    const html = renderAt(accessoryHref(shield.id))
    expect(html).toContain(`data-combination="${shield.id}"`)
    // the FULL tree is rendered (open), and every node but the page's own is a link to that accessory's page
    const rendered = [...html.matchAll(/data-combo-node="(\d+)"/g)].map((m) => Number(m[1]))
    expect(new Set(rendered)).toEqual(new Set(ids(tree)))
    for (const id of new Set(rendered)) {
      if (id === shield.id) continue
      const tag = new RegExp(`<a [^>]*data-tree-item="${id}"[^>]*>`).exec(html)?.[0] ?? ''
      expect(tag, String(id)).toContain(`href="/accessories/${id}"`)
    }
    // a real space between the name and the note (its accessible name reads "Ankh Shield (this accessory)")
    expect(html).toMatch(/Ankh Shield(?:<!-- -->)? <span[^>]*>\(this accessory\)<\/span>/)
    // each node with parts is collapsible in place: a 44px button, its state in aria-expanded
    expect(html).toMatch(/<button type="button" aria-expanded="true" aria-controls="[^"]+" aria-label="What Ankh Charm is combined from"/)
    // every toggle controls its OWN list (unique ids, even for an accessory repeated at one depth), which exists
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1])
    expect(controls.length).toBeGreaterThan(3)
    expect(new Set(controls).size).toBe(controls.length)
    for (const id of controls) expect(html, id).toContain(`<ul id="${id}"`)
    // names wrap between words at 375: an 18px level indent below md (34px from md), names never `overflow-wrap: anywhere`
    expect(html).toContain('class="mt-1 ml-2 space-y-1 md:ml-5"')
    expect(html).toContain('border-l-2 border-panel-border pl-2 md:pl-3')
    expect(html).toMatch(/<span class="min-w-0 wrap-break-word">Ankh Charm/)
  })

  it('alternative recipes are alternatives ("Recipe i of N", "or") — never one list that seems to need them all (Spectre Boots)', () => {
    const tree = combinationTree(byName('Spectre Boots').id, src())
    expect(tree.recipes).toHaveLength(4)
    expect(tree.recipes.every((r) => r.ingredients.filter((i) => i.kind === 'accessory').length === 2)).toBe(true)
    const html = renderAt(accessoryHref(byName('Spectre Boots').id))
    expect(text(html)).toContain('Recipe 1 of 4')
    expect(text(html)).toContain('or Recipe 2 of 4')
  })

  it('"Any …" groups list their members as links; what it combines into goes up the chain (Cobalt Shield → … → Ankh Shield)', () => {
    const balloons = combinationTree(byName('Bundle of Horseshoe Balloons').id, src())
    expect(balloons.recipes.some((r) => r.ingredients.some((i) => i.kind === 'group'))).toBe(true)
    const up = upgradeTree(byName('Cobalt Shield').id, data.accessories)
    const flat = (n: typeof up): string[] => [data.accessories.get(n.id)?.name ?? '', ...n.into.flatMap(flat)]
    expect(flat(up)).toEqual(expect.arrayContaining(['Obsidian Shield', 'Ankh Shield']))
    const html = renderAt(accessoryHref(byName('Cobalt Shield').id))
    expect(html).toContain('data-upgrade-tree=""')
    expect(html).toMatch(new RegExp(`href="/accessories/${byName('Ankh Shield').id}"`))
  })

  it('every combination tree is finite (a repeat stops at the repeat) and every node is an accessory record', () => {
    for (const a of data.list) {
      if (a.combinedFrom.length === 0) continue
      const tree = combinationTree(a.id, src())
      expect(comboNodeCount(tree), a.name).toBeLessThan(200)
      for (const id of ids(tree)) expect(data.accessories.has(id), `${a.name}: ${id}`).toBe(true)
    }
  })
})

describe('accessory pages (server-rendered from the shipped data)', () => {
  it('every accessory: Unknown markers ⇄ the partially-verified badge; no dead local link; AC3 — each wiki-text effect quoted with a source', () => {
    const routes = APP_ROUTES.map((r) => r.path)
    const mismatches: string[] = []
    const dead: string[] = []
    for (const a of data.list) {
      const html = renderAt(accessoryHref(a.id))
      if (markers(html).length !== badgeCount(html)) mismatches.push(`${a.name}: page ${markers(html).length}, badge ${badgeCount(html)}`)
      for (const e of a.effects) if (e.kind === 'special') expect(html, a.name).toContain(`“${e.text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')}”`)
      for (const [, href] of html.matchAll(/href="(\/[^"#]*)/g)) {
        const path = href.replace(/&amp;/g, '&').split('?')[0]
        const acc = /^\/accessories\/(\d+)$/.exec(path)
        const arm = /^\/armor\/(.+)$/.exec(path)
        const ok = acc ? data.accessories.has(Number(acc[1])) : arm ? resolveArmorId(arm[1], armor).kind !== 'none' : routes.some((p) => new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(path))
        if (!ok) dead.push(`${a.name} → ${href}`)
      }
    }
    expect(mismatches).toEqual([])
    expect(dead).toEqual([])
  })

  it('header: curated category, rarity, stage; the plan and Loadout Builder links; an unknown id is the styled 404', () => {
    const shield = byName('Ankh Shield')
    const html = renderAt(accessoryHref(shield.id))
    expect(html).toContain('data-category="defense"')
    expect(text(html)).toContain('curated')
    expect(html).toContain(`href="/plan/new?item=${shield.id}"`)
    expect(html).toContain(`href="/loadout?owned=${shield.id}"`)
    expect(html).toContain('id="acq-title"')
    const missing = renderAt('/accessories/999999')
    expect(missing).toContain('Lost in the caverns')
    expect(missing).toContain('href="/accessories"')
    expect(renderAt('/accessories/4956')).toContain('Lost in the caverns') // Zenith is a weapon, not an accessory
  })
})

describe('copy audit: no forward promise, no outcome / "best" wording', () => {
  it('in the copy module and on rendered pages (wiki quotes excluded)', () => {
    const strings = Object.values(copy).flatMap((v) => (typeof v === 'function' ? [String((v as (...a: unknown[]) => string)('1.4.5.8' as never, 3 as never)), String((v as (...a: unknown[]) => string)(1 as never, 2 as never))] : [String(v)]))
    for (const s of strings) expect(auditCopy(s), s).toBeUndefined()
    for (const name of ['Ankh Shield', 'Spectre Boots', 'Razortip', 'Demon Wings', 'Ranger Emblem', 'Cobalt Shield']) {
      expect(auditCopy(ownWords(renderAt(accessoryHref(byName(name).id)))), name).toBeUndefined()
    }
    expect(auditCopy(ownWords(renderAt('/accessories?q=zzzz')))).toBeUndefined()
  })
})
