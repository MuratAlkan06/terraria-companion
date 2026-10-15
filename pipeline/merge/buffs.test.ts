/* Buff registry (P2-S7) on synthetic Buff IDs rows + buff / potion / weapon articles shaped like the
 * 2026-10-13 sync (pipeline/merge/buffs.ts states every rule). */
import { describe, expect, it } from 'vitest'
import { Buff } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import { buildBuffs, buffArticleTitles, cargoBuffNames, effectFromEntry, enemyDps, type BuffTable } from './buffs'
import { Evidence } from './evidence'
import type { BuffsOverlay } from './overlays'

const buffBox = (title: string, effects: string[], id: number) =>
  `<aside class="portable-infobox"><h2 class="pi-item pi-title">${title}</h2><div class="pi-item pi-data"><h3 class="pi-data-label">Effects</h3><div class="pi-data-value">${effects.join('<br />')}</div></div><div class="pi-item pi-data"><h3 class="pi-data-label"><a href="/wiki/Buff_IDs">Buff ID</a></h3><div class="pi-data-value">${id}</div></div></aside>`
const itemBox = (title: string, buffIds: string, tooltip?: string) =>
  `<div class="infobox item"><div class="title">${title}</div>${tooltip ? `<div class="section buff"><table class="stat"><tbody><tr><th>Buff tooltip</th><td><i>${tooltip}</i></td></tr></tbody></table></div>` : ''}<div class="section ids"><ul><li>Internal <a href="/wiki/Buff_IDs">Buff ID</a>:&#32;<b>${buffIds}</b></li></ul></div></div>`
const article = (title: string, html: string): [string, Article] => [title, { title, resolvedTitle: title, revid: 200, html, fetchedAt: '2026-10-13T08:00:00.000Z' }]
const ARTICLES = new Map<string, Article>([
  article('On Fire!', buffBox('On Fire!', ['−4 health <small>per second</small>', 'No health regeneration'], 24)),
  article('Acid Venom', buffBox('Acid Venom', ['−30 health per second <span class="note-text">(on enemies)</span>', '−15 health per second (on players)'], 70)),
  article('Zapped', buffBox('Zapped', ['Entity is engulfed in blue lightning'], 399) + buffBox('Zapped', ['Entity is engulfed in red lightning'], 400)),
  article('Ironskin Potion', `${itemBox('Ironskin Potion', '5', 'Increase defense by 8')}<p>The buff increases the player's defense by 8.</p>`),
  article('Blood Butcherer', itemBox('Blood Butcherer', '344')),
  article('Midas', buffBox('Midas', ['Affected enemy drops more coins upon death'], 72)),
  article('Odd', buffBox('Odd', ['−4 health per second (8 with Oiled)'], 9)),
  article('Wrongid', buffBox('Wrongid', ['No health regeneration'], 88)),
])
const TABLE: BuffTable = {
  url: 'https://terraria.wiki.gg/wiki/Buff_IDs',
  rev: 1029302,
  fetchedAt: '2026-10-13T08:00:00.000Z',
  rows: [
    { id: 5, name: 'Ironskin', internalName: 'Ironskin', isDebuff: false, article: 'Ironskin Potion' },
    { id: 9, name: 'Odd', internalName: 'Odd', isDebuff: true, article: 'Odd' },
    { id: 24, name: 'On Fire!', internalName: 'OnFire', isDebuff: true, article: 'On Fire!' },
    { id: 70, name: 'Acid Venom', internalName: 'Venom', isDebuff: true, article: 'Acid Venom' },
    { id: 72, name: 'Midas', internalName: 'Midas', isDebuff: true, article: 'Midas' },
    { id: 77, name: 'Wrongid', internalName: 'Wrongid', isDebuff: true, article: 'Wrongid' },
    { id: 344, name: 'Blood Butchered', internalName: 'BloodButcherer', isDebuff: true, article: 'Blood Butcherer' },
    { id: 399, name: 'Zapped', internalName: 'BlueLightning', isDebuff: true, article: 'Zapped' },
    { id: 400, name: 'Zapped', internalName: 'RedLightning', isDebuff: true, article: 'Zapped' },
  ],
}
const overlay = (entries: BuffsOverlay['entries']): BuffsOverlay => ({ overlay: 'buffs', authoredAt: '2026-10-13', notes: [], entries })
const IRONSKIN = overlay([{ name: 'Ironskin', effects: [{ stat: 'defense-flat', value: 8, quote: 'Increase defense by 8' }] }])
const members = (names: string[]) => new Map(names.map((n) => [n, [`inflicted by test (${n})`]]))
const run = (names: string[], o = IRONSKIN) => buildBuffs({ table: TABLE, members: members(names), overlay: o, articles: ARTICLES, evidence: new Evidence(ARTICLES) })

describe('buff helpers', () => {
  it('enemyDps: the "(on enemies)" line, else an unqualified line; null when no health loss is stated; undefined when unparsed', () => {
    expect(enemyDps(['−30 health per second (on enemies)', '−15 health per second (on players)'])).toBe(30)
    expect(enemyDps(['−4 health per second', 'No health regeneration'])).toBe(4)
    expect(enemyDps(['No health regeneration (on players)'])).toBeNull()
    expect(enemyDps(['−4 health per second (8 with Oiled)'])).toBeUndefined()
  })

  it('effectFromEntry: a stat quote must state the value, the sign and the scope; specials keep the verbatim text', () => {
    const url = 'https://terraria.wiki.gg/wiki/Tipsy'
    expect(effectFromEntry({ stat: 'damage-pct', value: 10, scope: 'melee', quote: '+10% melee damage' }, url, 'w')).toEqual({ kind: 'stat', stat: 'damage-pct', value: 10, scope: 'melee' })
    expect(effectFromEntry({ special: '+5 Fishing Power' }, url, 'w')).toEqual({ kind: 'special', text: '+5 Fishing Power', simulated: false, sourceUrl: url })
    expect(() => effectFromEntry({ stat: 'damage-pct', value: 12, quote: '+10% melee damage' }, url, 'w')).toThrow('does not state the value 12')
    expect(() => effectFromEntry({ stat: 'defense-flat', value: -4, quote: '4 defense bonus' }, url, 'w')).toThrow('does not state a reduction')
    expect(() => effectFromEntry({ stat: 'damage-pct', value: 10, scope: 'magic', quote: '+10% melee damage' }, url, 'w')).toThrow('does not name the scope "magic"')
  })

  it('cargoBuffNames / buffArticleTitles: ^-lists of buff names → the Buff IDs table articles', () => {
    const names = cargoBuffNames([{ name: 'Venom Arrow', debuffs: 'Acid Venom^Potent Acid' }, { name: 'Flare', debuffs: 'On Fire!' }, { name: 'Bow', debuffs: '' }], 'debuffs')
    expect([...names]).toEqual([['Acid Venom', ['Venom Arrow']], ['Potent Acid', ['Venom Arrow']], ['On Fire!', ['Flare']]])
    expect(buffArticleTitles(TABLE.rows, ['Zapped', 'On Fire!', 'Unknown buff'])).toEqual(['On Fire!', 'Zapped'])
  })
})

describe('buildBuffs', () => {
  const out = run(['On Fire!', 'Acid Venom', 'Zapped', 'Ironskin', 'Blood Butchered', 'Midas', 'Odd', 'Wrongid', 'Not A Buff'])
  const buff = (id: string) => out.buffs.find((b) => b.id === id)!

  it('emits schema-valid records keyed by name slug; a name the Buff IDs table lacks is a gap, not a record', () => {
    for (const b of out.buffs) expect(Buff.parse(b)).toEqual(b)
    expect(out.buffs.map((b) => b.id)).toEqual(['acid-venom', 'blood-butchered', 'ironskin', 'midas', 'odd', 'on-fire', 'wrongid', 'zapped'])
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'buff:not-a-buff', kind: 'count-reconciliation' }))
    expect(out.slugByName.get('On Fire!')).toBe('on-fire')
  })

  it('dot.dps = enemy health loss per second; none stated → not applicable; no buff infobox / unparsed line → Unknown; a "Buff" has no DoT', () => {
    expect(buff('on-fire')).toMatchObject({ gameBuffId: 24, isDebuff: true, dot: { dps: 4 }, wikiUrl: 'https://terraria.wiki.gg/wiki/On_Fire!' })
    expect(buff('acid-venom').dot).toEqual({ dps: 30 })
    expect(buff('midas').dot).toBeUndefined()
    expect(buff('midas')._prov.unverifiedFields).toEqual(['effects'])
    expect(buff('blood-butchered')._prov.unverifiedFields).toEqual(['dot', 'effects']) // weapon page: no buff infobox
    expect(buff('odd')._prov.unverifiedFields).toContain('dot')
    expect(buff('ironskin')._prov.unverifiedFields).toEqual([])
  })

  it('gameBuffId: cross-checked with the article; several IDs under one name or a disagreement → Unknown', () => {
    expect(buff('zapped').gameBuffId).toBeUndefined()
    expect(buff('zapped')._prov.unverifiedFields).toEqual(['effects', 'gameBuffId'])
    expect(buff('wrongid').gameBuffId).toBeUndefined()
    expect(out.gaps).toContainEqual(expect.objectContaining({ ref: 'buff:wrongid', field: 'gameBuffId', kind: 'source-mismatch' }))
    expect(buff('blood-butchered').gameBuffId).toBe(344) // stated as "Internal Buff ID" on the weapon page
    expect(out.crossCheck.get('gameBuffId (Buff IDs table vs article)')).toEqual({ agree: 6, mismatch: 1, noWikiValue: 0 })
  })

  it('overlay effects are verbatim, number-checked quotes of the buff article (curated provenance); a quote not on the page fails the build', () => {
    expect(buff('ironskin')).toMatchObject({ isDebuff: false, effects: [{ kind: 'stat', stat: 'defense-flat', value: 8 }], wikiUrl: 'https://terraria.wiki.gg/wiki/Ironskin_Potion' })
    expect(buff('ironskin')._prov.sources).toContainEqual(expect.objectContaining({ kind: 'curated', overlay: 'buffs', rev: 200 }))
    expect(buff('ironskin')._prov.sources).toContainEqual(expect.objectContaining({ kind: 'wiki-article', url: TABLE.url, rev: 1029302 }))
    expect(() => run(['Ironskin'], overlay([{ name: 'Ironskin', effects: [{ stat: 'defense-flat', value: 8, quote: 'Increases defense by 8 points' }] }]))).toThrow('quote not found verbatim')
    expect(() => run(['On Fire!'], IRONSKIN)).toThrow('not a member of the buff registry')
  })
})
