/* The readiness checker's saved-build import (AMENDMENTS-016 B106 queue: the loadout → readiness
 * direction; UX_SPEC §3.5 Step 4 "Check Readiness", §3.8 SetupPane "import saved build", §10.6): the
 * mapping (slots, class, difficulty, stage, target boss — nothing of the builder's own rules), when an
 * import must ask first, the store's one-save import (the analysis lifecycle intact), the setup pane's
 * import control, the round trip builder → saved build → readiness (the checker keeps its own semantics:
 * tracked defeats only) and the copy audit. Live data via accessors only. */
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Condition, Item, ProgressionEdge, ProgressionNode, Weapon } from '../../../../data-access/types'
import accessoriesJson from '../../../../data/accessories.detail.json'
import armorJson from '../../../../data/armor.detail.json'
import setsJson from '../../../../data/armor-sets.json'
import bossesJson from '../../../../data/bosses.json'
import buffsJson from '../../../../data/buffs.json'
import conditionsJson from '../../../../data/conditions.json'
import itemUniverseJson from '../../../../data/item-universe.json'
import itemsJson from '../../../../data/items.detail.json'
import progressionJson from '../../../../data/progression.json'
import weaponsJson from '../../../../data/weapons.detail.json'
import { auditCopy } from '../../../../scoring/copyAudit'
import { effectiveProgress, type TrackedProgress } from '../../../../scoring/progress'
import { loadoutEntries } from '../../../../scoring/readiness'
import { recommendLoadout } from '../../../../scoring/recommend'
import type { StorageBackend } from '../../../../storage'
import type { SavedBuild } from '../../../../storage/builds'
import { defaultReadinessSetup, type ReadinessSetup } from '../../../../storage/readiness'
import { createReadinessStore } from '../../../readinessStore'
import { draftFrom, effectiveInputs, engineInput, type LoadoutState } from '../../loadout/loadoutModel'
import { importReplacesLoadout, readinessImportFromBuild } from './buildImport'
import { assembleReadinessData } from './readinessData'
import { readinessBuildHref } from './readinessLinks'
import * as copy from './readinessUiCopy'
import { engineInput as readinessInput, markedDefeats } from './readinessUi'
import { SetupPane, type SetupPaneProps } from './SetupPane'

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
const isBoss = (id: string) => page.engine.bosses.has(id)
const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const stamp = { createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' }
const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

function memoryBackend(): StorageBackend {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) }
}

/** A saved build made the builder's way (its Save path). */
function saved(state: LoadoutState, buildId = 'b-test-0001', name = 'Ranged for Plantera'): SavedBuild {
  const eff = effectiveInputs(state, null)
  const result = recommendLoadout(engineInput(eff, NONE, state.pins), page.engine)
  return { ...draftFrom(name, eff, result, state.pins), buildId, ...stamp }
}
const BUILD = saved({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', boss: 'plantera', owned: [], pins: {} })

describe('the mapping (B106 queue: readiness consumes a saved build’s slots)', () => {
  it('slots, class, difficulty, stage and the target boss cross over; the builder’s goal and owned list don’t', () => {
    const values = readinessImportFromBuild(BUILD, isBoss)
    expect(values).toEqual({ bossId: 'plantera', stage: 'early-hm', difficulty: 'expert', cls: 'ranged', loadout: { ...BUILD.slots } })
    expect(Object.keys(values).sort()).toEqual(['bossId', 'cls', 'difficulty', 'loadout', 'stage'])
    expect(values.loadout.accessories).toHaveLength(7)
    // a boss the data no longer has is left out (the setup keeps its own); no target boss → none
    expect(readinessImportFromBuild({ ...BUILD, targetBoss: 'no-such-boss' }, isBoss).bossId).toBeUndefined()
    const { targetBoss: _t, ...noBoss } = BUILD
    expect('bossId' in readinessImportFromBuild(noBoss, isBoss)).toBe(false)
    // a stored 5-slot accessory list is padded to the 7 the readiness store keeps
    const short = readinessImportFromBuild({ ...BUILD, slots: { ...BUILD.slots, accessories: [1, null, 2, null, null] } }, isBoss)
    expect(short.loadout.accessories).toEqual([1, null, 2, null, null, null, null])
    // copies, not the saved build's own arrays
    expect(readinessImportFromBuild(BUILD, isBoss).loadout.ammo).not.toBe(BUILD.slots.ammo)
  })

  it('asks first only when it would replace a loadout entered here (UX_SPEC §10.6)', () => {
    const values = readinessImportFromBuild(BUILD, isBoss)
    expect(importReplacesLoadout(defaultReadinessSetup(), values)).toBe(false)
    expect(importReplacesLoadout({ ...defaultReadinessSetup(), loadout: values.loadout }, values)).toBe(false)
    const entered: ReadinessSetup = { ...defaultReadinessSetup(), loadout: { ...defaultReadinessSetup().loadout, mainWeapon: 4956 } }
    expect(importReplacesLoadout(entered, values)).toBe(true)
    // an item only in a slot the difficulty doesn't use would be lost too
    const hidden: ReadinessSetup = { ...defaultReadinessSetup(), loadout: { ...defaultReadinessSetup().loadout, accessories: [null, null, null, null, null, null, 1] } }
    expect(importReplacesLoadout(hidden, values)).toBe(true)
  })

  it('the link: /readiness?build=<id>', () => {
    expect(readinessBuildHref('b-test-0001')).toBe('/readiness?build=b-test-0001')
  })
})

describe('the store’s import: one save; the analysis lifecycle intact (SCORING_SPEC §7, UX_SPEC §6)', () => {
  it('replaces stage, difficulty, class and loadout; sets the boss when given; persists; an analysis goes out of date', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss('skeletron')
    store.getState().setSlot('mainWeapon', 4956)
    store.getState().analyze(NONE, new Date('2026-10-14T12:00:00.000Z'))
    expect(store.getState().setup.analyzedAt).not.toBeNull()
    const values = readinessImportFromBuild(BUILD, isBoss)
    store.getState().importLoadout(values)
    expect(store.getState().setup).toMatchObject({ bossId: 'plantera', stage: 'early-hm', difficulty: 'expert', class: 'ranged', loadout: BUILD.slots, analyzedAt: null })
    // the shown analysis keeps its snapshot (dimmed "Out of date", never silently replaced)
    expect(store.getState().snapshot?.setup.bossId).toBe('skeletron')
    expect(createReadinessStore(backend).getState().setup).toMatchObject({ bossId: 'plantera', loadout: BUILD.slots })
    // without a boss the setup keeps its own
    const { bossId: _b, ...noBoss } = values
    store.getState().setBoss('the-twins')
    store.getState().importLoadout(noBoss)
    expect(store.getState().setup.bossId).toBe('the-twins')
  })
})

describe('the round trip: builder → saved build → readiness, with the checker’s own semantics', () => {
  it('every saved item is in the readiness loadout; availability follows TRACKED defeats only — a Wall of Flesh item the build’s Early Hardmode stage made obtainable reads as gated here until the Wall of Flesh is marked', () => {
    const values = readinessImportFromBuild(BUILD, isBoss)
    const setup: ReadinessSetup = { ...defaultReadinessSetup(), bossId: values.bossId ?? null, stage: values.stage, difficulty: values.difficulty, class: values.cls, loadout: values.loadout, analyzedAt: null }
    const entries = loadoutEntries(readinessInput(setup, NONE), page.engine)
    const savedIds = [BUILD.slots.mainWeapon, BUILD.slots.altWeapon, BUILD.slots.helmet, BUILD.slots.chest, BUILD.slots.legs, ...BUILD.slots.accessories, ...BUILD.slots.ammo, ...BUILD.slots.buffs, BUILD.slots.summon].filter((x): x is number => x !== null)
    expect(entries.map((e) => e.id).sort((a, b) => a - b)).toEqual([...savedIds].sort((a, b) => a - b))
    // the builder made these obtainable through its stage hypothesis (virtual Wall of Flesh); the checker reads tracked defeats only
    const builderEp = effectiveProgress(page.engine.graph, NONE, 'early-hm')
    expect(builderEp.has('wall-of-flesh')).toBe(true)
    const gatedHere = entries.filter((e) => e.availability.status === 'gated' && e.availability.missing.includes('wall-of-flesh'))
    expect(gatedHere.length).toBeGreaterThan(0)
    // …and none of them is dropped from the analysis: owned items always count (B94(1))
    for (const e of gatedHere) expect(e.reason, String(e.id)).toBeUndefined()
    const marked = loadoutEntries(readinessInput(setup, { worldEvil: null, nodeStates: { 'wall-of-flesh': 'defeated' } }), page.engine)
    expect(marked.filter((e) => e.availability.missing.includes('wall-of-flesh'))).toEqual([])
  })
})

describe('SetupPane: "Import a saved build" (UX_SPEC §3.8)', () => {
  const props = (over: Partial<SetupPaneProps>): SetupPaneProps => {
    const setup = defaultReadinessSetup()
    const marks = markedDefeats(page.engine.graph, NONE)
    const noop = () => {}
    return {
      page,
      setup,
      entries: loadoutEntries(readinessInput(setup, NONE), page.engine),
      markedCount: marks.marked.length,
      worldEvilName: null,
      demonHeartOpen: false,
      inactiveSlotItems: 0,
      errors: { boss: false, empty: false },
      onBoss: noop,
      onStage: noop,
      onDifficulty: noop,
      onClass: noop,
      onOpenPicker: noop,
      onRemove: noop,
      onAnalyze: noop,
      onClear: noop,
      registerSlot: noop,
      ids: { setup: 's', boss: 'b', bossError: 'be', loadout: 'l', loadoutError: 'le' },
      ...over,
    }
  }

  it('with saved builds: a select (newest first, preselected) and one Import button, its hint saying the checker’s rule; none → absent', () => {
    const older = { ...BUILD, buildId: 'b-test-0002', name: 'Older', updatedAt: '2026-10-01T12:00:00.000Z' }
    const html = wrap(createElement(SetupPane, props({ savedBuilds: [older, BUILD], onImport: () => {} })))
    const control = /data-import-build=""[\s\S]*?data-import-submit=""/.exec(html)?.[0] ?? ''
    expect(control).toMatch(/<label for="l-import"/)
    expect([...control.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual(['b-test-0001', 'b-test-0002'])
    expect(control).toMatch(/<option value="b-test-0001" selected=""/)
    expect(text(control)).toContain(copy.IMPORT_HINT)
    expect(wrap(createElement(SetupPane, props({ savedBuilds: [], onImport: () => {} })))).not.toContain('data-import-build')
    expect(wrap(createElement(SetupPane, props({})))).not.toContain('data-import-build')
  })
})

describe('copy audit: the import’s words (SCORING_SPEC §8.4; UX_SPEC §10.3)', () => {
  it('no outcome, readiness-verdict, odds or forward-promise wording', () => {
    const texts = [
      copy.IMPORT_LABEL,
      copy.IMPORT_HINT,
      copy.IMPORT_PICK,
      copy.IMPORT,
      copy.imported('Ranged for Plantera'),
      copy.importedBoss('Plantera'),
      copy.IMPORT_MISSING,
      copy.IMPORT_REPLACE_TITLE,
      copy.importReplaceBody('Ranged for Plantera'),
      copy.IMPORT_REPLACE_KEEP,
      copy.IMPORT_REPLACE,
      copy.IMPORT_KEEP,
      copy.IMPORT_DISMISS,
    ]
    for (const t of texts) expect(auditCopy(t), t).toBeUndefined()
    // the notice says the checker's own rule, not the build's
    expect(copy.imported('X')).toMatch(/follows the bosses marked on the map, not the stage the build was made for/)
  })
})
