/* P7-S2b build text export / import (ADR D6 export/import; UX_SPEC §4(f), §5.7, §9; AMENDMENTS-016 B123(a)):
 * the readable block (header, slots in plain words with emptied / unfilled told apart, the `#code:` line last),
 * the full round trip through the builder's own Save path and a FRESH browser's store (slots identical, the
 * reopened draft identical), unknown items named by id and counted, the import preview, copy-to-clipboard
 * (mocked), the rendered surfaces (Export on every saved build and in Step 4, Import on the list) and the copy
 * audit over every new sentence. Live data via accessors only — the dataset may be regenerated under these tests. */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Condition, Item, ProgressionEdge, ProgressionNode, Weapon } from '../../../data-access/types'
import accessoriesJson from '../../../data/accessories.detail.json'
import armorJson from '../../../data/armor.detail.json'
import setsJson from '../../../data/armor-sets.json'
import bossesJson from '../../../data/bosses.json'
import buffsJson from '../../../data/buffs.json'
import conditionsJson from '../../../data/conditions.json'
import itemUniverseJson from '../../../data/item-universe.json'
import itemsJson from '../../../data/items.detail.json'
import { meta } from '../../../data/meta'
import progressionJson from '../../../data/progression.json'
import weaponsJson from '../../../data/weapons.detail.json'
import { auditCopy } from '../../../scoring/copyAudit'
import type { TrackedProgress } from '../../../scoring/progress'
import { recommendLoadout } from '../../../scoring/recommend'
import type { SavedBuild } from '../../../storage/builds'
import { memoryBackend } from '../../../storage/testing/storageFixtures'
import { buildRecordOf, readBuildText, type BuildRecord } from '../../../storage/transfer'
import { createBuildsStore } from '../../buildsStore'
import { assembleReadinessData } from '../bosses/readiness/readinessData'
import { buildText, buildTextLines, copyText, dataNames, exportDate, importPreview, isKnownItem, slotLines, type BuildTextNames } from './buildText'
import * as text from './buildTextCopy'
import { BuildsView } from './BuildsView'
import { BuildImport, BuildImportPreview } from './BuildTransfer'
import * as copy from './loadoutCopy'
import { buildHeadingId, draftFrom, effectiveInputs, engineInput, stateFromBuild, type LoadoutState } from './loadoutModel'
import { SaveStep } from './SaveStep'

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const page = assembleReadinessData({
  map: { progression: { ...progression, nodeById: byId(progression.nodes) }, bosses: bossesJson as unknown as Boss[], sprites: null },
  weapons: byId(weaponsJson as unknown as Weapon[]),
  armor: byId(armorJson as unknown as ArmorPiece[]),
  accessories: byId(accessoriesJson as unknown as Accessory[]),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: itemsJson as unknown as Item[],
  buffs: buffsJson as unknown as Buff[],
  conditions: { byId: byId(conditionsJson as unknown as Condition[]) },
  names: { byId: new Map(itemUniverseJson.items.flatMap((i) => (i.name ? [[i.id, i.name] as const] : []))), bySlug: new Map() },
})
const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const STAMP = { createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' }
const META = { now: new Date(2026, 9, 15, 12, 0), appVersion: '0.1.0', gameVersion: meta.gameVersion }
const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, el)))
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

/** A build saved the builder's own way (draftFrom over a real engine run). */
function saveOf(state: LoadoutState, name: string, buildId = 'b-text-0001'): SavedBuild {
  const eff = effectiveInputs(state, null)
  const result = recommendLoadout(engineInput(eff, NONE, state.pins), page.engine)
  return { ...draftFrom(name, eff, result, state.pins), buildId, ...STAMP }
}

/** Names that make every line checkable without the dataset. */
const FAKE: BuildTextNames = { item: (id) => `Item ${id}`, boss: (slug) => `Boss ${slug}` }
const base = (): BuildRecord => ({
  name: 'Test',
  stage: 'early-hm',
  class: 'ranged',
  difficulty: 'expert',
  goal: 'boss',
  slots: { mainWeapon: 10, altWeapon: null, helmet: 20, chest: null, legs: 22, accessories: [30, null, 32, null, null, null, null], ammo: [40], buffs: [50], summon: null },
  ownedIds: [10],
  emptiedSlots: ['alt', 'acc1', 'buff2'],
})

describe('the readable block (ADR D6: a header people can skim, the slots in plain words, the #code: line)', () => {
  it('header: name, class, stage, difficulty, goal, target boss, the export date with the app and game-data versions', () => {
    const lines = buildTextLines({ ...base(), targetBoss: 'plantera', name: 'Two\nlines' }, FAKE, META)
    expect(lines.slice(0, 9)).toEqual([
      'Terraria Companion build',
      'Name: Two lines',
      'Class: Ranged',
      'Stage: Early Hardmode',
      'Difficulty: Expert Mode',
      'Goal: Boss fight',
      'Made for: Boss plantera',
      `Exported: 2026-10-15 from Terraria Companion 0.1.0 · game data ${meta.gameVersion} (Desktop)`,
      '',
    ])
    expect(exportDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    // no goal saved (v1): the builder's default, said as such; no boss: no line
    const v1 = buildTextLines({ ...base(), goal: undefined }, FAKE, META)
    expect(v1).toContain('Goal: Balanced (none saved; the builder’s default)')
    expect(v1.some((l) => l.startsWith('Made for'))).toBe(false)
  })

  it('slots: items by name; empty slots told apart — emptied by you vs left empty by the recommendation (B106); list slots name their emptied positions', () => {
    expect(slotLines(base(), FAKE)).toEqual([
      'Main weapon: Item 10',
      'Alt weapon: empty — emptied by you',
      'Helmet: Item 20',
      'Chest: none',
      'Legs: Item 22',
      'Accessory 1: Item 30',
      'Accessory 2: empty — emptied by you',
      'Accessory 3: Item 32',
      'Accessory 4: empty — left empty by the recommendation',
      'Accessory 5: empty — left empty by the recommendation',
      'Accessory 6: empty — left empty by the recommendation',
      'Ammo: Item 40',
      'Potions: Item 50 (emptied by you: Potion 3)',
      'Minion staff: empty — left empty by the recommendation',
    ])
  })

  it('a v1 build (no emptied marker): every stored empty reads as emptied — v1’s meaning; armor all empty is one line; an accessory past the difficulty’s slots is said', () => {
    const v1: BuildRecord = { name: 'Old', stage: 'endgame', class: 'magic', difficulty: 'classic', slots: { mainWeapon: null, altWeapon: null, helmet: null, chest: null, legs: null, accessories: [1, 2, 3, 4, 5, 6, null], ammo: [], buffs: [], summon: null } }
    expect(slotLines(v1, FAKE)).toEqual([
      'Main weapon: empty — emptied by you',
      'Alt weapon: empty — emptied by you',
      'Armor set: empty — emptied by you',
      'Accessory 1: Item 1',
      'Accessory 2: Item 2',
      'Accessory 3: Item 3',
      'Accessory 4: Item 4',
      'Accessory 5: Item 5',
      'Accessory 6: Item 6 — no such slot at this difficulty',
      'Ammo: none',
      'Potions: none (emptied by you: Potion 1, Potion 2, Potion 3)',
      'Minion staff: empty — emptied by you',
    ])
    const lines = buildTextLines(v1, FAKE, META)
    expect(lines.at(-1)).toBe('Gear you own: none')
  })

  it('the block ends with the note and the #code: line — the only part an import reads', () => {
    const block = buildText(base(), FAKE, META).split('\n')
    expect(block.at(-2)).toBe(text.CODE_NOTE)
    expect(block.at(-1)).toMatch(/^#code: tcb\.2\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/)
    expect(block.filter((l) => l.startsWith('#code:'))).toHaveLength(1)
    expect(block).toContain('Gear you own: Item 10')
    expect(buildText({ ...base(), notes: 'keep\nthis' }, FAKE, META)).toContain('\nNotes: keep this\n')
  })

  it('names from the data: a known item by its name, an unknown id said with its id, an unknown boss slug said', () => {
    const names = dataNames(page)
    const weapon = (weaponsJson as unknown as Weapon[])[0]
    expect(names.item(weapon.id)).toBe(weapon.name)
    expect(isKnownItem(page.engine, weapon.id)).toBe(true)
    expect(isKnownItem(page.engine, 999_999)).toBe(false)
    expect(names.item(999_999)).toBe('Unknown item (id 999999)')
    expect(names.boss('plantera')).toBe('Plantera')
    expect(names.boss('not-a-boss')).toBe('not-a-boss (not a boss in this site’s data)')
  })
})

describe('round trip: export a saved build, wipe, paste it into a fresh browser — identical (PRD P7-S2)', () => {
  const states: LoadoutState[] = [
    { step: 2, stage: 'mid-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', boss: 'plantera', owned: [], pins: { alt: { kind: 'empty' }, buff2: { kind: 'empty' } } },
    { step: 2, stage: 'early-prehm', cls: 'summon', difficulty: 'master', goal: 'survivability', owned: [], pins: { acc0: { kind: 'empty' }, main: { kind: 'empty' } } },
    { step: 2, stage: 'endgame', cls: 'hybrid', difficulty: 'classic', goal: 'mobility', owned: [], pins: {} },
  ]

  it.each(states.map((s, i) => [i, s] as const))('state %i: slots, inputs, markers, target boss and owned list come back; the reopened draft is the same', (_i, state) => {
    const firstOwned = saveOf(state, 'probe').slots.mainWeapon
    const withOwned: LoadoutState = { ...state, owned: firstOwned ? [firstOwned] : [] }
    const original = saveOf(withOwned, `Export test ${_i}`)
    // this browser: saved, then exported
    const here = createBuildsStore(memoryBackend(), () => 'b-here-0001')
    const saved = here.getState().create(buildRecordOf(original))
    const exported = buildText(buildRecordOf(saved), dataNames(page), META)
    // a fresh browser: nothing saved; paste → read → add
    const fresh = memoryBackend()
    const there = createBuildsStore(fresh, () => 'b-there-001')
    expect(there.getState().builds).toEqual([])
    const read = readBuildText(exported)
    if (!read.ok) throw new Error(JSON.stringify(read.error))
    const imported = there.getState().create(read.build)
    expect(imported.buildId).not.toBe(saved.buildId)
    expect(buildRecordOf(imported)).toEqual(buildRecordOf(saved))
    expect(imported.slots).toEqual(saved.slots)
    // and it persisted: a reload of the fresh browser holds the same build
    expect(buildRecordOf(createBuildsStore(fresh).getState().builds[0])).toEqual(buildRecordOf(saved))
    // opening it in the builder gives the same draft (pins, inputs) as the original
    const { build: _a, ...openedHere } = stateFromBuild(saved, page.engine)
    const { build: _b, ...openedThere } = stateFromBuild(imported, page.engine)
    expect(openedThere).toEqual(openedHere)
  })
})

describe('the import preview: every item counted, unknown ones listed by id, a missing boss and a duplicate said', () => {
  const known = (id: number) => isKnownItem(page.engine, id)
  const isBoss = (slug: string) => page.engine.bosses.has(slug)
  const weapon = (weaponsJson as unknown as Weapon[])[0].id
  const record: BuildRecord = {
    ...base(),
    slots: { ...base().slots, mainWeapon: weapon, helmet: null, legs: null, accessories: [999_001, null, 999_002, null, null, null, null], ammo: [], buffs: [999_001] },
    ownedIds: [weapon, 999_003],
    targetBoss: 'not-a-boss',
  }

  it('unknown ids with where they sit (an id in two places is one row); the count keeps them', () => {
    const model = importPreview(record, known, isBoss, [])
    expect(model.items).toEqual([weapon, 999_001, 999_002, 999_001])
    expect(model.unknown).toEqual([
      { id: 999_001, where: ['Accessory 1', 'Potions'] },
      { id: 999_002, where: ['Accessory 3'] },
      { id: 999_003, where: ['gear you own'] },
    ])
    expect(model.missingBoss).toBe('not-a-boss')
    expect(model.duplicateOf).toBeUndefined()
  })

  it('a saved build holding exactly the same thing is named (ids and dates aside)', () => {
    const twin: SavedBuild = { ...record, buildId: 'b-twin-0001', ...STAMP }
    expect(importPreview(record, known, isBoss, [twin]).duplicateOf?.buildId).toBe('b-twin-0001')
    expect(importPreview({ ...record, name: 'Renamed' }, known, isBoss, [twin]).duplicateOf).toBeUndefined()
  })

  it('renders: title, counts, the grid, explicit unknown rows, the kept note, the missing boss, a game-data note, Add + Cancel', () => {
    const read = { ok: true as const, build: record, v: 2, gameVersion: '1.4.4.9' }
    const html = wrap(createElement(BuildImportPreview, { page, builds: [], read, headingId: 'p', onAdd: () => {}, onCancel: () => {} }))
    const t = plain(html)
    expect(t).toContain(text.previewTitle('Test'))
    expect(t).toContain(text.itemsCount(4))
    expect(t).toContain(text.ownedCount(2))
    expect(html).toContain('data-import-unknown="3"')
    expect([...html.matchAll(/data-unknown-id="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([999_001, 999_002, 999_003])
    expect(t).toContain(text.unknownRow(999_001, 'Accessory 1, Potions'))
    expect(t).toContain(text.UNKNOWN_KEPT)
    expect(t).toContain(text.previewBossMissing('not-a-boss'))
    expect(t).toContain(text.previewGame('1.4.4.9', meta.gameVersion))
    expect(html).toContain(`aria-label="${copy.previewLabel('Test')}"`)
    expect(html).toContain('data-import-add=""')
    expect(html).toMatch(/<h4 id="p" tabindex="-1"/)
    const audit = auditCopy(t)
    expect(audit, audit).toBeUndefined()
  })
})

describe('copy to the clipboard (mocked)', () => {
  it('the Clipboard API first', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const fallback = vi.fn(() => true)
    expect(await copyText('abc', { clipboard: { writeText }, fallback })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('refused (permission, no gesture) or absent: the select-and-copy fallback; neither works → false, never a throw', async () => {
    const refused = { writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) }
    expect(await copyText('abc', { clipboard: refused, fallback: () => true })).toBe(true)
    expect(await copyText('abc', { fallback: () => true })).toBe(true)
    expect(await copyText('abc', { clipboard: refused, fallback: () => false })).toBe(false)
    expect(
      await copyText('abc', {
        fallback: () => {
          throw new Error('no execCommand')
        },
      }),
    ).toBe(false)
    expect(await copyText('abc', {})).toBe(false)
  })
})

describe('the surfaces: Export on every saved build and in Step 4; Import on the saved-builds list', () => {
  const a = saveOf({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} }, 'Ranged one', 'b-text-0101')
  const onImport = (r: BuildRecord): SavedBuild => ({ ...r, ...STAMP, buildId: 'b-text-new1' })

  it('the list: an Export button per card (named for screen readers), card headings focusable for the import’s focus move, the Import toggle closed', () => {
    const html = wrap(createElement(BuildsView, { page, builds: [a], loadStatus: 'loaded', persistError: false, headingId: 'h', backHref: '/loadout', openHref: () => '', onDelete: () => {}, onExport: () => {}, onImport }))
    expect(html).toContain(`data-export="${a.buildId}"`)
    expect(html).toContain(`aria-label="${text.exportSr(a.name)}"`)
    expect(html).toMatch(new RegExp(`<h3 id="${buildHeadingId(a.buildId)}" tabindex="-1"`))
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-import-toggle=""/)
    expect(plain(html)).toContain(text.IMPORT_OPEN)
    expect(html).not.toContain('data-import-panel')
  })

  it('a fresh browser (no builds): the empty invitation AND the import', () => {
    const html = wrap(createElement(BuildsView, { page, builds: [], loadStatus: 'empty', persistError: false, headingId: 'h', backHref: '/loadout', openHref: () => '', onDelete: () => {}, onExport: () => {}, onImport }))
    expect(html).toContain('data-builds-empty=""')
    expect(html).toContain('data-import-toggle=""')
  })

  it('Step 4: "Export as text" beside Save, described by its hint', () => {
    const html = wrap(
      createElement(SaveStep, { builds: [], loadStatus: 'empty', persistError: false, editingMissing: false, unsaved: false, defaultName: 'x', weaponIds: [], openHref: () => '', onSave: () => {}, onExport: () => {}, onDelete: () => {} }),
    )
    expect(html).toMatch(/<button[^>]*aria-describedby="[^"]*export-hint"[^>]*data-export-draft=""/)
    expect(plain(html)).toContain(text.EXPORT_DRAFT_HINT)
  })

  it('the import panel component renders closed by default (state lives in the browser)', () => {
    const html = wrap(createElement(BuildImport, { page, builds: [], onAdd: onImport }))
    expect(html).toMatch(/role="status"[^>]*data-import-status=""/)
  })
})

describe('copy audit (UX_SPEC §10.3): every sentence of the export / import and the text block', () => {
  it('every string and sample call', () => {
    const strings: string[] = []
    for (const [key, value] of Object.entries(text)) {
      if (typeof value === 'string') strings.push(value)
      else if (typeof value === 'object') strings.push(...Object.values(value as Record<string, string>))
      else if (key === 'importError') {
        const failure = { kind: 'invalid' as const, message: 'x', version: 2 }
        for (const error of [{ kind: 'empty' }, { kind: 'no-code' }, { kind: 'several-codes', count: 2 }, { kind: 'damaged' }, { kind: 'future-version', version: 3, supported: 2 }, { kind: 'invalid', failure }] as const) strings.push(text.importError(error))
      } else strings.push((value as (...a: unknown[]) => string)(3, 'x', 'y', 'z', 'w'))
    }
    strings.push(text.itemsCount(0), text.itemsCount(1), text.ownedCount(0), text.ownedCount(1), text.unknownTitle(1, '1.4.5.8'))
    expect(strings.length).toBeGreaterThan(40)
    for (const s of strings) expect(auditCopy(s), s).toBeUndefined()
  })

  it('a real block', () => {
    const block = buildText(buildRecordOf(saveOf({ step: 2, stage: 'mid-hm', cls: 'melee', difficulty: 'master', goal: 'boss', boss: 'plantera', owned: [], pins: {} }, 'Audit')), dataNames(page), META)
    expect(auditCopy(block), auditCopy(block)).toBeUndefined()
  })
})
