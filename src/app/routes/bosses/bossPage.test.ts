/* Boss pages (PRD P5-S2 AC1–AC4; UX_SPEC §3.7) rendered server-side from the shipped data, the
 * prep-checklist persistence (AMENDMENTS-001 A7), and the page model. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import manifest from '../../../../public/sprites/manifest.json'
import { buildMapGraph } from '../../../components/nodeMap/graph'
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
  bossDropSections,
  bossPageUnknowns,
  declaredGapReason,
  DROP_TIERS,
  GEAR_CLASSES,
  itemResolver,
  nextSteps,
  pathDepths,
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
  ]
  for (const q of quoted.filter(Boolean).sort((x, y) => y.length - x.length)) t = t.split(escaped(q)).join(' ')
  return t
}

const ALLOWED_LOCAL = new RegExp(`^(/weapons/\\d+|/bosses\\?node=[a-z0-9-]+|/bosses/(${BOSS_PAGE_IDS.join('|')})|/guides/(${Object.values(BOSS_PREP_GUIDES).map((g) => g.slug).join('|')}))$`)

describe('boss pages: every pre-Hardmode page renders every PRD P5-S2 AC1 section from the shipped data', () => {
  it.each(BOSS_PAGE_IDS.map((id) => [id]))('%s', (id) => {
    const b = boss(id)
    const html = render(b)

    // AC1 sections, in order: visual/header, summon, where & when, prep, gear (per class), attack patterns + tips, drops, next steps (+ stats)
    const sections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1])
    expect(sections).toEqual(['header', 'summon', 'where', 'prep', 'gear', 'patterns', 'drops', 'next', 'stats'])
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

    // gear: four class tabs; suggested gear Unknown with the overlay's stated reason (no item verified obtainable before)
    expect([...html.matchAll(/data-class-tab="([a-z]+)"/g)].map((m) => m[1])).toEqual([...GEAR_CLASSES])
    expect(count(html, /data-class-panel="/g)).toBe(4)
    expect(getField(b, 'suggestedEquipment').status).toBe('unverified')
    expect(html).toContain('data-gear-unknown=""')
    expect(html).toContain('data-unknown-field="suggestedEquipment"')
    const reason = declaredGapReason(gaps, b, 'suggestedEquipment')
    expect(reason).toMatch(/^No weapon is verified as obtainable before this fight/)
    expect(html).toContain(escaped(reason as string))

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

  it('AC2: drop items link their real page — weapons in-app, accessories / armor / ammo to their own wiki article, others to the wiki search for their name', () => {
    const html = render(boss('queen-bee'))
    expect(html).toContain('href="/weapons/1123"') // Bee Keeper
    expect(html).toContain('href="https://terraria.wiki.gg/wiki/Hive_Pack"') // accessory
    expect(html).toContain(`href="${wikiSearchUrl('Bee Wax')}"`) // material: no record of its own
    expect(html).not.toMatch(/href="\/(items|accessories|armor)\//)
  })

  it('a world-evil boss says which world it belongs to, and the page progress is display only', () => {
    const html = render(boss('brain-of-cthulhu'))
    expect(html).toContain('Crimson worlds only')
    expect(html).toContain('data-defeat-state="not-attempted"')
    expect(html).toContain('Display only: defeats can’t be marked on this page.')
  })

  it('unknown or non-page boss ids are a NotFoundError (styled 404), never a half page', async () => {
    await expect(loadBossPageData('plantera')).rejects.toBeInstanceOf(NotFoundError)
    await expect(loadBossPageData('not-a-boss')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('per-class gear when a boss has curated entries (rendering contract; validate enforces the gating)', () => {
  const gearData: GearData = {
    weapons: new Map((weaponsDetailJson as Weapon[]).map((w) => [w.id, w])),
    accessories: new Map((accessoriesDetailJson as Accessory[]).map((a) => [a.id, a])),
    armor: new Map((armorDetailJson as ArmorPiece[]).map((a) => [a.id, a])),
    sets: new Map((armorSetsJson as ArmorSet[]).map((s) => [s.id, s])),
    buffs: new Map((buffsJson as Buff[]).map((b) => [b.id, b])),
  }
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
    expect(melee).toContain('Ninja armor')
    expect(melee).toContain(`href="${gearData.buffs.get('ironskin')?.wikiUrl}"`)
    // other classes: an honest empty state, never another class's picks
    const ranged = /data-class-panel="ranged"[\s\S]*?(?=data-class-panel="magic")/.exec(html)![0]
    expect(ranged).toContain('No curated ranged gear for this fight.')
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

  it('items resolve to their real page: weapon in-app, accessory to its own article, else the wiki search for the Iteminfo name; a nameless id has no link', () => {
    expect(itemOf(1123)).toMatchObject({ name: 'Bee Keeper', kind: 'weapon', link: { kind: 'internal', to: '/weapons/1123' } })
    expect(itemOf(3097)).toMatchObject({ name: 'Shield of Cthulhu', kind: 'accessory', link: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Shield_of_Cthulhu' } })
    expect(itemOf(560)).toEqual({ id: 560, name: 'Slime Crown', kind: 'other', link: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Special:Search?search=Slime%20Crown' } })
    expect(names.byId.has(999999)).toBe(false)
    expect(itemOf(999999)).toEqual({ id: 999999, name: 'Item #999999', kind: 'other' })
    // no record of its own, but the Ironskin buff record carries the article titled exactly "Ironskin Potion"
    expect(itemOf(292)).toEqual({ id: 292, name: 'Ironskin Potion', kind: 'other', link: { kind: 'external', href: 'https://terraria.wiki.gg/wiki/Ironskin_Potion' } })
    expect(wikiArticleTitle('https://terraria.wiki.gg/wiki/Torch_God%27s_Favor')).toBe('Torch God\'s Favor')
    expect(wikiArticleTitle('https://example.com/wiki/Torch')).toBeUndefined()
  })
})

describe('H1: stats — an all-Unknown table collapses to one honest line', () => {
  const noStats = BOSS_PAGE_IDS.filter((id) => statsView(boss(id), gaps).kind === 'none')

  it('the shipped data: no stat verified for Eater of Worlds, Brain of Cthulhu, Queen Bee, Skeletron; all for the rest', () => {
    expect([...noStats].sort()).toEqual(['brain-of-cthulhu', 'eater-of-worlds', 'queen-bee', 'skeletron'])
    for (const id of BOSS_PAGE_IDS.filter((x) => !noStats.includes(x))) expect(statsView(boss(id), gaps), id).toEqual({ kind: 'table', unknownCells: 0 })
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

  it('a partial table keeps the grid: each Unknown cell hatched and phone-sized, the caption shown', () => {
    const b = structuredClone(boss('king-slime'))
    delete b.statsByDifficulty.expert
    delete b.statsByDifficulty.master
    b._prov = { ...b._prov, unverifiedFields: [...b._prov.unverifiedFields, 'statsByDifficulty.expert', 'statsByDifficulty.master'] }
    expect(statsView(b, gaps)).toEqual({ kind: 'table', unknownCells: 6 })
    const stats = section(render(b), 'stats')
    const hatched = [...stats.matchAll(/<td class="([^"]*\bbg-hatch-unknown\b[^"]*)">/g)].map((m) => m[1])
    expect(hatched).toHaveLength(6)
    for (const cls of hatched) expect(cls).toContain('max-md:text-xs')
    for (const d of ['expert', 'master'] as const) for (const k of STAT_KEYS) expect(stats).toContain(`data-unknown-field="${statField(d, k)}"`)
    expect(stats).toContain('2,000')
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
    expect(skeletron.tiers.conditional.map((g) => g.item.name)).toEqual(['Hellforge'])
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
  const recordUrl = new Map<number, string>()
  for (const r of [...(accessoriesListJson as AccessoryListRecord[]), ...(armorListJson as ArmorListRecord[]), ...(itemsJson as Item[])]) if (!recordUrl.has(r.id)) recordUrl.set(r.id, r.wikiUrl)
  const buffArticle = new Map(buffs.map((b) => [wikiArticleTitle(b.wikiUrl), b.wikiUrl]))
  const expected = (id: number) =>
    weaponIds.has(id)
      ? { kind: 'internal', to: `/weapons/${id}` }
      : recordUrl.has(id)
        ? { kind: 'external', href: recordUrl.get(id) }
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

  it('potions named in prep checklists now link their article (via the buff registry)', () => {
    const html = render(boss('king-slime'))
    expect(html).toContain('href="https://terraria.wiki.gg/wiki/Ironskin_Potion"')
    expect(html).toContain('href="https://terraria.wiki.gg/wiki/Regeneration_Potion"')
  })

  it('an item with no page and no article (Torch, Campfire) opens the wiki search for its exact name, in a new tab with the external marker', () => {
    const html = render(boss('eye-of-cthulhu'))
    expect(html).not.toContain('data-item-inert')
    for (const name of ['Torch', 'Campfire']) {
      const href = wikiSearchUrl(name)
      expect(href).toBe(`https://terraria.wiki.gg/wiki/Special:Search?search=${name}`)
      const link = new RegExp(`<a href="${escaped(href).replace(/[.?]/g, '\\$&')}" target="_blank" rel="noopener noreferrer"[^>]*>[\\s\\S]*?</a>`).exec(html)?.[0] ?? ''
      expect(link, name).toMatch(new RegExp(`>${name}</span><svg[^>]*aria-hidden="true"`))
      expect(link, name).toContain('on terraria.wiki.gg (opens in a new tab)')
    }
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
    for (const id of BOSS_PAGE_IDS) {
      const gear = section(render(boss(id)), 'gear')
      expect(gear).toContain('We can’t verify which weapons you can get before this fight, so we don’t suggest any.')
      expect(gear).toMatch(/<details[^>]*>[\s\S]*?Why we can’t tell[\s\S]*?<\/details>/)
      if (id === 'eye-of-cthulhu') expect(gear).toMatch(/data-prep-guide=""[\s\S]*?href="\/guides\/first-boss-prep"[^>]*>Preparing for your first boss</)
      else expect(gear, id).not.toContain('data-prep-guide')
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
