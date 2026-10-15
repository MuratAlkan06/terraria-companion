/**
 * Route registry — the single source of truth for BOTH the router and every nav
 * surface (UX_SPEC §1 nav visibility rule, PRD P1-S1 AC2). A section appears in
 * navigation only by being registered here with a `nav` entry, so a nav item can
 * never point at a route that does not exist. Add entries as slices ship; never
 * add placeholders.
 *
 * Eager: shell + `/` (UX_SPEC §1). Every other section is a lazy chunk (ADR D7).
 */
import { Backpack, BookOpen, ClipboardList, Columns3, DatabaseBackup, FlaskConical, FolderOpen, Gem, House, Package, Pickaxe, Scale, Shield, Skull, Star, Swords, type LucideIcon } from 'lucide-react'
import { lazy, type ComponentType } from 'react'
import BuildsRedirect from './routes/BuildsRedirect'
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
/** The Boss Readiness Checker (`chunk-readiness`, UX_SPEC §1): Feature A, P5-S6/S7. */
const chunkReadiness = () => import('./routes/bosses/readiness/chunk-readiness')
/** The weapon comparison (`chunk-compare`, UX_SPEC §1): P4-S1. */
const chunkCompare = () => import('./routes/db/compare/chunk-compare')
/** The Loadout Builder (`chunk-loadout`, UX_SPEC §1): P4-S2. */
const chunkLoadout = () => import('./routes/loadout/chunk-loadout')
/** Feature B, "What Should I Grind For?" (`chunk-plan`, UX_SPEC §1): P6-S5/S6. */
const chunkPlan = () => import('./routes/plan/chunk-plan')

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
    // AMENDMENTS-016 B123(h): Home leaves the desktop header's links — the logo links home (UX_SPEC §2) — so
    // the header's inline links match the tab bar's sections: Weapons · Lab · Bosses.
    id: 'home',
    path: '/',
    Component: HomePage,
    nav: { label: 'Home', icon: House, surfaces: ['tabbar'], order: 0 },
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
    // P4-S2: the 4-step builder; `?step=1..4` + the draft's inputs and swaps, `?build=:id` opens a saved build
    // (UX_SPEC §1). Entry points: the homepage hero's "Build My Loadout" (heroActions), the phone "More" sheet
    // (UX_SPEC §2: first in its list) and — B96b/B99b precedent — the header's desktop "More" menu, first in it:
    // AMENDMENTS-016 B123(h) puts Bosses inline after Lab, so Loadout sorts after Bosses (and before Compare —
    // the More sheet's order is unchanged).
    id: 'loadout',
    path: '/loadout',
    Component: lazy(() => chunkLoadout().then((m) => ({ default: m.LoadoutPage }))),
    nav: {
      label: 'Loadout',
      icon: Backpack,
      surfaces: ['header', 'more'],
      order: 32,
      description: 'Stage, class and goal in; a scored loadout out',
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
    // P5-S5: `?recommend=1` opens "What Should I Do Next?" (the homepage hero button links to it).
    features: ['recommend'],
  },
  {
    // P5-S2: pages for the bosses in src/schemas/bossPages.ts; any other id renders the styled 404.
    id: 'boss-detail',
    path: '/bosses/:id',
    Component: lazy(() => chunkBosses().then((m) => ({ default: m.BossPage }))),
  },
  {
    // P4-S1: 2–3 weapons side by side; `?w=4956,757,1308` restores a comparison (UX_SPEC §1, §10.11). Entry
    // points: every weapon page's "Compare" (UX_SPEC §3.3), the phone "More" sheet (UX_SPEC §2) and — AMENDMENTS-016
    // B99b, B96b parity — the header's desktop "More" menu (after Bosses, before Readiness: the sheet's order).
    id: 'compare',
    path: '/compare',
    Component: lazy(() => chunkCompare().then((m) => ({ default: m.ComparePage }))),
    nav: {
      label: 'Compare',
      icon: Columns3,
      surfaces: ['header', 'more'],
      order: 35,
      description: 'Two or three weapons side by side',
    },
  },
  {
    // P5-S6/S7 (Feature A): `?boss=:id&class=&difficulty=` prefill (UX_SPEC §1); entry points on boss pages + map cards.
    // AMENDMENTS-015 B96b: a headline feature, so it has its own desktop entry (the header's "More" menu,
    // after Bosses) as well as the phone "More" sheet — no boss-page detour needed.
    id: 'readiness',
    path: '/readiness',
    Component: lazy(() => chunkReadiness().then((m) => ({ default: m.ReadinessPage }))),
    nav: {
      label: 'Readiness',
      icon: ClipboardList,
      surfaces: ['header', 'more'],
      order: 40,
      description: 'Check your gear against a boss, factor by factor',
    },
  },
  {
    // P6-S5/S6 (Feature B, PRD §9): the plan list (UX_SPEC §1 `/plan`). Entry points: the phone "More" sheet (UX_SPEC
    // §2: "… Readiness, Plans, Items …") and — B96b/B99b precedent for headline features — the header's desktop
    // "More" menu, after Readiness; item / weapon pages ("What Should I Grind For?"), the readiness checker's "Show Me
    // How to Get It" and the builder's gated track link /plan/new?item=:id.
    id: 'plans',
    path: '/plan',
    Component: lazy(() => chunkPlan().then((m) => ({ default: m.PlansPage }))),
    nav: {
      label: 'Plans',
      icon: Pickaxe,
      surfaces: ['header', 'more'],
      order: 45,
      description: 'Pick any item: every material, drop and boss it takes, as a checklist',
    },
  },
  {
    // P6-S5: the goal picker, or `?item=:id` — that item's plan preview and "Make My Plan" (UX_SPEC §1, §10.11).
    id: 'plan-new',
    path: '/plan/new',
    Component: lazy(() => chunkPlan().then((m) => ({ default: m.PlanNewPage }))),
  },
  {
    // P6-S5/S6: a saved plan — tree + checklist + owned quantities (UX_SPEC §3.9).
    id: 'plan',
    path: '/plan/:planId',
    Component: lazy(() => chunkPlan().then((m) => ({ default: m.PlanPage }))),
  },
  {
    // P6 item encyclopedia (AMENDMENTS-016; UX_SPEC §1 `/items`, §3.10): category hub + every Item record, filterable
    // by category / game stage / name (`?category=&stage=&q=`). Entry points: the phone "More" sheet (UX_SPEC §2:
    // "… Readiness, Plans, Items, Guides …") and — B96b/B99b precedent — the header's desktop "More" menu, after
    // Readiness and before Guides (UX_SPEC §2 header order: … Bosses · Items · Guides); search rows and boss-page drop
    // rows link items in-app.
    id: 'items',
    path: '/items',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.ItemsListPage }))),
    nav: {
      label: 'Items',
      icon: Package,
      surfaces: ['header', 'more'],
      order: 50,
      description: 'Materials, potions, tools and every other item, with how to get them',
    },
  },
  {
    // P6: an Item record's page (stats, how to obtain, used in); a weapon / armor / accessory id is a styled 404
    // linking that record's own page (B113(e) M5; B131(b): armor and accessory pages are in-app).
    id: 'item-detail',
    path: '/items/:id',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.ItemDetailPage }))),
  },
  {
    // PRD P6-S1 (AMENDMENTS-016 B131(b): built, not cut): armor sets by class / stage / name, then the pieces outside
    // a set (UX_SPEC §1 `/armor`, chunk-db). Entry points: the phone "More" sheet and — B96b/B99b/B112 precedent for
    // database lists — the header's desktop "More" menu, after Items; search rows, boss-page gear, the builder and the
    // readiness checker link sets and pieces here.
    id: 'armor',
    path: '/armor',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.ArmorListPage }))),
    nav: {
      label: 'Armor',
      icon: Shield,
      surfaces: ['header', 'more'],
      order: 52,
      description: 'Armor sets with their set bonus counted in, compared side by side',
    },
  },
  {
    // P6-S1: a set's page (its slug) or an armor piece (its id — in a set: that set's page at the piece).
    id: 'armor-detail',
    path: '/armor/:id',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.ArmorDetailPage }))),
  },
  {
    // PRD P6-S2 (B131(b)): accessories by category / stage / name (UX_SPEC §1 `/accessories`, chunk-db); the same
    // entry points as Armor, after it.
    id: 'accessories',
    path: '/accessories',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.AccessoriesListPage }))),
    nav: {
      label: 'Accessories',
      icon: Gem,
      surfaces: ['header', 'more'],
      order: 54,
      description: 'Exact effects, the classes they count for, and combination trees',
    },
  },
  {
    // P6-S2: an accessory's page.
    id: 'accessory-detail',
    path: '/accessories/:id',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.AccessoryDetailPage }))),
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
    // AMENDMENTS-016 B111 R5 / UX_SPEC §2: the More sheet's "Builds" entry ("… Guides, Builds, Favorites, About"),
    // landing on the builder's saved-builds list (a redirect — see BuildsRedirect). B117/B118 (B96b/B99b parity):
    // the header's desktop "More" menu lists it too, last (after Guides — the sheet's order).
    id: 'builds',
    path: '/builds',
    Component: BuildsRedirect,
    nav: {
      label: 'Builds',
      icon: FolderOpen,
      surfaces: ['header', 'more'],
      order: 70,
      description: 'Your saved loadouts: open, compare, check readiness, export or import',
    },
  },
  {
    // P7-S1: starred weapons and bosses (tc.v1.favorites); in chunk-db per UX_SPEC §1.
    id: 'favorites',
    path: '/favorites',
    Component: lazy(() => chunkDb().then((m) => ({ default: m.FavoritesPage }))),
    nav: {
      label: 'Favorites',
      icon: Star,
      surfaces: ['more', 'footer'],
      order: 800,
      description: 'The weapons and bosses you starred',
    },
  },
  {
    // P7-S2: the saved-data page — back up (one JSON file), restore from a backup (preview, then merge / replace /
    // skip per part), what each part holds and its size, clear one part, and every set-aside copy with its actions.
    // Entry points: the phone "More" sheet and the footer (beside Favorites, the other this-browser-only page).
    id: 'data',
    path: '/settings/data',
    Component: lazy(() => import('./routes/settings/DataPage')),
    nav: {
      label: 'Your data',
      icon: DatabaseBackup,
      surfaces: ['more', 'footer'],
      order: 850,
      description: 'Back up, restore or clear what this browser saved',
    },
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
      description: 'Data license, attribution, takedown contact, fonts & software credits',
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
