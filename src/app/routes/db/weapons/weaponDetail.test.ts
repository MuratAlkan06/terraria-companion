import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tooltip } from 'radix-ui'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDataAccess, type AcquisitionData } from '../../../../data-access'
import type { SpriteIndex, Weapon } from '../../../../data-access/types'
import weaponsDetail from '../../../../data/weapons.detail.json'
import { AcquisitionPanel, AcquisitionView } from './AcquisitionView'
import {
  acquisitionNeeds,
  AMMO_TYPE_LABELS,
  ammoTypeLabel,
  critView,
  fieldLabel,
  formatCoins,
  formatQuantity,
  formatRate,
  groupDropSources,
  humanizeSlug,
  labBlurb,
  SOURCE_KIND_LABELS,
  sourcePageName,
  sourceTitle,
  UNKNOWN_CAPABLE_PATHS,
  weaponStatRows,
} from './weaponDisplay'
import { WeaponDetailView } from './WeaponDetailView'
import { unknownCount, weaponPageUnknowns } from './weaponUnknowns'

const WEAPONS = weaponsDetail as unknown as Weapon[]
const byName = (name: string) => {
  const w = WEAPONS.find((x) => x.name === name)
  if (!w) throw new Error(`fixture weapon missing: ${name}`)
  return w
}

let data: AcquisitionData
let sprites: SpriteIndex
let weaponsById: ReadonlyMap<number, Weapon>

beforeAll(async () => {
  const da = createDataAccess({ validate: null })
  data = await da.loadAcquisitionData({ recipes: true, drops: true, gates: true })
  weaponsById = await da.loadDetailIndex('weapons')
  // Manifest lives in public/ (fetched at runtime); feed the same JSON for the render test.
  const manifest = (await import('../../../../../public/sprites/manifest.json')).default
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

function wrap(node: ReactNode): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
}

function renderDetail(weapon: Weapon): string {
  return wrap(
    createElement(WeaponDetailView, {
      weapon,
      sprites,
      acquisitionData: data,
      acquisition: createElement(
        AcquisitionPanel,
        { weapon },
        createElement(AcquisitionView, { weapon, data, weaponsById, sprites }),
      ),
    }),
  )
}

function unknownMarkers(html: string): string[] {
  return [...html.matchAll(/data-unknown-field="([^"]+)"/g)].map((m) => m[1])
}

/** Drop-record fields the drop table renders (source.npcIds / source.bossId are not displayed). */
const DROP_DISPLAYED = /^(rates\.(classic|expert|master)|quantity(\.(classic|expert|master))?|conditions)$/

describe('weapon detail: Unknown markers sit exactly on unverified fields (PRD P2-S3 AC4)', () => {
  it('every unverified weapon field in the dataset is one the page can render as Unknown', () => {
    const unsupported = new Set(
      WEAPONS.flatMap((w) => w._prov.unverifiedFields).filter((p) => !UNKNOWN_CAPABLE_PATHS.some((re) => re.test(p))),
    )
    expect([...unsupported]).toEqual([])
  })

  it('for all weapons: weapon-level markers == _prov.unverifiedFields, drop markers == displayed drop unknowns', () => {
    const mismatches: string[] = []
    for (const weapon of WEAPONS) {
      const markers = unknownMarkers(renderDetail(weapon))
      const weaponMarkers = new Set(markers.filter((m) => !m.startsWith('drop:')))
      const expected = new Set(weapon._prov.unverifiedFields)
      const dropMarkers = new Set(markers.filter((m) => m.startsWith('drop:')))
      const expectedDrop = new Set(
        weapon.acquisition
          .flatMap((a) => (a.method === 'drop' ? a.dropIds : []))
          .flatMap((id) => {
            const drop = data.drops?.byId.get(id)
            return (drop?._prov.unverifiedFields ?? []).filter((f) => DROP_DISPLAYED.test(f)).map((f) => `drop:${id}:${f}`)
          }),
      )
      const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
      if (!same(weaponMarkers, expected)) {
        mismatches.push(`${weapon.name}: rendered [${[...weaponMarkers]}] expected [${[...expected]}]`)
      }
      if (!same(dropMarkers, expectedDrop)) mismatches.push(`${weapon.name}: drop markers differ`)
    }
    expect(mismatches).toEqual([])
  })
})

describe('partially-verified badge covers every Unknown on the page (design review P2-S3 #1)', () => {
  it('for all weapons: badge count == rendered Unknown markers (weapon + drop records + vendor rows)', () => {
    const mismatches: string[] = []
    for (const weapon of WEAPONS) {
      const html = renderDetail(weapon)
      const rendered = unknownMarkers(html).length
      const counted = unknownCount(weaponPageUnknowns(weapon, data.drops))
      if (rendered !== counted) mismatches.push(`${weapon.name}: page shows ${rendered}, badge counts ${counted}`)
      // The badge exists exactly when something on the page is Unknown.
      if ((rendered > 0) !== html.includes('Partially verified')) mismatches.push(`${weapon.name}: badge presence`)
    }
    expect(mismatches).toEqual([])
  })

  it('Terraprisma (AMENDMENTS-016 B105): its drop states no quantity, so 1 is derived from the item kind — shown "derived", never Unknown, never like a stated value', () => {
    const terraprisma = byName('Terraprisma')
    expect(terraprisma._prov.unverifiedFields).toEqual([])
    const entries = weaponPageUnknowns(terraprisma, data.drops)
    expect(unknownCount(entries)).toBe(0) // it used to be the 3 quantity cells
    const html = renderDetail(terraprisma)
    expect(html).not.toContain('Partially verified')
    // one quantity cell per difficulty that applies, each labelled with the derivation toggletip
    const derived = html.match(/<td class="px-2 py-1.5"><span class="inline-flex[^"]*"><span class="tabular-nums">1<\/span><button[^>]*data-derived=""/g) ?? []
    expect(derived.length).toBeGreaterThan(0)
    expect(html).toContain('derived<span class="sr-only"> (show what this means)</span>')
  })

  it('Bomb: 2 vendor prices + 3 Black Slime rates = 5, labelled like the page sections (B70: stage, vendor conditions and gating derive; P3-S11: damage and knockback verify; B85(b): no crit row)', () => {
    const bomb = byName('Bomb')
    const entries = weaponPageUnknowns(bomb, data.drops)
    expect(unknownCount(entries)).toBe(5)
    expect(entries.map((e) => e.label)).toEqual([
      'Black Slime (bonus drop) — drop chance (Classic, Expert, Master)',
      'Sold by Demolitionist — price',
      'Sold by Skeleton Merchant — price',
    ])
    const html = renderDetail(bomb)
    expect(html).toContain('show which 5 values are unknown')
    expect(unknownMarkers(html)).toHaveLength(5)
  })

  it('B85(b): classless crit is not applicable — no Unknown "Critical chance" on any classless page (the 15 thrown explosives each count one Unknown fewer)', () => {
    const classless = WEAPONS.filter((w) => w.damageClass === 'other')
    expect(classless.length).toBeGreaterThanOrEqual(15)
    for (const w of classless) {
      expect(w._prov.unverifiedFields, w.name).not.toContain('critPct')
      expect(weaponPageUnknowns(w, data.drops).some((e) => e.key === 'critPct'), w.name).toBe(false)
    }
    const explosives = classless.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'explosive-aoe')
    expect(explosives).toHaveLength(15)
  })

  it('while the drop index is not loaded only the weapon-level Unknowns (all that is on screen) count', () => {
    expect(unknownCount(weaponPageUnknowns(byName('Bomb'), undefined))).toBe(2)
    expect(unknownCount(weaponPageUnknowns(byName('Terraprisma'), undefined))).toBe(0)
  })
})

describe('weapon detail content (PRD P2-S3 AC3)', () => {
  it('Zenith: verified stats, B14 use time, B17 crit, craft route with exact materials + station, source link', () => {
    const zenith = byName('Zenith')
    const html = renderDetail(zenith)
    const rows = Object.fromEntries(weaponStatRows(zenith).map((r) => [r.key, r.text]))
    expect(rows).toMatchObject({ damage: '190', crit: '14%', useTime: '30 ticks', knockback: '6.5', autoReuse: 'Yes' })
    expect(rows).not.toHaveProperty('mana')
    expect(rows).not.toHaveProperty('ammo')
    expect(html).toContain('Zenith')
    expect(html).toMatch(/<a [^>]*href="\/items\/525"[^>]*>Mythril Anvil<\/a> or <a [^>]*href="\/items\/1220"[^>]*>Orichalcum Anvil<\/a>/)
    expect(html).toContain('Terra Blade')
    expect(html).toContain('href="/weapons/757"') // ingredient that is itself a weapon links to its page
    expect(html).toContain('href="https://terraria.wiki.gg/wiki/Zenith"')
    expect(html).toContain('Partially verified')
    // States that the Lab doesn't simulate it — no forward promise (design review P3-S1).
    expect(html).toContain('Not simulated in the Weapon Lab')
    expect(html).not.toMatch(/simulation coming|Until then/)
    // No tooltip text and only the wiki pointer: no "here's what it does" promise before a bare link.
    expect(html).not.toContain('here’s what it does in-game')
    expect(html).toContain('The wiki describes how it behaves in-game.')
  })

  it('crafting materials render as ItemSlots in an InventoryGrid, spanning the panel for a single recipe', () => {
    const html = renderDetail(byName('Zenith'))
    const grid = /<div role="group" aria-label="Materials for Zenith"[^>]*>/.exec(html)
    expect(grid?.[0]).toContain('minmax(min(100%, 12rem), 1fr)')
    // 10 weapon materials: each a slot (role=img) inside a link to its page, the amount announced.
    expect(html.match(/<a [^>]*href="\/weapons\/\d+"[^>]*><div aria-hidden="true"[^>]*><div role="img"/g)).toHaveLength(10)
    expect(html).toContain('<span class="sr-only">1 × </span>Terra Blade')
    // A single recipe is not squeezed into half of a two-column grid.
    expect(html).not.toMatch(/<ul class="grid gap-3 md:grid-cols-2"><li[^>]*><dl/)
  })

  it('item materials link their encyclopedia page (P6), with a quantity badge; stations that are items link too', () => {
    const html = renderDetail(byName('Adamantite Sword'))
    expect(html).toMatch(/<div role="img" aria-label="Adamantite Bar, stack of 12"/)
    expect(html).toContain('<span class="sr-only">12 × </span>Adamantite Bar')
    expect(html).toMatch(/<a [^>]*href="\/items\/391"[^>]*>(?:(?!<\/a>).)*Adamantite Bar/)
    // AMENDMENTS-016 B113(e): a station group ("Mythril or Orichalcum Anvil") names its members, each linking its item page
    expect(html).toMatch(/data-station-group="mythril-or-orichalcum-anvil"><a [^>]*href="\/items\/525"[^>]*>Mythril Anvil<\/a> or <a [^>]*href="\/items\/1220"[^>]*>Orichalcum Anvil<\/a><\/span>/)
    const wooden = renderDetail(byName('Wooden Sword')) // crafted at a Work Bench (item 36, an encyclopedia item)
    expect(wooden).toMatch(/Crafting station:<\/dt><dd><span><a [^>]*href="\/items\/36"[^>]*>Work Bench<\/a><\/span><\/dd>/)
  })

  it('a material id that is no record of any page is an inert cell (no dead local link, no guessed wiki URL)', () => {
    const recipeIds = WEAPONS.flatMap((w) => w.acquisition.flatMap((a) => (a.method === 'craft' ? a.recipeIds : [])))
    const recipes = recipeIds.map((id) => data.recipes!.byId.get(id)!).filter(Boolean)
    const inert = recipes.flatMap((r) => r.ingredients).find((g) => g.ref.kind === 'group')
    expect(inert).toBeDefined() // an "Any …" group material has no page of its own
    const weapon = WEAPONS.find((w) => w.acquisition.some((a) => a.method === 'craft' && a.recipeIds.some((id) => data.recipes!.byId.get(id)?.ingredients.some((g) => g.ref.kind === 'group'))))!
    const html = renderDetail(weapon)
    const group = data.recipes!.groups.get((inert!.ref as { groupId: string }).groupId)!
    expect(html).toContain(group.name)
    expect(html).not.toMatch(new RegExp(`<a [^>]*>(?:(?!</a>).)*${group.name}`))
  })

  it('every local link on every weapon page resolves to an existing weapon', () => {
    const dead: string[] = []
    for (const weapon of WEAPONS) {
      for (const [, id] of renderDetail(weapon).matchAll(/href="\/weapons\/([^"]*)"/g)) {
        if (!weaponsById.has(Number(id))) dead.push(`${weapon.name} → /weapons/${id}`)
      }
    }
    expect(dead).toEqual([])
  })

  it('identical drop tables are grouped into one table listing every source (Bomb: 11 sources → 4 tables)', () => {
    const bomb = byName('Bomb')
    const html = renderDetail(bomb)
    expect(html.match(/<table/g)).toHaveLength(4)
    expect(html).toContain('Same drop table from 8 sources')
    for (const id of bomb.acquisition.flatMap((a) => (a.method === 'drop' ? a.dropIds : []))) {
      expect(html).toContain(data.drops!.byId.get(id)!.source.npcName)
    }
    // Black Slime has Unknown rates: never grouped, its Unknowns stay on its own table.
    const drops = bomb.acquisition.flatMap((a) => (a.method === 'drop' ? a.dropIds : [])).map((id) => data.drops!.byId.get(id)!)
    const groups = groupDropSources(drops)
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 1, 8])
    expect(groups.find((g) => g.some((d) => d.source.npcName.startsWith('Black Slime')))).toHaveLength(1)
  })

  it('drop tables use fixed column widths and hatch the whole Unknown cell (UX_SPEC §5.3)', () => {
    // Bomb: the Black Slime bonus drop's three Unknown rates (Terraprisma's quantities derive since B105)
    const html = renderDetail(byName('Bomb'))
    expect(html).toContain('<table class="w-full table-fixed text-sm">')
    expect(html.match(/<td class="bg-hatch-unknown[^"]*"><button[^>]*data-unknown-field="drop:/g)).toHaveLength(3)
  })

  it('Bomb (classless): no crit row (B85(b): classless damage never crits), damage + knockback verified (P3-S11), two vendors with Unknown price; conditions, stage and gating known (B70)', () => {
    const bomb = byName('Bomb')
    const html = renderDetail(bomb)
    expect(critView(bomb).status).toBe('not-applicable')
    expect(weaponStatRows(bomb).map((r) => r.key)).toEqual(['damage', 'useTime', 'knockback', 'autoReuse'])
    expect(html).not.toContain('Critical chance')
    expect(bomb).toMatchObject({ damage: 100, knockback: 8, stage: 'early-prehm', gatedBy: { bosses: [], conditions: [], stage: 'early-prehm' } })
    const markers = unknownMarkers(html)
    for (const f of ['acquisition.1.priceCopper', 'acquisition.2.priceCopper']) {
      expect(markers).toContain(f)
    }
    for (const f of ['damage', 'knockback', 'critPct', 'stage', 'gatedBy', 'acquisition.1.conditions', 'acquisition.2.conditions']) expect(markers).not.toContain(f)
    expect(html).toContain('Sold by Demolitionist')
    expect(html).toContain('Sold by Skeleton Merchant')
    // gating derives: available from the start — no boss or world condition gates it
    expect(html).toContain('Required progress:</span><span>None — no boss or world condition gates it</span>')
  })

  it('B17 / B64 / B85(b): summon and classless weapons have no crit row at all; melee / ranged / magic keep theirs', () => {
    for (const w of WEAPONS.filter((x) => x.damageClass === 'summon' || x.damageClass === 'other')) {
      expect(weaponStatRows(w).some((r) => r.key === 'crit'), w.name).toBe(false)
    }
    expect(weaponStatRows(byName('Zenith')).some((r) => r.key === 'crit')).toBe(true)
  })

  it('the Lab note varies by archetype family: a thrown explosive names its blast and per-dummy damage, no crits (design review P3-S11 #6)', () => {
    const bomb = renderDetail(byName('Bomb'))
    expect(bomb).toContain('Simulated in the Weapon Lab')
    expect(bomb).toContain('Throw it at the dummies to see its blast radius and per-dummy damage')
    expect(bomb).not.toMatch(/data-lab-blurb=""[^<]*crits/)
    // a sword keeps its swing wording and its crits; a summon weapon never mentions crits
    expect(labBlurb(byName('Wooden Sword'))).toMatch(/^Swing it at the Infinite Dummy to see per-hit damage, crits and an estimated DPS/)
    for (const w of WEAPONS.filter((x) => x.labBehavior.kind === 'archetype')) {
      const text = labBlurb(w) ?? ''
      expect(text, w.name).toContain('a browser simulation')
      if (w.damageClass === 'summon' || w.damageClass === 'other') expect(text, w.name).not.toContain('crits')
    }
    const archetypes = new Set(WEAPONS.flatMap((w) => (w.labBehavior.kind === 'archetype' ? [w.labBehavior.params.archetype] : [])))
    const leads = new Set(WEAPONS.flatMap((w) => (w.labBehavior.kind === 'archetype' ? [(labBlurb(w) ?? '').split(' ')[0]] : [])))
    expect(leads.size).toBeGreaterThanOrEqual(Math.min(archetypes.size, 7))
  })

  it('sources name their page: the Bomb’s triple evidence reads as three distinct sources (design review P3-S11 #7)', () => {
    const bomb = byName('Bomb')
    const titles = bomb._prov.sources.map((s) => sourceTitle(s))
    expect(titles).toEqual(
      expect.arrayContaining([
        { label: 'Wiki Items table', page: 'Bomb' },
        { label: 'Wiki article', page: 'Explosives (class)' },
        { label: 'Wiki article', page: 'Bomb' },
        { label: 'Module:Iteminfo (game item data)' },
      ]),
    )
    // every kind in the dataset has a label (never the raw kind)
    for (const w of WEAPONS) for (const s of w._prov.sources) expect(SOURCE_KIND_LABELS[s.kind], s.kind).toBeDefined()
    const html = renderDetail(bomb)
    expect(html).not.toContain('>wiki-article<')
    expect(html.match(/data-source-page="">Explosives \(class\)</g)).toHaveLength(1)
    expect(sourcePageName('https://terraria.wiki.gg/wiki/Module:Projectileinfo/data')).toBe('Module:Projectileinfo/data')
    expect(sourcePageName('not a url')).toBeUndefined()
  })

  it('weapons with unverified acquisition render the honest "Acquisition unknown" state', () => {
    const glove = byName('Bladed Glove')
    expect(glove.acquisition).toEqual([])
    const html = renderDetail(glove)
    expect(html).toContain('Ways to obtain: ')
    expect(html).not.toContain('Acquisition unknown') // no "Acquisition unknown: Unknown" stutter
    expect(unknownMarkers(html)).toContain('acquisition')
  })

  it('drop routes show source names and per-difficulty verified rates', () => {
    const html = renderDetail(byName('Flower of Fire'))
    expect(html).toContain('Red Devil')
    expect(html).toContain('3.33%')
    expect(html).toContain('Classic')
  })

  it('purchase routes show vendor + formatted price', () => {
    const html = renderDetail(byName('Minishark'))
    expect(html).toContain('Sold by Arms Dealer')
    expect(html).toContain('35 gold')
  })

  it('mana/ammo rows appear only when applicable', () => {
    const bow = byName('Wooden Bow')
    expect(weaponStatRows(bow).find((r) => r.key === 'ammo')?.text).toBe('Arrows')
    expect(weaponStatRows(bow).some((r) => r.key === 'mana')).toBe(false)
    expect(weaponStatRows(byName('Flower of Fire')).find((r) => r.key === 'mana')?.view.status).toBe('unverified')
  })

  it('the Ammo row names the ammo TYPE, never one example item (design review P2-S3 #2)', () => {
    const ammoText = (name: string) => weaponStatRows(byName(name)).find((r) => r.key === 'ammo')?.text
    expect(ammoText('Minishark')).toBe('Bullets')
    expect(ammoText('Rocket Launcher')).toBe('Rockets')
    expect(ammoText('Blowpipe')).toBe('Darts')
    expect(ammoText('Sandgun')).toBe('Sand')
    expect(ammoText('Coin Gun')).toBe('Coins')
    const html = renderDetail(byName('Minishark'))
    expect(html).toContain('Bullets')
    expect(html).not.toContain('Musket Ball')
  })

  it('every ammo class in the dataset has an ammo-type label; unmapped ones never imply a single item', () => {
    const slugs = new Set(WEAPONS.flatMap((w) => (w.ammoClass ? [w.ammoClass] : [])))
    expect([...slugs].filter((s) => !(s in AMMO_TYPE_LABELS))).toEqual([])
    expect(ammoTypeLabel('future-ammo')).toBe('Future Ammo and compatible ammo')
  })

  it('acquisitionNeeds loads only what the routes reference', () => {
    expect(acquisitionNeeds(byName('Zenith'))).toMatchObject({ recipes: true, drops: false })
    expect(acquisitionNeeds(byName('Minishark'))).toMatchObject({ recipes: false, drops: false })
  })

  it('verified gates render as named lock chips from the progression/conditions registries', () => {
    const gated = WEAPONS.filter((w) => w.gatedBy && w.gatedBy.bosses.length + w.gatedBy.conditions.length > 0)
    for (const w of gated) {
      expect(acquisitionNeeds(w).gates || w.gatedBy!.bosses.length === 0, w.name).toBe(true)
      const html = renderDetail(w)
      for (const slug of w.gatedBy!.bosses) {
        const name = data.progression?.nodeById.get(slug)?.name
        expect(name, `${w.name}: node ${slug} resolves`).toBeDefined()
        expect(html, w.name).toContain(name!.replace(/'/g, '&#x27;'))
      }
      for (const slug of w.gatedBy!.conditions) {
        expect(html, w.name).toContain(data.conditions.byId.get(slug)!.name.replace(/'/g, '&#x27;'))
      }
    }
  })
})

describe('formatting', () => {
  it('coins', () => {
    expect([350000, 50000, 15, 2000, 1_050_203].map(formatCoins)).toEqual([
      '35 gold',
      '5 gold',
      '15 copper',
      '20 silver',
      '1 platinum 5 gold 2 silver 3 copper',
    ])
  })
  it('rates and quantities', () => {
    expect([1, 0.25, 0.0333, 1 / 3, 0.0001].map(formatRate)).toEqual(['100%', '25%', '3.33%', '33.3%', '0.01%'])
    expect(formatQuantity({ min: 1, max: 1 })).toBe('1')
    expect(formatQuantity({ min: 25, max: 49 })).toBe('25–49')
  })
  it('labels', () => {
    expect(fieldLabel('acquisition.1.priceCopper', byName('Bomb'))).toBe('Sold by Demolitionist — price')
    expect(fieldLabel('acquisition.2.conditions', byName('Bomb'))).toBe('Sold by Skeleton Merchant — conditions')
    expect(fieldLabel('acquisition.1.priceCopper')).toBe('Way to obtain #2 — price')
    expect(fieldLabel('gatedBy')).toBe('Required progress')
    expect(humanizeSlug('rocket-i')).toBe('Rocket I')
  })
})
