/* Boss pages (PRD P5-S2/P5-S3 AC1–AC4; UX_SPEC §3.7) rendered server-side from the shipped data,
 * the prep-checklist persistence (AMENDMENTS-001 A7), and the page model. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import manifest from '../../../../public/sprites/manifest.json'
import { buildMapGraph } from '../../../components/nodeMap/graph'
import { unknownItemLine } from '../../../components/unknownItemLine'
import { createDataAccess, NotFoundError } from '../../../data-access'
import type { Accessory, AccessoryListRecord, ArmorListRecord, ArmorPiece, ArmorSet, Boss, Buff, Condition, DropSource, GapEntry, Item, ProgressionEdge, ProgressionNode, SpriteIndex, Weapon, WeaponListRecord } from '../../../data-access/types'
import accessoriesDetailJson from '../../../data/accessories.detail.json'
import accessoriesListJson from '../../../data/accessories.list.json'
import armorDetailJson from '../../../data/armor.detail.json'
import armorListJson from '../../../data/armor.list.json'
import armorSetsJson from '../../../data/armor-sets.json'
import bossesJson from '../../../data/bosses.json'
import buffsJson from '../../../data/buffs.json'
import conditionsJson from '../../../data/conditions.json'
import dropsJson from '../../../data/drops.json'
import itemUniverseJson from '../../../data/item-universe.json'
import itemsJson from '../../../data/items.detail.json'
import progressionJson from '../../../data/progression.json'
import stageGapsJson from '../../../data/stage-gaps.json'
import weaponsDetailJson from '../../../data/weapons.detail.json'
import weaponsListJson from '../../../data/weapons.list.json'
import { meta } from '../../../data/meta'
import { ChecklistsV1 } from '../../../schemas'
import { BOSS_PAGE_IDS } from '../../../schemas/bossPages'
import { getField } from '../../../schemas/getField'
import { wikiSearchUrl } from '../../../search/links'
import { loadDomain, type StorageBackend } from '../../../storage'
import { parseChecklists } from '../../../storage/checklists'
import { guideBySlug } from '../guides/content'
import { guideMentions } from '../guides/guideModel'
import { NO_PAGE_TITLE } from './BossBits'
import { CONDITIONAL_QUALIFIER, CONDITIONAL_SUMMARY } from './BossDrops'
import { loadBossPageData, type BossPageData, type GearData } from './bossPageData'
import {
  BOSS_PREP_GUIDES,
  bossDropRows,
  classGear,
  bossDropSections,
  CUT_AT_END,
  bossPageUnknowns,
  declaredGapReason,
  DROP_TIERS,
  GEAR_CLASSES,
  gearClassField,
  isMultiForm,
  itemResolver,
  nextSteps,
  pathDepths,
  quoteLead,
  quoteTrail,
  rankSteps,
  STAT_DIFFICULTIES,
  STAT_KEYS,
  statField,
  statsView,
  stepPhrase,
  strategyGroups,
  tipLinker,
  wikiArticleTitle,
} from './bossPageModel'
import { BossPageView } from './BossPageView'
import { createPrepChecklistStore, prepChecklistKey, prepEntryId } from './prepChecklistStore'
import { createProgressStore } from '../../progressStore'

const bosses = bossesJson as Boss[]
const raw = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const graph = buildMapGraph(raw, bosses)
const drops = { byId: new Map((dropsJson as DropSource[]).map((d) => [d.id, d])) }
const names = { byId: new Map(itemUniverseJson.items.flatMap((i) => (i.name ? [[i.id, i.name] as const] : []))), bySlug: new Map<string, string>() }
const weaponList = weaponsListJson as WeaponListRecord[]
const buffs = buffsJson as Buff[]
const itemOf = itemResolver({
  names,
  weapons: weaponList,
  accessories: accessoriesListJson as AccessoryListRecord[],
  armor: armorListJson as ArmorListRecord[],
  items: itemsJson as Item[],
  articles: buffs.map((b) => b.wikiUrl),
})
const linkTip = tipLinker(weaponList, itemOf)
const conditions = { byId: new Map((conditionsJson as Condition[]).map((c) => [c.id, c])) }
const gaps = stageGapsJson as GapEntry[]
/** The gear panel's detail data (gating, sets, buffs) — what the page loads once a boss has curated gear. */
const gearData: GearData = {
  weapons: new Map((weaponsDetailJson as Weapon[]).map((w) => [w.id, w])),
  accessories: new Map((accessoriesDetailJson as Accessory[]).map((a) => [a.id, a])),
  armor: new Map((armorDetailJson as ArmorPiece[]).map((a) => [a.id, a])),
  sets: new Map((armorSetsJson as ArmorSet[]).map((s) => [s.id, s])),
  buffs: new Map((buffsJson as Buff[]).map((b) => [b.id, b])),
}
let sprites: SpriteIndex

beforeAll(async () => {
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

const boss = (id: string) => bosses.find((b) => b.id === id) as Boss
const pageData = (b: Boss, gapLog: readonly GapEntry[] = gaps): BossPageData => ({ boss: b, graph, sprites, drops, itemOf, linkTip, conditions, gaps: gapLog })
const render = (b: Boss, gearData?: GearData, nodeStates: Record<string, 'defeated' | 'skipped'> = {}, gapLog: readonly GapEntry[] = gaps) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BossPageView, { data: pageData(b, gapLog), worldEvil: null, nodeStates, headingId: 'boss-page-title', gearData })))
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0
/** One page section's markup: from its data-section attribute to the next section's. */
const section = (html: string, name: string) => {
  const start = html.indexOf(`data-section="${name}"`)
  const next = html.indexOf('data-section="', start + 1)
  return html.slice(start, next < 0 ? undefined : next)
}
const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** Quoted tips with their weapon-name links unwrapped (M3 links names inside verbatim quotes). */
const unwrapTipLinks = (html: string) => html.replace(/<a [^>]*data-tip-link="\d+"[^>]*>([^<]*)<\/a>/g, '$1')

/** No forward promises / outcome promises in OUR copy (PRD §9; AMENDMENTS-013 purge). Wiki quotes are removed first. */
const FORWARD_PROMISE = /\b(yet|coming soon|so far|soon)\b/i
const OUTCOME = /\b(guarantee[sd]?|you will (win|die)|win the fight|easy win)\b/i
function ownCopy(html: string, b: Boss): string {
  // UnknownValue's standard screen-reader wording (UX_SPEC §5.3 "Not yet verified…") is the shared convention, not page copy.
  let t = text(unwrapTipLinks(html)).replace(/\(not yet verified(, show details)?\)/g, ' ')
  const quoted = [
    ...(b.strategies ?? []).map((s) => s.text),
    ...(b.prepChecklist ?? []).map((p) => p.text),
    b.summon.text ?? '',
    ...raw.edges.map((e) => e.note ?? ''),
    declaredGapReason(gaps, b, 'suggestedEquipment') ?? '',
    ...GEAR_CLASSES.map((cls) => declaredGapReason(gaps, b, gearClassField(cls)) ?? ''),
  ]
  for (const q of quoted.filter(Boolean).sort((x, y) => y.length - x.length)) t = t.split(escaped(q)).join(' ')
  return t
}

/** PRD P6-S1/S2 (AMENDMENTS-016 B131(b)): armor and accessories link in-app — a set by its slug, a piece / accessory by id. */
const ARMOR_SET_IDS = (armorSetsJson as { id: string }[]).map((s) => s.id)
const ALLOWED_LOCAL = new RegExp(
  `^(/weapons/\\d+|/items/\\d+|/armor/(\\d+|${ARMOR_SET_IDS.join('|')})|/accessories/\\d+|/bosses\\?node=[a-z0-9-]+|/bosses/(${BOSS_PAGE_IDS.join('|')})|/readiness\\?boss=(${BOSS_PAGE_IDS.join('|')})|/guides/(${Object.values(BOSS_PREP_GUIDES).map((g) => g.slug).join('|')}))$`,
)

/** One class tab's panel markup. */
const classPanel = (html: string, cls: string) => {
  const start = html.indexOf(`data-class-panel="${cls}"`)
  const next = html.indexOf('data-class-panel="', start + 1)
  return html.slice(start, next < 0 ? html.indexOf('data-section="patterns"') : next)
}

describe('boss pages: every page (pre-Hardmode P5-S2, Wall of Flesh + Hardmode P5-S3) renders every AC1 section from the shipped data', () => {
  it('the page list is every registry boss (B79: the Wall of Flesh joins the Hardmode list)', () => {
    expect([...BOSS_PAGE_IDS].sort()).toEqual(bosses.map((b) => b.id).sort())
    expect(BOSS_PAGE_IDS).toHaveLength(18)
  })

  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s', (id) => {
    const b = boss(id)
    const html = render(b, gearData)

    // AC1 sections, in order: visual/header, summon, where & when, prep, gear (per class), attack patterns + tips, drops,
    // the "Check Readiness" CTA (UX_SPEC §3.7, P5-S6 — top of the rail), next steps (+ stats)
    const sections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1])
    expect(sections).toEqual(['header', 'summon', 'where', 'prep', 'gear', 'patterns', 'drops', 'readiness', 'next', 'stats'])
    // Feature A AC5: every boss page opens the readiness checker prefilled with itself
    expect(html).toContain(`href="/readiness?boss=${b.id}"`)
    expect(html).toContain(`>${escaped(b.name)}</h1>`)
    // the full sprite file (B30 `full`), never a thumbnail
    expect(html).toContain(`src="${b.sprite}"`)

    // summon: the verified quote with its source; summon items as ItemSlots
    expect(html).toContain(escaped(b.summon.text as string))
    expect(html).toContain(`href="${b.summon.sourceUrl}"`)
    for (const item of b.summon.items) expect(html).toContain(`data-item-id="${item}"`)
    // where & when
    for (const biome of b.location.biomes) expect(html).toContain(escaped(biome))

    // prep checklist: one checkbox per curated step, each with its source
    const prep = b.prepChecklist ?? []
    expect(prep.length).toBeGreaterThan(0)
    expect(count(html, /data-prep-entry="p-[0-9a-f]{8}"/g)).toBe(prep.length)
    expect(count(html, /type="checkbox"/g)).toBe(prep.length)
    for (const p of prep) expect(html).toContain(`href="${p.sourceUrl}"`)
    expect(html).toContain(`data-prep-progress="0/${prep.length}"`)

    // gear: four class tabs. Either the whole field is Unknown with the overlay's stated reason (no
    // weapon verified obtainable before the fight), or it is curated and every class tab shows its
    // picks — each a real weapon page with its gate — or its own Unknown with its stated reason.
    expect([...html.matchAll(/data-class-tab="([a-z]+)"/g)].map((m) => m[1])).toEqual([...GEAR_CLASSES])
    expect(count(html, /data-class-panel="/g)).toBe(4)
    if (getField(b, 'suggestedEquipment').status === 'unverified') {
      expect(html).toContain('data-gear-unknown=""')
      expect(html).toContain('data-unknown-field="suggestedEquipment"')
      const reason = declaredGapReason(gaps, b, 'suggestedEquipment')
      expect(reason).toMatch(/^No weapon is verified as obtainable before this fight/)
      expect(html).toContain(escaped(reason as string))
      expect(html).not.toContain('data-gear-class-unknown')
    } else {
      expect(getField(b, 'suggestedEquipment').status).toBe('editorial')
      expect(html).not.toContain('data-gear-unknown=""')
      expect(html).toContain('data-gear-basis=""')
      for (const cls of GEAR_CLASSES) {
        const own = classGear(b, cls)
        const panel = classPanel(html, cls)
        expect(own.status, `${id} ${cls}`).not.toBe('none') // the gate makes every class an entry or a declared Unknown
        if (own.status === 'curated') {
          expect(panel).toContain(`data-gear-entry="${cls}"`)
          for (const w of own.entries.flatMap((e) => e.weapons)) expect(panel, `${id} ${cls} i:${w}`).toMatch(new RegExp(`data-item-id="${w}"[^>]*>\\s*<a [^>]*href="/weapons/${w}"`))
          expect(panel).not.toContain('data-gear-class-unknown')
        } else {
          expect(panel).toContain(`data-gear-class-unknown="${cls}"`)
          expect(panel).toContain(`data-unknown-field="${gearClassField(cls)}"`)
          const reason = declaredGapReason(gaps, b, gearClassField(cls))
          expect(reason, `${id} ${cls}`).toMatch(new RegExp(`^No ${cls} weapon the wiki recommends for this fight is verified as obtainable before it`))
          expect(panel).toContain(escaped(reason as string))
        }
      }
    }

    // attack patterns + every strategy (survival tips + Expert tips + class tips), each a quote with its own source
    for (const tag of b.attackPatternTags ?? []) expect(html).toContain(`data-attack-tag="${tag}"`)
    expect(count(html, /data-tip=""/g)).toBe(b.strategies?.length)
    for (const s of b.strategies ?? []) expect(unwrapTipLinks(html)).toContain(escaped(s.text))
    expect(count(html, />curated</g)).toBeGreaterThanOrEqual(4) // stage, prep, gear, patterns

    // drops: one row per drop record, rate cells Unknown exactly where the record lists them
    const { rows } = bossDropRows(b, drops, itemOf)
    expect(count(html, /data-drop-row="/g)).toBe(b.dropIds.length)
    const unknownRates = rows.reduce((n, r) => n + (['classic', 'expert', 'master'] as const).filter((d) => getField(r.drop, `rates.${d}`).status === 'unverified').length, 0)
    expect(count(html, /data-rate="unknown"/g)).toBe(unknownRates)

    // AC3 next steps link back into the map at the right node; AC2: no dead local links
    expect(html).toContain(`href="/bosses?node=${b.nodeId}"`)
    expect(count(html, /data-map-link="/g)).toBeGreaterThan(1)
    for (const m of html.matchAll(/href="(\/[^"]*)"/g)) expect(m[1].replace(/&amp;/g, '&'), id).toMatch(ALLOWED_LOCAL)

    // the partially-verified badge counts exactly the Unknown markers on the page
    const total = bossPageUnknowns(b, rows).reduce((n, u) => n + (u.count ?? 1), 0)
    expect(count(html, /data-unknown-field="/g)).toBe(total)

    // our copy: no forward promises, no outcome promises
    expect(ownCopy(html, b)).not.toMatch(FORWARD_PROMISE)
    expect(ownCopy(html, b)).not.toMatch(OUTCOME)
  })

  it('AC1/AC4: an Unknown drop rate renders as a hatched Unknown cell with its source (Eater of Worlds wall drops)', () => {
    const html = render(boss('eater-of-worlds'))
    expect(count(html, /data-rate="unknown"/g)).toBeGreaterThan(0)
    expect(html).toMatch(/<td data-cell="classic" data-rate="unknown" class="[^"]*\bbg-hatch-unknown\b[^"]*">/)
    expect(html).toContain('data-unknown-field="drop:')
    // each row carries its own source link
    expect(count(html, /Source for the [^<]*? drop[^<]* on terraria\.wiki\.gg/g)).toBe(boss('eater-of-worlds').dropIds.length)
  })

  it('AC2: drop items link their real page — weapons, items (P6 encyclopedia), accessories and armor (P6-S1/S2, B131(b)) in-app', () => {
    const html = render(boss('queen-bee'))
    expect(html).toContain('href="/weapons/1123"') // Bee Keeper
    expect(html).toContain('href="/accessories/3333"') // Hive Pack — its accessory page, no longer its wiki article
    expect(html).not.toContain('href="https://terraria.wiki.gg/wiki/Hive_Pack"')
    // AMENDMENTS-016 B104: Bee Wax used to fall back to the wiki search; its record is in the core file now
    expect(html).toContain('href="/items/2431"') // Bee Wax
    expect(html).not.toContain(wikiSearchUrl('Bee Wax'))
  })

  it('AMENDMENTS-016 B105: a derived drop quantity reads "× 1 derived" (explained once under the table), never like a stated one', () => {
    const html = render(boss('empress-of-light'))
    const terraprisma = /<tr[^>]*data-drop-row="[^"]*5005[^"]*"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? ''
    expect(terraprisma).toMatch(/<span class="sr-only">Quantity: <\/span>×\u00a01 <span data-derived=""/)
    expect(html).toContain('data-derived-note=""')
    // a boss without derived quantities has no note
    expect(render(boss('king-slime'))).not.toContain('data-derived-note')
  })

  it('B104: on every boss page no drop row of an emitted record falls back to the wiki search; every Item drop opens its item page', () => {
    for (const id of BOSS_PAGE_IDS) {
      const b = boss(id)
      const rows = bossDropRows(b, drops, itemOf).rows
      for (const row of rows) {
        const item = itemOf(row.drop.itemId)
        if (item.kind === 'other') continue // not an emitted record (a declared gap): wiki article / search stays honest
        expect(item.link?.kind === 'external' && item.link.href.includes('Special:Search'), `${id} ${item.name}`).toBe(false)
        if (item.kind === 'item') expect(item.link, `${id} ${item.name}`).toEqual({ kind: 'internal', to: `/items/${item.id}` })
      }
      expect(rows.filter((r) => itemOf(r.drop.itemId).kind === 'other').map((r) => itemOf(r.drop.itemId).name), id).toEqual([])
    }
  })

  it('a world-evil boss says which world it belongs to; the header carries the defeat control (P5-S4)', () => {
    const html = render(boss('brain-of-cthulhu'))
    expect(html).toContain('Crimson worlds only')
    expect(section(html, 'header')).toContain('data-defeat-control="brain-of-cthulhu"')
    expect(html).toMatch(/<input type="radio" data-defeat-option="not-attempted"[^>]*checked=""/)
    expect(html).not.toContain('Display only')
  })

  it('event / milestone node ids and unknown ids are a NotFoundError (styled 404), never a half page', async () => {
    // A3: events and milestones are map markers without pages.
    await expect(loadBossPageData('hardmode')).rejects.toBeInstanceOf(NotFoundError)
    await expect(loadBossPageData('pumpkin-moon')).rejects.toBeInstanceOf(NotFoundError)
    await expect(loadBossPageData('not-a-boss')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('per-class gear when a boss has curated entries (rendering contract; validate enforces the gating)', () => {
  // A synthetic gear entry on Skeletron naming real records: Bee Keeper (gated by Queen Bee), Shield of
  // Cthulhu (Eye of Cthulhu), Ninja armor (King Slime), the Ironskin buff.
  const withGear = (): Boss => {
    const b = structuredClone(boss('skeletron'))
    b.suggestedEquipment = [{ class: 'melee', weapons: [1123], armorSetIds: ['ninja-armor'], accessories: [3097], buffs: ['ironskin'] }]
    b._prov = { ...b._prov, unverifiedFields: b._prov.unverifiedFields.filter((f) => f !== 'suggestedEquipment'), editorialFields: [...b._prov.editorialFields, 'suggestedEquipment'] }
    return b
  }

  it('renders the class tab’s gear as linked ItemSlots, each gated item with a GateBadge naming (and linking) its gate', () => {
    const html = render(withGear(), gearData)
    expect(html).not.toContain('data-gear-unknown')
    const melee = /data-class-panel="melee"[\s\S]*?(?=data-class-panel="ranged")/.exec(html)![0]
    expect(melee).toContain('data-gear-entry="melee"')
    expect(melee).toContain('href="/weapons/1123"')
    expect(melee).toMatch(/data-gate="Queen Bee"[^>]*>|href="\/bosses\/queen-bee"[^>]*data-gate="Queen Bee"/)
    expect(melee).toContain('data-gate="Eye of Cthulhu"')
    expect(melee).toContain('data-gate="King Slime"')
    // review nit (768): entries take their natural width and wrap whole, so a badge stays on its item's line while there is room
    expect(melee).toContain('<ul aria-label="Weapons" class="flex flex-wrap gap-x-6 gap-y-1">')
    expect(melee).toContain('Ninja armor')
    expect(melee).toContain(`href="${gearData.buffs.get('ironskin')?.wikiUrl}"`)
    // other classes: never another class's picks. Skeletron's ranged gear is declared Unknown (B78/B83b
    // per-class gap) — the Unknown block with the plain line and the overlay's stated reason one tap away.
    const ranged = /data-class-panel="ranged"[\s\S]*?(?=data-class-panel="magic")/.exec(html)![0]
    expect(ranged).not.toContain('href="/weapons/1123"')
    expect(ranged).toContain('data-gear-class-unknown="ranged"')
    expect(ranged).toContain('data-unknown-field="suggestedEquipment.ranged"')
    expect(ranged).toContain('None of the ranged weapons the wiki recommends here is verified as obtainable before this fight.')
    const reason = declaredGapReason(gaps, boss('skeletron'), 'suggestedEquipment.ranged')
    expect(reason).toMatch(/^No ranged weapon the wiki recommends for this fight is verified as obtainable before it: /)
    expect(ranged).toMatch(new RegExp(`<details[^>]*>[\\s\\S]*?Why we can’t tell</summary><p[^>]*>${escaped(reason as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p></details>`))
    expect(ranged).not.toContain('No curated ranged gear')
    // a class neither curated nor declared Unknown: an honest empty state
    const undeclared = withGear()
    undeclared._prov = { ...undeclared._prov, unverifiedFields: undeclared._prov.unverifiedFields.filter((f) => f !== 'suggestedEquipment.ranged') }
    expect(classPanel(render(undeclared, gearData), 'ranged')).toContain('No curated ranged gear for this fight.')
  })

  it('a gate the player marked defeated drops its badge (badges reflect tracked progress)', () => {
    const html = render(withGear(), gearData, { 'queen-bee': 'defeated' })
    expect(html).not.toContain('data-gate="Queen Bee"')
    expect(html).toContain('data-gate="Eye of Cthulhu"')
  })
})

describe('prep checklist persistence (tc.v1.checklists, AMENDMENTS-001 A7)', () => {
  function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
    const map = new Map(Object.entries(seed))
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      dump: () => Object.fromEntries(map),
    }
  }
  const envelope = (data: unknown) => JSON.stringify({ v: 1, savedAt: '2026-10-14T00:00:00.000Z', gameVersion: '1.4.5.8', data })
  const eye = boss('eye-of-cthulhu')
  const [first, second] = (eye.prepChecklist ?? []).map((p) => prepEntryId(p.text))

  it('round trip: a check-off is written as a ChecklistsV1 envelope under boss:<slug>:prep and survives a reload', () => {
    const backend = memoryBackend()
    const store = createPrepChecklistStore(backend)
    const key = prepChecklistKey('eye-of-cthulhu')
    expect(key).toBe('boss:eye-of-cthulhu:prep')
    store.getState().setChecked(key, first, true)
    store.getState().setChecked(key, second, true)
    const stored = JSON.parse(backend.dump()['tc.v1.checklists'])
    expect(ChecklistsV1.safeParse(stored).success).toBe(true)
    expect(stored.data).toEqual({ byKey: { [key]: [first, second] } })
    // a fresh store = a reload
    const reloaded = createPrepChecklistStore(backend)
    expect(reloaded.getState().byKey[key]).toEqual([first, second])
    reloaded.getState().setChecked(key, first, false)
    expect(createPrepChecklistStore(backend).getState().byKey[key]).toEqual([second])
    reloaded.getState().setChecked(key, second, false)
    expect(loadDomain('checklists', backend)).toEqual({ kind: 'loaded', data: { byKey: {} } })
  })

  it('read-merge-write: another owner’s keys (guides) written meanwhile are kept', () => {
    const backend = memoryBackend()
    const store = createPrepChecklistStore(backend)
    backend.setItem('tc.v1.checklists', envelope({ byKey: { 'guide:getting-started': ['g-1'] } }))
    store.getState().setChecked('boss:king-slime:prep', 'p-00000001', true)
    expect(loadDomain('checklists', backend)).toEqual({ kind: 'loaded', data: { byKey: { 'guide:getting-started': ['g-1'], 'boss:king-slime:prep': ['p-00000001'] } } })
  })

  it('keeps the change in memory (and says so) when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createPrepChecklistStore(null)
    store.getState().setChecked('boss:king-slime:prep', 'p-00000001', true)
    expect(store.getState()).toMatchObject({ byKey: { 'boss:king-slime:prep': ['p-00000001'] }, persistError: true })
    warn.mockRestore()
  })

  it('the hand-written parser agrees with the Zod ChecklistsV1 schema', () => {
    const good = [{ byKey: {} }, { byKey: { 'boss:eye-of-cthulhu:prep': ['p-1', 'p-2'], 'guide:x': [] } }]
    const bad = [{}, { byKey: [] }, { byKey: { k: 'p-1' } }, { byKey: { k: [1] } }, { byKey: {}, extra: 1 }, null]
    for (const data of good) {
      expect(() => parseChecklists(data)).not.toThrow()
      expect(ChecklistsV1.safeParse({ v: 1, savedAt: '2026-10-14T00:00:00.000Z', gameVersion: '1.4.5.8', data }).success).toBe(true)
    }
    for (const data of bad) {
      expect(() => parseChecklists(data)).toThrow()
      expect(ChecklistsV1.safeParse({ v: 1, savedAt: '2026-10-14T00:00:00.000Z', gameVersion: '1.4.5.8', data }).success).toBe(false)
    }
  })

  it('entry ids are stable (whitespace / case) and distinct across every shipped checklist', () => {
    expect(prepEntryId('  Drink a  Swiftness Potion ')).toBe(prepEntryId('drink a swiftness potion'))
    for (const id of BOSS_PAGE_IDS) {
      const ids = (boss(id).prepChecklist ?? []).map((p) => prepEntryId(p.text))
      expect(new Set(ids).size, id).toBe(ids.length)
    }
  })
})

describe('page model', () => {
  it('next steps: a main-line boss lists what it leads to (an either/or target with its partner)', () => {
    const eye = nextSteps(graph, 'eye-of-cthulhu')
    expect(eye.after.map((a) => [a.connection.other.id, a.partners.map((p) => p.id)])).toEqual([['eater-of-worlds', ['brain-of-cthulhu']]])
    // M1: the usual next fight first; the far-downstream gate it opens (Lunatic Cultist, endgame) after it.
    expect(nextSteps(graph, 'skeletron').after.map((a) => a.connection.other.id)).toEqual(['wall-of-flesh', 'lunatic-cultist'])
  })

  it('next steps: an either/or member shows its partner and what comes before the pair', () => {
    const brain = nextSteps(graph, 'brain-of-cthulhu')
    expect(brain.alternatives.map((c) => c.other.id)).toEqual(['eater-of-worlds'])
    expect(brain.before.map((c) => c.other.id)).toEqual(['eye-of-cthulhu'])
    expect(brain.after.map((a) => a.connection.other.id)).toEqual(['skeletron'])
  })

  it('next steps: a milestone step (Hardmode after the Wall of Flesh) lists what it opens — exactly its links out of the graph, fights first', () => {
    const wof = nextSteps(graph, 'wall-of-flesh')
    expect(wof.after.map((a) => a.connection.other.id)).toEqual(['hardmode'])
    const opens = wof.after[0].opens ?? []
    const fromGraph = new Set(raw.edges.filter((e) => e.from === 'hardmode' && e.type !== 'alternative-route').map((e) => e.to))
    expect(new Set(opens.map((c) => c.other.id))).toEqual(fromGraph)
    expect(opens.map((c) => c.other.id)).toEqual(expect.arrayContaining(['queen-slime', 'the-twins', 'the-destroyer', 'skeletron-prime', 'duke-fishron']))
    const kindRank = (k: string) => ['boss', 'event', 'milestone'].indexOf(k)
    expect(opens.map((c) => kindRank(c.other.kind))).toEqual(opens.map((c) => kindRank(c.other.kind)).sort((a, b) => a - b))
    expect(opens.find((c) => c.other.id === 'duke-fishron')?.link.types).toContain('early-challenge-possible')
    // the mechanical bosses' milestone opens Plantera; a boss step opens nothing of its own
    expect(nextSteps(graph, 'the-twins').after.find((a) => a.connection.other.id === 'all-mechanical-bosses')?.opens?.map((c) => c.other.id)).toEqual(['plantera'])
    expect(nextSteps(graph, 'skeletron').after.every((a) => a.opens === undefined)).toBe(true)
  })

  it('the Wall of Flesh page points past the Hardmode marker: one map link per step Hardmode opens, read from the graph (not hand-written)', () => {
    const next = section(render(boss('wall-of-flesh')), 'next')
    const pointer = next.slice(next.indexOf('data-step-opens="hardmode"'))
    expect(pointer).toContain('From Hardmode, the path continues with:')
    const listed = [...pointer.matchAll(/data-opens="([^"]+)"/g)].map((m) => m[1])
    expect(listed).toEqual((nextSteps(graph, 'wall-of-flesh').after[0].opens ?? []).map((c) => c.other.id))
    for (const id of listed) expect(pointer).toContain(`href="/bosses?node=${id}"`)
    expect(pointer).toMatch(/Duke Fishron<span class="sr-only"> on the map<\/span><\/a><span[^>]*>can be fought early</)
    expect(pointer).toMatch(/Queen Slime<span class="sr-only"> on the map<\/span><\/a><span[^>]*>optional</)
    // graph-derived: drop Hardmode's link to Queen Slime and she leaves the pointer
    const trimmed = buildMapGraph({ nodes: raw.nodes, edges: raw.edges.filter((e) => !(e.from === 'hardmode' && e.to === 'queen-slime')) }, bosses)
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BossPageView, { data: { ...pageData(boss('wall-of-flesh')), graph: trimmed }, worldEvil: null, nodeStates: {}, headingId: 'h' })))
    const trimmedPointer = section(html, 'next').slice(section(html, 'next').indexOf('data-step-opens="hardmode"'))
    expect(trimmedPointer).not.toContain('data-opens="queen-slime"')
    expect(trimmedPointer).toContain('data-opens="the-twins"')
    // boss pages whose next step is a boss show no pointer
    expect(section(render(boss('skeletron')), 'next')).not.toContain('data-step-opens')
  })

  it('next steps: an optional side branch points to where the path it branched from continues', () => {
    for (const id of ['king-slime', 'queen-bee', 'deerclops']) {
      const steps = nextSteps(graph, id)
      expect(steps.after, id).toEqual([])
      expect(steps.continueFrom?.from.id, id).toBe('pre-hardmode')
      expect(steps.continueFrom?.next.map((c) => c.other.id), id).toEqual(['eye-of-cthulhu'])
    }
  })

  it('strategies split into survival tips, Expert/Master tips and per-class tips without loss', () => {
    for (const id of BOSS_PAGE_IDS) {
      const s = boss(id).strategies ?? []
      const g = strategyGroups(s)
      expect(g.general.length + g.byDifficulty.length + GEAR_CLASSES.reduce((n, c) => n + g.byClass[c].length, 0), id).toBe(s.length)
      for (const c of GEAR_CLASSES) expect(g.byClass[c].every((t) => t.class === c)).toBe(true)
    }
  })

  it('items resolve to their real page: weapon, Item, accessory and armor records in-app, else the wiki search for the Iteminfo name; a nameless id has no link', () => {
    expect(itemOf(1123)).toMatchObject({ name: 'Bee Keeper', kind: 'weapon', link: { kind: 'internal', to: '/weapons/1123' } })
    // PRD P6-S1/S2 (AMENDMENTS-016 B131(b)): accessories and armor pieces have their own pages now
    expect(itemOf(3097)).toMatchObject({ name: 'Shield of Cthulhu', kind: 'accessory', link: { kind: 'internal', to: '/accessories/3097' } })
    expect(itemOf(684)).toMatchObject({ name: 'Frost Helmet', kind: 'armor', link: { kind: 'internal', to: '/armor/684' } })
    // B96(d), fixed data-side by P6-S0: a summoning item is a record of its own (items.detail.json holds every item a boss
    // references); P6 encyclopedia (AMENDMENTS-016): each Item record opens its own item page
    expect(itemOf(560)).toEqual({ id: 560, name: 'Slime Crown', kind: 'item', sprite: '/sprites/items/560.png', link: { kind: 'internal', to: '/items/560' } })
    expect(itemOf(43)).toMatchObject({ name: 'Suspicious Looking Eye', kind: 'item', link: { kind: 'internal', to: '/items/43' } })
    // an Iteminfo name without any record still opens the wiki search for that exact name (Magic Shimmer Dropper: no Cargo Items row)
    expect(itemOf(5492)).toEqual({ id: 5492, name: 'Magic Shimmer Dropper', kind: 'other', link: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Special:Search?search=Magic%20Shimmer%20Dropper' } })
    expect(names.byId.has(999999)).toBe(false)
    expect(itemOf(999999)).toEqual({ id: 999999, name: 'Item #999999', kind: 'other' })
    // B70: the Ironskin Potion is a record of its own (the potion corpus) — its own item page and sprite
    expect(itemOf(292)).toEqual({ id: 292, name: 'Ironskin Potion', kind: 'item', sprite: '/sprites/items/292.png', link: { kind: 'internal', to: '/items/292' } })
    // without that record, the Ironskin buff record still carries the article titled exactly "Ironskin Potion"
    const noItemRecords = itemResolver({ names, weapons: weaponList, accessories: accessoriesListJson as AccessoryListRecord[], armor: armorListJson as ArmorListRecord[], items: [], articles: buffs.map((b) => b.wikiUrl) })
    expect(noItemRecords(292)).toEqual({ id: 292, name: 'Ironskin Potion', kind: 'other', link: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Ironskin_Potion' } })
    expect(wikiArticleTitle('https://terraria.wiki.gg/wiki/Torch_God%27s_Favor')).toBe('Torch God\'s Favor')
    expect(wikiArticleTitle('https://example.com/wiki/Torch')).toBeUndefined()
  })
})

describe('H1: stats — an all-Unknown table collapses to one honest line', () => {
  const noStats = BOSS_PAGE_IDS.filter((id) => statsView(boss(id), gaps).kind === 'none')

  it('the shipped data: a stats table for six bosses (Empress of Light and Plantera with Unknown contact damage), one honest line for the rest', () => {
    expect([...noStats].sort()).toEqual([
      'brain-of-cthulhu',
      'duke-fishron',
      'eater-of-worlds',
      'golem',
      'lunatic-cultist',
      'moon-lord',
      'queen-bee',
      'skeletron',
      'skeletron-prime',
      'the-destroyer',
      'the-twins',
      'wall-of-flesh',
    ])
    const tables = Object.fromEntries(BOSS_PAGE_IDS.filter((x) => !noStats.includes(x)).map((id) => [id, statsView(boss(id), gaps)]))
    expect(tables).toEqual({
      'king-slime': { kind: 'table', unknownCells: 0 },
      'eye-of-cthulhu': { kind: 'table', unknownCells: 0 },
      deerclops: { kind: 'table', unknownCells: 0 },
      'queen-slime': { kind: 'table', unknownCells: 0 },
      plantera: { kind: 'table', unknownCells: 3 },
      'empress-of-light': { kind: 'table', unknownCells: 3 },
    })
  })

  it('the Moon Lord line carries its multi-part reason (P5-S3 evidence)', () => {
    const ml = boss('moon-lord')
    const reason = 'Multi-part boss (head, two hands and core, each with its own health and defense); no boss-level row.'
    expect(statsView(ml, gaps)).toEqual({ kind: 'none', reason })
    expect(section(render(ml), 'stats')).toContain(`Stats not verified for Terraria ${meta.gameVersion} — ${escaped(reason)}`)
  })

  it('B82: the "first form" caption only on bosses that change form mid-fight (curated multi-phase tag)', () => {
    for (const id of BOSS_PAGE_IDS.filter((x) => !noStats.includes(x))) {
      const stats = section(render(boss(id)), 'stats')
      expect(stats.includes('first form'), id).toBe(isMultiForm(boss(id)))
    }
    // pinned: two single-form tables without it, four multi-phase ones with it
    expect(['king-slime', 'deerclops'].map((id) => isMultiForm(boss(id)))).toEqual([false, false])
    expect(['eye-of-cthulhu', 'queen-slime', 'plantera', 'empress-of-light'].map((id) => isMultiForm(boss(id)))).toEqual([true, true, true, true])
  })

  it.each(noStats.map((id) => [id]))('%s: one line, one Unknown marker, no grid, no first-form caption', (id) => {
    const stats = section(render(boss(id)), 'stats')
    expect(stats).toContain('data-stats-unknown=""')
    expect(count(stats, /data-unknown-field="/g)).toBe(1)
    expect(stats).toContain('data-unknown-field="statsByDifficulty"')
    expect(stats).not.toContain('<table')
    expect(stats).toContain(`Stats not verified for Terraria ${meta.gameVersion} — `)
    expect(stats).not.toContain('first form')
    expect(bossPageUnknowns(boss(id), []).find((u) => u.key === 'stats')).toEqual({ key: 'stats', label: 'Stats' })
  })

  it('the line carries the stated reason from the shipped gap log (the overlay’s statsUnknown → a missing-field gap on statsByDifficulty)', () => {
    const eow = boss('eater-of-worlds')
    const reason = 'Multi-segment boss: the wiki gives health, defense and damage per segment (head, body and tail rows); no boss-level row.'
    expect(gaps).toContainEqual({ ref: 'boss:eater-of-worlds', field: 'statsByDifficulty', kind: 'missing-field', detail: `Eater of Worlds: ${reason}`, sources: [eow.wikiUrl] })
    expect(statsView(eow, gaps)).toEqual({ kind: 'none', reason })
    expect(section(render(eow), 'stats')).toContain(`Stats not verified for Terraria ${meta.gameVersion} — ${escaped(reason)}`)
    // without the gap log the line stays honest, just without its reason
    expect(statsView(eow, undefined)).toEqual({ kind: 'none', reason: undefined })
  })

  it('a partial table keeps the grid: each Unknown cell hatched and phone-sized, the caption shown (multi-form boss)', () => {
    const b = structuredClone(boss('eye-of-cthulhu'))
    delete b.statsByDifficulty.expert
    delete b.statsByDifficulty.master
    b._prov = { ...b._prov, unverifiedFields: [...b._prov.unverifiedFields, 'statsByDifficulty.expert', 'statsByDifficulty.master'] }
    expect(statsView(b, gaps)).toEqual({ kind: 'table', unknownCells: 6 })
    const stats = section(render(b), 'stats')
    const hatched = [...stats.matchAll(/<td class="([^"]*\bbg-hatch-unknown\b[^"]*)">/g)].map((m) => m[1])
    expect(hatched).toHaveLength(6)
    for (const cls of hatched) expect(cls).toContain('max-md:text-xs')
    // neighbouring hatched cells stay apart (review nit: touching "Unknown"s in the 1440 rail)
    for (const cls of hatched) expect(cls).toMatch(/\bborder-x-2\b.*\bborder-panel\b/)
    expect(stats).toMatch(/<th scope="col" class="[^"]*\blg:w-\[28%\]/)
    for (const d of ['expert', 'master'] as const) for (const k of STAT_KEYS) expect(stats).toContain(`data-unknown-field="${statField(d, k)}"`)
    expect(stats).toContain(Number(boss('eye-of-cthulhu').statsByDifficulty.classic?.hp).toLocaleString('en-US'))
    expect(stats).toContain('first form')
    expect(STAT_DIFFICULTIES).toEqual(['classic', 'expert', 'master'])
  })
})

describe('H2: drops — order and grouping (property over every boss page)', () => {
  const ROLE_RANK = { boss: 0, segment: 1, variant: 2, bag: 3 } as const

  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s', (id) => {
    const b = boss(id)
    const { tiers, rows, missing } = bossDropSections(b, drops, itemOf)
    const loaded = b.dropIds.filter((d) => drops.byId.has(d))
    // every loaded record exactly once; missing ones counted
    expect(rows.map((r) => r.drop.id).sort()).toEqual([...loaded].sort())
    expect(missing).toBe(b.dropIds.length - loaded.length)
    expect(rows.map((r) => r.drop.id)).toEqual(DROP_TIERS.flatMap((t) => tiers[t].flatMap((g) => g.rows.map((r) => r.drop.id))))

    // the condition-dependent group is EXACTLY the records whose conditions are Unknown
    const unknownConditions = new Set(loaded.filter((d) => getField(drops.byId.get(d) as DropSource, 'conditions').status === 'unverified'))
    expect(new Set(tiers.conditional.flatMap((g) => g.rows.map((r) => r.drop.id)))).toEqual(unknownConditions)

    // Treasure Bag first among the rewards; then best verified chance first (rewards and materials)
    const hasBag = rows.some((r) => r.bag)
    expect(tiers.rewards.findIndex((g) => g.treasureBag)).toBe(hasBag ? 0 : -1)
    expect(tiers.rewards.filter((g) => g.treasureBag).map((g) => g.item.name)).toEqual(hasBag ? [rows.find((r) => r.bag)?.drop.source.npcName] : [])
    for (const list of [tiers.rewards.filter((g) => !g.treasureBag), tiers.materials]) {
      for (let i = 1; i < list.length; i++) expect(list[i - 1].topRate, `${id}: ${list[i].item.name}`).toBeGreaterThanOrEqual(list[i].topRate)
    }
    // equipment is always a reward; a group is one item, its rows boss → segments → variants → bag
    for (const tier of DROP_TIERS) {
      for (const g of tiers[tier]) {
        expect(g.tier).toBe(tier)
        if (tier !== 'conditional' && ['weapon', 'accessory', 'armor'].includes(g.item.kind)) expect(g.tier, g.item.name).toBe('rewards')
        expect(new Set(g.rows.map((r) => r.drop.itemId))).toEqual(new Set([g.item.id]))
        const ranks = g.rows.map((r) => ROLE_RANK[r.role])
        expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
        if (g.rows.some((r) => r.role === 'segment')) expect(g.rows[0].role).toBe('boss')
      }
    }

    // rendered: exactly this order; the condition-dependent group collapsed, after the main table, with its qualifier
    const html = render(b)
    expect([...html.matchAll(/data-drop-row="([^"]+)"/g)].map((m) => m[1])).toEqual(rows.map((r) => r.drop.id))
    const open = html.indexOf('<details data-drop-tier="conditional"')
    if (tiers.conditional.length > 0) {
      const tag = /<details data-drop-tier="conditional"[^>]*>/.exec(html)?.[0] ?? ''
      expect(tag).not.toMatch(/\sopen/)
      const group = html.slice(open, html.indexOf('</details>', open))
      expect(group).toContain(escaped(CONDITIONAL_SUMMARY))
      expect(group).toContain(escaped(CONDITIONAL_QUALIFIER))
      for (const r of tiers.conditional.flatMap((g) => g.rows)) expect(group).toContain(`data-drop-row="${r.drop.id}"`)
      expect(count(group, /data-drop-row="/g)).toBe(unknownConditions.size)
    } else {
      expect(open).toBe(-1)
    }
  })

  it('the reviewed cases: Eater of Worlds’ dungeon bricks and walls, the Eye’s altars and Badger’s Hat sit in the collapsed group; the bag leads', () => {
    const eow = bossDropSections(boss('eater-of-worlds'), drops, itemOf)
    const eowConditional = eow.tiers.conditional.map((g) => g.item.name)
    expect(eowConditional).toEqual(expect.arrayContaining(['Blue Brick', 'Green Brick', 'Pink Brick', 'Cursed Blue Brick Wall', 'Cursed Green Tiled Wall']))
    expect(eow.tiers.rewards[0].item.name).toBe('Treasure Bag (Eater of Worlds)')
    expect(eow.tiers.rewards.map((g) => g.item.name)).toContain('Worm Scarf')
    const eye = bossDropSections(boss('eye-of-cthulhu'), drops, itemOf)
    expect(eye.tiers.conditional.map((g) => g.item.name)).toEqual(['Badger’s Hat', 'Crimson Altar', 'Demon Altar'].map((n) => n.replace('’', "'")))
    expect(eye.tiers.rewards[0].item.name).toBe('Treasure Bag (Eye of Cthulhu)')
    expect(eye.tiers.rewards.map((g) => g.item.name)).toEqual(expect.arrayContaining(['Shield of Cthulhu', 'Binoculars', 'Eye of Cthulhu Relic']))
    expect(eye.tiers.materials.map((g) => g.item.name)).toEqual(expect.arrayContaining(['Demonite Ore', 'Crimtane Ore', 'Lesser Healing Potion', 'Gold Coin', 'Unholy Arrow']))
    const skeletron = bossDropSections(boss('skeletron'), drops, itemOf)
    // B84 (P6-S0): the Hellforge's caption is a registered condition now, so it left the collapsed Unknown-conditions group
    expect(skeletron.tiers.conditional.map((g) => g.item.name)).toEqual([])
    expect([...drops.byId.values()].filter((d) => d.itemId === 221 && d.source.bossId === 'skeletron').map((d) => d.conditions)).toEqual([['hellforge-absent']])
    // King Slime's Slime Staff also drops from slimes, but a weapon is a reward
    expect(bossDropSections(boss('king-slime'), drops, itemOf).tiers.rewards.map((g) => g.item.name)).toContain('Slime Staff')
  })

  it('Eater of Worlds: per-segment Demonite Ore / Shadow Scale rows sit under the item, labelled per segment, with the add-up note', () => {
    const eow = bossDropSections(boss('eater-of-worlds'), drops, itemOf)
    for (const name of ['Demonite Ore', 'Shadow Scale']) {
      const g = eow.tiers.materials.find((x) => x.item.name === name)
      expect(g?.segmented, name).toBe(true)
      expect(g?.rows.map((r) => r.role)).toEqual(['boss', 'segment', 'segment', 'segment', 'bag'])
      // game order (NPC ids 13, 14, 15), not alphabetical
      expect(g?.rows.filter((r) => r.role === 'segment').map((r) => r.part)).toEqual(['Head', 'Body', 'Tail'])
    }
    const html = render(boss('eater-of-worlds'))
    expect(count(html, /data-segment-note="/g)).toBe(2)
    expect(count(html, />On defeat \(whole boss\)</g)).toBe(2)
    for (const part of ['Head', 'Body', 'Tail']) expect(count(html, new RegExp(`>Per segment: ${part}<`, 'g'))).toBe(2)
    // no other boss page has segment rows
    for (const id of BOSS_PAGE_IDS.filter((x) => x !== 'eater-of-worlds')) expect(bossDropSections(boss(id), drops, itemOf).rows.some((r) => r.role === 'segment'), id).toBe(false)
  })

  it('a quantity range is one unbreakable line (no-break space after ×, nowrap)', () => {
    const html = render(boss('eater-of-worlds'))
    const quantities = [...html.matchAll(/<span data-quantity="" class="([^"]*)">([\s\S]*?)<\/span>(?=<\/td>)/g)]
    expect(quantities.length).toBeGreaterThan(10)
    for (const [, cls, body] of quantities) {
      expect(cls).toContain('whitespace-nowrap')
      expect(body.replace(/<span class="sr-only">[^<]*<\/span>/, '').replace(/<!-- -->/g, '')).toMatch(/^×\u00a0\d+(–\d+)?$/)
    }
    expect(html).toContain('×\u00a0500–600')
  })
})

describe('P5-S3 review fixes on the drops table (shipped data)', () => {
  const dropRow = (html: string, id: string) => {
    const start = html.indexOf(`data-drop-row="${id}"`)
    return html.slice(start, html.indexOf('</tr>', start))
  }
  const rowsOf = (bossId: string, itemName: string) => boss(bossId).dropIds.map((id) => drops.byId.get(id) as DropSource).filter((d) => itemOf(d.itemId).name === itemName)
  const quantities = (row: string) => [...row.matchAll(/<span data-quantity=""[^>]*>[\s\S]*?× ([^<]+)<\/span>/g)].map((m) => m[1])

  it('[High] Plantera: the Grenade Launcher is one launcher (no rocket stack); Rocket I is its own row with 50–149 at the same chance', () => {
    const html = render(boss('plantera'))
    const launchers = rowsOf('plantera', 'Grenade Launcher')
    const rockets = rowsOf('plantera', 'Rocket I')
    expect(launchers.map((d) => d.source.npcName).sort()).toEqual(['Plantera (Second Form)', 'Treasure Bag (Plantera)'])
    expect(rockets.map((d) => d.source.npcName).sort()).toEqual(['Plantera (Second Form)', 'Treasure Bag (Plantera)'])
    for (const d of launchers) {
      expect(d.quantity).toEqual({ min: 1, max: 1 })
      expect(quantities(dropRow(html, d.id))).toEqual([]) // a quantity of 1 shows no "×" line
      const rocket = rockets.find((r) => r.source.npcName === d.source.npcName) as DropSource
      expect(rocket.rates).toEqual(d.rates)
      expect(rocket.quantity).toEqual({ min: 50, max: 149 })
      expect(quantities(dropRow(html, rocket.id)).length).toBeGreaterThan(0)
      for (const q of quantities(dropRow(html, rocket.id))) expect(q).toBe('50–149')
    }
  })

  it('[Medium] Plantera: the four Jungle Temple drops carry their caption condition (no longer Unknown); only the first-defeat-note rows stay condition-dependent', () => {
    const html = render(boss('plantera'))
    const temple = ['Lihzahrd Brick', 'Forbidden Lihzahrd Brick Wall', 'Lihzahrd Altar', 'Picksaw'].flatMap((n) => rowsOf('plantera', n))
    expect(temple).toHaveLength(4)
    for (const d of temple) {
      expect(d.conditions).toEqual(['jungle-temple-absent'])
      expect(getField(d, 'conditions').status).toBe('verified')
      expect(d._prov.sources).toContainEqual(expect.objectContaining({ kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Plantera' }))
      expect(dropRow(html, d.id)).toContain('Only: <span class="font-semibold text-fg">Jungle Temple not present</span>')
    }
    const { tiers } = bossDropSections(boss('plantera'), drops, itemOf)
    expect(tiers.conditional.map((g) => g.item.name)).toEqual(['Grenade Launcher', 'Rocket I'])
    expect(conditions.byId.get('jungle-temple-absent')).toMatchObject({ name: 'Jungle Temple not present', kind: 'world-state' })
  })

  it('nit: a source every non-bag row shares ("Plantera (Second Form)") is said once, not on each row; mixed sources keep their row labels', () => {
    const plantera = bossDropSections(boss('plantera'), drops, itemOf)
    expect(plantera.commonSource).toBe('Plantera (Second Form)')
    const html = render(boss('plantera'))
    expect(count(html, /data-common-source="Plantera \(Second Form\)"/g)).toBe(1)
    expect(text(section(html, 'drops')).replace(/ \./g, '.')).toContain('Every drop not marked Treasure Bag comes from Plantera (Second Form).')
    expect(html).not.toContain('From Plantera (Second Form)')
    // Skeletron: its head and the Red Hat variant both drop — every row keeps its own source
    const skeletron = bossDropSections(boss('skeletron'), drops, itemOf)
    expect(skeletron.commonSource).toBeUndefined()
    expect(render(boss('skeletron'))).toContain('From Skeletron (Red Hat Skeletron)')
    // a boss whose own rows name the boss itself has nothing to hoist
    expect(bossDropSections(boss('golem'), drops, itemOf).commonSource).toBeUndefined()
  })

  it('nit: the Empress condition reads once ("Only: 100% of damage dealt at daytime"), not "Only: … damaged only …"', () => {
    const html = render(boss('empress-of-light'))
    const terraprisma = rowsOf('empress-of-light', 'Terraprisma')
    expect(terraprisma.length).toBeGreaterThan(0)
    for (const d of terraprisma) {
      expect(d.conditions).toEqual(['empress-daytime-damage'])
      const row = text(dropRow(html, d.id))
      expect(row).toContain('Only: 100% of damage dealt at daytime')
      expect(row).not.toMatch(/Only:[^]*\bonly\b/)
    }
  })

  it('nit: each chance sits on its row name\'s line — first rows (44px, 48px slot from md) and sub-rows get the matching top padding', () => {
    const html = render(boss('plantera'))
    for (const d of rowsOf('plantera', 'The Axe')) {
      const cells = [...dropRow(html, d.id).matchAll(/<td data-cell="[a-z]+"[^>]*class="([^"]*)"/g)].map((m) => m[1])
      expect(cells).toHaveLength(3)
      for (const cls of cells) {
        expect(cls).toContain('pt-[1.125rem]')
        expect(cls).not.toMatch(/\bpy-1\.5\b/)
        if (d.source.treasureBag) expect(cls).toContain('md:pt-4')
        else expect(cls).not.toContain('md:pt-4')
      }
    }
  })
})

describe('B82: world-condition labels and one distinct source link per drop row (every page)', () => {
  /** A drop row's markup, from its <tr> to the next one. */
  const dropRow = (html: string, id: string) => {
    const start = html.indexOf(`data-drop-row="${id}"`)
    return html.slice(start, html.indexOf('</tr>', start))
  }
  const WORLD = ['corruption-world', 'crimson-world']

  it('Eye of Cthulhu: the world-evil ores and seeds (boss and bag rows) say which world they drop in', () => {
    const eye = boss('eye-of-cthulhu')
    const html = render(eye)
    const byItem = new Map<string, string[]>()
    for (const id of eye.dropIds) {
      const d = drops.byId.get(id) as DropSource
      const world = d.conditions.filter((c) => WORLD.includes(c))
      if (world.length === 0) continue
      byItem.set(itemOf(d.itemId).name, [...(byItem.get(itemOf(d.itemId).name) ?? []), ...world])
      expect(dropRow(html, id), id).toContain(`data-drop-conditions="${d.conditions.join(' ')}"`)
      expect(dropRow(html, id), id).toMatch(world[0] === 'corruption-world' ? />Corruption world</ : />Crimson world</)
    }
    // the wiki's drop list: Demonite Ore + Corrupt Seeds only in Corrupt worlds, Crimtane Ore + Crimson Seeds only in Crimson ones
    expect(Object.fromEntries(byItem)).toEqual({
      'Demonite Ore': ['corruption-world', 'corruption-world'],
      'Corrupt Seeds': ['corruption-world', 'corruption-world'],
      'Crimtane Ore': ['crimson-world', 'crimson-world'],
      'Crimson Seeds': ['crimson-world', 'crimson-world'],
    })
    // the Unholy Arrow is listed outside those groups on the wiki: no world condition
    const arrow = eye.dropIds.map((id) => drops.byId.get(id) as DropSource).filter((d) => itemOf(d.itemId).name === 'Unholy Arrow')
    expect(arrow.length).toBeGreaterThan(0)
    for (const d of arrow) expect(d.conditions).toEqual([])
  })

  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s: every drop row with verified conditions renders their labels; one page-glyph source link per row, beside its name', (id) => {
    const b = boss(id)
    const html = render(b)
    for (const dropId of b.dropIds) {
      const d = drops.byId.get(dropId) as DropSource
      const row = dropRow(html, dropId)
      if (getField(d, 'conditions').status !== 'unverified' && d.conditions.length > 0) {
        for (const c of d.conditions) expect(row, `${dropId} ${c}`).toContain(escaped(conditions.byId.get(c)?.name ?? c))
      }
      // exactly one source link, a page glyph (never the item's ↗), inside the row header with the name
      expect(count(row, /data-source-link=""/g), dropId).toBe(1)
      const header = row.slice(row.indexOf('<th'), row.indexOf('</th>'))
      expect(header, dropId).toContain('data-source-link=""')
      expect(/data-source-link=""[^>]*>\s*<svg[^>]*class="[^"]*lucide-file-text/.test(header), dropId).toBe(true)
    }
    // Hardmode pages: the wiki's drop lists carry no world-evil captions, so no HM boss drop is world-conditional
    if (BOSS_PAGE_IDS.indexOf(id as (typeof BOSS_PAGE_IDS)[number]) >= BOSS_PAGE_IDS.indexOf('queen-slime')) {
      for (const dropId of b.dropIds) expect((drops.byId.get(dropId) as DropSource).conditions.filter((c) => WORLD.includes(c)), dropId).toEqual([])
    }
  })
})

describe('P5-S3: real gear where a quoted wiki tip names a weapon verified obtainable before the fight', () => {
  const weaponName = (id: number) => weaponList.find((w) => w.id === id)?.name
  /** Every pick per class, in entry order — a class may carry several entries (King Slime's melee). */
  const picks = (id: string) => {
    const out: Record<string, (string | undefined)[]> = {}
    for (const g of boss(id).suggestedEquipment ?? []) (out[g.class] ??= []).push(...g.weapons.map(weaponName))
    return out
  }

  it('the shipped picks (B78/B83b/B90: pre-Hardmode weapons the gating expansion verified; Wall of Flesh-gated weapons from Queen Slime on; Plantera / Golem drops for the later fights)', () => {
    expect(Object.fromEntries(BOSS_PAGE_IDS.filter((id) => boss(id).suggestedEquipment).map((id) => [id, picks(id)]))).toEqual({
      // AMENDMENTS-016 B141: the Flinx Staff passes gating (Cavern Gold Chest bars ride along), so the tips naming it force it (B83b)
      'king-slime': { melee: ['Thorn Chakram', 'Ice Blade'], magic: ['Wand of Frosting'], summon: ['Flinx Staff'] },
      'eye-of-cthulhu': { magic: ['Wand of Frosting'], summon: ['Cobwhip'] },
      'eater-of-worlds': { summon: ['Flinx Staff'] },
      'brain-of-cthulhu': { melee: ['Flaming Mace'], summon: ['Snapthorn'] },
      'queen-bee': { melee: ['Thorn Chakram'], ranged: ['Minishark'], magic: ['Space Gun'], summon: ['Flinx Staff'] },
      skeletron: { melee: ['Amazon'] },
      deerclops: { ranged: ['Minishark'], magic: ['Space Gun'], summon: ['Snapthorn'] },
      'wall-of-flesh': { summon: ['Starcrash'] },
      'queen-slime': { summon: ['Firecracker'] },
      'the-twins': { ranged: ['Clockwork Assault Rifle'], summon: ['Firecracker'] },
      'the-destroyer': { summon: ['Firecracker'] },
      'skeletron-prime': { ranged: ['Clockwork Assault Rifle'] },
      plantera: { summon: ['Firecracker'] },
      golem: { melee: ['Scourge of the Corruptor'], ranged: ['Venus Magnum'], magic: ['Leaf Blower'], summon: ['Desert Tiger Staff', 'Vulgar Display of Flower'] },
      'empress-of-light': { melee: ['Scourge of the Corruptor'], summon: ['Desert Tiger Staff', 'Vulgar Display of Flower'] },
      'duke-fishron': { summon: ['Firecracker', 'Snapthorn'] },
      'lunatic-cultist': { melee: ['Possessed Hatchet'] },
      'moon-lord': { summon: ['Vulgar Display of Flower', 'Firecracker'] },
    })
    // every boss's quoted tips now name a weapon verified obtainable before it (the Eater of Worlds since B141; was B90(b)'s one exception)
    expect(BOSS_PAGE_IDS.filter((id) => !boss(id).suggestedEquipment)).toEqual([])
  })

  it('every pick is quoted in a tip of that boss — its class’s or a general one (B90(a)) — and sits in its weapon’s own damage class', () => {
    const fromGeneral: string[] = []
    for (const id of BOSS_PAGE_IDS) {
      const groups = strategyGroups(boss(id).strategies ?? [])
      for (const g of boss(id).suggestedEquipment ?? []) {
        for (const w of g.weapons) {
          const name = weaponName(w) as string
          const label = `${id} ${g.class} ${name}`
          // B90(a): the class assignment comes from the weapon's own verified damage class
          expect(weaponList.find((x) => x.id === w)?.damageClass, label).toBe(g.class)
          const inClass = (g.class === 'other' ? [] : groups.byClass[g.class]).some((t) => t.text.includes(name))
          const inGeneral = groups.general.some((t) => t.text.includes(name))
          expect(inClass || inGeneral, label).toBe(true)
          if (!inClass) fromGeneral.push(label)
        }
      }
    }
    // the shipped picks whose only quote is a general (untagged) tip
    expect(fromGeneral).toEqual(['empress-of-light melee Scourge of the Corruptor'])
  })

  it('Plantera: the Firecracker links its weapon page with a GateBadge to the Wall of Flesh page; the other classes read Unknown', () => {
    const summon = classPanel(render(boss('plantera'), gearData), 'summon')
    expect(summon).toContain('data-gear-entry="summon"')
    expect(summon).toMatch(/data-item-id="4912"[^>]*>\s*<a [^>]*href="\/weapons\/4912"/)
    expect(summon).toMatch(/href="\/bosses\/wall-of-flesh"[^>]*data-gate="Wall of Flesh"|data-gate="Wall of Flesh"[^>]*href="\/bosses\/wall-of-flesh"/)
    // the badge goes once the player has marked the Wall of Flesh defeated
    expect(classPanel(render(boss('plantera'), gearData, { 'wall-of-flesh': 'defeated' }), 'summon')).not.toContain('data-gate="Wall of Flesh"')
    for (const cls of ['melee', 'ranged', 'magic']) expect(classPanel(render(boss('plantera'), gearData), cls)).toContain(`data-gear-class-unknown="${cls}"`)
    expect(bossPageUnknowns(boss('plantera'), []).filter((u) => u.key.startsWith('suggestedEquipment.')).map((u) => u.label)).toEqual(['Suggested melee gear', 'Suggested ranged gear', 'Suggested magic gear'])
  })
})

describe('M1: next steps — nearest first, plain phrases', () => {
  const key = (c: { link: { types: readonly string[] }; other: { id: string; name: string } }) => [
    Number(c.link.types.every((t) => t === 'optional')),
    pathDepths(graph).get(c.other.id) ?? 0,
  ]

  it('path depth: Wall of Flesh is one step past Skeletron, Lunatic Cultist far downstream; either/or partners share a depth', () => {
    const depth = pathDepths(graph)
    expect(depth.get('wall-of-flesh')).toBe((depth.get('skeletron') ?? 0) + 1)
    expect(depth.get('lunatic-cultist') ?? 0).toBeGreaterThan((depth.get('wall-of-flesh') ?? 0) + 3)
    expect(depth.get('brain-of-cthulhu')).toBe(depth.get('eater-of-worlds'))
  })

  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s: optional steps last, then nearest first', (id) => {
    const steps = nextSteps(graph, boss(id).nodeId)
    for (const list of [steps.after.map((a) => a.connection), steps.continueFrom?.next ?? []]) {
      expect(rankSteps(graph, list)).toEqual(list)
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [key(list[i - 1]), key(list[i])]
        expect(a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]), `${id}: ${list[i - 1].other.id} before ${list[i].other.id}`).toBe(true)
      }
    }
  })

  it('reads in plain words: “Usually fought after …” before, what a gate needs after', () => {
    expect(stepPhrase(['recommended-next'], 'before', { self: 'Eater of Worlds', other: 'Eye of Cthulhu' })).toBe('Usually fought after Eye of Cthulhu')
    expect(stepPhrase(['required-gate'], 'after', { self: 'Skeletron', other: 'Lunatic Cultist' })).toBe('Needs Skeletron defeated first')
    expect(stepPhrase(['required-gate', 'early-challenge-possible'], 'before', { self: 'Duke Fishron', other: 'Hardmode' })).toBe('Needs Hardmode first · Can be fought early, at a much harder difficulty')

    const skeletron = section(render(boss('skeletron')), 'next')
    const order = [...skeletron.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1])
    expect(order.slice(0, 2)).toEqual(['wall-of-flesh', 'lunatic-cultist'])
    expect(skeletron).toContain('Usually fought next')
    expect(skeletron).toContain('Needs Skeletron defeated first')
    expect(skeletron).not.toMatch(/>Required gate</)
    expect(section(render(boss('eater-of-worlds')), 'next')).toContain('Usually fought after Eye of Cthulhu')
    expect(section(render(boss('eater-of-worlds')), 'next')).toContain('In Crimson worlds instead')
    expect(section(render(boss('king-slime')), 'next')).toContain('Optional side fight, from Pre-Hardmode on')
  })
})

describe('M4: every item slot links its real page, else the wiki search for its name; only a nameless one says it has none', () => {
  const weaponIds = new Set(weaponList.map((w) => w.id))
  const itemIds = new Set((itemsJson as Item[]).map((i) => i.id))
  // PRD P6-S1/S2 (AMENDMENTS-016 B131(b)): accessories and armor pieces open their own pages — no wiki fallback for them
  const accessoryIds = new Set((accessoriesListJson as AccessoryListRecord[]).map((a) => a.id))
  const armorIds = new Set((armorListJson as ArmorListRecord[]).map((a) => a.id))
  const buffArticle = new Map(buffs.map((b) => [wikiArticleTitle(b.wikiUrl), b.wikiUrl]))
  const expected = (id: number) =>
    weaponIds.has(id)
      ? { kind: 'internal', to: `/weapons/${id}` }
      : itemIds.has(id)
        ? { kind: 'internal', to: `/items/${id}` }
      : accessoryIds.has(id)
        ? { kind: 'internal', to: `/accessories/${id}` }
      : armorIds.has(id)
        ? { kind: 'internal', to: `/armor/${id}` }
        : buffArticle.has(names.byId.get(id))
          ? { kind: 'external', href: buffArticle.get(names.byId.get(id)) }
          : names.byId.has(id)
            ? { kind: 'external', href: wikiSearchUrl(names.byId.get(id) as string) }
            : undefined

  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s', (id) => {
    const b = boss(id)
    const html = render(b)
    const referenced = new Set([...b.summon.items, ...(b.prepChecklist ?? []).flatMap((p) => p.itemIds ?? []), ...b.dropIds.flatMap((d) => drops.byId.get(d)?.itemId ?? [])])
    for (const itemId of referenced) expect(itemOf(itemId).link, `${id}: item ${itemId}`).toEqual(expected(itemId))
    // every rendered item cell: a link to exactly that target, or an inert name that says it has no page
    const cells = [...html.matchAll(/data-item-id="(\d+)"[^>]*>\s*<(a|span)\b([^>]*)>/g)]
    expect(cells.length).toBeGreaterThan(0)
    for (const [, rawId, tag, attrs] of cells) {
      const target = expected(Number(rawId))
      if (target === undefined) {
        expect(tag, rawId).toBe('span')
        expect(attrs).toContain(`data-item-inert="" title="${NO_PAGE_TITLE}"`)
      } else {
        expect(tag, rawId).toBe('a')
        expect(attrs).toContain(`href="${escaped(target.kind === 'internal' ? (target.to as string) : (target.href as string))}"`)
      }
    }
  })

  it('potions named in prep checklists link their item pages (their own potion records, B70; P6 encyclopedia)', () => {
    const html = render(boss('king-slime'))
    expect(html).toContain('href="/items/292"') // Ironskin Potion
    expect(html).toContain('href="/items/289"') // Regeneration Potion
  })

  it('Item records open their item page (Torch, Campfire: records since P6-S0, B96(d)); an accessory its accessory page (B131(b)); a name without any record the wiki search — in a new tab with the external marker', () => {
    const html = render(boss('eye-of-cthulhu'))
    expect(html).not.toContain('data-item-inert')
    for (const [id, name] of [[8, 'Torch'], [966, 'Campfire']] as const) {
      expect(itemOf(id).link, name).toEqual({ kind: 'internal', to: `/items/${id}` })
      expect(html, name).toContain(`href="/items/${id}"`)
    }
    // an accessory opens its accessory page in-app (P6-S2, B131(b)) — no new tab, no external marker
    const b = structuredClone(boss('king-slime'))
    b.summon.items = [3097, 5492] // Shield of Cthulhu (accessory), Magic Shimmer Dropper (no record)
    const summon = section(render(b), 'summon')
    const accessory = /<a [^>]*href="\/accessories\/3097"[^>]*>[\s\S]*?<\/a>/.exec(summon)?.[0] ?? ''
    expect(accessory).toContain('Shield of Cthulhu')
    expect(accessory).not.toContain('target="_blank"')
    expect(summon).not.toContain('https://terraria.wiki.gg/wiki/Shield_of_Cthulhu')
    // without any record, an Iteminfo name still opens the wiki search for that exact name — an external row: B82, the ↗
    // glued to the name's last word, 4px from it
    const href = wikiSearchUrl('Magic Shimmer Dropper')
    const link = new RegExp(`<a href="${escaped(href).replace(/[.?]/g, '\\$&')}" target="_blank" rel="noopener noreferrer"[^>]*>[\\s\\S]*?</a>`).exec(summon)?.[0] ?? ''
    expect(link).toMatch(/<span class="whitespace-nowrap">Dropper<svg[^>]*aria-hidden="true"/)
    expect(link).toMatch(/<span class="whitespace-nowrap">Dropper<svg[^>]*class="[^"]*\bml-1\b/)
    expect(link).toContain('on terraria.wiki.gg (opens in a new tab)')
  })

  it('a nameless ref stays inert and says it has no page', () => {
    const b = structuredClone(boss('king-slime'))
    b.summon.items = [999999]
    const cell = /data-item-id="999999"[^>]*>\s*<(a|span)\b([^>]*)>/.exec(section(render(b), 'summon'))
    expect(cell?.[1]).toBe('span')
    expect(cell?.[2]).toContain(`data-item-inert="" title="${NO_PAGE_TITLE}"`)
  })
})

describe('M3: quoted tips link the weapons they name; the quotes stay verbatim', () => {
  it('every shipped tip: the parts rejoin to the exact quote, every link is a real weapon named exactly', () => {
    let linked = 0
    for (const id of BOSS_PAGE_IDS) {
      for (const s of boss(id).strategies ?? []) {
        const parts = linkTip(s.text)
        expect(parts.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe(s.text)
        for (const p of parts) {
          if (typeof p === 'string') continue
          linked++
          expect(p.item.kind).toBe('weapon')
          expect(p.item.link).toEqual({ kind: 'internal', to: `/weapons/${p.item.id}` })
          expect([p.item.name, `${p.item.name}s`]).toContain(p.text)
          if (p.text !== p.item.name) expect(p.item.name).toContain(' ')
        }
      }
    }
    expect(linked).toBeGreaterThan(30)
  })

  it('longest name first; a plural only for multi-word names', () => {
    const links = (t: string) => linkTip(t).flatMap((p) => (typeof p === 'string' ? [] : [[p.text, p.item.name]]))
    expect(links('Bone Javelins are very effective')).toEqual([['Bone Javelins', 'Bone Javelin']])
    expect(links('the Flaming Mace (craftable from a Mace, found in chests)')).toEqual([
      ['Flaming Mace', 'Flaming Mace'],
      ['Mace', 'Mace'],
    ])
    expect(links('Spears are fine; the Spear is better.')).toEqual([['Spear', 'Spear']])
    expect(links('Muskets, a Musketeer, Musket-like')).toEqual([])
  })

  it('renders the links inside the class tab (Deerclops, ranged)', () => {
    const html = render(boss('deerclops'))
    const ranged = /data-class-panel="ranged"[\s\S]*?(?=data-class-panel="magic")/.exec(html)?.[0] ?? ''
    for (const name of ['Musket', 'The Undertaker', 'Minishark']) {
      const w = weaponList.find((x) => x.name === name) as WeaponListRecord
      const tag = new RegExp(`<a [^>]*data-tip-link="${w.id}"[^>]*>${escaped(name)}</a>`).exec(ranged)?.[0]
      expect(tag, name).toContain(`href="/weapons/${w.id}"`)
    }
  })
})

describe('M2/M3: the suggested-gear Unknown block', () => {
  it('plain words; the stated reason one tap away; the first-boss guide linked on the Eye of Cthulhu only', () => {
    const wholeFieldUnknown = BOSS_PAGE_IDS.filter((id) => getField(boss(id), 'suggestedEquipment').status === 'unverified')
    // B90(b)/(c): weapons are verifiable now; since AMENDMENTS-016 B141 (the Flinx Staff) no shipped boss is a whole-field Unknown —
    // the block is checked on the Eye of Cthulhu copy below (its reason disclosure on the per-class blocks, B91(a))
    expect(wholeFieldUnknown).toEqual([])
    // the Eye of Cthulhu's gear is curated now; its guide link is checked on a whole-field Unknown copy of the page
    const eyeUnknown = structuredClone(boss('eye-of-cthulhu'))
    delete eyeUnknown.suggestedEquipment
    eyeUnknown._prov = { ...eyeUnknown._prov, unverifiedFields: [...eyeUnknown._prov.unverifiedFields.filter((f) => !f.startsWith('suggestedEquipment')), 'suggestedEquipment'] }
    for (const b of [...wholeFieldUnknown.map(boss), eyeUnknown]) {
      const gear = section(render(b), 'gear')
      expect(gear).toContain('None of the weapons the wiki recommends for this fight is verified as obtainable before it, so we don’t suggest any.')
      expect(gear).not.toContain('We can’t verify which weapons')
      if (b !== eyeUnknown) expect(gear).toMatch(/<details[^>]*>[\s\S]*?Why we can’t tell[\s\S]*?<\/details>/)
      if (b.id === 'eye-of-cthulhu') expect(gear).toMatch(/data-prep-guide=""[\s\S]*?href="\/guides\/first-boss-prep"[^>]*>Preparing for your first boss</)
      else expect(gear, b.id).not.toContain('data-prep-guide')
      // our copy: no forward or outcome promises
      expect(ownCopy(gear, b)).not.toMatch(FORWARD_PROMISE)
      expect(ownCopy(gear, b)).not.toMatch(OUTCOME)
    }
  })

  it('each linked guide exists under that title, covers the boss and has curated weapon picks', () => {
    const weaponIds = new Set(weaponList.map((w) => w.id))
    for (const [bossId, { slug, title }] of Object.entries(BOSS_PREP_GUIDES)) {
      const guide = guideBySlug(slug)
      expect(guide?.title).toBe(title)
      const mentions = guide ? guideMentions(guide) : []
      expect(mentions.some((m) => m.kind === 'entity' && m.ref === `boss:${bossId}`)).toBe(true)
      expect(mentions.filter((m) => m.kind === 'entity' && /^i:\d+$/.test(m.ref) && weaponIds.has(Number(m.ref.slice(2)))).length).toBeGreaterThan(3)
    }
  })
})

describe('B91(a): the first-boss guide inside per-class Unknown blocks (starter-tier fights)', () => {
  // King Slime's summon class is curated since AMENDMENTS-016 B141 (Flinx Staff): only its ranged tab stays Unknown
  const POINTED = { 'eye-of-cthulhu': ['melee', 'ranged'], 'king-slime': ['ranged'] } as const

  it.each(Object.entries(POINTED))('%s: in each Unknown class tab, after the plain line and before the stated reason; never beside curated picks', (id, classes) => {
    const html = render(boss(id), gearData)
    for (const cls of GEAR_CLASSES) {
      const panel = classPanel(html, cls)
      if ((classes as readonly string[]).includes(cls)) {
        expect(classGear(boss(id), cls).status, cls).toBe('unknown')
        const at = (needle: string) => panel.indexOf(needle)
        expect(panel, cls).toMatch(/data-prep-guide=""[\s\S]*?href="\/guides\/first-boss-prep"[^>]*>Preparing for your first boss</)
        expect(at(`None of the ${cls} weapons`), cls).toBeGreaterThan(-1)
        expect(at('data-prep-guide'), cls).toBeGreaterThan(at(`None of the ${cls} weapons`))
        expect(at('Why we can’t tell'), cls).toBeGreaterThan(at('data-prep-guide'))
        // inside the Unknown block, ahead of the class tips
        expect(at('tips from the wiki'), cls).toBeGreaterThan(at('Why we can’t tell'))
      } else {
        expect(classGear(boss(id), cls).status, cls).toBe('curated')
        expect(panel, cls).not.toContain('data-prep-guide')
      }
    }
    expect(count(html, /data-prep-guide=""/g)).toBe(classes.length)
  })

  it('no guide mapping, no pointer: the Eater of Worlds (per-class Unknowns since B141) and every other page', () => {
    for (const id of BOSS_PAGE_IDS.filter((x) => !(x in BOSS_PREP_GUIDES))) expect(render(boss(id), gearData), id).not.toContain('data-prep-guide')
    const eow = render(boss('eater-of-worlds'), gearData)
    expect(eow).toContain('data-gear-basis=""')
    expect(eow).not.toContain('data-gear-unknown=""')
  })
})

describe('B91(b): a class’s picks share one box', () => {
  const box = (panel: string) => {
    const start = panel.indexOf('data-gear-entry="')
    return start < 0 ? '' : panel.slice(start, panel.indexOf('tips from the wiki', start))
  }
  const itemIds = (html: string) => [...html.matchAll(/data-item-id="(\d+)"/g)].map((m) => Number(m[1]))

  it('King Slime melee: one box, “Weapons” heard once, both picks in entry order', () => {
    const melee = classPanel(render(boss('king-slime'), gearData), 'melee')
    expect(boss('king-slime').suggestedEquipment?.filter((g) => g.class === 'melee')).toHaveLength(2)
    expect(count(melee, /data-gear-entry="melee"/g)).toBe(1)
    expect(count(melee, />Weapons<\/h3>/g)).toBe(1)
    expect(count(melee, /aria-label="Weapons"/g)).toBe(1)
    expect(itemIds(box(melee))).toEqual([191, 724]) // Thorn Chakram, Ice Blade
  })

  it('every page, every class: at most one box, each kind’s heading at most once', () => {
    for (const id of BOSS_PAGE_IDS) {
      const html = render(boss(id), gearData)
      for (const cls of GEAR_CLASSES) {
        const panel = classPanel(html, cls)
        expect(count(panel, /data-gear-entry="/g), `${id} ${cls}`).toBeLessThanOrEqual(1)
        for (const kind of ['Weapons', 'Armor', 'Accessories', 'Buffs']) expect(count(panel, new RegExp(`>${kind}</h3>`, 'g')), `${id} ${cls} ${kind}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('two entries with their own items and notes: one heading per kind, items deduped in entry order, both notes kept', () => {
    const b = structuredClone(boss('skeletron'))
    b.suggestedEquipment = [
      { class: 'melee', weapons: [1123], armorSetIds: ['ninja-armor'], accessories: [], buffs: [], note: 'First entry note.' },
      { class: 'melee', weapons: [1123, 191], armorSetIds: [], accessories: [3097], buffs: ['ironskin'], note: 'Second entry note.' },
    ]
    b._prov = { ...b._prov, unverifiedFields: b._prov.unverifiedFields.filter((f) => f !== 'suggestedEquipment'), editorialFields: [...b._prov.editorialFields, 'suggestedEquipment'] }
    const melee = box(classPanel(render(b, gearData), 'melee'))
    expect(count(melee, /data-gear-entry="melee"/g)).toBe(1)
    for (const kind of ['Weapons', 'Armor', 'Accessories', 'Buffs']) expect(count(melee, new RegExp(`>${kind}</h3>`, 'g')), kind).toBe(1)
    expect(count(melee, /href="\/weapons\/1123"/g)).toBe(1)
    expect(melee.indexOf('href="/weapons/1123"')).toBeLessThan(melee.indexOf('href="/weapons/191"'))
    expect([...melee.matchAll(/data-gear-note=""[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['First entry note.', 'Second entry note.'])
  })
})

describe('B91(d): a pick quoted only by a class-less tip says where that tip is', () => {
  it('Empress of Light melee (Scourge of the Corruptor): a pointer to the attack-patterns section, which quotes the tip', () => {
    const html = render(boss('empress-of-light'), gearData)
    expect(classPanel(html, 'melee')).toMatch(/data-gear-tip-elsewhere=""[^>]*>The wiki tip that names Scourge of the Corruptor is quoted under <a href="#boss-patterns-title"[^>]*>Attack patterns &amp; survival tips<\/a>\.<\/p>/)
    expect(section(html, 'patterns')).toContain('id="boss-patterns-title"')
    expect(unwrapTipLinks(section(html, 'patterns'))).toContain('Scourge of the Corruptor')
  })

  it('only there: every other pick is quoted in its own class tab (the B90(a) list above, pinned at one)', () => {
    const shown = BOSS_PAGE_IDS.flatMap((id) => {
      const html = render(boss(id), gearData)
      return GEAR_CLASSES.filter((cls) => classPanel(html, cls).includes('data-gear-tip-elsewhere')).map((cls) => `${id} ${cls}`)
    })
    expect(shown).toEqual(['empress-of-light melee'])
  })
})

describe('design review P5-S5 M2: wiki sentences cut mid-way', () => {
  const nodeName = (id: string) => graph.nodeById.get(id)?.name ?? id
  const PILLARS = 'https://terraria.wiki.gg/wiki/Celestial_Pillars'
  const MECHANICAL_BOSSES = 'https://terraria.wiki.gg/wiki/Mechanical_bosses'
  // the sentence the display-side CUT_AT_END pin was made for (B93(ii)); P6-S0 re-extracted the data, so
  // no shipped edge carries it any more and its pin is retired (B104) — it stays here only as a unit of quoteTrail
  const MECH_CUT = 'Defeating each of the three mechanical bosses at least once causes the following to happen'
  const MECH_SENTENCE = "One Plantera's Bulb immediately spawns once all three mechanical bosses are defeated for the first time."

  it('quoteLead: none for a whole sentence; a cut one gets its subject in brackets when its article is about a node the edge connects, else an ellipsis', () => {
    expect(quoteLead('Pillars drop Lunar Fragments when destroyed.', PILLARS, ['Celestial Pillars'])).toBeUndefined()
    expect(quoteLead('are four late-Hardmode, stationary bosses.', PILLARS, ['Lunatic Cultist', 'Celestial Pillars'])).toBe('[Celestial Pillars] ')
    expect(quoteLead('are four late-Hardmode, stationary bosses.', PILLARS, ['Lunatic Cultist', 'Golem'])).toBe('…')
    expect(quoteLead('are four late-Hardmode, stationary bosses.', 'https://terraria.wiki.gg/wiki/Bosses', ['Celestial Pillars'])).toBe('…')
  })

  it('quoteTrail (B93(ii)): an ellipsis only after a sentence pinned as cut at the end, from its own article — never inferred from a missing full stop', () => {
    const pins = [{ sourceUrl: MECHANICAL_BOSSES, text: MECH_CUT }]
    expect(quoteTrail(MECH_CUT, MECHANICAL_BOSSES, pins)).toBe('…')
    expect(quoteTrail(MECH_CUT, 'https://terraria.wiki.gg/wiki/Plantera', pins)).toBeUndefined()
    expect(quoteTrail(`${MECH_CUT}:`, MECHANICAL_BOSSES, pins)).toBeUndefined()
    expect(quoteTrail('A world permanently changes into Hardmode after the Wall of Flesh is defeated for the first time', 'https://terraria.wiki.gg/wiki/Hardmode', pins)).toBeUndefined()
    // the shipped pin list is empty since B104, so the retired sentence no longer trails by default
    expect(quoteTrail(MECH_CUT, MECHANICAL_BOSSES)).toBeUndefined()
  })

  it('sweep: every edge note reads from a capital or a marked lead (the shipped cut sentence: the Celestial Pillars article’s lead); none is cut at the end (the CUT_AT_END set is empty, B104)', () => {
    const cut = raw.edges.filter((e) => e.note && /^\p{Ll}/u.test(e.note))
    expect(cut.map((e) => `${e.from}->${e.to}`)).toEqual(['lunatic-cultist->celestial-pillars'])
    for (const e of raw.edges) {
      if (!e.note) continue
      const lead = quoteLead(e.note, e.sourceUrl, [nodeName(e.from), nodeName(e.to)])
      expect(`${lead ?? ''}${e.note}`, `${e.from}->${e.to}`).not.toMatch(/^\p{Ll}/u)
    }
    expect(quoteLead(cut[0].note as string, cut[0].sourceUrl, [nodeName(cut[0].from), nodeName(cut[0].to)])).toBe('[Celestial Pillars] ')
    // cut at the end: none since the B93(ii) data-side re-extraction (P6-S0) — the three mech → All mechanical
    // bosses edges quote a whole sentence of the same section, so the CUT_AT_END pin is retired (B104): the
    // set is empty, the mechanism kept for a future cut a re-extraction can't fix
    expect(CUT_AT_END).toEqual([])
    const trailed = raw.edges.filter((e) => e.note && quoteTrail(e.note, e.sourceUrl) !== undefined)
    expect(trailed).toEqual([])
    const mechEdges = raw.edges.filter((e) => e.to === 'all-mechanical-bosses')
    expect(mechEdges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['skeletron-prime->all-mechanical-bosses', 'the-destroyer->all-mechanical-bosses', 'the-twins->all-mechanical-bosses'])
    for (const e of mechEdges) expect([e.note, e.sourceUrl], `${e.from}->${e.to}`).toEqual([MECH_SENTENCE, MECHANICAL_BOSSES])
    // every other note without end punctuation is a whole sentence: no trail
    const unpunctuated = raw.edges.filter((e) => e.note && !/[.!?]$/.test(e.note) && !trailed.includes(e))
    expect(unpunctuated.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['plantera->frost-moon', 'pre-hardmode->queen-bee', 'wall-of-flesh->hardmode'])
    for (const e of unpunctuated) expect(quoteTrail(e.note as string, e.sourceUrl), `${e.from}->${e.to}`).toBeUndefined()
    // the boss pages' own quotes (tips, prep steps, summon lines) all start a sentence today: a cut one would need the same care
    for (const b of bosses) for (const q of [...(b.strategies ?? []).map((s) => s.text), ...(b.prepChecklist ?? []).map((p) => p.text), b.summon.text ?? 'X']) expect(q, b.id).not.toMatch(/^\p{Ll}/u)
  })

  it('the Lunatic Cultist page quotes it as “[Celestial Pillars] are four…”, with its source', () => {
    const step = /<li data-step="celestial-pillars"[\s\S]*?<\/li>/.exec(section(render(boss('lunatic-cultist')), 'next'))?.[0] ?? ''
    expect(step).toMatch(/data-step-quote=""[^>]*>“\[Celestial Pillars\] are four late-Hardmode, stationary bosses/)
    expect(step).toContain(`href="${PILLARS}"`)
  })

  it('each mech page’s After section quotes the re-extracted whole sentence as stored, no ellipsis (B93(ii) data side); a whole sentence on another page stays as stored', () => {
    for (const id of ['skeletron-prime', 'the-destroyer', 'the-twins']) {
      const step = /<li data-step="all-mechanical-bosses"[\s\S]*?<\/li>/.exec(section(render(boss(id)), 'next'))?.[0] ?? ''
      expect(step, id).toMatch(new RegExp(`data-step-quote=""[^>]*>“${escaped(MECH_SENTENCE).replace(/[.]/g, '\\.')}”`))
      expect(step, id).not.toContain('…')
      expect(step, id).toContain(`href="${MECHANICAL_BOSSES}"`)
    }
    const hardmode = /<li data-step="hardmode"[\s\S]*?<\/li>/.exec(section(render(boss('wall-of-flesh')), 'next'))?.[0] ?? ''
    expect(hardmode).toMatch(/data-step-quote=""[^>]*>“A world permanently changes into Hardmode after the Wall of Flesh is defeated for the first time”/)
  })
})

describe('Partially verified list lines (design review nit: “5 values” over three lines)', () => {
  it('a line standing for several values says how many, so the lines add up to the count above them', () => {
    expect(unknownItemLine({ key: 'stats', label: 'Stats' })).toBe('Stats')
    expect(unknownItemLine({ key: 'stats', label: 'Stats', count: 1 })).toBe('Stats')
    expect(unknownItemLine({ key: 'drops', label: 'Drops — chance, quantity or conditions', count: 3 })).toBe('Drops — chance, quantity or conditions (3 values)')
  })
})

describe('M5/M6: checklist bar and behavior tags', () => {
  it('the prep progress bar scales on X like the guide checklist’s (no width animation)', () => {
    const html = render(boss('eye-of-cthulhu'))
    expect(html).toMatch(/data-prep-bar="" class="[^"]*\borigin-left\b[^"]*\btransition-transform\b[^"]*" style="transform:scaleX\(0\)"/)
    expect(html).not.toMatch(/data-prep-bar=""[^>]*width/)
    expect(html).toMatch(/<p id="[^"]+" role="status"[^>]*><span data-prep-progress=/)
  })

  it('behavior tags are plain labelled words, not bordered chips', () => {
    const html = render(boss('eye-of-cthulhu'))
    const tags = [...html.matchAll(/<li data-attack-tag="[^"]+" class="([^"]*)"/g)].map((m) => m[1])
    expect(tags.length).toBe(boss('eye-of-cthulhu').attackPatternTags?.length)
    for (const cls of tags) expect(cls).not.toMatch(/\b(border|bg-|px-|py-)/)
    expect(html).toContain('>Behavior</h3>')
  })
})

describe('P5-S4: tracked defeats drive the boss page live (UX_SPEC §8, §10.5)', () => {
  const memory = (): StorageBackend => {
    const map = new Map<string, string>()
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) }
  }
  const MECHS = ['the-twins', 'the-destroyer', 'skeletron-prime']

  it('gate badges follow the shared store: marking the Wall of Flesh drops “After Wall of Flesh” on every page that shows it', () => {
    const store = createProgressStore(memory())
    // what BossPage does: the page renders from the store's node states (one subscription, every surface)
    const page = (id: string) => render(boss(id), gearData, store.getState().progress.nodeStates)
    for (const id of ['plantera', 'the-twins', 'queen-slime']) expect(page(id), id).toContain('data-gate="Wall of Flesh"')
    store.getState().setNodeState('wall-of-flesh', 'defeated')
    for (const id of ['plantera', 'the-twins', 'queen-slime']) expect(page(id), id).not.toContain('data-gate="Wall of Flesh"')
    // un-marking brings it back
    store.getState().setNodeState('wall-of-flesh', null)
    expect(page('plantera')).toContain('data-gate="Wall of Flesh"')
  })

  it('a MILESTONE gate clears once its bosses are marked (src/scoring isNodeSatisfied — milestones are never marked themselves)', () => {
    const b = structuredClone(boss('skeletron'))
    b.suggestedEquipment = [{ class: 'melee', weapons: [1123], armorSetIds: [], accessories: [], buffs: [] }]
    b._prov = { ...b._prov, unverifiedFields: b._prov.unverifiedFields.filter((f) => f !== 'suggestedEquipment'), editorialFields: [...b._prov.editorialFields, 'suggestedEquipment'] }
    const weapon = { ...gearData.weapons.get(1123)!, gatedBy: { bosses: [], conditions: ['post-mechanical-bosses'], stage: 'mid-hm' as const } }
    const data: GearData = { ...gearData, weapons: new Map([...gearData.weapons, [1123, weapon]]) }
    const badge = 'data-gate="All mechanical bosses defeated"'
    expect(render(b, data, {})).toContain(badge)
    expect(render(b, data, Object.fromEntries(['wall-of-flesh', 'the-twins', 'the-destroyer'].map((id) => [id, 'defeated' as const])))).toContain(badge)
    expect(render(b, data, Object.fromEntries(['wall-of-flesh', ...MECHS].map((id) => [id, 'defeated' as const])))).not.toContain(badge)
  })

  it('the Wall of Flesh page: its control, and the Hardmode pointer’s statuses updating with the mark', () => {
    const before = render(boss('wall-of-flesh'))
    expect(section(before, 'header')).toContain('data-defeat-control="wall-of-flesh"')
    expect(section(before, 'header')).not.toContain('data-defeat-option="skipped"') // the gateway to Hardmode is never "skipped"
    const pointer = (html: string) => section(html, 'next').slice(section(html, 'next').indexOf('data-step-opens="hardmode"'))
    const status = (html: string, id: string) => new RegExp(`data-opens="${id}"[\\s\\S]*?data-node-status="([a-z]+)"`).exec(pointer(html))?.[1]
    expect(status(before, 'the-twins')).toBe('locked')
    expect(status(before, 'queen-slime')).toBe('locked')
    expect(section(before, 'next')).toMatch(/data-step="hardmode"[\s\S]*?data-node-status="locked"/)
    const after = render(boss('wall-of-flesh'), undefined, { 'wall-of-flesh': 'defeated' })
    expect(section(after, 'header')).toMatch(/data-defeat-option="defeated"[^>]*checked=""/)
    expect(section(after, 'next')).toMatch(/data-step="hardmode"[\s\S]*?data-node-status="reached"/)
    for (const id of ['queen-slime', 'the-twins', 'the-destroyer', 'skeletron-prime', 'duke-fishron']) expect(status(after, id), id).toBe('recommended')
  })

  it('the three mechs open Plantera on its page too (locked note gone, status recommended in the mechs’ next steps)', () => {
    const marks = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'defeated' as const]))
    expect(section(render(boss('plantera'), undefined, marks(['wall-of-flesh'])), 'header')).toContain('data-locked-note')
    expect(section(render(boss('plantera'), undefined, marks(['wall-of-flesh', ...MECHS])), 'header')).not.toContain('data-locked-note')
    const twins = section(render(boss('the-twins'), undefined, marks(['wall-of-flesh', ...MECHS])), 'next')
    expect(twins).toMatch(/data-opens="plantera"[\s\S]*?data-node-status="recommended"/)
  })
})
