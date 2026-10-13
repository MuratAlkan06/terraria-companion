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

  it('P3-S1 nav: Home + Weapons + Lab in header and tab bar; Licensing in More + footer', () => {
    expect(navItemsFor('header').map((i) => i.to)).toEqual(['/', '/weapons', '/lab'])
    expect(navItemsFor('footer').map((i) => i.to)).toEqual(['/about/licensing'])
    const { tabs, more } = tabBarLayout()
    expect({ tabs, more }).toMatchObject({
      tabs: [{ to: '/' }, { to: '/weapons', label: 'Weapons' }, { to: '/lab', label: 'Lab' }],
      more: [{ to: '/about/licensing' }],
    })
    // 3 tabs + the More tab: within the UX_SPEC §10.12 cap.
    expect(tabs.length + (more.length > 0 ? 1 : 0)).toBeLessThanOrEqual(TAB_BAR_MAX)
  })

  it('the Lab is registered as a lazy route (its own chunk), never an eager import', () => {
    const lab = APP_ROUTES.find((r) => r.id === 'lab')
    if (!lab) throw new Error('no /lab route')
    expect(lab.path).toBe('/lab')
    // React.lazy components are exotic objects tagged with the lazy symbol, not plain functions.
    expect((lab.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
  })

  it('registers the weapon detail route without a nav entry', () => {
    const detail = APP_ROUTES.find((r) => r.path === '/weapons/:id')
    expect(detail).toBeDefined()
    expect(detail?.nav).toBeUndefined()
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
    // Today's registry: Home + Weapons + Lab — exactly the inline limit, nothing collapsed.
    expect(headerNavLayout()).toMatchObject({ inline: [{ to: '/' }, { to: '/weapons' }, { to: '/lab' }], more: [] })
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
