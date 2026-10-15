/* AMENDMENTS-016 B131(b): P4-S2 AC3's wiki-link exception for armor and accessories EXPIRES with their pages. A sweep
 * over every link resolver the app routes items through — for EVERY armor piece, armor set and accessory in the data:
 * no resolver hands back a wiki article (or the wiki search) for one of them any more. Plus a source guard: no view
 * builds a set / armor / accessory link from its record's wikiUrl. */
import { describe, expect, it } from 'vitest'
import accessoriesJson from '../../../../data/accessories.detail.json'
import armorJson from '../../../../data/armor.detail.json'
import armorSetsJson from '../../../../data/armor-sets.json'
import itemUniverseJson from '../../../../data/item-universe.json'
import searchDocsJson from '../../../../data/search-docs.json'
import type { AccessoryListRecord, ArmorListRecord, ArmorSet, ItemNames } from '../../../../data-access/types'
import type { SearchDoc } from '../../../../schemas'
import { resolveTarget } from '../../../../search/links'
import { itemResolver } from '../../bosses/bossPageModel'
import type { ReadinessPageData } from '../../bosses/readiness/readinessData'
import { segmentContext } from '../../bosses/readiness/readinessUi'
import { refInfoFrom } from '../items/itemsData'

const accessories = accessoriesJson as unknown as AccessoryListRecord[]
const armor = armorJson as unknown as ArmorListRecord[]
const sets = armorSetsJson as unknown as ArmorSet[]
const docs = searchDocsJson as SearchDoc[]
const docsByRef = new Map(docs.map((d) => [d.id, d]))
const names: ItemNames = { byId: new Map((itemUniverseJson as { items: { id: number; name?: string }[] }).items.flatMap((i) => (i.name ? [[i.id, i.name] as const] : []))), bySlug: new Map() }

const internal = (to: string) => ({ kind: 'internal', to })

describe('B131(b) link-resolver sweep: no armor / accessory / set wiki fallback remains anywhere', () => {
  it('search rows, guide mentions, plan nodes, item-page materials and the item 404 (resolveTarget): every armor / set / accessory doc is in-app', () => {
    const external = docs.filter((d) => (d.type === 'armor' || d.type === 'accessory' || d.type === 'set') && resolveTarget(d).kind !== 'internal')
    expect(external.map((d) => d.id)).toEqual([])
    for (const a of armor) expect(resolveTarget(docsByRef.get(`i:${a.id}`) as SearchDoc)).toEqual(internal(`/armor/${a.id}`))
    for (const a of accessories) expect(resolveTarget(docsByRef.get(`i:${a.id}`) as SearchDoc)).toEqual(internal(`/accessories/${a.id}`))
    for (const s of sets) expect(resolveTarget(docsByRef.get(`set:${s.id}`) as SearchDoc)).toEqual(internal(`/armor/${s.id}`))
  })

  it('materials and "used in" rows on item / armor / accessory pages (refInfoFrom): every armor piece and accessory is in-app', () => {
    const info = refInfoFrom(docsByRef)
    for (const a of armor) expect(info(a.id)?.link, a.name).toEqual(internal(`/armor/${a.id}`))
    for (const a of accessories) expect(info(a.id)?.link, a.name).toEqual(internal(`/accessories/${a.id}`))
  })

  it('boss pages, the readiness checker and the loadout builder (itemResolver): every armor piece and accessory is in-app', () => {
    const itemOf = itemResolver({ names, weapons: [], accessories, armor, items: [] })
    for (const a of armor) expect(itemOf(a.id).link, a.name).toEqual(internal(`/armor/${a.id}`))
    for (const a of accessories) expect(itemOf(a.id).link, a.name).toEqual(internal(`/accessories/${a.id}`))
  })

  it('armor-set segments and suggestions (readiness, builder Step 3 — segmentContext.setHref): every set is its page; an unknown set is no link', () => {
    const page = { info: () => ({ id: 0, name: '', kind: 'other' }), conditions: { byId: new Map() }, engine: { sets: new Map(sets.map((s) => [s.id, s])) }, graph: { nodeById: new Map() } } as unknown as ReadinessPageData
    const ctx = segmentContext(page, {})
    for (const s of sets) expect(ctx.setHref(s.id)).toBe(`/armor/${s.id}`)
    expect(ctx.setHref('no-such-set')).toBeUndefined()
  })

  it('source guard: no app view builds a set / armor / accessory link from its record’s wikiUrl', () => {
    const sources = import.meta.glob<string>(['../../../../**/*.tsx', '../../../../**/*.ts', '!../../../../**/*.test.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const offenders: string[] = []
    for (const [path, code] of Object.entries(sources)) {
      if (/sets\.get\([^)]*\)\?\.wikiUrl/.test(code)) offenders.push(`${path}: a set's wikiUrl`)
      if (/kind: 'external',\s*href: (?:a|set|piece|accessory)\.wikiUrl/.test(code)) offenders.push(`${path}: an armor / accessory / set record's wikiUrl as a link`)
      if (/setUrl\b/.test(code)) offenders.push(`${path}: setUrl (the retired set-article resolver)`)
    }
    expect(offenders).toEqual([])
  })
})
