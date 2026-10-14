/**
 * Route registry — the single source of truth for BOTH the router and every nav
 * surface (UX_SPEC §1 nav visibility rule, PRD P1-S1 AC2). A section appears in
 * navigation only by being registered here with a `nav` entry, so a nav item can
 * never point at a route that does not exist. Add entries as slices ship; never
 * add placeholders.
 *
 * Eager: shell + `/` (UX_SPEC §1). Every other section is a lazy chunk (ADR D7).
 */
import { BookOpen, FlaskConical, House, Scale, Skull, Swords, type LucideIcon } from 'lucide-react'
import { lazy, type ComponentType } from 'react'
import HomePage from './routes/HomePage'

/** All database pages live in one lazy chunk (`chunk-db`, UX_SPEC §1). */
const chunkDb = () => import('./routes/db/chunk-db')
/**
 * The Weapon Lab (`chunk-lab`, UX_SPEC §1). PixiJS sits behind a second dynamic import inside it
 * (src/lab/arena), so no other route ever downloads the renderer.
 */
const chunkLab = () => import('./routes/lab/chunk-lab')
/** The boss section (`chunk-bosses`, UX_SPEC §1): the progression map and the boss pages (P5-S2). */
const chunkBosses = () => import('./routes/bosses/chunk-bosses')
/** Guides (`chunk-guides`, UX_SPEC §1): the index and every guide page (P6-S8). */
const chunkGuides = () => import('./routes/guides/chunk-guides')

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
  /**
   * In-page capabilities other surfaces may deep-link into (e.g. the boss map's `?recommend=1`
   * panel, P5-S5). A link to one exists only once it is listed here — absent, never disabled.
   */
  features?: readonly string[]
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    id: 'home',
    path: '/',
    Component: HomePage,
    nav: { label: 'Home', icon: House, surfaces: ['header', 'tabbar'], order: 0 },
  },
  {
    id: 'weapons',
    path: '/weapons',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.WeaponsListPage }))),
    nav: { label: 'Weapons', icon: Swords, surfaces: ['header', 'tabbar'], order: 10 },
  },
  {
    id: 'weapon-detail',
    path: '/weapons/:id',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.WeaponDetailPage }))),
  },
  {
    id: 'lab',
    path: '/lab',
    Component: lazy(() => chunkLab().then((m) => ({ default: m.LabPage }))),
    nav: {
      label: 'Lab',
      icon: FlaskConical,
      surfaces: ['header', 'tabbar'],
      order: 20,
      description: 'Swing weapons at a training dummy — a browser simulation',
    },
  },
  {
    id: 'bosses',
    path: '/bosses',
    Component: lazy(() => chunkBosses().then((m) => ({ default: m.BossMapPage }))),
    nav: {
      label: 'Bosses',
      icon: Skull,
      surfaces: ['header', 'tabbar'],
      order: 30,
      description: 'The boss progression map: what unlocks what',
    },
  },
  {
    // P5-S2: pages for the bosses in src/schemas/bossPages.ts; any other id renders the styled 404.
    id: 'boss-detail',
    path: '/bosses/:id',
    Component: lazy(() => chunkBosses().then((m) => ({ default: m.BossPage }))),
  },
  {
    id: 'guides',
    path: '/guides',
    Component: lazy(() => chunkGuides().then((m) => ({ default: m.GuidesIndexPage }))),
    nav: {
      label: 'Guides',
      icon: BookOpen,
      surfaces: ['header', 'more'],
      order: 60,
      description: 'Beginner guides with checklists that remember your progress',
    },
  },
  {
    id: 'guide',
    path: '/guides/:slug',
    Component: lazy(() => chunkGuides().then((m) => ({ default: m.GuidePage }))),
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

/** True when a route with this id ships (data-driven entry points, PRD P1-S2 AC3 pattern). */
export function hasRoute(id: string): boolean {
  return APP_ROUTES.some((r) => r.id === id)
}

export function pathFor(id: string): string {
  const route = APP_ROUTES.find((r) => r.id === id)
  if (!route) throw new Error(`No route registered with id "${id}"`)
  return route.path
}
