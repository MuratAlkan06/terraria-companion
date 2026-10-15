import { Scale } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { APP_ROUTES, type AppRoute } from '../routes'
import { SiteHeader } from './SiteHeader'

/**
 * Header width budget (AMENDMENTS-007 B29) with a FAKE six-route nav config — the six header
 * sections UX_SPEC §2 plans (Weapons · Lab · Loadout · Bosses · Items · Guides). Layout itself
 * (zero horizontal scroll at 1024, search >= 240px) is verified in the browser; this pins the
 * markup that budget relies on.
 */
const Stub = () => null
const SIX: AppRoute[] = ['Weapons', 'Lab', 'Loadout', 'Bosses', 'Items', 'Guides'].map((label, i) => ({
  id: label.toLowerCase(),
  path: `/${label.toLowerCase()}`,
  Component: Stub,
  nav: { label, icon: Scale, surfaces: ['header'], order: i },
}))

function renderHeader(path: string, routes: readonly AppRoute[] = SIX): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(SiteHeader, { routes })),
  )
}

/** The primary nav's markup (between <nav aria-label="Primary"> and </nav>). */
function primaryNav(html: string): string {
  const start = html.indexOf('<nav aria-label="Primary"')
  return html.slice(start, html.indexOf('</nav>', start))
}

describe('SiteHeader with six nav sections (B29)', () => {
  it('shows only the first three links inline, then a "More" menu trigger', () => {
    const nav = primaryNav(renderHeader('/weapons'))
    expect([...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/weapons', '/lab', '/loadout'])
    expect(nav).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>More<svg/)
    for (const hidden of ['/bosses', '/items', '/guides']) expect(nav).not.toContain(`href="${hidden}"`)
  })

  it('the More trigger carries the active underline while one of its sections is open', () => {
    const more = (path: string) => /<button[^>]*aria-haspopup="menu"[^>]*>/.exec(primaryNav(renderHeader(path)))?.[0] ?? ''
    expect(more('/items')).toMatch(/\btext-accent after:bg-accent\b/)
    expect(more('/items/42')).toMatch(/\btext-accent\b/)
    expect(more('/lab')).not.toMatch(/\btext-accent\b/)
  })

  it('no More menu while everything fits in three links', () => {
    expect(primaryNav(renderHeader('/', SIX.slice(0, 3)))).not.toContain('aria-haspopup="menu"')
  })

  it('width budget: wordmark steps aside at lg–xl (name kept for screen readers), search keeps >= 240px', () => {
    const html = renderHeader('/')
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>.*?<span class="[^"]*\bsr-only\b[^"]*\bmd:not-sr-only lg:sr-only xl:not-sr-only\b[^"]*">Terraria Companion<\/span>/)
    expect(html).toMatch(/class="[^"]*\blg:min-w-60\b[^"]*"><div class="relative w-full max-w-md"/)
  })
})

describe('the header height is one shared token (AMENDMENTS-016 B119)', () => {
  it('the bar is h-header — the token the sticky strips below it pin to (top-header)', () => {
    expect(renderHeader('/')).toMatch(/<div class="[^"]*\bh-header\b[^"]*"/)
    expect(renderHeader('/')).not.toMatch(/\bh-16\b/)
  })
})

describe('SiteHeader with the app’s own registry (AMENDMENTS-016 B123h)', () => {
  it('Weapons · Lab · Bosses inline (the tab bar’s sections), no Home link — the logo links home — and the rest in More', () => {
    const html = renderHeader('/', APP_ROUTES)
    const nav = primaryNav(html)
    expect([...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/weapons', '/lab', '/bosses'])
    expect(nav).not.toContain('href="/"')
    expect(nav).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>More<svg/)
    // the logo is the way home, outside the nav
    expect(html.slice(0, html.indexOf('<nav aria-label="Primary"'))).toMatch(/<a [^>]*href="\/"[^>]*>/)
  })

  it('the More trigger is current on a section it holds (Loadout), not on an inline one (Bosses)', () => {
    const more = (path: string) => /<button[^>]*aria-haspopup="menu"[^>]*>/.exec(primaryNav(renderHeader(path, APP_ROUTES)))?.[0] ?? ''
    expect(more('/loadout')).toMatch(/\btext-accent after:bg-accent\b/)
    expect(more('/bosses')).not.toMatch(/\btext-accent\b/)
    expect(primaryNav(renderHeader('/bosses/plantera', APP_ROUTES))).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/bosses"|<a [^>]*href="\/bosses"[^>]*aria-current="page"/)
  })
})
