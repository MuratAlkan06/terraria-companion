import { House } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { navItemsFor, TAB_BAR_MAX, tabBarLayout } from './nav'
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

  it('P1 ships exactly Home and Licensing in nav', () => {
    expect(navItemsFor('header').map((i) => i.to)).toEqual(['/'])
    expect(navItemsFor('footer').map((i) => i.to)).toEqual(['/about/licensing'])
    expect(tabBarLayout()).toMatchObject({
      tabs: [{ to: '/' }],
      more: [{ to: '/about/licensing' }],
    })
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
