import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { matchPath, MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { EntityCard } from '../../../components/EntityCard'
import { FavoriteStarButton } from '../../../components/FavoriteStar'
import type { Boss, Weapon, WeaponListRecord } from '../../../data-access/types'
import armorList from '../../../data/armor.list.json'
import bossesJson from '../../../data/bosses.json'
import progressionJson from '../../../data/progression.json'
import weaponsDetail from '../../../data/weapons.detail.json'
import weaponsListJson from '../../../data/weapons.list.json'
import { hasBossPage } from '../../../schemas/bossPages'
import { APP_ROUTES } from '../../routes'
import { loadBossPageData } from '../bosses/bossPageData'
import { BossPageView } from '../bosses/BossPageView'
import { WeaponDetailView } from '../db/weapons/WeaponDetailView'
import { loadFavoritesData } from './favoritesData'
import { focusAfterRemoval, groupFavorites, resolveFavorite, type FavoriteSources } from './favoritesModel'
import FavoritesPage, { EMPTY_MESSAGE, EMPTY_TITLE, FavoritesView, TITLE_ID } from './FavoritesPage'

/**
 * P7-S1 /favorites: grouping by entity type, silent skip of refs the dataset no longer resolves,
 * a working link for every favorited ref, the designed empty state, and the star on the surfaces
 * it ships on (weapon list rows via EntityCard's action cell, weapon + boss page headers).
 * Store persistence and the star's own contract live in src/app/favorites.test.ts.
 */
const weapons = weaponsListJson as unknown as WeaponListRecord[]
const bosses = bossesJson as unknown as Boss[]
const sources: FavoriteSources = {
  weaponsById: new Map(weapons.map((w) => [w.id, w])),
  bossesById: new Map(bosses.map((b) => [b.id, b])),
}
const weaponByName = (name: string) => {
  const w = weapons.find((x) => x.name === name)
  if (!w) throw new Error(`fixture weapon missing: ${name}`)
  return w
}
const zenith = weaponByName('Zenith')
const nodeIds = new Set((progressionJson as { nodes: { id: string }[] }).nodes.map((n) => n.id))
/** An item id that exists in the dataset but isn't a weapon (an armor piece): no weapon page. */
const nonWeaponItemId = (armorList as { id: number }[]).find((a) => !sources.weaponsById.has(a.id))?.id

const wrap = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const anchors = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => ({ href: m[1], inner: m[2] }))
const decode = (href: string) => href.replace(/&amp;/g, '&')

describe('/favorites grouping and resolution (PRD P7-S1)', () => {
  it('groups by entity type — Weapons, then Bosses — keeping stored order within each', () => {
    const groups = groupFavorites(['boss:skeletron', `i:${zenith.id}`, 'boss:king-slime', `i:${weaponByName('Terra Blade').id}`], sources)
    expect(groups.map((g) => g.id)).toEqual(['weapons', 'bosses'])
    expect(groups[0].entries.map((e) => e.name)).toEqual(['Zenith', 'Terra Blade'])
    expect(groups[1].entries.map((e) => e.name)).toEqual(['Skeletron', 'King Slime'])
  })

  it('skips unresolvable refs silently (dataset drift) and shows each ref once', () => {
    expect(nonWeaponItemId).toBeDefined()
    const refs = [
      'i:999999999', // not in the dataset at all
      `i:${nonWeaponItemId}`, // a real item without a weapon page
      'boss:no-such-boss',
      'node:wall-of-flesh', // an entity type with no local favorites card
      'set:molten',
      `i:${zenith.id}`,
      `i:${zenith.id}`,
      'boss:king-slime',
    ]
    const groups = groupFavorites(refs, sources)
    expect(groups.flatMap((g) => g.entries.map((e) => e.ref))).toEqual([`i:${zenith.id}`, 'boss:king-slime'])
    for (const ref of refs.slice(0, 5)) expect(resolveFavorite(ref, sources)).toBeUndefined()
  })

  it('omits a group with nothing in it, and yields no groups when nothing resolves', () => {
    expect(groupFavorites(['boss:queen-bee'], sources).map((g) => g.id)).toEqual(['bosses'])
    expect(groupFavorites(['i:999999999', 'boss:gone'], sources)).toEqual([])
    expect(groupFavorites([], sources)).toEqual([])
  })

  it('every favorited weapon and boss renders a working link (a registered route; a real record)', () => {
    const refs = [...weapons.map((w) => `i:${w.id}`), ...bosses.map((b) => `boss:${b.id}`)]
    const groups = groupFavorites(refs, sources)
    const entries = groups.flatMap((g) => g.entries)
    expect(entries).toHaveLength(weapons.length + bosses.length)

    const routePaths = APP_ROUTES.map((r) => r.path)
    for (const entry of entries) {
      const [pathname, search = ''] = entry.href.split('?')
      expect(routePaths.some((path) => matchPath(path, pathname)), entry.href).toBe(true)
      if (entry.kind === 'weapon') {
        expect(matchPath('/weapons/:id', pathname)?.params.id).toBe(String(entry.weapon.id))
      } else if (hasBossPage(entry.boss.id)) {
        expect(entry.href).toBe(`/bosses/${entry.boss.id}`)
      } else {
        // No page yet: the boss's own node on the map, focus card open.
        expect(pathname).toBe('/bosses')
        const node = new URLSearchParams(search).get('node')
        expect(node).toBe(entry.boss.nodeId)
        expect(nodeIds.has(node ?? '')).toBe(true)
      }
    }

    // The rendered page: one link per entry, each to exactly that entry's href, none wrapping a control.
    const html = wrap(createElement(FavoritesView, { groups, sprites: null, onRemove: () => {} }))
    const links = anchors(html)
    expect(links.map((a) => decode(a.href))).toEqual(entries.map((e) => e.href))
    for (const link of links) expect(link.inner).not.toContain('<button')
  })
})

describe('/favorites rendering', () => {
  const groups = groupFavorites([`i:${zenith.id}`, 'boss:eye-of-cthulhu', 'boss:moon-lord'], sources)

  it('renders a section per group with its count, and each card with a pressed star that removes it', () => {
    const removed: string[] = []
    const html = wrap(createElement(FavoritesView, { groups, sprites: null, onRemove: (e) => removed.push(e.ref) }))
    expect([...html.matchAll(/<h2 id="favorites-(\w+)"/g)].map((m) => m[1])).toEqual(['weapons', 'bosses'])
    // The count reads "Weapons 1 starred" to assistive tech, not a bare number.
    expect(html).toMatch(/<h2 id="favorites-weapons"[^>]*>.*?Weapons.*?>1<span class="sr-only"> starred<\/span><\/span><\/h2>/)
    expect(html).toMatch(/<h2 id="favorites-bosses"[^>]*>.*?Bosses.*?>2<span class="sr-only"> starred<\/span><\/span><\/h2>/)
    const stars = [...html.matchAll(/<button[^>]*data-favorite-ref="([^"]+)"[^>]*>/g)]
    expect(stars.map((m) => m[1])).toEqual([`i:${zenith.id}`, 'boss:eye-of-cthulhu', 'boss:moon-lord'])
    for (const [tag] of stars) expect(tag).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Favorite Zenith"')
    expect(html).toContain('aria-label="Favorite Moon Lord"')
  })

  it('focus after a removal: the next star, else the previous one, else the page title', () => {
    expect(focusAfterRemoval(groups, `i:${zenith.id}`)).toBe('boss:eye-of-cthulhu') // crosses into the next group
    expect(focusAfterRemoval(groups, 'boss:moon-lord')).toBe('boss:eye-of-cthulhu')
    const single = groupFavorites(['boss:skeletron'], sources)
    expect(focusAfterRemoval(single, 'boss:skeletron')).toBeNull()
  })

  it('designed empty state when nothing is starred: one-line invitation + a single CTA, no data loaded', () => {
    const html = wrap(createElement(FavoritesPage))
    expect(html).toContain(`<h1 id="${TITLE_ID}" tabindex="-1"`)
    expect(html).toContain(EMPTY_TITLE)
    expect(html).toContain(EMPTY_MESSAGE)
    expect(`${EMPTY_TITLE} — ${EMPTY_MESSAGE.toLowerCase()}`).toContain('Nothing starred yet — tap the star on any weapon or boss')
    expect(anchors(html).map((a) => a.href)).toEqual(['/weapons'])
    expect(html).not.toMatch(/Loading favorites/)
    expect(html).not.toContain('data-favorite-ref')
    // No "tap a star to remove one" when there is nothing to remove.
    expect(html).not.toContain('remove one')
  })

  it('loads its data (weapon list + bosses; sprites optional) in one call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = await loadFavoritesData()
    expect(data.weaponsById.get(zenith.id)?.name).toBe('Zenith')
    expect(data.bossesById.get('king-slime')?.name).toBe('King Slime')
    warn.mockRestore()
  })
})

describe('FavoriteStar on entity surfaces (UX_SPEC §3.1, §3.3)', () => {
  it('EntityCard puts an action in its own cell beside the link — never inside it', () => {
    const action = createElement(FavoriteStarButton, { entityRef: 'i:1', name: 'X', pressed: false, onToggle: () => {} })
    const html = wrap(createElement(EntityCard, { to: '/weapons/1', sprite: null, name: 'X', rarity: undefined, action }))
    const [link] = anchors(html)
    expect(link.href).toBe('/weapons/1')
    expect(link.inner).not.toContain('<button')
    expect(html).toMatch(/<\/a><div[^>]*><span[^>]*><button[^>]*data-favorite-ref="i:1"/)
    // Without an action the card is still the single link it always was.
    const plain = wrap(createElement(EntityCard, { to: '/weapons/1', sprite: null, name: 'X', rarity: undefined }))
    expect(plain.startsWith('<a ')).toBe(true)
    expect(plain).not.toContain('<button')
  })

  it('weapon page header: a star for the weapon beside its name', () => {
    const weapon = (weaponsDetail as unknown as Weapon[]).find((w) => w.name === 'Zenith') as Weapon
    const html = wrap(createElement(WeaponDetailView, { weapon, sprites: null, acquisitionData: undefined, acquisition: null }))
    const header = html.slice(0, html.indexOf('</header>'))
    expect(header).toMatch(/<\/h1><span[^>]*><button[^>]*aria-label="Favorite Zenith"[^>]*data-favorite-ref="i:4956"/)
    expect(html.match(/data-favorite-ref=/g)).toHaveLength(1)
  })

  it('boss page header: a star for the boss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = await loadBossPageData('king-slime')
    warn.mockRestore()
    const html = wrap(createElement(BossPageView, { data, worldEvil: null, nodeStates: {}, headingId: 'boss-page-title' }))
    const header = html.slice(0, html.indexOf('</header>'))
    expect(header).toMatch(/<button[^>]*aria-pressed="false"[^>]*aria-label="Favorite King Slime"[^>]*data-favorite-ref="boss:king-slime"/)
    expect(html.match(/data-favorite-ref=/g)).toHaveLength(1)
  })
})
