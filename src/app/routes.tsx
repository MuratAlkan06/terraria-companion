/**
 * Route registry — the single source of truth for BOTH the router and every nav
 * surface (UX_SPEC §1 nav visibility rule, PRD P1-S1 AC2). A section appears in
 * navigation only by being registered here with a `nav` entry, so a nav item can
 * never point at a route that does not exist. Add entries as slices ship; never
 * add placeholders.
 *
 * Eager: shell + `/` (UX_SPEC §1). Every other section is a lazy chunk (ADR D7).
 */
import { House, Scale, type LucideIcon } from 'lucide-react'
import { lazy, type ComponentType } from 'react'
import HomePage from './routes/HomePage'

export type NavSurface = 'header' | 'tabbar' | 'more' | 'footer'

export interface NavMeta {
  label: string
  icon: LucideIcon
  /** Where the link is shown. Mobile tab bar holds <= 5 items incl. "More". */
  surfaces: readonly NavSurface[]
  /** Sort order within a surface (ascending). */
  order: number
  /** One-line description shown in the mobile "More" sheet. */
  description?: string
}

export interface AppRoute {
  id: string
  /** Absolute path, e.g. "/about/licensing". */
  path: string
  Component: ComponentType
  nav?: NavMeta
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    id: 'home',
    path: '/',
    Component: HomePage,
    nav: { label: 'Home', icon: House, surfaces: ['header', 'tabbar'], order: 0 },
  },
  {
    id: 'licensing',
    path: '/about/licensing',
    Component: lazy(() => import('./routes/LicensingPage')),
    nav: {
      label: 'Licensing',
      icon: Scale,
      surfaces: ['more', 'footer'],
      order: 900,
      description: 'Data license, attribution & takedown contact',
    },
  },
]

export function pathFor(id: string): string {
  const route = APP_ROUTES.find((r) => r.id === id)
  if (!route) throw new Error(`No route registered with id "${id}"`)
  return route.path
}
