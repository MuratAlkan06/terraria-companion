/* Armor database (PRD P6-S1 AC1–AC3; AMENDMENTS-016 B131(b)): the set model (variants, B52 hybrids, full-set totals with
 * the set bonus once), the set-bonus-aware comparison, stage peers, browse filters, the /armor/:id route ids, and the
 * pages server-rendered from the shipped data through the app's own loaders — every set (Unknown markers ⇄ badge,
 * hash targets, no dead links), a hybrid set, a comparison where the set bonus changes the answer, Unknown-heavy
 * pieces, the list — and the copy audit. */
import { Tooltip } from 'radix-ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArmorPiece, ArmorSet } from '../../../../data-access/types'
import { auditCopy } from '../../../../scoring/copyAudit'
import { APP_ROUTES } from '../../../routes'
import * as copy from './armorCopy'
import { loadArmorData, loadArmorSections, type ArmorData } from './armorData'
import ArmorDetailPage from './ArmorDetailPage'
import ArmorListPage from './ArmorListPage'
import {
  buildArmorFacets,
  compareSets,
  compareState,
  EMPTY_ARMOR_FILTERS,
  loosePieceEntries,
  matchesArmor,
  parseArmorFilters,
  resolveArmorId,
  setEntries,
  setPieceIds,
  setTotals,
  stagePeers,
  toggleArmorFilter,
  variantsOf,
  writeArmorFilters,
} from './armorModel'
import { armorCompareHref, armorPieceHref, armorSetHref, pieceAnchorId } from './armorNav'
import { statAmount, statLabel } from './equipmentDisplay'

/** The armor-sets overlay as stored (its quotes are checked verbatim against the cached articles at build). */
const OVERLAY = JSON.parse(
  Object.values(import.meta.glob<string>('../../../../../pipeline/overlays/armor-sets.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '{"entries":[]}',
) as { entries: { page: string; combination?: { legs?: { quote: string } } }[] }

let data: ArmorData
const set = (id: string): ArmorSet => {
  const s = data.sets.get(id)
  if (!s) throw new Error(`fixture set missing: ${id}`)
  return s
}
const piece = (name: string): ArmorPiece => {
  const p = [...data.armor.values()].find((x) => x.name === name)
  if (!p) throw new Error(`fixture piece missing: ${name}`)
  return p
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // the sprite manifest is fetched: absent under Node → placeholder art
  data = await loadArmorData()
  // warm every section the pages read, so they render on their first frame (as on back navigation)
  await Promise.all([...data.sets.values()].map((s) => loadArmorSections(setPieceIds(s).map((id) => data.armor.get(id)).filter((p): p is ArmorPiece => p !== undefined))))
  await Promise.all(loosePieceEntries(data.armor, data.sets.values()).map((e) => loadArmorSections([e.piece])))
}, 120_000)

const renderAt = (path: string) =>
  renderToStaticMarkup(
    createElement(
      Tooltip.Provider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: '/armor', element: createElement(ArmorListPage) }), createElement(Route, { path: '/armor/:id', element: createElement(ArmorDetailPage) })),
      ),
    ),
  )
const markers = (html: string) => [...html.matchAll(/data-unknown-field="([^"]+)"/g)].map((m) => m[1])
/** The partially-verified badge's own count (its screen-reader text), 0 when the badge is absent. */
const badgeCount = (html: string) => {
  const m = /show which (?:(\d+) values are|value is) unknown/.exec(html)
  return m ? (m[1] ? Number(m[1]) : 1) : 0
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
/** The page's own words: wiki quotes and the shared Unknown screen-reader wording removed. */
const ownWords = (html: string) => text(html.replace(/<span data-wiki-text=""[^>]*>[^<]*<\/span>/g, ' ')).replace(/\(not yet verified(, show details)?\)/g, ' ')

describe('data: sets, pieces and the route ids', () => {
  it('69 sets and 256 pieces; every set piece exists; 14 pieces outside the recorded sets; one variant per helmet (per helmet × chest where keyed)', () => {
    expect(data.sets.size).toBe(69)
    expect(data.armor.size).toBe(256)
    for (const s of data.sets.values()) {
      for (const id of setPieceIds(s)) expect(data.armor.has(id), `${s.id}: ${id}`).toBe(true)
      const keyed = s.variants.some((v) => v.chestId !== undefined)
      expect(s.variants.length, s.id).toBe(s.pieces.helmets.length * (keyed ? setPieceIds(s).filter((id) => data.armor.get(id)?.slot === 'chest').length : 1))
    }
    const loose = loosePieceEntries(data.armor, data.sets.values())
    expect(loose).toHaveLength(14)
    expect(loose.map((e) => e.name)).not.toContain('Wizard Hat')
    expect(loose.map((e) => e.name)).toContain('Viking Helmet')
    const inSets = new Set([...data.sets.values()].flatMap(setPieceIds))
    expect(inSets.size + loose.length).toBe(256)
  })

  it('/armor/:id — a slug is its set, a set piece goes to its set at the piece, a loose piece has its own page, anything else is a 404', () => {
    expect(resolveArmorId('frost-armor', data)).toMatchObject({ kind: 'set', set: { id: 'frost-armor' } })
    expect(resolveArmorId('684', data)).toMatchObject({ kind: 'in-set', set: { id: 'frost-armor' }, pieceId: 684 })
    // P6 fix round: an alternative chest and a combination set's hat open their set at the piece
    expect(resolveArmorId('2201', data)).toMatchObject({ kind: 'in-set', set: { id: 'beetle-armor' }, pieceId: 2201 })
    expect(resolveArmorId(String(piece('Wizard Hat').id), data)).toMatchObject({ kind: 'in-set', set: { id: 'wizard-set' } })
    expect(resolveArmorId(String(piece('Viking Helmet').id), data)).toMatchObject({ kind: 'piece', piece: { name: 'Viking Helmet' } })
    for (const bad of ['nope-armor', '999999', '0', '1.5', '']) expect(resolveArmorId(bad, data), bad).toEqual({ kind: 'none' })
    expect(armorPieceHref(684)).toBe('/armor/684')
    expect(armorSetHref('frost-armor')).toBe('/armor/frost-armor')
    expect(armorCompareHref('jungle-armor', 'platinum-armor')).toBe('/armor/jungle-armor?vs=platinum-armor#armor-compare-title')
  })
})

describe('set model: variants (B52), full-set totals (AC1/AC2)', () => {
  it('a hybrid set names every class of its variant, curated; a multi-helmet set has one variant per helmet', () => {
    const [frost] = variantsOf(set('frost-armor'), data.armor)
    expect(frost).toMatchObject({ classes: ['melee', 'ranged'], hybrid: true, curated: true })
    const hallowed = variantsOf(set('hallowed-armor'), data.armor)
    expect(hallowed.map((v) => v.classes)).toEqual([['melee'], ['ranged'], ['magic'], ['summon']])
    expect(hallowed.every((v) => !v.hybrid)).toBe(true)
    // every hybrid variant in the data has ≥ 2 classes and its set keeps `class: "other"` beside them (B52)
    const hybrids = [...data.sets.values()].filter((s) => variantsOf(s, data.armor).some((v) => v.hybrid))
    expect(hybrids.map((s) => s.id).sort()).toEqual(
      ['apprentice-armor', 'dark-artist-armor', 'forbidden-armor', 'frost-armor', 'huntress-armor', 'monk-armor', 'red-riding-armor', 'shinobi-infiltrator-armor', 'squire-armor', 'valhalla-knight-armor'].sort(),
    )
  })

  it('totals add the pieces and the set bonus ONCE: Platinum armor is 16 defense of pieces + 4 of set bonus = 20', () => {
    const [v] = variantsOf(set('platinum-armor'), data.armor)
    const t = setTotals(set('platinum-armor'), v, data.armor)
    expect(t.defense).toEqual({ kind: 'known', total: 20, pieces: 16, bonus: 4 })
    // a per-piece sum never sees the bonus
    expect(t.pieceIds.reduce((n, id) => n + (data.armor.get(id)?.defense ?? 0), 0)).toBe(16)
  })

  it('Frost armor: +16% melee and ranged damage from the helmet, the set bonus kept as quoted text where the data has no number', () => {
    const [v] = variantsOf(set('frost-armor'), data.armor)
    const t = setTotals(set('frost-armor'), v, data.armor)
    const lines = Object.fromEntries(t.lines.map((l) => [l.key, l.total]))
    expect(lines['damage-pct:melee']).toBeGreaterThanOrEqual(16)
    expect(lines['damage-pct:ranged']).toBeGreaterThanOrEqual(16)
    expect(t.specials.some((s) => s.from === 'bonus')).toBe(true)
    expect(statLabel('damage-pct', 'melee')).toBe('Melee damage')
    expect(statAmount('mana-cost-pct', -14)).toBe('−14%')
    expect(statAmount('lava-immunity-ticks', 420)).toBe('+420 ticks (7 seconds)') // ticks with seconds, the wings' pattern
  })

  it('every set and helmet: totals = Σ pieces + Σ bonus per stat (nothing dropped, nothing double-counted)', () => {
    for (const s of data.sets.values()) {
      for (const v of variantsOf(s, data.armor)) {
        const t = setTotals(s, v, data.armor)
        const pieces = t.pieceIds.map((id) => data.armor.get(id) as ArmorPiece)
        const effects = [...pieces.flatMap((p) => p.effects), ...v.setBonus]
        for (const l of t.lines) {
          const sum = effects.filter((e) => e.kind === 'stat' && e.stat === l.stat && e.scope === l.scope).reduce((n, e) => n + (e.kind === 'stat' ? e.value : 0), 0)
          expect(l.total, `${s.id} ${l.key}`).toBe(sum)
        }
        if (t.defense.kind === 'known') {
          const flat = effects.filter((e) => e.kind === 'stat' && e.stat === 'defense-flat').reduce((n, e) => n + (e.kind === 'stat' ? e.value : 0), 0)
          expect(t.defense.total, s.id).toBe(pieces.reduce((n, p) => n + (p.defense ?? 0), 0) + flat)
        }
      }
    }
  })
})

describe('AC2: comparing two sets compares set-bonus-aware totals — verified with a set whose bonus changes the comparison', () => {
  it('Jungle vs Platinum: the pieces alone give Jungle more defense (17 vs 16); with the set bonuses Platinum gives more (17 vs 20)', () => {
    const jungle = set('jungle-armor')
    const platinum = set('platinum-armor')
    const rows = compareSets(setTotals(jungle, variantsOf(jungle, data.armor)[0], data.armor), setTotals(platinum, variantsOf(platinum, data.armor)[0], data.armor))
    const defense = rows.find((r) => r.key === 'defense')
    expect(defense).toMatchObject({ a: { kind: 'value', total: 17, pieces: 17, bonus: 0 }, b: { kind: 'value', total: 20, pieces: 16, bonus: 4 }, bonusChangesOrder: true })
    // a stat only one set gives reads "None" on the other side, never Unknown and never dropped
    expect(rows.some((r) => r.a.kind === 'none' || r.b.kind === 'none')).toBe(true)
  })

  it('the page: ?vs= renders both full sets side by side, the defense row flagged, and says in words that the bonus changes it', () => {
    const html = renderAt('/armor/jungle-armor?vs=platinum-armor')
    expect(html).toContain('data-armor-compare="platinum-armor"')
    expect(html).toMatch(/<tr[^>]*data-compare-row="defense"[^>]*data-bonus-changes=""/)
    const table = /<table[^>]*data-compare-table=""[\s\S]*?<\/table>/.exec(html)?.[0] ?? ''
    // the breakdown signs each part ("+4 from the set bonus") — no sum to work out, no "−" reading as subtraction
    expect(text(table)).toMatch(/Defense 17 20 16 from pieces, \+4 from the set bonus/)
    expect(text(html)).toContain(copy.bonusChanges('Defense', 'Platinum armor', 'Jungle armor'))
    expect(html).toContain('<caption class="sr-only">Jungle armor and Platinum armor, full sets with their set bonuses</caption>')
    // an unknown ?vs= id is no comparison (never a guessed set)
    expect(renderAt('/armor/jungle-armor?vs=nope')).toContain('data-armor-compare=""')
  })

  it('multi-helmet sets: the other side defaults to a helmet of a matching class; ?helmet / ?vshelmet pick one', () => {
    const hallowed = set('hallowed-armor')
    const adamantite = set('adamantite-armor')
    const magicHelmet = variantsOf(hallowed, data.armor).find((v) => v.classes[0] === 'magic')!.helmetId
    const state = compareState(hallowed, data.sets, data.armor, new URLSearchParams(`vs=${adamantite.id}&helmet=${magicHelmet}`))
    expect(state.aVariant.classes).toEqual(['magic'])
    expect(state.bVariant?.classes).toEqual(['magic'])
    const picked = compareState(hallowed, data.sets, data.armor, new URLSearchParams(`vs=${adamantite.id}&vshelmet=${adamantite.variants[1].helmetId}`))
    expect(picked.bVariant?.helmetId).toBe(adamantite.variants[1].helmetId)
    // with no ?helmet, each side opens on its first helmet in class order (melee first)
    expect(compareState(hallowed, data.sets, data.armor, new URLSearchParams(`vs=${adamantite.id}`)).aVariant.classes).toEqual(['melee'])
    const html = renderAt(`/armor/hallowed-armor?vs=adamantite-armor`)
    expect((html.match(/<select /g) ?? []).length).toBe(3) // the set picker + a helmet picker per side
  })
})

describe('AC3: "Comparable sets at this stage" links work', () => {
  it('peers share the VERIFIED stage; each links its set page and the comparison; an Unknown stage lists none (never guessed)', () => {
    const copper = set('copper-armor')
    const peers = stagePeers(copper, data.sets.values())
    expect(peers.length).toBeGreaterThan(3)
    expect(peers.every((p) => p.stage === copper.stage && p.id !== copper.id)).toBe(true)
    const html = renderAt('/armor/copper-armor')
    expect(html).toContain(`data-peers="${peers.length}"`)
    for (const p of peers) {
      expect(html).toContain(`href="/armor/${p.id}"`)
      expect(html).toContain(`href="${armorCompareHref('copper-armor', p.id).replace(/&/g, '&amp;')}"`)
    }
    const unknown = [...data.sets.values()].find((s) => s._prov.unverifiedFields.includes('stage')) as ArmorSet
    expect(stagePeers(unknown, data.sets.values())).toEqual([])
    expect(renderAt(`/armor/${unknown.id}`)).toContain('data-peers="unknown-stage"')
  })
})

describe('set and piece pages (server-rendered from the shipped data)', () => {
  it('every set: Unknown markers ⇄ the partially-verified badge; each piece a #piece-<id> hash target; acq-title present; no dead local link', () => {
    const routes = APP_ROUTES.map((r) => r.path)
    const mismatches: string[] = []
    const dead: string[] = []
    for (const s of data.sets.values()) {
      const html = renderAt(armorSetHref(s.id))
      const pieces = setPieceIds(s).map((id) => data.armor.get(id) as ArmorPiece)
      const rendered = markers(html).length
      if (rendered !== badgeCount(html)) mismatches.push(`${s.id}: page ${rendered}, badge ${badgeCount(html)}`)
      for (const p of pieces) expect(html, s.id).toMatch(new RegExp(`<h3 id="${pieceAnchorId(p.id)}" tabindex="-1"`))
      expect(html).toContain('id="acq-title"')
      for (const [, href] of html.matchAll(/href="(\/[^"#]*)/g)) {
        const path = href.replace(/&amp;/g, '&').split('?')[0]
        const armor = /^\/armor\/(.+)$/.exec(path)
        if (armor ? resolveArmorId(armor[1], data).kind === 'none' : !routes.some((p) => new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(path))) dead.push(`${s.id} → ${href}`)
      }
    }
    expect(mismatches).toEqual([])
    expect(dead).toEqual([])
  })

  it('a hybrid set (Frost armor): classes "Melee + ranged", curated, the hybrid note, the bonus quoted, per-piece stats', () => {
    const html = renderAt('/armor/frost-armor')
    expect(html).toContain('data-classes="melee+ranged"')
    expect(text(html)).toContain('Melee + ranged')
    expect(text(html)).toContain('curated')
    expect(html).toContain('data-hybrid=""')
    const bonus = set('frost-armor').variants[0].setBonusText
    expect(html).toContain(`“${bonus.replace(/'/g, '&#x27;')}”`)
    expect(html).toContain('data-helmet-classes="melee+ranged"')
    expect(text(html)).toMatch(/Frost Helmet[\s\S]*Defense 10/)
    expect(text(html)).toContain('+16% melee damage')
    // piece materials and gates: in-app links (Frost Core is an Item record)
    expect(html).toMatch(/href="\/items\/\d+"/)
    expect(html).not.toMatch(/href="https:\/\/terraria\.wiki\.gg\/wiki\/[^"]*"[^>]*target="_blank"[^>]*>[^<]*(Helmet|Breastplate|Leggings)/)
  })

  it('BLOCKER (a): Beetle armor is a SET page — both set bonuses quoted, each with the chest it comes with; a totals card per chest (61 / 73)', () => {
    const html = renderAt('/armor/beetle-armor')
    const words = text(html)
    expect(html).toContain('“Beetles increase your melee damage and speed”')
    expect(html).toContain('“Beetles protect you from damage”')
    expect(words).toContain(copy.bonusFor('Beetle Scale Mail (melee)'))
    expect(words).toContain(copy.bonusFor('Beetle Shell (melee)'))
    expect((html.match(/data-bonus-group="/g) ?? []).length).toBe(2)
    expect(html).toContain('data-totals="2199.2200"')
    expect(html).toContain('data-totals="2199.2201"')
    const defense = [...html.matchAll(/data-totals="(2199\.\d+)"[\s\S]*?data-total="defense"><span class="font-semibold">(\d+)</g)].map((m) => [m[1], Number(m[2])])
    expect(defense).toEqual([['2199.2200', 61], ['2199.2201', 73]])
    expect(words).toContain(copy.totalsFor('Beetle Shell', 'melee'))
    expect(words).toContain(copy.piecesValue(4, 1, 2))
    expect(words).toContain(copy.shapeNote(2, true, false))
    // the chest a bonus comes with says so on its card; every piece is a hash target
    expect(html).toMatch(/<h3 id="piece-2201"[\s\S]*?Chest piece for[\s\S]*?Melee/)
    for (const id of [2199, 2200, 2201, 2202]) expect(html).toContain(`id="${pieceAnchorId(id)}"`)
    // the comparison picks a chest piece
    const vsTurtle = renderAt('/armor/beetle-armor?vs=turtle-armor')
    expect(vsTurtle).toMatch(/<label[^>]*>Beetle armor chest piece<\/label>/)
    // the pieces' own text effects get a row; the set bonus's are only in the "Set bonus" row (never counted twice)
    expect(vsTurtle).toContain('data-compare-row="piece-specials"')
    expect(renderAt('/armor/frost-armor?vs=hallowed-armor')).not.toContain('data-compare-row="piece-specials"')
  })

  it('BLOCKER (a): the Wizard set — two hats with any of eight robes, no legs piece; one quoted bonus per hat; 16 combinations behind one picker', () => {
    const html = renderAt('/armor/wizard-set')
    const words = text(html)
    expect(html).toContain('“10% increased magic critical strike chance”')
    expect(html).toContain('“Increases maximum mana by 60”')
    expect(words).toContain(copy.bonusFor('Wizard Hat (magic)'))
    expect(words).toContain(copy.bonusFor('Magic Hat (magic)'))
    expect(words).toContain(copy.anyChest(8))
    expect(words).toContain(copy.shapeNote(8, false, true))
    // B136: the "no legs piece" claim shows its stored verbatim quote — the overlay's build-checked evidence — with its source
    const legsQuote = OVERLAY.entries.find((e) => e.page === 'Wizard set')?.combination?.legs?.quote as string
    expect(legsQuote).toBe('Any leg-slot equipment can be worn without affecting the set bonus.')
    const quoted = /<p data-legs-quote=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ''
    expect(quoted).toContain(`<span data-wiki-text="" class="whitespace-pre-line italic">“${legsQuote}”</span>`)
    expect(quoted).toContain(`href="${set('wizard-set').wikiUrl}"`)
    expect(text(quoted)).toMatch(/^ ?“Any leg-slot[^”]+” Source for “Any leg-slot/)
    // only where a set has no legs piece (and the quote is recorded)
    expect(renderAt('/armor/beetle-armor')).not.toContain('data-legs-quote')
    expect(words).toContain(copy.TOTALS_LEGS_ANY)
    // 16 wearable combinations: a picker and ONE card (not sixteen)
    expect(html).toContain('data-totals-pick=""')
    const picker = /<select[^>]*data-totals-pick=""[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? ''
    expect((picker.match(/<option value="(?:238|2275)\.\d+"/g) ?? []).length).toBe(16)
    expect((html.match(/data-totals="/g) ?? []).length).toBe(1)
    expect(words).toContain(copy.totalsPickLabel(16))
    expect(words).toContain(copy.piecesValue(10, 2, 8))
    // the pieces: two hats + eight robes, each its own hash target
    for (const id of setPieceIds(set('wizard-set'))) expect(html).toContain(`id="${pieceAnchorId(id)}"`)
    // the comparison picks a combination; a combination key in the URL selects it
    const state = compareState(set('wizard-set'), data.sets, data.armor, new URLSearchParams('vs=jungle-armor&helmet=2275.2279'))
    expect([state.aVariant.helmetId, state.aVariant.chestId, state.aVariant.label]).toEqual([2275, 2279, 'Magic Hat + Mystic Robe'])
    expect(state.a.pieceIds).toEqual([2275, 2279]) // no legs piece counted
    expect(renderAt('/armor/wizard-set?vs=jungle-armor')).toMatch(/<label[^>]*>Wizard set combination<\/label>/)
  })

  it('every totals list pairs each term with its value (group names are labels, not terms); a total with no set-bonus part shows no breakdown', () => {
    for (const id of ['hallowed-armor', 'beetle-armor', 'frost-armor', 'jungle-armor']) {
      const html = renderAt(`/armor/${id}`)
      for (const [dl] of html.matchAll(/<dl class="grid grid-cols-\[minmax\(0,1fr\)_auto\][\s\S]*?<\/dl>/g)) {
        // dt, dd(, dd …): every term has at least one description, and the list starts with a term
        const tags = [...dl.matchAll(/<(dt|dd)\b/g)].map((m) => m[1])
        expect(tags[0], id).toBe('dt')
        tags.forEach((tag, i) => {
          if (tag === 'dt') expect(tags[i + 1], `${id} #${i}`).toBe('dd')
        })
        expect(dl, id).not.toMatch(/<dt[^>]*col-span-2/)
      }
      expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/)
    }
    // Jungle armor's bonus adds no defense: its defense total stands alone (no "from pieces" line repeating it)
    const jungle = renderAt('/armor/jungle-armor')
    expect(jungle).toMatch(/data-total="defense"><span class="font-semibold">17<\/span><\/dd><\/dl>/)
    // a breakdown is its own full-width description row; with no pieces part it names the set bonus alone
    expect(renderAt('/armor/platinum-armor')).toContain(`<dd class="col-span-2 -mt-1 text-right text-xs text-fg-muted">${copy.breakdown('16', '+4')}</dd>`)
    expect(copy.breakdown(undefined, '+10%')).toBe('+10% from the set bonus')
  })

  it('a set with several helmets (Ancient Hallowed): one bonus text for four helmets, a totals card per helmet', () => {
    const html = renderAt('/armor/ancient-hallowed-armor')
    expect((html.match(/data-bonus-group="/g) ?? []).length).toBe(2) // three helmets share the text; the summoner's adds minions
    expect((html.match(/data-totals="/g) ?? []).length).toBe(4)
    expect(text(html)).toContain('4 helmets to choose from')
  })

  it('a loose piece (Viking Helmet): its own page — header, stats, dataset-scoped "not part of any set recorded", how to obtain', () => {
    const helm = piece('Viking Helmet')
    const html = renderAt(armorPieceHref(helm.id))
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Viking Helmet/)
    expect(html).toContain('data-not-in-set=""')
    expect(text(html)).toContain(copy.NOT_IN_SET)
    expect(text(html)).toMatch(/Set None recorded/)
    expect(html).toContain('id="acq-title"')
  })

  it('BLOCKER (b): no piece outside the recorded sets claims "no set bonus" as fact; where the wiki ties it to a set the dataset can\'t record, its set is Unknown (Rain Hat, Rain Coat, Ultrabright Helmet)', () => {
    for (const loose of loosePieceEntries(data.armor, data.sets.values())) {
      const html = renderAt(armorPieceHref(loose.id))
      expect(ownWords(html), loose.name).not.toMatch(/no set bonus|belongs? to no set|not part of an armor set/i)
      const unknown = loose.piece._prov.unverifiedFields.includes('setId')
      expect(markers(html).includes('setId'), loose.name).toBe(unknown)
      expect(html, loose.name).toContain(`data-not-in-set="${unknown ? 'unknown' : ''}"`)
    }
    expect(loosePieceEntries(data.armor, data.sets.values()).filter((e) => e.piece._prov.unverifiedFields.includes('setId')).map((e) => e.name)).toEqual(['Rain Coat', 'Rain Hat', 'Ultrabright Helmet'])
    expect(text(renderAt(armorPieceHref(piece('Ultrabright Helmet').id)))).toContain(copy.SET_UNKNOWN_NOTE.replace(/'/g, "'"))
    // the list says it too: a "Set Unknown" marker on those rows, and the section note is dataset-scoped
    const list = renderAt('/armor')
    expect((list.match(/data-set-unknown=""/g) ?? []).length).toBe(3)
    expect(text(list)).toContain(copy.LOOSE_NOTE.replace(/'/g, "'"))
    expect(ownWords(list)).not.toMatch(/no set bonus/i)
  })

  it('Unknown-heavy pieces say so up front; the badge counts exactly the markers (Gi; Angler armor)', () => {
    const hat = renderAt(armorPieceHref(piece('Gi').id))
    expect(hat).toContain('data-unknown-heavy=""')
    expect(markers(hat).length).toBeGreaterThanOrEqual(3)
    expect(badgeCount(hat)).toBe(markers(hat).length)
    for (const loose of loosePieceEntries(data.armor, data.sets.values())) {
      const html = renderAt(armorPieceHref(loose.id))
      expect(badgeCount(html), loose.name).toBe(markers(html).length)
    }
    const angler = renderAt('/armor/angler-armor')
    expect(angler).toContain('data-unknown-heavy=""')
    // Unknown is never 0, blank or a dash: each Unknown is the literal marker
    expect(markers(angler).every((m) => m.length > 0)).toBe(true)
    expect(angler).not.toMatch(/>\s*(—|-)\s*</)
  })

  it('an unknown id is the styled 404 linking the armor list', () => {
    const html = renderAt('/armor/not-a-set')
    expect(html).toContain('Lost in the caverns')
    expect(html).toContain('href="/armor"')
    expect(text(html)).toContain(copy.notFoundBody.replace(/'/g, "'"))
  })
})

describe('/armor list (AC1: list / filter by stage and class)', () => {
  const sets = () => setEntries(data.sets.values(), data.armor)
  const loose = () => loosePieceEntries(data.armor, data.sets.values())

  it('URL state: parse / write / toggle; unknown values dropped, never guessed', () => {
    const f = parseArmorFilters(new URLSearchParams('class=ranged,nonsense,melee&stage=unknown&q=  frost '))
    expect(f).toEqual({ class: ['melee', 'ranged'], stage: ['unknown'], q: 'frost' })
    expect(writeArmorFilters(new URLSearchParams('x=1'), f).toString()).toBe('x=1&class=melee%2Cranged&stage=unknown&q=frost')
    expect(toggleArmorFilter(f, 'class', 'melee').class).toEqual(['ranged'])
    expect(writeArmorFilters(new URLSearchParams('class=melee'), EMPTY_ARMOR_FILTERS).toString()).toBe('')
  })

  it('a hybrid set matches each of its classes; a class filter leaves out pieces outside a set (they have none)', () => {
    const frost = sets().find((e) => e.id === 'frost-armor')!
    expect(matchesArmor(frost, { ...EMPTY_ARMOR_FILTERS, class: ['melee'] })).toBe(true)
    expect(matchesArmor(frost, { ...EMPTY_ARMOR_FILTERS, class: ['ranged'] })).toBe(true)
    expect(matchesArmor(frost, { ...EMPTY_ARMOR_FILTERS, class: ['magic'] })).toBe(false)
    expect(loose().some((e) => matchesArmor(e, { ...EMPTY_ARMOR_FILTERS, class: ['magic'] }))).toBe(false)
    const facets = buildArmorFacets(sets(), EMPTY_ARMOR_FILTERS)
    const stage = facets.find((x) => x.id === 'stage')!
    expect(stage.options.reduce((n, o) => n + o.count, 0)).toBe(69) // one stage bucket per set
    expect(stage.options.find((o) => o.value === 'unknown')?.count).toBe(50)
  })

  it('the page: 69 set rows linking their pages with the full-set defense (set bonus in); 14 loose pieces; class filter says what it leaves out', () => {
    const html = renderAt('/armor')
    expect(html).toContain('data-set-list="69"')
    expect(html).toContain('data-loose-list="14"')
    expect(html).toMatch(/href="\/armor\/platinum-armor"[\s\S]*?Full-set defense[\s\S]*?20/)
    // set shapes on their rows: Beetle's two chests (61–73 defense), the Wizard set's eight robes and no legs piece
    expect(text(html)).toMatch(/Beetle armor Melee 2 chest pieces Full-set defense 61–73/)
    expect(text(html)).toMatch(/Wizard set Magic 2 helmets 8 chest pieces no legs piece/)
    const melee = renderAt('/armor?class=melee')
    expect(melee).toMatch(/href="\/armor\/frost-armor"/)
    expect(melee).toMatch(/href="\/armor\/beetle-armor"/)
    expect(melee).toContain('data-loose-hidden="14"')
    expect(melee).not.toContain('data-loose-list=')
    expect(text(melee)).toContain(copy.looseHiddenByClass(14))
    const none = renderAt('/armor?q=zzzz')
    expect(none).toContain(copy.EMPTY_TITLE)
    // no set matches but a piece outside them does: the sets section says so (never a bare "0 sets" over an empty list)
    const viking = renderAt('/armor?q=viking')
    expect(viking).toContain('data-set-list="0"')
    expect(text(viking)).toContain(copy.noSetsButPieces(1))
    expect(viking).toContain('data-loose-list="1"')
    // a facet option's screen-reader count agrees in number (shared FilterBar): "1 result", never "1 results"
    const beetle = renderAt('/armor?q=beetle')
    expect(beetle).toMatch(/>1<span class="sr-only"> result<\/span>/)
    expect(beetle).not.toMatch(/>1<span class="sr-only"> results<\/span>/)
    // heading, then filters, then results — the items and accessories lists' order
    expect(html.indexOf('id="armor-sets-title"')).toBeLessThan(html.indexOf('Filter by name'))
  })
})

describe('copy audit: no forward promise, no outcome / "best" wording', () => {
  it('in the copy module and on rendered pages (wiki quotes excluded)', () => {
    const strings = Object.values(copy).flatMap((v) =>
      typeof v === 'function' ? [String((v as (...a: unknown[]) => string)('1.4.5.8' as never, 3 as never, 'X' as never)), String((v as (...a: unknown[]) => string)(1 as never, 2 as never, undefined as never))] : typeof v === 'string' ? [v] : Object.values(v as object).map(String),
    )
    for (const s of strings) expect(auditCopy(s), s).toBeUndefined()
    for (const path of ['/armor', '/armor/frost-armor', '/armor/jungle-armor?vs=platinum-armor', `/armor/${piece('Wizard Hat').id}`, '/armor/angler-armor']) {
      expect(auditCopy(ownWords(renderAt(path))), path).toBeUndefined()
    }
  })
})
