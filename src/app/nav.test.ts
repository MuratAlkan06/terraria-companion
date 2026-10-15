import { House } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { HEADER_INLINE_MAX, headerNavLayout, navItemsFor, TAB_BAR_MAX, tabBarLayout } from './nav'
import { APP_ROUTES, type AppRoute, type NavSurface } from './routes'

const SURFACES: NavSurface[] = ['header', 'tabbar', 'more', 'footer']
const Stub = () => null

function route(id: string, surfaces: NavSurface[], order: number): AppRoute {
  return { id, path: `/${id}`, Component: Stub, nav: { label: id, icon: House, surfaces, order } }
}

describe('route registry + data-driven nav', () => {
  it('has unique ids and paths', () => {
    expect(new Set(APP_ROUTES.map((r) => r.id)).size).toBe(APP_ROUTES.length)
    expect(new Set(APP_ROUTES.map((r) => r.path)).size).toBe(APP_ROUTES.length)
  })

  it('only ever links to registered routes (no dead nav items)', () => {
    const registered = new Set(APP_ROUTES.map((r) => r.path))
    for (const surface of SURFACES) {
      for (const item of navItemsFor(surface)) expect(registered.has(item.to)).toBe(true)
    }
  })

  it('P4-S2 / P6 / P7-S2 / P7-S2b nav: Weapons + Lab + Bosses in header and tab bar, Home in the tab bar only (B123h); Loadout, Compare, Readiness, Plans, Items, Armor, Accessories, Guides and Builds in header + More; Favorites, Your data and Licensing in More + footer', () => {
    // AMENDMENTS-015 B96b: Readiness has a desktop entry (the header's "More" menu, after Bosses);
    // AMENDMENTS-016 B99b: Compare gets one too, by the same reasoning (before Readiness, as in the More sheet).
    // P4-S2: Loadout follows the same precedent, in the UX_SPEC §2 header order (Weapons · Lab · Loadout · Bosses).
    // P6 item encyclopedia (AMENDMENTS-016): Items joins the header's "More" menu (B96b/B99b precedent), before Guides (UX_SPEC §2).
    // P6-S5/S6 (Feature B): Plans joins the header's "More" menu after Readiness (B96b/B99b precedent; UX_SPEC §2 sheet order).
    // AMENDMENTS-016 B117/B118: Builds gets its desktop entry (the header's "More" menu, last — the sheet's order).
    // AMENDMENTS-016 B123(h): Home leaves the header's links (the logo links home); Bosses follows Lab, then Loadout.
    // PRD P6-S1/S2 (B131(b)): Armor then Accessories follow Items — the database lists together (B112 precedent).
    expect(navItemsFor('header').map((i) => i.to)).toEqual(['/weapons', '/lab', '/bosses', '/loadout', '/compare', '/readiness', '/plan', '/items', '/armor', '/accessories', '/guides', '/builds'])
    expect(navItemsFor('header').map((i) => i.to)).not.toContain('/')
    // AMENDMENTS-001 A8: the footer's secondary links are data-driven; Favorites joins at P7-S1, Your data at P7-S2.
    expect(navItemsFor('footer').map((i) => i.to)).toEqual(['/favorites', '/settings/data', '/about/licensing'])
    const { tabs, more } = tabBarLayout()
    // UX_SPEC §2: Home · Weapons · Lab · Bosses · More (Compare, Readiness, Guides, Favorites, About live in the More
    // sheet — the sheet's own order: "Loadout, Compare, Readiness, Plans, Items, Guides, …").
    expect({ tabs, more }).toMatchObject({
      tabs: [{ to: '/' }, { to: '/weapons', label: 'Weapons' }, { to: '/lab', label: 'Lab' }, { to: '/bosses', label: 'Bosses' }],
      more: [
        { to: '/loadout', label: 'Loadout' },
        { to: '/compare', label: 'Compare' },
        { to: '/readiness', label: 'Readiness' },
        { to: '/plan', label: 'Plans' },
        { to: '/items', label: 'Items' },
        // PRD P6-S1/S2 (B131(b)): the armor and accessory databases, after Items
        { to: '/armor', label: 'Armor' },
        { to: '/accessories', label: 'Accessories' },
        { to: '/guides', label: 'Guides' },
        // AMENDMENTS-016 B111 R5: "Builds" (UX_SPEC §2 "… Guides, Builds, Favorites, About")
        { to: '/builds', label: 'Builds' },
        { to: '/favorites', label: 'Favorites' },
        // P7-S2: the saved-data page (back up, restore, clear, set-aside copies), before About.
        { to: '/settings/data', label: 'Your data' },
        { to: '/about/licensing' },
      ],
    })
    // 4 tabs + the More tab: exactly the UX_SPEC §10.12 cap.
    expect(tabs.length + (more.length > 0 ? 1 : 0)).toBeLessThanOrEqual(TAB_BAR_MAX)
  })

  it('P6-S5/S6: /plan is a lazy route; /plan/new and /plan/:planId are lazy and carry no nav entry', () => {
    for (const [id, path, nav] of [
      ['plans', '/plan', true],
      ['plan-new', '/plan/new', false],
      ['plan', '/plan/:planId', false],
    ] as const) {
      const route = APP_ROUTES.find((r) => r.id === id)
      if (!route) throw new Error(`no ${id} route`)
      expect(route.path).toBe(path)
      expect(route.nav !== undefined).toBe(nav)
      expect((route.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
    }
  })

  it('B111 R5 / B117: /builds is registered (a redirect to the builder’s saved-builds list), in the More sheet and the header’s More menu', () => {
    const builds = APP_ROUTES.find((r) => r.id === 'builds')
    expect(builds?.path).toBe('/builds')
    expect(builds?.nav?.surfaces).toEqual(['header', 'more'])
  })

  it('P7-S2: /settings/data is a lazy route in the More sheet and the footer only', () => {
    const data = APP_ROUTES.find((r) => r.id === 'data')
    if (!data) throw new Error('no data route')
    expect(data.path).toBe('/settings/data')
    expect(data.nav?.surfaces).toEqual(['more', 'footer'])
    expect((data.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
  })

  it.each(['lab', 'bosses', 'guides', 'favorites', 'readiness', 'compare', 'loadout', 'items', 'armor', 'accessories'])('/%s is registered as a lazy route (its own chunk), never an eager import', (id) => {
    const route = APP_ROUTES.find((r) => r.id === id)
    if (!route) throw new Error(`no ${id} route`)
    expect(route.path).toBe(`/${id}`)
    // React.lazy components are exotic objects tagged with the lazy symbol, not plain functions.
    expect((route.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
  })

  it('registers the weapon detail route without a nav entry', () => {
    const detail = APP_ROUTES.find((r) => r.path === '/weapons/:id')
    expect(detail).toBeDefined()
    expect(detail?.nav).toBeUndefined()
  })

  it('P6: registers the item page route lazily and without a nav entry', () => {
    const detail = APP_ROUTES.find((r) => r.path === '/items/:id')
    if (!detail) throw new Error('no item page route')
    expect(detail.nav).toBeUndefined()
    expect((detail.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
  })

  it('P6-S1/S2: registers /armor/:id and /accessories/:id lazily and without a nav entry', () => {
    for (const path of ['/armor/:id', '/accessories/:id']) {
      const detail = APP_ROUTES.find((r) => r.path === path)
      if (!detail) throw new Error(`no ${path} route`)
      expect(detail.nav).toBeUndefined()
      expect((detail.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
    }
  })

  it('registers the guide page route (P6-S8) lazily and without a nav entry', () => {
    const guide = APP_ROUTES.find((r) => r.path === '/guides/:slug')
    if (!guide) throw new Error('no guide page route')
    expect(guide.nav).toBeUndefined()
    expect((guide.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
  })

  it('sorts by order and omits routes without nav metadata', () => {
    const routes: AppRoute[] = [
      route('b', ['header'], 2),
      { id: 'hidden', path: '/hidden', Component: Stub },
      route('a', ['header'], 1),
    ]
    expect(navItemsFor('header', routes).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('caps the tab bar at 5 items including More, overflowing into the More sheet', () => {
    const routes = Array.from({ length: 7 }, (_, i) => route(`t${i}`, ['tabbar'], i))
    const { tabs, more } = tabBarLayout(routes)
    expect(tabs).toHaveLength(TAB_BAR_MAX - 1)
    expect(more.map((i) => i.id)).toEqual(['t4', 't5', 't6'])
  })

  it('uses all 5 tab slots and no More sheet when nothing overflows', () => {
    const routes = Array.from({ length: 5 }, (_, i) => route(`t${i}`, ['tabbar'], i))
    expect(tabBarLayout(routes)).toMatchObject({ more: [] })
    expect(tabBarLayout(routes).tabs).toHaveLength(5)
  })

  it('header (B29): the first 3 links inline, the rest in the header "More" menu, order kept', () => {
    const six = ['weapons', 'lab', 'loadout', 'bosses', 'items', 'guides'].map((id, i) => route(id, ['header'], i))
    const { inline, more } = headerNavLayout(six)
    expect(HEADER_INLINE_MAX).toBe(3)
    expect(inline.map((i) => i.id)).toEqual(['weapons', 'lab', 'loadout'])
    expect(more.map((i) => i.id)).toEqual(['bosses', 'items', 'guides'])
    // Up to 3 links: no More menu at all; a 4th goes into it.
    expect(headerNavLayout(six.slice(0, 3)).more).toEqual([])
    expect(headerNavLayout(six.slice(0, 4)).more.map((i) => i.id)).toEqual(['bosses'])
    // Today's registry (B123h): Weapons + Lab + Bosses inline — the tab bar's sections, Home left to the logo;
    // Loadout (P4-S2), Compare (B99b), Readiness (B96b), Plans (P6-S5), Items (P6), Armor + Accessories (P6-S1/S2, B131b),
    // Guides then Builds (B117) in "More" (B34).
    expect(headerNavLayout()).toMatchObject({
      inline: [{ to: '/weapons', label: 'Weapons' }, { to: '/lab', label: 'Lab' }, { to: '/bosses', label: 'Bosses' }],
      more: [
        { to: '/loadout', label: 'Loadout' },
        { to: '/compare', label: 'Compare' },
        { to: '/readiness', label: 'Readiness' },
        { to: '/plan', label: 'Plans' },
        { to: '/items', label: 'Items' },
        { to: '/armor', label: 'Armor' },
        { to: '/accessories', label: 'Accessories' },
        { to: '/guides', label: 'Guides' },
        { to: '/builds', label: 'Builds' },
      ],
    })
    expect(headerNavLayout().more).toHaveLength(9)
    // The inline links are exactly the tab bar's sections other than Home (B123h: "matching the tab bar").
    expect(headerNavLayout().inline.map((i) => i.to)).toEqual(tabBarLayout().tabs.map((i) => i.to).filter((to) => to !== '/'))
  })

  it('reserves a More slot when there are more-only items', () => {
    const routes = [
      ...Array.from({ length: 5 }, (_, i) => route(`t${i}`, ['tabbar'], i)),
      route('about', ['more'], 99),
    ]
    const { tabs, more } = tabBarLayout(routes)
    expect(tabs).toHaveLength(4)
    expect(more.map((i) => i.id)).toEqual(['t4', 'about'])
  })
})
