/* Item encyclopedia (P6, AMENDMENTS-016): filters, display rules, "Used in", and the item page rendered
 * server-side from the shipped data for every category (Unknown markers ⇄ badge count, links, B105,
 * fishing condition chips, missing sprite, Unknown-heavy, copy audit). */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../../../../../public/sprites/manifest.json'
import { createDataAccess, loadSearchDocs, NotFoundError } from '../../../../data-access'
import type { Item, ItemListRecord, SpriteIndex } from '../../../../data-access/types'
import { DERIVED_QUANTITY_EXPLANATION } from '../../../../components/DerivedLabel'
import { ItemCategory as ItemCategorySchema, type SearchDoc } from '../../../../schemas'
import { auditCopy } from '../../../../scoring/copyAudit'
import { APP_ROUTES } from '../../../routes'
import { AcquisitionPanel, AcquisitionView } from '../weapons/AcquisitionView'
import { unknownCount } from '../weapons/weaponUnknowns'
import * as copy from './itemCopy'
import { categoryInfo, formatDurationTicks, ITEM_CATEGORIES, ITEM_UNKNOWN_CAPABLE_PATHS, itemFieldLabel, itemStatRows, itemUses, usedInEntries, usedInLine } from './itemDisplay'
import { ItemNotFound } from './ItemDetailPage'
import { ItemDetailView, UsedInPanel } from './ItemDetailView'
import { applyItemFilters, buildItemFacets, categoryCounts, matchesName, parseItemFilters, toggleItemFilter, writeItemFilters, EMPTY_ITEM_FILTERS } from './itemFilters'
import { CATEGORY_ICON } from './itemIcons'
import { itemHref } from './itemNav'
import { itemNeeds, refInfoFrom, type ItemSectionsData } from './itemsData'
import { itemPageUnknowns } from './itemUnknowns'

const da = createDataAccess({ validate: null })
let list: ItemListRecord[]
let items: Item[]
let sections: ItemSectionsData
let sprites: SpriteIndex

beforeAll(async () => {
  list = await da.loadItemList()
  const index = await da.loadItemIndex()
  items = await Promise.all([...index.ids].map((id) => da.loadItemDetail(id)))
  const [acquisition, docs, buffs] = await Promise.all([da.loadAcquisitionData({ recipes: true, drops: true, gates: true }), da.loadSearchDocs(), da.loadBuffs()])
  sections = { acquisition, docs: new Map(docs.map((d: SearchDoc) => [d.id, d])), buffs: new Map(buffs.map((b) => [b.id, b])) }
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

const byName = (name: string): Item => {
  const item = items.find((i) => i.name === name)
  if (!item) throw new Error(`fixture item missing: ${name}`)
  return item
}
const wrap = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
/** `null` = the sections below the header are still loading. */
function renderItem(item: Item, loaded: ItemSectionsData | null = sections): string {
  const data = loaded ?? undefined
  return wrap(
    createElement(ItemDetailView, {
      item,
      sprites,
      sections: data,
      acquisition: createElement(
        AcquisitionPanel,
        { weapon: item },
        data ? createElement(AcquisitionView, { weapon: item, noun: 'item', data: data.acquisition, weaponsById: undefined, sprites, refInfo: refInfoFrom(data.docs) }) : null,
      ),
      usedIn: createElement(UsedInPanel, { item, sections: data, sprites }),
    }),
  )
}
const markers = (html: string) => [...html.matchAll(/data-unknown-field="([^"]+)"/g)].map((m) => m[1])
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('data: every Item record has a page; the browse list matches the records', () => {
  it('5,045 items: list = index = records; every category of the schema has a label and a glyph', () => {
    expect(list).toHaveLength(5045)
    expect(items).toHaveLength(5045)
    expect(ITEM_CATEGORIES.map((c) => c.id).sort()).toEqual([...ItemCategorySchema.options].sort())
    for (const c of ITEM_CATEGORIES) expect(CATEGORY_ICON[c.id], c.id).toBeDefined()
    expect(new Set(list.map((i) => i.category))).toEqual(new Set(items.map((i) => i.category)))
  })

  it('a weapon / accessory id is not an item page (styled 404, never a half page)', async () => {
    await expect(da.loadItemDetail(4956)).rejects.toBeInstanceOf(NotFoundError) // Zenith
    await expect(da.loadItemDetail(3097)).rejects.toBeInstanceOf(NotFoundError) // Shield of Cthulhu
  })

  it('B113(e) M5: the 404 for a weapon id names it and links its weapon page; an accessory id links its wiki article; anything else points to the list', async () => {
    await loadSearchDocs() // the 404 reads the search docs (cached here, so it renders on its first frame)
    const zenith = wrap(createElement(ItemNotFound, { id: '4956' }))
    expect(zenith).toContain('data-not-item="weapon"')
    expect(text(zenith)).toContain('is Zenith, a weapon')
    expect(zenith).toMatch(/<a [^>]*href="\/weapons\/4956"[^>]*>Open Zenith<\/a>/)
    const shield = wrap(createElement(ItemNotFound, { id: '3097' }))
    expect(shield).toContain('data-not-item="accessory"')
    expect(shield).toMatch(/<a href="https:\/\/terraria\.wiki\.gg\/wiki\/[^"]+"[^>]*target="_blank"/)
    expect(shield).toContain(`href="${'/items'}"`)
    const nothing = wrap(createElement(ItemNotFound, { id: '999999' }))
    expect(nothing).not.toContain('data-not-item')
    expect(text(nothing)).toContain('browse the item list instead')
  })

  it('every unverified path any item lists is one the page can render (no Unknown silently dropped)', () => {
    const unrenderable = items.flatMap((i) => i._prov.unverifiedFields.filter((f) => !ITEM_UNKNOWN_CAPABLE_PATHS.some((re) => re.test(f))).map((f) => `${i.name}: ${f}`))
    expect(unrenderable).toEqual([])
  })
})

describe('filters (category / stage / name; URL state)', () => {
  it('parses, writes and toggles URL state; unknown values are dropped, never guessed', () => {
    const f = parseItemFilters(new URLSearchParams('category=tool,nonsense,hook&stage=unknown,early-prehm&q=  cop pick '))
    expect(f).toEqual({ category: ['hook', 'tool'].sort((a, b) => ITEM_CATEGORIES.findIndex((c) => c.id === a) - ITEM_CATEGORIES.findIndex((c) => c.id === b)), stage: ['early-prehm', 'unknown'], q: 'cop pick' })
    expect(writeItemFilters(new URLSearchParams('x=1'), f).toString()).toBe('x=1&category=hook%2Ctool&stage=early-prehm%2Cunknown&q=cop+pick')
    expect(toggleItemFilter(f, 'category', 'tool').category).toEqual(['hook'])
    expect(writeItemFilters(new URLSearchParams('category=tool'), EMPTY_ITEM_FILTERS).toString()).toBe('')
  })

  it('name filter: every typed word starts a word of the name (case / accent insensitive)', () => {
    expect(matchesName('Copper Pickaxe', 'pick cop')).toBe(true)
    expect(matchesName('Copper Pickaxe', 'axe')).toBe(false) // inside a word, not its start
    expect(matchesName('Señor Fish', 'senor')).toBe(true)
    const tools = applyItemFilters(list, { category: ['tool'], stage: [], q: 'pickaxe' })
    expect(tools.length).toBeGreaterThan(5)
    expect(tools.every((i) => i.category === 'tool' && /pickaxe/i.test(i.name))).toBe(true)
  })

  it('facets count per option given the other facets; the stage-unknown bucket holds every item without a verified stage', () => {
    const facets = buildItemFacets(list, { category: ['vanity'], stage: [], q: '' })
    const stage = facets.find((f) => f.id === 'stage')!
    const vanity = list.filter((i) => i.category === 'vanity')
    expect(stage.options.find((o) => o.value === 'unknown')?.count).toBe(vanity.filter((i) => !i.stage).length)
    expect(stage.options.reduce((n, o) => n + o.count, 0)).toBe(vanity.length)
    const category = facets.find((f) => f.id === 'category')!
    expect(category.options.reduce((n, o) => n + o.count, 0)).toBe(list.length) // the category facet ignores its own selection
    expect([...categoryCounts(list).values()].reduce((a, b) => a + b, 0)).toBe(list.length)
  })
})

describe('display rules per category (getField: verified value, Unknown, or no row)', () => {
  const rows = (name: string) => Object.fromEntries(itemStatRows(byName(name)).map((r) => [r.key, r.text ?? 'Unknown']))

  it('tools, fishing poles, bait; ammo; potions; hooks and mounts (Unknown, never "not applicable")', () => {
    expect(rows('Copper Pickaxe')).toMatchObject({ pickaxe: '35%', consumable: 'No' })
    expect(rows('Wood Fishing Pole')).toMatchObject({ fishingPower: expect.stringMatching(/^\d+%$/) })
    expect(rows('Master Bait')).toMatchObject({ bait: expect.stringMatching(/^\d+%$/) })
    expect(rows('Wooden Arrow')).toMatchObject({ ammoType: 'Arrows', ammoDamage: expect.any(String) })
    expect(rows('Healing Potion')).toMatchObject({ healLife: '100 HP', consumable: 'Yes', maxStack: expect.any(String) })
    expect(rows('Grappling Hook')).toMatchObject({ hookStats: 'Unknown' })
    expect(rows('Slimy Saddle')).toMatchObject({ mountStats: 'Unknown' })
    expect(rows('Gel')).toMatchObject({ ammoDamage: 'Unknown' })
    expect(formatDurationTicks(28800)).toBe('8 minutes')
    expect(formatDurationTicks(90 * 60)).toBe('1 minute 30 seconds')
    expect(formatDurationTicks(30)).toBe('0.5 seconds')
    expect(itemFieldLabel('acquisition.2.priceCopper', byName('Healing Potion'))).toMatch(/— price$/)
  })

  it('"Used in": direct ingredient, "Any …" group member, crafting station — every recipe, one entry per result', () => {
    const recipes = sections.acquisition.recipes!
    const silk = itemUses(byName('Silk').id, recipes.byId.values(), recipes.groups)
    expect(silk.filter((u) => u.role.kind === 'ingredient')).toHaveLength(183) // P6-S0 pin: 183 recipes
    expect(silk.some((u) => u.recipe.resultItemId === 224)).toBe(true) // Bed
    const iron = itemUses(byName('Iron Bar').id, recipes.byId.values(), recipes.groups)
    const viaGroup = iron.filter((u) => u.role.kind === 'ingredient' && u.role.via?.id === 'any-iron-bar')
    expect(viaGroup.length).toBeGreaterThan(10)
    const entry = usedInEntries(viaGroup)[0]
    // B113(e) M2: the amount consumed, in the "How to obtain" form — never a bare "× 2" that reads as the yield
    expect(usedInLine(entry, 'Iron Bar')).toMatch(/^uses \d+ × Any Iron Bar/)
    const direct = silk.filter((u) => u.role.kind === 'ingredient' && !u.role.via)
    expect(usedInLine(usedInEntries(direct)[0], 'Silk')).toMatch(/^uses \d+ × Silk$/)
    const bench = itemUses(byName('Work Bench').id, recipes.byId.values(), recipes.groups)
    expect(bench.some((u) => u.role.kind === 'station')).toBe(true)
    expect(usedInLine({ resultId: 1, uses: bench.filter((u) => u.role.kind === 'station').slice(0, 1) }, 'Work Bench')).toBe('crafting station')
  })

  it('B113(e): "Consumed on use" on a placeable says placing uses it up; a potion keeps a plain "Yes"', () => {
    expect(rows('Work Bench')).toMatchObject({ consumable: copy.CONSUMED_PLACEABLE })
    expect(rows('Healing Potion')).toMatchObject({ consumable: 'Yes' })
    expect(rows('Copper Pickaxe')).toMatchObject({ consumable: 'No' })
  })
})

describe('item page (server-rendered from the shipped data)', () => {
  it('Unknown markers ⇄ the partially-verified badge, for items of every category (and with the sections still loading)', () => {
    const sample = ITEM_CATEGORIES.flatMap((c) => items.filter((i) => i.category === c.id).slice(0, 6))
    const mismatches: string[] = []
    for (const item of sample) {
      for (const data of [sections, null]) {
        const html = renderItem(item, data)
        const rendered = markers(html).length
        const counted = unknownCount(itemPageUnknowns(item, data?.acquisition.drops, data !== null))
        if (rendered !== counted) mismatches.push(`${item.name} (${data ? 'loaded' : 'loading'}): page ${rendered}, badge ${counted}`)
        if ((rendered > 0) !== html.includes('Partially verified')) mismatches.push(`${item.name}: badge presence`)
      }
    }
    expect(sample.length).toBeGreaterThan(80)
    expect(mismatches).toEqual([])
  })

  it('a tool: Copper Pickaxe — 35% pickaxe power, Merchant sells it, its anvil recipe links materials and the station group’s members (B113(e))', () => {
    const html = renderItem(byName('Copper Pickaxe'))
    expect(html).toContain('data-stat="pickaxe"')
    expect(text(html)).toContain('Pickaxe power 35%')
    expect(text(html)).toContain('Sold by Merchant')
    expect(html).toMatch(/<a [^>]*href="\/items\/20"[^>]*>(?:(?!<\/a>).)*Copper Bar/) // material → its item page
    expect(html).toMatch(/<a [^>]*href="\/items\/35"[^>]*>Iron Anvil<\/a> or <a [^>]*href="\/items\/716"[^>]*>Lead Anvil<\/a>/)
    expect(html).toContain('Category</dt>')
    expect(html).toContain('data-category="tool"')
  })

  it('a fishing item: Flarefin Koi — its lava fishing route shows the condition as a chip linking its wiki article', () => {
    const koi = byName('Flarefin Koi')
    const html = renderItem(koi)
    expect(text(html)).toContain('Fished up')
    expect(text(html)).toContain('Where: Lava')
    const condition = sections.acquisition.conditions.byId.get('can-fish-in-lava')!
    expect(html).toMatch(new RegExp(`<a href="${condition.wikiUrl.replace(/[.?]/g, '\\$&')}"[^>]*data-condition-chip="${condition.name}"`))
    expect(itemNeeds(koi)).toMatchObject({ recipes: true })
  })

  it('a vanity piece: Familiar Shirt — sold by the Clothier once Skeletron is defeated; gated late pre-Hardmode', () => {
    const html = renderItem(byName('Familiar Shirt'))
    expect(text(html)).toContain('Sold by Clothier')
    expect(text(html)).toContain('Late Pre-Hardmode')
    expect(html).toContain('data-category="vanity"')
    expect(html).not.toContain('Partially verified')
  })

  it('B105 on an item page: Picksaw (Plantera) and Badger\'s Hat show quantity 1 as "derived", never as a stated value', () => {
    for (const name of ['Picksaw', "Badger's Hat"]) {
      const html = renderItem(byName(name))
      expect(html, name).toMatch(/<span class="tabular-nums">1<\/span><button[^>]*data-derived=""/)
      expect(markers(html).filter((m) => m.endsWith(':quantity'))).toEqual([])
    }
    expect(DERIVED_QUANTITY_EXPLANATION).toMatch(/states no quantity/)
  })

  it('a potion: Healing Potion — restores 100 HP and grants Potion Sickness for 1 minute (linked buff article)', () => {
    const html = renderItem(byName('Healing Potion'))
    expect(text(html)).toContain('Restores health 100 HP')
    expect(html).toMatch(/<a href="https:\/\/terraria\.wiki\.gg\/wiki\/Potion_Sickness"[^>]*>Potion Sickness/)
    expect(text(html)).toContain('for 1 minute')
    expect(text(html)).toContain(copy.TICKS_NOTE)
  })

  it('a summoning item links the boss page it summons; a station says how many recipes need it', () => {
    expect(renderItem(byName('Suspicious Looking Eye'))).toMatch(/data-stat="summons"[\s\S]*?<a [^>]*href="\/bosses\/eye-of-cthulhu"[^>]*>Eye of Cthulhu<\/a>/)
    const bench = renderItem(byName('Work Bench'))
    expect(bench).toContain('data-stat="station"')
    expect(text(bench)).toMatch(/Used as the station in [\d,]+ recipes/)
  })

  it('hooks and mounts: stats not extracted are Unknown on the page (and in the badge)', () => {
    for (const [name, field] of [['Grappling Hook', 'hookStats'], ['Slimy Saddle', 'mountStats']] as const) {
      const item = byName(name)
      expect(markers(renderItem(item))).toContain(field)
      expect(itemPageUnknowns(item, sections.acquisition.drops, true).map((u) => u.key)).toContain(field)
    }
  })

  it('B113(e): a station whose recipes outnumber the items they make says why the "Show all" count is lower (Iron Anvil)', () => {
    const anvil = byName('Iron Anvil')
    const recipes = sections.acquisition.recipes!
    const uses = itemUses(anvil.id, recipes.byId.values(), recipes.groups)
    const entries = usedInEntries(uses)
    expect(entries.length).toBeLessThan(uses.length)
    const html = renderItem(anvil)
    expect(text(html)).toContain(copy.usedInMerged(entries.length, uses.length))
    expect(html).toContain(`Show all ${entries.length.toLocaleString('en-US')}`)
    // one recipe per result: nothing to explain
    const plain = items.find((i) => {
      const u = itemUses(i.id, recipes.byId.values(), recipes.groups)
      return u.length > 1 && usedInEntries(u).length === u.length
    })!
    expect(renderItem(plain)).not.toContain('data-used-in-merged')
  })

  it('"Used in": every recipe as a link (Silk: 183, preview then "Show all"); an item no recipe uses says so', () => {
    const silk = renderItem(byName('Silk'))
    expect(text(silk)).toContain('an ingredient in 183 recipes')
    expect(silk.match(/data-used-in="/g)?.length).toBe(24) // the preview; the rest behind "Show all"
    expect(silk).toMatch(/aria-expanded="false"[^>]*>[\s\S]*?Show all \d+/)
    expect(silk).toMatch(/<a [^>]*href="\/items\/224"[^>]*data-used-in="Bed"|<a [^>]*data-used-in="Bed"[^>]*href="\/items\/224"/)
    const unused = items.find((i) => i.category === 'vanity' && itemUses(i.id, sections.acquisition.recipes!.byId.values(), sections.acquisition.recipes!.groups).length === 0)!
    expect(text(renderItem(unused))).toContain(copy.USED_IN_NONE)
  })

  it('missing sprite: placeholder art + the note visible beside the header (B113d) and in the sources; Unknown-heavy items say so up front', () => {
    const relic = items.find((i) => !i.sprite)!
    const html = renderItem(relic)
    expect(html).toContain('data-no-sprite=""')
    expect(html).toMatch(/<header[\s\S]*?data-sprite-note="no-sprite"[\s\S]*?<\/header>/)
    expect(text(html)).toContain(copy.SPRITE_FALLBACK['no-sprite'])
    expect(html).not.toMatch(/<img src="\/sprites\/items\//) // the header shows placeholder art
    expect(renderItem(byName('Copper Pickaxe'))).not.toContain('data-sprite-note') // a listed sprite draws; no note
    const torch = byName('Torch') // 3 Unknowns: two prices and one conditions row
    expect(unknownCount(itemPageUnknowns(torch, sections.acquisition.drops))).toBeGreaterThanOrEqual(3)
    expect(renderItem(torch)).toContain('data-unknown-heavy=""')
    expect(renderItem(byName('Familiar Shirt'))).not.toContain('data-unknown-heavy')
  })

  it('every local link on a sample of item pages resolves (item ids are Item records; weapons, bosses and guides exist)', () => {
    const itemIds = new Set(items.map((i) => i.id))
    const routes = APP_ROUTES.map((r) => r.path)
    const dead: string[] = []
    for (const item of ITEM_CATEGORIES.flatMap((c) => items.filter((i) => i.category === c.id).slice(0, 3))) {
      for (const [, href] of renderItem(item).matchAll(/href="(\/[^"#]*)/g)) {
        const m = /^\/items\/(\d+)$/.exec(href)
        if (m ? !itemIds.has(Number(m[1])) : !routes.some((p) => new RegExp(`^${p.replace(/:[a-z]+/g, '[^/]+')}$`).test(href.split('?')[0]))) dead.push(`${item.name} → ${href}`)
      }
    }
    expect(dead).toEqual([])
    expect(itemHref(22)).toBe('/items/22')
  })

  it('copy audit: no forward promise, no outcome / "best" wording in the encyclopedia copy or rendered pages', () => {
    const strings = Object.values(copy).flatMap((v) => (typeof v === 'function' ? [String((v as (...a: unknown[]) => string)('1.4.5.8' as never, 3 as never)), String((v as (...a: unknown[]) => string)(1 as never, 2 as never))] : [String(v)]))
    for (const s of [...strings, ...ITEM_CATEGORIES.flatMap((c) => [c.label, c.badge, c.blurb]), DERIVED_QUANTITY_EXPLANATION]) expect(auditCopy(s), s).toBeUndefined()
    for (const name of ['Copper Pickaxe', 'Healing Potion', 'Silk', 'Familiar Shirt', 'Grappling Hook']) {
      // UnknownValue's shared screen-reader wording ("not yet verified") is the app-wide convention, not page copy
      const own = text(renderItem(byName(name))).replace(/\(not yet verified(, show details)?\)/g, ' ')
      expect(auditCopy(own), name).toBeUndefined()
    }
    expect(categoryInfo('permanent-booster').label).toBe('Permanent boosters')
  })
})
