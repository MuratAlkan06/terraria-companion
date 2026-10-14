/* AMENDMENTS-015 B82: on a guide page (/guides/<slug>) the mobile tab bar's "More" — the section the
 * Guides link lives in — is highlighted and says it is current, like the tabs' own NavLinks do for
 * their sub-paths (/weapons/4956 highlights Weapons). */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { isNavCurrent, tabBarLayout } from '../nav'
import { BottomTabBar } from './BottomTabBar'

const render = (path: string) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(BottomTabBar)))
/** The "More" trigger's opening tag. */
const moreTrigger = (html: string) => /<button[^>]*aria-haspopup="dialog"[^>]*>/.exec(html)?.[0] ?? ''

describe('isNavCurrent: NavLink matching for every nav surface', () => {
  it('"/" only exactly; every other link also for its sub-paths, never for a mere prefix', () => {
    expect(isNavCurrent('/', '/')).toBe(true)
    expect(isNavCurrent('/', '/guides')).toBe(false)
    expect(isNavCurrent('/guides', '/guides')).toBe(true)
    expect(isNavCurrent('/guides', '/guides/first-boss-prep')).toBe(true)
    expect(isNavCurrent('/guides', '/guidesx')).toBe(false)
    expect(isNavCurrent('/weapons', '/guides/first-boss-prep')).toBe(false)
  })
})

describe('BottomTabBar "More" on guide paths (B82)', () => {
  it('the Guides link sits in the More sheet', () => {
    expect(tabBarLayout().more.map((i) => i.to)).toContain('/guides')
  })

  it.each([['/guides'], ['/guides/first-boss-prep']])('%s: More is highlighted and aria-current', (path) => {
    const trigger = moreTrigger(render(path))
    expect(trigger).toMatch(/\btext-accent before:bg-accent\b/)
    expect(trigger).toContain('aria-current="true"')
  })

  it('a page outside the sheet leaves More plain (its own tab is the current one)', () => {
    const html = render('/weapons/4956')
    expect(moreTrigger(html)).not.toMatch(/\btext-accent\b/)
    expect(moreTrigger(html)).not.toContain('aria-current')
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/weapons"|<a[^>]*href="\/weapons"[^>]*aria-current="page"/)
  })
})
