/* Potion corpus (AMENDMENTS-014 B70, merge/potions.ts) on synthetic Cargo Items rows + Iteminfo stats +
 * article infoboxes shaped like the 2026-10-14 sync. */
import { describe, expect, it } from 'vitest'
import { Item } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import type { Iteminfo } from '../parse/iteminfo'
import type { GatingResult } from './gating'
import { BUFF_POTIONS_PAGE, buildPotions, durationTicksOf, identifyPotions, infoboxBuffDurations, parseBuffPotionsTable, parsePotionNavbox, potionBuffNames } from './potions'

const DEFAULTS = { rare: 0, value: 0, maxStack: 9999, consumable: true, buffType: 0, buffTime: 0, healLife: 0, healMana: 0, potion: false }
const ITEMS: { id: number; name: string; stats: Record<string, unknown> }[] = [
  { id: 28, name: 'Lesser Healing Potion', stats: { healLife: 50, potion: true, value: 300 } },
  { id: 110, name: 'Lesser Mana Potion', stats: { healMana: 50 } },
  { id: 292, name: 'Ironskin Potion', stats: { buffType: 5, buffTime: 28800, rare: 1, value: 1000 } },
  { id: 303, name: 'Archery Potion', stats: { buffType: 16, buffTime: 28800, rare: 1 } },
  { id: 353, name: 'Ale', stats: { buffType: 25, buffTime: 7200 } },
  { id: 2350, name: 'Recall Potion', stats: {} },
  { id: 3001, name: 'Strange Brew', stats: { healLife: 70, potion: true } },
  { id: 357, name: 'Bowl of Soup', stats: { buffType: 206, buffTime: 36000 } },
]
const info: Iteminfo = {
  rev: 1023241,
  revTimestamp: '2026-08-22T03:26:22Z',
  fetchedAt: '2026-10-14T00:00:00.000Z',
  generated: '2026-08-22',
  terrariaVersion: '1.4.5.7',
  items: new Map(ITEMS.map((i) => [i.id, { id: i.id, internalName: i.name.replaceAll(' ', ''), name: i.name, stats: { ...DEFAULTS, ...i.stats } }])),
  idsByName: new Map(ITEMS.map((i) => [i.name, [i.id]])),
  wikiIdFromName: new Map(),
}
const row = (over: Record<string, string>): CargoRow => ({ _rowid: '1', _page: over.name ?? '', itemid: '', name: '', internalname: '', imagefile: '', type: 'potion', listcat: '', tag: '', rare: '0', consumable: '1', buffs: '', debuffs: '', hheal: '', mheal: '', unobtainable: '', ...over })
const ROWS: CargoRow[] = [
  row({ _rowid: '1', itemid: '28', name: 'Lesser Healing Potion', type: 'potion^crafting material', debuffs: 'Potion Sickness', hheal: '50', imagefile: 'Lesser Healing Potion.png', tag: 'vendor:Merchant' }),
  row({ _rowid: '2', itemid: '110', name: 'Lesser Mana Potion', debuffs: 'Mana Sickness', mheal: '50' }),
  row({ _rowid: '3', itemid: '292', name: 'Ironskin Potion', buffs: 'Ironskin', rare: '1' }),
  row({ _rowid: '4', itemid: '303', name: 'Archery Potion', buffs: 'Archery', rare: '1' }),
  row({ _rowid: '5', itemid: '353', name: 'Ale', type: 'potion^ammunition', debuffs: 'Tipsy' }),
  row({ _rowid: '6', itemid: '2350', name: 'Recall Potion' }),
  row({ _rowid: '7', itemid: '3001', name: 'Strange Brew', debuffs: 'Potion Sickness', hheal: '70–120' }),
  row({ _rowid: '8', itemid: '357', name: 'Bowl of Soup', type: 'food^potion', buffs: 'Plenty Satisfied' }),
]
const ids = (v: string) => `<div class="section ids"><ul><li>Internal <a href="/wiki/Item_IDs">Item ID</a>:&#32;<b>${v}</b></li></ul></div>`
const box = (title: string, itemId: number, rows: [string, string][]) => `<div class="infobox item"><div class="title">${title}</div><table class="stat"><tbody>${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</tbody></table>${ids(String(itemId))}</div>`
const article = (title: string, html: string): [string, Article] => [title, { title, resolvedTitle: title, revid: 400, html, fetchedAt: '2026-10-14T08:00:00.000Z' }]
const tableRow = (name: string, duration: string, type: string) => `<tr><td class="result" data-sort-value="${name}"><a href="/wiki/x">${name}</a></td><td class="ingredients"></td><td class="col-C-1">tip</td><td class="col-C-2">${duration}</td><td class="col-C-3"></td><td class="col-C-4">${type}</td></tr>`
const navbox = `<div class="ranger-row"><div class="ranger-group level-0"><div class="ranger-wrap">Health</div></div><div class="ranger-listbox"><ul><li><a href="/wiki/Lesser_Healing_Potion" title="Lesser Healing Potion">Lesser Healing</a></li><li><a href="/wiki/Strange_Brew" title="Strange Brew">Strange Brew</a></li></ul></div></div><div class="ranger-row"><div class="ranger-group level-0"><div class="ranger-wrap">Tipsy</div></div><div class="ranger-listbox"><ul><li><a href="/wiki/Ale" title="Ale">Ale</a></li></ul></div></div>`
const ARTICLES = new Map<string, Article>([
  article(BUFF_POTIONS_PAGE, `<table class="terraria">${tableRow('Archery Potion', '8&#160;minutes', 'Battle')}${tableRow('Ironskin Potion', '8 minutes', 'Battle')}${tableRow('Love Potion', '30 seconds', 'Miscellaneous')}</table>${navbox}`),
  article('Lesser Healing Potion', box('Lesser Healing Potion', 28, [['Heals Health', '50'], ['Debuff', 'Potion Sickness'], ['Debuff tooltip', 'Cannot consume anymore healing items'], ['Duration', '1 minute']])),
  article('Lesser Mana Potion', box('Lesser Mana Potion', 110, [['Heals Mana', '50'], ['Debuff', 'Mana Sickness'], ['Duration', '5 seconds']])),
  article('Ironskin Potion', box('Ironskin Potion', 292, [['Buff', 'Ironskin'], ['Buff tooltip', 'Increase defense by 8'], ['Duration', '8 minutes']])),
  article('Archery Potion', box('Archery Potion', 303, [['Buff', 'Archery'], ['Duration', '7 minutes']])),
  article('Strange Brew', box('Strange Brew', 3001, [['Heals Health', '70–120'], ['Debuff', 'Potion Sickness'], ['Duration', '40–70 seconds']])),
])
const TABLE = [
  { id: 5, name: 'Ironskin', internalName: 'Ironskin', isDebuff: false, article: 'Ironskin Potion' },
  { id: 16, name: 'Archery', internalName: 'Archery', isDebuff: false, article: 'Archery Potion' },
  { id: 21, name: 'Potion Sickness', internalName: 'PotionSickness', isDebuff: true, article: 'Potion Sickness' },
  { id: 94, name: 'Mana Sickness', internalName: 'ManaSickness', isDebuff: true, article: 'Mana Sickness' },
  { id: 25, name: 'Tipsy', internalName: 'Tipsy', isDebuff: true, article: 'Tipsy' },
]
const slugs: Record<string, string> = { Ironskin: 'ironskin', Archery: 'archery', 'Potion Sickness': 'potion-sickness', 'Mana Sickness': 'mana-sickness' }
const GATE_FREE: GatingResult = { ok: true, gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } }
const build = () =>
  buildPotions({
    itemRows: ROWS,
    itemsFetchedAt: '2026-10-14T02:50:00.000Z',
    iteminfo: info,
    articles: ARTICLES,
    images: { found: new Map([['Lesser Healing Potion.png', { file: 'Lesser Healing Potion.png', title: 'File:Lesser Healing Potion.png', url: 'https://terraria.wiki.gg/images/Lesser_Healing_Potion.png', descriptionUrl: 'https://terraria.wiki.gg/wiki/File:Lesser_Healing_Potion.png', sha1: 'b'.repeat(40), bytes: 300, width: 14, height: 24, mime: 'image/png' }]]), missing: [], fetchedAt: '2026-10-14T08:00:00.000Z' },
    recipes: [{ id: '292-abc', resultItemId: 292 }],
    drops: [],
    gating: (id) => (id === 292 ? GATE_FREE : { ok: false, blockers: ['no-known-route'] }),
    elsewhere: new Map([[353, 'an ammo item']]),
    usedSlugs: new Set(),
    stationIds: new Set(),
    buffTable: TABLE,
    buffSlug: (name) => slugs[name],
  })
const byName = (items: Item[], name: string) => items.find((i) => i.name === name) as Item

describe('potion corpus helpers', () => {
  it('durations: minutes / seconds / ranges → ticks; anything else undefined', () => {
    expect(durationTicksOf('8 minutes')).toBe(28800)
    expect(durationTicksOf('1 minute')).toBe(3600)
    expect(durationTicksOf('45 seconds')).toBe(2700)
    expect(durationTicksOf('40–70 seconds')).toEqual({ minTicks: 2400, maxTicks: 4200 })
    expect(durationTicksOf('2 / 4 minutes')).toBeUndefined()
  })

  it('infobox Buff / Debuff sections own the Duration row that follows them', () => {
    const boxes = [{ title: 'x', itemIds: [1], projectileIds: [], buffIds: [], rows: [{ label: 'Buff', value: 'Honey' }, { label: 'Duration', value: '15 seconds' }, { label: 'Debuff', value: 'Potion Sickness' }, { label: 'Duration', value: '1 minute' }] }]
    expect([...infoboxBuffDurations(boxes[0])]).toEqual([['Honey', '15 seconds'], ['Potion Sickness', '1 minute']])
  })

  it('the Buff potions table (one row per potion) and the Potions navbox groups', () => {
    const html = (ARTICLES.get(BUFF_POTIONS_PAGE) as Article).html
    expect(parseBuffPotionsTable(html)).toEqual([
      { name: 'Archery Potion', duration: '8 minutes', type: 'Battle' },
      { name: 'Ironskin Potion', duration: '8 minutes', type: 'Battle' },
      { name: 'Love Potion', duration: '30 seconds', type: 'Miscellaneous' },
    ])
    expect([...parsePotionNavbox(html)]).toEqual([['Health', ['Lesser Healing Potion', 'Strange Brew']], ['Tipsy', ['Ale']]])
  })

  it('identification: potion-typed, not food, a buff or healing in Iteminfo; another collection keeps its item', () => {
    const idn = identifyPotions(ROWS, info, new Map([[353, 'an ammo item']]))
    expect(idn.typedRows).toBe(7)
    expect(idn.included.map((c) => c.name)).toEqual(['Lesser Healing Potion', 'Lesser Mana Potion', 'Ironskin Potion', 'Archery Potion', 'Strange Brew'])
    expect(idn.excluded.map((e) => e.reason)).toEqual([expect.stringContaining('emitted as an ammo item'), expect.stringContaining('grants no buff and restores no health or mana')])
    expect([...potionBuffNames(idn, TABLE).keys()].sort()).toEqual(['Archery', 'Ironskin', 'Mana Sickness', 'Potion Sickness'])
  })
})

describe('buildPotions', () => {
  const out = build()

  it('emits schema-valid potion items: heal amounts, buffs with durations, gating from the deriver', () => {
    for (const i of out.items) expect(() => Item.parse(i)).not.toThrow()
    expect(byName(out.items, 'Lesser Healing Potion')).toMatchObject({ category: 'potion', healLife: 50, buffGrants: [{ buffId: 'potion-sickness', durationTicks: 3600 }], tags: ['healing-potion'], sprite: '/sprites/items/28.png' })
    expect(byName(out.items, 'Lesser Mana Potion')).toMatchObject({ healMana: 50, buffGrants: [{ buffId: 'mana-sickness', durationTicks: 300 }], tags: ['mana-potion'] })
    expect(byName(out.items, 'Ironskin Potion')).toMatchObject({ buffGrants: [{ buffId: 'ironskin', durationTicks: 28800 }], tags: ['battle', 'buff-potion'], gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' }, stage: 'early-prehm' })
    expect(byName(out.items, 'Ironskin Potion')._prov.verified).toBe(true)
  })

  it('cross-checks withhold: a heal range vs one game value, a duration the infobox contradicts', () => {
    const brew = byName(out.items, 'Strange Brew')
    expect(brew.healLife).toBeUndefined()
    expect(brew._prov.unverifiedFields).toContain('healLife')
    expect(brew.buffGrants).toEqual([{ buffId: 'potion-sickness', durationTicks: { minTicks: 2400, maxTicks: 4200 } }])
    const archery = byName(out.items, 'Archery Potion')
    expect(archery.buffGrants).toEqual([{ buffId: 'archery' }]) // Iteminfo 28800 vs the infobox's "7 minutes"
    expect(archery._prov.unverifiedFields).toContain('buffGrants.0.durationTicks')
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'i:303', field: 'buffGrants.0.durationTicks', kind: 'source-mismatch' }))
  })

  it('reconciles against the Buff potions table and the navbox groups', () => {
    expect(out.reconciliation).toEqual([
      { name: 'Archery Potion', group: 'Buff potions table (Battle)', outcome: 'emitted', ref: 'i:303' },
      { name: 'Ironskin Potion', group: 'Buff potions table (Battle)', outcome: 'emitted', ref: 'i:292' },
      { name: 'Love Potion', group: 'Buff potions table (Miscellaneous)', outcome: 'no Cargo Items potion row with this name' },
      { name: 'Lesser Healing Potion', group: 'Potions navbox: Health', outcome: 'emitted', ref: 'i:28' },
      { name: 'Strange Brew', group: 'Potions navbox: Health', outcome: 'emitted', ref: 'i:3001' },
      { name: 'Ale', group: 'Potions navbox: Tipsy', outcome: expect.stringContaining('emitted as an ammo item') },
    ])
  })
})
