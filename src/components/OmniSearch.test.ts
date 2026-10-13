import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { createDataAccess } from '../data-access'
import type { SpriteIndex } from '../data-access/types'
import type { SearchResultItem, SearchSuggestions } from '../search'
import { SpritePlaceholder } from './art/SpritePlaceholder'
import { HeroSearch, OmniSearch, ResultGroups } from './OmniSearch'

const zenith: SearchResultItem = {
  ref: 'i:4956',
  name: 'Zenith',
  type: 'weapon',
  damageClass: 'melee',
  rarity: 10,
  detail: 'Melee · Red (10)',
  sprite: '/sprites/weapons/4956.png',
  target: { kind: 'internal', to: '/weapons/4956' },
}
const kingSlime: SearchResultItem = {
  ref: 'boss:king-slime',
  name: 'King Slime',
  type: 'boss',
  stage: 'early-prehm',
  detail: 'Early Pre-Hardmode',
  sprite: '/sprites/bosses/50.gif',
  target: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/King_Slime' },
}
const blueSlime: SearchResultItem = {
  ref: 'enemy:blue-slime',
  name: 'Blue Slime',
  type: 'enemy',
  detail: '',
  target: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Blue_Slime' },
}
const suggestions: SearchSuggestions = {
  query: 'z',
  groups: [
    { type: 'weapon', label: 'Weapons', items: [zenith], total: 7 },
    { type: 'boss', label: 'Bosses', items: [kingSlime], total: 1 },
    { type: 'enemy', label: 'Enemies', items: [blueSlime], total: 1 },
  ],
  options: [zenith, kingSlime, blueSlime],
}

let sprites: SpriteIndex
beforeAll(async () => {
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

function renderGroups(active: number): string {
  return renderToStaticMarkup(
    createElement(ResultGroups, {
      suggestions,
      idPrefix: 's-',
      optionId: (index: number) => `s-option-${index}`,
      active,
      sprites,
      onHover: () => {},
      onActivate: () => {},
    }),
  )
}

/** Attribute-order-independent: the opening tag of the element carrying `id`. */
function tagWithId(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html)
  if (!match) throw new Error(`no element with id ${id}`)
  return match[0]
}

describe('OmniSearch result rows (P2-S4 AC2/AC5)', () => {
  let html = ''
  beforeAll(() => {
    html = renderGroups(1)
  })

  it('renders one labelled group per entity type, in the given order', () => {
    const groups = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1])
    expect(groups).toEqual(['s-group-weapon', 's-group-boss', 's-group-enemy'])
    expect(tagWithId(html, 's-group-weapon')).toContain('role="presentation"')
    expect(html).toMatch(/id="s-group-weapon"[^>]*><span>Weapons<\/span><span[^>]*>top 1 of 7 · keep typing to narrow<\/span>/)
    expect(html).toContain('<span>Bosses</span>')
    expect(html).toContain('<span>Enemies</span>')
  })

  it('"keep typing to narrow" goes on the first truncated group only', () => {
    const twoTruncated: SearchSuggestions = {
      ...suggestions,
      groups: suggestions.groups.map((g) => (g.type === 'enemy' ? { ...g, total: 40 } : g)),
    }
    const markup = renderToStaticMarkup(
      createElement(ResultGroups, {
        suggestions: twoTruncated,
        idPrefix: 's-',
        optionId: (index: number) => `s-option-${index}`,
        active: 0,
        sprites,
        onHover: () => {},
        onActivate: () => {},
      }),
    )
    expect(markup.match(/keep typing to narrow/g)).toHaveLength(1)
    expect(markup).toMatch(/<span>Enemies<\/span><span[^>]*>top 1 of 40<\/span>/)
  })

  it('rows without a sprite show the generic creature mark (B32), not a creature-like figure', () => {
    const enemyRow = html.slice(html.indexOf('id="s-option-2"'))
    const creature = renderToStaticMarkup(createElement(SpritePlaceholder, { variant: 'creature', className: 'size-full' }))
    expect(enemyRow).toContain(creature)
  })

  it('options are flat-indexed across groups; only the active one is aria-selected', () => {
    expect(tagWithId(html, 's-option-0')).toContain('aria-selected="false"')
    expect(tagWithId(html, 's-option-1')).toContain('aria-selected="true"')
    expect(tagWithId(html, 's-option-2')).toContain('aria-selected="false"')
    expect(html.match(/role="option"/g)).toHaveLength(3)
  })

  it('internal rows navigate in-app; boss/enemy rows carry the external-link indicator', () => {
    expect(tagWithId(html, 's-option-0')).toContain('data-target="internal"')
    expect(tagWithId(html, 's-option-1')).toContain('data-target="external"')
    expect(tagWithId(html, 's-option-2')).toContain('data-target="external"')
    expect(html.match(/opens terraria\.wiki\.gg in a new tab/g)).toHaveLength(2)
  })

  it('rarity-coloured names, type badges, sprites for weapons/bosses and placeholder art otherwise', () => {
    expect(html).toContain('style="color:var(--rarity-10)"')
    expect(html).toContain('<img src="/sprites/weapons/4956.png"')
    expect(html).toContain('<img src="/sprites/bosses/50.gif"')
    expect(html.match(/<img /g)).toHaveLength(2) // Blue Slime has no sprite → original placeholder SVG
    for (const badge of ['Weapon', 'Boss', 'Enemy']) expect(html).toContain(`>${badge}</span>`)
    expect(html).toContain('Melee · Red (10)')
  })
})

describe('OmniSearch shell markup (AC4; APG combobox)', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(OmniSearch)))

  it('is a collapsed combobox wired to its (empty, hidden) listbox, with the "/" shortcut advertised', () => {
    const input = /<input[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toContain('aria-expanded="false"')
    expect(input).toContain('aria-autocomplete="list"')
    expect(input).toContain('aria-keyshortcuts="/"')
    expect(input).toContain('aria-label="Search"')
    expect(input).toContain('placeholder="Search weapons, bosses, enemies…"')
    expect(input).not.toContain('aria-activedescendant')
    const controls = /aria-controls="([^"]+)"/.exec(input)?.[1]
    expect(tagWithId(html, controls!)).toMatch(/role="listbox"[^>]*hidden=""|hidden=""[^>]*role="listbox"/)
  })

  it('has the small-screen overlay trigger and builds nothing up front (no options rendered)', () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"/)
    expect(html).not.toContain('role="option"')
  })

  it('the inline field keeps >= 240px: the header nav collapses instead (B29)', () => {
    expect(html).toMatch(/<div class="[^"]*\blg:min-w-60\b[^"]*"><div class="relative w-full max-w-md"/)
  })
})

describe('HeroSearch markup (UX_SPEC §3.2, AMENDMENTS-007 B28)', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HeroSearch)))
  const input = /<input[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? ''

  it('is the same combobox, drawn larger (≥ lg), with the large overlay trigger below lg', () => {
    expect(html).toMatch(/<div class="hidden lg:block">/)
    expect(input).toContain('aria-autocomplete="list"')
    expect(input).toContain('aria-expanded="false"')
    expect(input).toMatch(/class="[^"]*\bh-14\b[^"]*\btext-lg\b/)
    const trigger = /<button[^>]*aria-haspopup="dialog"[^>]*>/.exec(html)?.[0] ?? ''
    expect(trigger).toMatch(/\bh-14\b/)
    expect(trigger).toMatch(/\blg:hidden\b/)
    expect(html).toContain('Search weapons, bosses, enemies…</span></button>')
  })

  it('leaves the "/" shortcut to the header instance', () => {
    expect(input).not.toContain('aria-keyshortcuts')
    expect(html).not.toContain('<kbd')
  })

  it('has no unconditional autofocus: focusing is decided at runtime, desktop only (autofocusSearch)', () => {
    expect(html.toLowerCase()).not.toContain('autofocus')
    expect(html).not.toContain('role="option"')
  })
})
