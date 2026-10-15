import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { matchPath, MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDataAccess } from '../../../data-access'
import type { SpriteIndex } from '../../../data-access/types'
import accessoriesList from '../../../data/accessories.list.json'
import armorSets from '../../../data/armor-sets.json'
import armorList from '../../../data/armor.list.json'
import bosses from '../../../data/bosses.json'
import buffs from '../../../data/buffs.json'
import enemies from '../../../data/enemies.json'
import itemUniverse from '../../../data/item-universe.json'
import itemsList from '../../../data/items.list.json'
import searchDocs from '../../../data/search-docs.json'
import weaponsList from '../../../data/weapons.list.json'
import type { SearchDoc, SearchDocType } from '../../../schemas'
import { resolveTarget, WIKI_ORIGIN } from '../../../search/links'
import { APP_ROUTES, hasRoute } from '../../routes'
import { STAGE_IDS } from '../../stages'
import { GUIDE_PATHS, GUIDES, guideBySlug } from './content'
import { progressLabel } from './checklistStore'
import { PERSIST_ERROR_NOTICE, QUARANTINE_NOTICE } from './GuideChecklist'
import { buildGuideData, loadGuideData, type GuideData } from './guideData'
import { RichText } from './GuideLinks'
import { citedPages, ent, guideMentions, guideText, t, wikiUrl, type EntityMention, type Guide } from './guideModel'
import { mentionTarget } from './mentionTargets'
import GuidePage, { GuideArticle } from './GuidePage'
import GuidesIndexPage from './GuidesIndexPage'

/**
 * P6-S8 Guides v1 — content integrity (every referenced entity is a real record with a real page),
 * copy audit, and rendering of the index and all five guides. Checklist persistence lives in
 * ./checklist.test.ts.
 */
const DOCS = searchDocs as unknown as SearchDoc[]
const DOC_BY_ID = new Map(DOCS.map((d) => [d.id, d]))
const ITEM_NAMES = new Map((itemUniverse as { items: { id: number; name?: string }[] }).items.map((i) => [i.id, i.name]))

/** The dataset record behind each SearchDoc type: an entity mention must name a real record. */
const RECORD_IDS: Record<SearchDocType, Set<string>> = {
  weapon: new Set(weaponsList.map((r) => `i:${r.id}`)),
  armor: new Set(armorList.map((r) => `i:${r.id}`)),
  accessory: new Set(accessoriesList.map((r) => `i:${r.id}`)),
  item: new Set(itemsList.map((r) => `i:${r.id}`)),
  set: new Set(armorSets.map((r) => `set:${r.id}`)),
  boss: new Set(bosses.map((r) => `boss:${r.id}`)),
  enemy: new Set(enemies.map((r) => `enemy:${r.id}`)),
  buff: new Set(buffs.map((r) => `buff:${r.id}`)),
}

/**
 * Every terraria.wiki.gg article the guides cite, each confirmed to exist (HTTP 200) when the
 * citation was written (2026-10-14). A new citation must be checked and added here.
 */
const VERIFIED_WIKI_PAGES = new Set([
  'Arms_Dealer', 'Armor', 'Bed', 'Bottle', 'Campfire', 'Copper_Axe', 'Copper_Ore', 'Copper_Pickaxe', 'Corruption',
  'Crimson', 'Crimson_Heart', 'Crimtane_Ore', 'Death', 'Deathbringer_Pickaxe', 'Defense', 'Demon_Altar', 'Demonite_Ore',
  'Dungeon', 'Eye_of_Cthulhu', 'Fall_damage', 'Furnace', 'Glowstick', 'Gold_Chest', 'Gold_Pickaxe', 'Grappling_Hook',
  'Guide', 'Guide:Eye_of_Cthulhu_strategies', 'Guide:Getting_started', 'Heart_Lantern', 'Hellforge', 'Hellstone',
  'House', 'Ice_Mirror', 'Iron_Anvil', 'Ironskin_Potion', 'Layers', 'Lava', 'Lead_Anvil', 'Lens', 'Lesser_Healing_Potion',
  'Life_Crystal', 'Magic_Mirror', 'Merchant', 'Meteorite', 'Mushroom', 'Night', 'Night_Owl_Potion', 'Nightmare_Pickaxe',
  'NPCs', 'Obsidian_Skin_Potion', 'Ores', 'Piggy_Bank', 'Pickaxe_power', 'Platinum_Pickaxe', 'Potion_Sickness',
  'Recall_Potion', 'Regeneration_Potion', 'Rope', 'Shadow_Orb', 'Shadow_Scale', 'Shine_Potion', 'Spelunker_Potion',
  'Suspicious_Looking_Eye', 'Swiftness_Potion', 'Tissue_Sample', 'Torch', 'Treasure_Bag', 'Wood', 'Wood_Platform',
  'Wooden_Chair', 'Wooden_Door', 'Wooden_Table', 'Work_Bench',
])

/** No promise of later features (AMENDMENTS-013 purge) and no predicted outcomes (PRD §9 Feature A AC3). */
const FORWARD_PROMISE = /\b(yet|coming soon|so far|soon|in a future|future update|will be added)\b/i
const OUTCOME_OR_HYPE =
  /\b(you(?:'|’)ll|you will) (?:win|beat|defeat|lose|die|survive)\b|guarantee|\bwin(?:ning)? chance|\bchances? (?:to|of) (?:win|beat|winning|beating)\b|\bodds\b|\bcan(?:'|’)t lose\b|\bsure to\b|\bbest\b|\beasy\b|\bobviously\b|\bsimply\b/i
const PARITY_CLAIM = /in-game DPS|exact DPS|matches the game|same as (in )?the game|real DPS|true DPS/i

const entities = (guide: Guide) => guideMentions(guide).filter((m): m is EntityMention => m.kind === 'entity')

/** Internal href -> a registered route pattern (and, for weapon pages, a weapon that exists). */
function isLiveInternalHref(href: string): boolean {
  const pathname = href.split(/[?#]/)[0]
  const match = APP_ROUTES.map((r) => matchPath({ path: r.path, end: true }, pathname)).find((m) => m !== null)
  if (!match) return false
  if (match.pattern.path === '/weapons/:id') return RECORD_IDS.weapon.has(`i:${match.params.id}`)
  if (match.pattern.path === '/bosses/:id') return RECORD_IDS.boss.has(`boss:${match.params.id}`)
  if (match.pattern.path === '/guides/:slug') return guideBySlug(match.params.slug ?? '') !== undefined
  return true
}

let data: GuideData

beforeAll(async () => {
  // Sprite manifest lives in public/ (fetched at runtime); feed the same JSON here.
  const manifest = (await import('../../../../public/sprites/manifest.json')).default
  const sprites: SpriteIndex = await createDataAccess({
    validate: null,
    importers: { 'sprite-manifest': async () => manifest },
  }).loadSpriteIndex()
  data = buildGuideData(DOCS, sprites)
  // Prime the page's session cache (search docs import; the manifest fetch fails in Node -> null).
  await loadGuideData()
})

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, node))
}

function renderAt(path: string): string {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/guides', element: createElement(GuidesIndexPage) }),
        createElement(Route, { path: '/guides/:slug', element: createElement(GuidePage) }),
      ),
    ),
  )
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('P6-S8 AC1: the five pre-Hardmode guides', () => {
  it('ships exactly the five topics, in path order', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual(['new-world', 'exploring-safely', 'better-equipment', 'armor-and-defense', 'first-boss-prep'])
    expect(GUIDE_PATHS.map((p) => p.id)).toEqual(['pre-hardmode'])
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length)
  })

  it.each(GUIDES.map((g) => [g.slug, g] as const))('%s has tips, a 5–10 step checklist, item slots and an Advanced section', (_slug, guide) => {
    expect(guide.intro.length).toBeGreaterThan(0)
    expect(guide.sections.length).toBeGreaterThanOrEqual(3)
    expect(guide.sections.flatMap((s) => s.blocks).some((b) => b.kind === 'tips')).toBe(true)
    expect(guide.sections.flatMap((s) => s.blocks).some((b) => b.kind === 'slots')).toBe(true)
    expect(guide.checklist.length).toBeGreaterThanOrEqual(5)
    expect(guide.checklist.length).toBeLessThanOrEqual(10)
    expect(guide.advanced?.blocks.length).toBeGreaterThan(0)
    // Stable ids: persisted entry ids and section anchors are slugs, unique within the guide.
    const entryIds = guide.checklist.map((e) => e.id)
    expect(new Set(entryIds).size).toBe(entryIds.length)
    for (const id of entryIds) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    const sectionIds = guide.sections.map((s) => s.id)
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
    // Stage band: real stages, contiguous and in game order.
    const positions = guide.stages.map((s) => STAGE_IDS.indexOf(s))
    expect(positions.every((p, i) => p >= 0 && (i === 0 || p === positions[i - 1] + 1))).toBe(true)
    expect(guide.stages[0]).toMatch(/prehm$/)
  })
})

describe('P6-S8 AC2: every reference resolves to a real record and a real page', () => {
  it.each(GUIDES.map((g) => [g.slug, g] as const))('%s: every entity mention is a dataset record with a working link', (_slug, guide) => {
    for (const mention of entities(guide)) {
      const doc = DOC_BY_ID.get(mention.ref)
      expect(doc, `${mention.ref} (${mention.name}) is not in search-docs.json`).toBeDefined()
      if (!doc) continue
      expect(doc.name, `${mention.ref} is "${doc.name}" in the dataset`).toBe(mention.name)
      expect(RECORD_IDS[doc.type].has(mention.ref), `${mention.ref} has no ${doc.type} record`).toBe(true)
      const target = resolveTarget(doc)
      if (target.kind === 'internal') {
        expect(isLiveInternalHref(target.to), `${mention.ref} -> ${target.to}`).toBe(true)
      } else {
        // The record's own article — never a guessed URL or a search page.
        expect(target.href).toBe(doc.wikiUrl)
        expect(target.href.startsWith(`${WIKI_ORIGIN}/wiki/`)).toBe(true)
      }
    }
  })

  it('weapons link to their in-app detail pages', () => {
    const weaponRefs = GUIDES.flatMap(entities).filter((m) => DOC_BY_ID.get(m.ref)?.type === 'weapon')
    expect(weaponRefs.length).toBeGreaterThan(40)
    for (const m of weaponRefs) expect(mentionTarget(m, data.docs)).toEqual({ kind: 'internal', to: `/weapons/${m.ref.slice(2)}` })
  })

  it.each(GUIDES.map((g) => [g.slug, g] as const))('%s: wiki citations are verified articles; cited items are real item ids', (_slug, guide) => {
    for (const mention of guideMentions(guide)) {
      if (mention.kind === 'wiki') {
        expect(VERIFIED_WIKI_PAGES.has(mention.page), `unverified wiki page ${mention.page}`).toBe(true)
        expect(wikiUrl(mention.page)).toBe(`${WIKI_ORIGIN}/wiki/${mention.page}`)
        if (mention.itemId !== undefined) {
          // The cited article is that item's own article.
          expect(ITEM_NAMES.get(mention.itemId), `item ${mention.itemId}`).toBe(mention.page.replace(/_/g, ' '))
        }
      }
      if (mention.kind === 'guide') expect(guideBySlug(mention.slug), mention.slug).toBeDefined()
      if (mention.kind === 'route') expect(hasRoute(mention.routeId), mention.routeId).toBe(true)
    }
  })

  it('first-boss prep links the Eye of Cthulhu and the boss map', () => {
    const guide = guideBySlug('first-boss-prep')!
    const mentions = guideMentions(guide)
    expect(mentions.some((m) => m.kind === 'entity' && m.ref === 'boss:eye-of-cthulhu')).toBe(true)
    expect(mentions.some((m) => m.kind === 'route' && m.routeId === 'bosses')).toBe(true)
  })

  it('a mention whose record is missing renders as plain text, never a dead link', () => {
    const html = render(
      createElement(MemoryRouter, null, createElement(RichText, { rich: t`Try the ${ent('i:4956', 'Zenith')}.`, data: { ...data, docs: new Map() } })),
    )
    expect(html).toContain('Zenith')
    expect(html).not.toContain('<a')
  })
})

describe('copy audit (guide prose is editorial; claims cite their sources)', () => {
  const chrome = [
    ...GUIDE_PATHS.flatMap((p) => [p.title, p.description]),
    QUARANTINE_NOTICE,
    PERSIST_ERROR_NOTICE,
    progressLabel({ done: 0, total: 5 }),
    progressLabel({ done: 2, total: 5 }),
    progressLabel({ done: 5, total: 5 }),
  ]

  it.each(GUIDES.map((g) => [g.slug, g] as const))('%s: no forward promises, outcome claims, "best" claims or parity claims', (_slug, guide) => {
    for (const line of guideText(guide)) {
      expect(line, line).not.toMatch(FORWARD_PROMISE)
      expect(line, line).not.toMatch(OUTCOME_OR_HYPE)
      expect(line, line).not.toMatch(PARITY_CLAIM)
    }
  })

  it('page chrome copy is clean too', () => {
    for (const line of chrome) {
      expect(line).not.toMatch(FORWARD_PROMISE)
      expect(line).not.toMatch(OUTCOME_OR_HYPE)
    }
  })

  it('every guide cites at least one wiki article (its Sources list)', () => {
    for (const guide of GUIDES) expect(citedPages(guide).length).toBeGreaterThan(3)
  })
})

describe('rendering', () => {
  it('/guides lists all five guides as cards with stage band and progress', () => {
    const html = renderAt('/guides')
    expect(html).toContain('>Guides</h1>')
    expect(hrefs(html)).toEqual(GUIDES.map((g) => `/guides/${g.slug}`))
    expect(text(html)).toContain('Pre-Hardmode path')
    expect(text(html)).toContain('Game stage: Early Pre-HM')
    expect(text(html)).toContain('Early Pre-HM → to Late Pre-HM')
    expect(text(html).match(/Checklist: Not started/g)).toHaveLength(5)
  })

  it.each(GUIDES.map((g) => [g.slug, g] as const))('/guides/%s renders prose, linked slots, checklist and a collapsed Advanced part', (slug, guide) => {
    const html = renderAt(`/guides/${slug}`)
    expect(html).toContain(`>${guide.title}</h1>`)
    for (const section of guide.sections) expect(html).toContain(`>${section.title.replace(/'/g, '&#x27;')}</h2>`)

    // Every link is live: internal hrefs hit registered routes, external ones are wiki articles.
    const links = hrefs(html)
    for (const href of links) {
      if (href.startsWith('/')) expect(isLiveInternalHref(href), href).toBe(true)
      else if (href.startsWith('#')) expect(href).toBe('#guide-checklist')
      else {
        expect(href.startsWith(`${WIKI_ORIGIN}/wiki/`), href).toBe(true)
        expect(href).not.toContain('Special:Search')
      }
    }
    // Every entity mention is on the page with its resolved link.
    for (const mention of entities(guide)) {
      const target = mentionTarget(mention, data.docs)
      expect(target.kind).not.toBe('none')
      expect(links).toContain(target.kind === 'internal' ? target.to : target.kind === 'external' ? target.href : '')
    }
    // ItemSlot cells (the slot picture is decorative; the visible name labels the link).
    const slotCount = guide.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'slots').reduce((n, b) => n + (b.kind === 'slots' ? b.items.length : 0), 0)
    expect((html.match(/role="img" aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(slotCount)

    // Interactive checklist: one native checkbox per entry, none checked in a fresh browser.
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(guide.checklist.length)
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/)
    expect(text(html)).toContain('Checklist: not started')

    // Advanced: a native disclosure, collapsed by default.
    expect(html).toMatch(/<details class="[^"]*"><summary/)
    expect(html).toContain(guide.advanced!.title.replace(/'/g, '&#x27;'))

    // Sources list names every cited article.
    for (const page of citedPages(guide)) expect(links).toContain(wikiUrl(page))
  })

  it('an unknown slug is the styled 404 with a way back to the guides', () => {
    const html = renderAt('/guides/zenith-speedrun')
    expect(text(html)).toContain('Lost in the caverns')
    expect(text(html)).toContain('zenith-speedrun')
    expect(hrefs(html)).toContain('/guides')
  })

  it('the article shows a reserved loading area, then ErrorState with Retry on failure', () => {
    const guide = GUIDES[0]
    const wrap = (resource: Parameters<typeof GuideArticle>[0]['resource']) =>
      render(createElement(MemoryRouter, null, createElement(GuideArticle, { guide, resource })))
    const loading = wrap({ status: 'loading', retry: () => {} })
    expect(loading).toContain('min-h-[50dvh]')
    expect(loading).not.toContain('<a')
    const failed = wrap({ status: 'error', error: new Error('offline'), retry: () => {} })
    expect(text(failed)).toContain('Couldn’t load this guide’s item links')
    expect(failed).toContain('Retry')
  })
})
