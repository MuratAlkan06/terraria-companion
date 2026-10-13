/* Parse stage: Lua modules, Iteminfo, recipe modules, Cargo Drops cell grammar, text helpers.
 * Fixtures mirror the real shapes verified against terraria.wiki.gg on 2026-10-13. */
import { describe, expect, it } from 'vitest'
import { customNotesOf, desktopSegments, modeParts, notesOf, parseQty, parseRate, platformsOf, plainTextOf } from './dropCells'
import { parseIteminfo, resolveItemName } from './iteminfo'
import { findCalls, parseLua, returnedValue } from './lua'
import { parseGameRecipeGroups, parseRecipesL10n, parseWikiRecipeGroups } from './recipeModules'
import { fnv1a32hex, slugify, stripMarkup } from './text'

const iteminfoModule = (data: unknown, nameDB: unknown) =>
  `-- generated\nreturn {\n["data"] = [=====[${JSON.stringify(data)}]=====],\n["nameDB"] = [=====[${JSON.stringify(nameDB)}]=====],\n}`

const fetched = (content: string) => ({ title: 'Module:Iteminfo/data', rev: 1023241, revTimestamp: '2026-08-22T03:26:22Z', content, fetchedAt: '2026-10-13T02:44:40.000Z' })

describe('lua', () => {
  it('reads literal tables (UTF-8 strings, negatives, nesting) without evaluating code', () => {
    const v = returnedValue(parseLua(`return { ['en'] = { name = 'Pokémon “x”', n = -3, list = {1, 2.5}, ok = true } }`, 't'), 't')
    expect(v).toEqual({ en: { name: 'Pokémon “x”', n: -3, list: [1, 2.5], ok: true } })
    expect(() => returnedValue(parseLua('return { x = os.time() }', 't'), 't')).toThrow(/E_PARSE_LUA/)
  })

  it('finds data calls in source order', () => {
    const calls = findCalls(parseLua(`local function group(a, b) end\ngroup('Any Wood', {'Wood'})\ngroup('Any Sand', {'Sand Block'})`, 't'), 'group')
    expect(calls).toHaveLength(2)
  })
})

describe('Module:Iteminfo/data', () => {
  const info = parseIteminfo(
    fetched(
      iteminfoModule(
        {
          '0': { name: '', internalName: 'None', maxStack: 9999, damage: -1 },
          _generated: '2026-08-22 03:17:40 (+00:00)',
          _terrariaversion: '1.4.5.7',
          '22': { name: 'Iron Bar', internalName: 'IronBar' },
          '753': { name: 'Seaweed', internalName: 'Seaweed' },
          '2338': { name: 'Seaweed', internalName: 'FishingSeaweed' },
          '97': { name: 'Musket Ball', internalName: 'MusketBall', damage: 7 },
          '3705': { internalName: 'Unused' },
        },
        { itemIdFromName: { 'Iron Bar': '22', Seaweed: '753', 'Musket Ball': '97' } },
      ),
    ),
  )

  it('merges sparse item stats over the defaults and records version metadata', () => {
    expect(info.terrariaVersion).toBe('1.4.5.7')
    expect(info.items.get(97)).toEqual({ id: 97, internalName: 'MusketBall', name: 'Musket Ball', stats: { name: 'Musket Ball', internalName: 'MusketBall', maxStack: 9999, damage: 7 } })
    expect(info.items.get(3705)?.name).toBeUndefined()
    expect(info.items.has(0)).toBe(false)
  })

  it('resolves names: unique, duplicate (wiki nameDB choice, reported), page disambiguator, unknown', () => {
    expect(resolveItemName(info, 'Iron Bar')).toEqual({ ok: true, id: 22 })
    expect(resolveItemName(info, 'Seaweed')).toEqual({ ok: true, id: 753, ambiguous: [753, 2338] })
    expect(resolveItemName(info, 'Iron Bar (item)')).toEqual({ ok: true, id: 22, normalized: 'Iron Bar' })
    expect(resolveItemName(info, 'Golden furniture')).toMatchObject({ ok: false })
  })
})

describe('recipe modules', () => {
  const mod = (content: string) => ({ title: 'Module:X', rev: 1, revTimestamp: '', content })

  it('Module:RecipeGroups newRecipeGroup(internalName, key, {ids})', () => {
    const src = `local function newRecipeGroup(a, b, c) end\nlocal function SetupRecipeGroups()\n newRecipeGroup("IronBar", "ItemName.IronBar", { 22, 704 })\nend`
    expect(parseGameRecipeGroups(mod(src))).toEqual([{ internalName: 'IronBar', descriptorKey: 'ItemName.IronBar', itemIds: [22, 704] }])
  })

  it("Module:Recipes group('Any X', {names})", () => {
    const src = `local function initItemGroups()\n local function group(n, c) end\n group('Any Iron Bar', {\n 'Iron Bar', 'Lead Bar',\n })\nend`
    expect(parseWikiRecipeGroups(mod(src))).toEqual([{ name: 'Any Iron Bar', memberNames: ['Iron Bar', 'Lead Bar'] }])
  })

  it('Module:Recipes/l10n en.station_cate + en.result_note', () => {
    const src = `return { ['en'] = { ['result_note'] = { ['#note_post_golem'] = '(After [[Golem]] is defeated)' }, ['station_cate'] = { ['Iron Anvil'] = 'Iron or Lead Anvil' } }, ['bg'] = {} }`
    expect(parseRecipesL10n(mod(src))).toEqual({ stationCate: { 'Iron Anvil': 'Iron or Lead Anvil' }, resultNotes: { '#note_post_golem': '(After [[Golem]] is defeated)' } })
  })
})

describe('Cargo Drops cell grammar', () => {
  const values = (cell: string) => {
    const parts = modeParts(cell)
    if (!parts.ok) return parts
    return parts.value.map((p) => ({ d: p.difficulties, segs: (desktopSegments(p.nodes) as { ok: true; value: unknown }).value }))
  }

  it('plain rates and fractions', () => {
    expect(parseRate('33%')).toBe(0.33)
    expect(parseRate('1/56 (1.79%)')).toBeCloseTo(1 / 56, 12)
    expect(parseRate('2.5–12.5%')).toBeUndefined()
    expect(parseRate('More info')).toBeUndefined()
    expect(parseRate('150%')).toBeUndefined()
  })

  it('quantities', () => {
    expect(parseQty('3')).toEqual({ min: 3, max: 3 })
    expect(parseQty('2–5')).toEqual({ min: 2, max: 5 })
    expect(parseQty('20-35')).toEqual({ min: 20, max: 35 })
    expect(parseQty('~2–3')).toBeUndefined()
    expect(parseQty('0–134')).toBeUndefined()
  })

  it('per-difficulty mode-content spans (m-normal m-journey / m-expert-master)', () => {
    const cell =
      '<span class="mode-content"><span class="m-normal m-journey">1%</span><span class="m-expert-master">[[Expert Mode|<abbr class="mode-exclusive expert" title="Expert Mode ">1.99%</abbr>]]</span></span>'
    expect(values(cell)).toEqual([
      { d: ['classic'], segs: [{ text: '1%', notes: [], platforms: [] }] },
      { d: ['expert', 'master'], segs: [{ text: '1.99%', notes: [], platforms: [] }] },
    ])
  })

  it('whole-cell mode-exclusive styling takes difficulties from the row flags', () => {
    expect(values('[[Expert Mode|<span class="mode-exclusive expert" >25%</span>]]')).toEqual([{ d: 'all', segs: [{ text: '25%', notes: [], platforms: [] }] }])
    const mixed = modeParts('1–[[Expert Mode|<span class="mode-exclusive expert" >2</span>]]')
    expect(mixed.ok && desktopSegments(mixed.value[0].nodes)).toMatchObject({ ok: false })
  })

  it('keeps only the Desktop value among platform variants (incl. a dangling " /" separator)', () => {
    const eico = (t: string) => `<span class="eico s i1" title="${t}"><b></b><i></i><span>(${t})</span></span>`
    const cell = `${eico('Desktop, Console and Mobile versions')} 1% /<br/>${eico('Old-gen console and 3DS versions')} 0.56%`
    expect(values(cell)).toEqual([{ d: 'all', segs: [{ text: '1%', notes: [], platforms: ['Desktop, Console and Mobile versions'] }] }])
    expect(platformsOf(cell)).toHaveLength(2)
  })

  it('notes attach to their value; a note on its own line belongs to the value above', () => {
    expect(values('20%<br/><span class="note-text ">(<span class=" eil"><span>[[Halloween|Halloween]]</span></span>)</span>')).toEqual([
      { d: 'all', segs: [{ text: '20%', notes: ['(Halloween)'], platforms: [] }] },
    ])
    expect(notesOf('<span class="chance">1%<br/>2% <span class="note-text ">(Hardmode)</span></span>')).toEqual(['Hardmode'])
  })

  it('custom-cell note2 spans: a condition is a note, an amount is not (P2-S2 spot-check finding)', () => {
    const terraprisma = '<span class="i -w">[[File:Terraprisma.png|link=Terraprisma|Terraprisma]]<span><span>[[Terraprisma]]</span><span class="note2">(if 100% of damage is dealt at daytime)</span></span></span>'
    const happyGrenade = '<span class="i -w">[[File:Happy Grenade.png|link=Happy Grenade|Happy Grenade]]<span><span>[[Happy Grenade]]</span><span class="note2">(30–60)</span></span></span>'
    expect(customNotesOf(terraprisma)).toEqual(['if 100% of damage is dealt at daytime'])
    expect(customNotesOf(happyGrenade)).toEqual([])
    expect(plainTextOf(happyGrenade)).toBe('Happy Grenade(30–60)') // the amount stays readable for the quantity fallback
  })

  it('rejects text outside a per-difficulty block', () => {
    expect(modeParts('<span class="mode-content"><span class="m-normal">1%</span></span> extra')).toMatchObject({ ok: false })
  })
})

describe('text helpers', () => {
  it('strips wiki markup and HTML to plain text (A15)', () => {
    expect(stripMarkup("<span class=\" eil\"><span>[[Mimics|Jungle Mimic]]</span></span> '''x''' &amp; [[File:A.png|link=]]")).toBe('Jungle Mimic x &')
  })
  it('slugify matches the shared Slug schema', () => {
    expect(slugify('Treasure Bag (Wall of Flesh)')).toBe('treasure-bag-wall-of-flesh')
    expect(slugify("Tinkerer's Workshop")).toBe('tinkerers-workshop')
  })
  it('fnv1a32hex reproduces the P2-S1 sample ids', () => {
    expect(fnv1a32hex('[]')).toBe('741638a5')
    expect(`36-${fnv1a32hex(JSON.stringify({ s: [], i: ['i:9*10'] }))}`).toBe('36-4cee494e')
  })
})
