/* tc.v1.readiness (DATA_SCHEMA_SPEC §8a ReadinessV1 + AMENDMENTS-001 A6; PRD §9 Feature A AC4;
 * SCORING_SPEC §7 lifecycle; UX_SPEC §5.6/§6): persistence round-trip, quarantine (set aside, never
 * deleted), the analyzedAt lifecycle (fresh → out-of-date → re-analyzed), explicit clear, and the
 * hand-written parser's parity with the Zod schema. */
import { describe, expect, it, vi } from 'vitest'
import { ReadinessV1 } from '../schemas'
import { loadDomain, storageKey, type StorageBackend } from '../storage'
import { MAX_ACCESSORY_SLOTS } from '../scoring/constants'
import { defaultReadinessSetup, parseReadiness, STORED_ACCESSORY_SLOTS, type ReadinessSetup } from '../storage/readiness'
import { createReadinessStore, sameInputs, sameProgress } from './readinessStore'

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const envelope = (data: unknown) => ({ v: 1, savedAt: '2026-10-14T12:00:00.000Z', gameVersion: '1.4.5.8', data })
const stored = (backend: ReturnType<typeof memoryBackend>) => JSON.parse(backend.dump()['tc.v1.readiness'])
const PROGRESS = { worldEvil: 'corruption' as const, nodeStates: { 'wall-of-flesh': 'defeated' as const } }
const T0 = new Date('2026-10-14T12:00:00.000Z')

describe('tc.v1.readiness: setup persistence (AC4: survives reload and browser restart)', () => {
  it('starts from the default setup (7 empty accessory slots, no boss, stage from the setting at creation)', () => {
    const store = createReadinessStore(memoryBackend(), 'mid-hm')
    expect(store.getState()).toMatchObject({ loadStatus: 'empty', snapshot: null, setup: { ...defaultReadinessSetup('mid-hm') } })
    expect(store.getState().setup.loadout.accessories).toHaveLength(7)
  })

  it('every edit saves a ReadinessV1 envelope under tc.v1.readiness and a fresh store (a reload) restores it', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    const s = store.getState()
    s.setBoss('plantera')
    s.setDifficulty('expert')
    s.setClass('melee')
    s.setStage('mid-hm')
    s.setSlot('mainWeapon', 1327)
    s.setAccessory(0, 490)
    s.addToList('buffs', 292)
    s.addToList('buffs', 292) // no repeats
    expect(storageKey('readiness')).toBe('tc.v1.readiness')
    expect(ReadinessV1.safeParse(stored(backend)).success).toBe(true)
    const reloaded = createReadinessStore(backend).getState()
    expect(reloaded.loadStatus).toBe('loaded')
    expect(reloaded.setup).toMatchObject({ bossId: 'plantera', stage: 'mid-hm', difficulty: 'expert', class: 'melee', analyzedAt: null })
    expect(reloaded.setup.loadout).toMatchObject({ mainWeapon: 1327, buffs: [292] })
    expect(reloaded.setup.loadout.accessories[0]).toBe(490)
    s.removeFromList('buffs', 0)
    expect(createReadinessStore(backend).getState().setup.loadout.buffs).toEqual([])
  })

  it('the stored slot count is the most any difficulty has (storage keeps its own copy of the constant)', () => {
    expect(STORED_ACCESSORY_SLOTS).toBe(MAX_ACCESSORY_SLOTS)
  })

  it('a stored 5-slot accessory list (valid schema) is padded to 7 on load', () => {
    const data = { ...defaultReadinessSetup(), loadout: { ...defaultReadinessSetup().loadout, accessories: [1, null, null, null, null] } }
    const store = createReadinessStore(memoryBackend({ 'tc.v1.readiness': JSON.stringify(envelope(data)) }))
    expect(store.getState().setup.loadout.accessories).toEqual([1, null, null, null, null, null, null])
  })

  it('ignores out-of-range accessory indexes (never stores a payload it could not read back)', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setAccessory(7, 490)
    store.getState().setAccessory(-1, 490)
    expect(backend.dump()).toEqual({})
  })
})

describe('the analysis lifecycle (SCORING_SPEC §7; UX_SPEC §6 — never silently replaced)', () => {
  it('analyze stamps analyzedAt and records the snapshot (setup + tracked progress); a reload restores the analysis for the same inputs', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss('plantera')
    store.getState().analyze(PROGRESS, T0)
    expect(store.getState().snapshot).toMatchObject({ at: T0.toISOString(), progress: PROGRESS, setup: { bossId: 'plantera' } })
    expect(stored(backend).data.analyzedAt).toBe(T0.toISOString())
    const reloaded = createReadinessStore(backend).getState()
    expect(reloaded.snapshot).toMatchObject({ at: T0.toISOString(), setup: { bossId: 'plantera' } })
    expect(reloaded.snapshot?.progress).toBeUndefined() // the progress at analysis time isn't stored
  })

  it('an edit after analyzing keeps the snapshot (shown out of date) and persists analyzedAt: null; editing back restores it', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss('plantera')
    store.getState().analyze(PROGRESS, T0)
    store.getState().setDifficulty('master')
    expect(store.getState().snapshot?.setup.difficulty).toBe('classic')
    expect(store.getState().setup.analyzedAt).toBeNull()
    expect(stored(backend).data.analyzedAt).toBeNull()
    // reloading now: the stored inputs were never analyzed → no analysis is restored for them
    expect(createReadinessStore(backend).getState().snapshot).toBeNull()
    store.getState().setDifficulty('classic')
    expect(store.getState().setup.analyzedAt).toBe(T0.toISOString())
    expect(stored(backend).data.analyzedAt).toBe(T0.toISOString())
  })

  it.each<[string, (s: ReturnType<ReturnType<typeof createReadinessStore>['getState']>) => void]>([
    ['boss', (s) => s.setBoss('golem')],
    ['difficulty', (s) => s.setDifficulty('expert')],
    ['class', (s) => s.setClass('magic')],
    ['loadout', (s) => s.setSlot('helmet', 1)],
    ['accessory', (s) => s.setAccessory(2, 490)],
    ['potion list', (s) => s.addToList('buffs', 292)],
  ])('a %s change after analyzing marks the analysis out of date', (_what, change) => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss('plantera')
    store.getState().analyze(PROGRESS, T0)
    change(store.getState())
    expect(store.getState().snapshot?.at).toBe(T0.toISOString())
    expect(store.getState().setup.analyzedAt).toBeNull()
    expect(stored(backend).data.analyzedAt).toBeNull()
  })

  it('a stage flip after analyzing leaves the analysis current (context only, AMENDMENTS-015 B97b): saved, analyzedAt kept, restored on reload', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend, 'early-prehm')
    store.getState().setBoss('plantera')
    store.getState().analyze(PROGRESS, T0)
    store.getState().setStage('endgame')
    expect(store.getState().setup).toMatchObject({ stage: 'endgame', analyzedAt: T0.toISOString() })
    expect(store.getState().snapshot).toMatchObject({ at: T0.toISOString(), progress: PROGRESS })
    expect(sameInputs(store.getState().setup, store.getState().snapshot?.setup as ReadinessSetup)).toBe(true)
    expect(stored(backend).data).toMatchObject({ stage: 'endgame', analyzedAt: T0.toISOString() })
    expect(createReadinessStore(backend).getState().snapshot).toMatchObject({ at: T0.toISOString(), setup: { bossId: 'plantera', stage: 'endgame' } })
    // while out of date for another reason, a stage flip doesn't bring it back
    store.getState().setDifficulty('master')
    store.getState().setStage('mid-hm')
    expect(store.getState().setup).toMatchObject({ stage: 'mid-hm', analyzedAt: null })
    store.getState().setDifficulty('classic')
    expect(store.getState().setup.analyzedAt).toBe(T0.toISOString())
  })

  it('a no-op edit writes nothing; prefill applies boss, class and difficulty in one save', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss(null)
    expect(backend.dump()).toEqual({})
    store.getState().prefill({ bossId: 'eye-of-cthulhu', cls: 'ranged', difficulty: 'expert' })
    expect(stored(backend).data).toMatchObject({ bossId: 'eye-of-cthulhu', class: 'ranged', difficulty: 'expert' })
  })

  it('clear is explicit: the default setup (the stage kept), no analysis', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setStage('endgame')
    store.getState().setBoss('moon-lord')
    store.getState().analyze(PROGRESS, T0)
    store.getState().clear()
    expect(store.getState()).toMatchObject({ snapshot: null, setup: defaultReadinessSetup('endgame') })
    expect(stored(backend).data).toEqual(defaultReadinessSetup('endgame'))
  })

  it('a restored snapshot pins the progress it is first shown with (once); a fresh analysis already carries its own', () => {
    const backend = memoryBackend()
    const store = createReadinessStore(backend)
    store.getState().setBoss('plantera')
    store.getState().analyze(PROGRESS, T0)
    const reloaded = createReadinessStore(backend)
    reloaded.getState().pinProgress({ worldEvil: null, nodeStates: {} })
    reloaded.getState().pinProgress(PROGRESS) // no-op: already pinned
    expect(reloaded.getState().snapshot?.progress).toEqual({ worldEvil: null, nodeStates: {} })
    store.getState().pinProgress({ worldEvil: null, nodeStates: {} })
    expect(store.getState().snapshot?.progress).toEqual(PROGRESS)
  })

  it('sameProgress compares world evil and node states regardless of key order', () => {
    expect(sameProgress({ worldEvil: null, nodeStates: { a: 'defeated', b: 'skipped' } }, { worldEvil: null, nodeStates: { b: 'skipped', a: 'defeated' } })).toBe(true)
    expect(sameProgress({ worldEvil: null, nodeStates: {} }, { worldEvil: 'crimson', nodeStates: {} })).toBe(false)
  })
})

describe('storage failures (ADR D6; UX_SPEC §5.6)', () => {
  it('quarantines an unreadable payload (set aside, never deleted) and starts from the default setup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = JSON.stringify(envelope({ ...defaultReadinessSetup(), difficulty: 'journey' }))
    const backend = memoryBackend({ 'tc.v1.readiness': raw })
    const store = createReadinessStore(backend)
    expect(store.getState()).toMatchObject({ loadStatus: 'quarantined', setup: defaultReadinessSetup() })
    const keys = Object.keys(backend.dump())
    expect(keys.filter((k) => k.startsWith('tc.quarantine.readiness.'))).toHaveLength(1)
    expect(backend.dump()[keys.find((k) => k.startsWith('tc.quarantine.readiness.')) as string]).toBe(raw)
    // the next edit writes a fresh valid envelope; the quarantined copy stays
    store.getState().setBoss('king-slime')
    expect(ReadinessV1.safeParse(stored(backend)).success).toBe(true)
    expect(Object.keys(backend.dump()).filter((k) => k.startsWith('tc.quarantine.readiness.'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('keeps edits in memory and says so when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createReadinessStore(null)
    store.getState().setBoss('plantera')
    expect(store.getState()).toMatchObject({ setup: { bossId: 'plantera' }, persistError: true })
    warn.mockRestore()
  })

  it('loadDomain reads the stored setup back exactly', () => {
    const backend = memoryBackend()
    createReadinessStore(backend).getState().setBoss('golem')
    const loaded = loadDomain('readiness', backend)
    expect(loaded.kind).toBe('loaded')
  })
})

describe('readiness domain parser ⇄ Zod ReadinessV1 parity', () => {
  const base: ReadinessSetup = defaultReadinessSetup()
  const valid: unknown[] = [
    base,
    { ...base, bossId: 'plantera', stage: 'mid-hm', difficulty: 'master', class: 'hybrid', analyzedAt: '2026-10-14T12:00:00.000Z' },
    { ...base, analyzedAt: '2026-10-14T12:00:00Z' },
    { ...base, loadout: { ...base.loadout, mainWeapon: 1327, accessories: [1, 2, 3, null, null], ammo: [97], buffs: [292, 28], summon: 4281 } },
  ]
  const invalid: Array<[string, unknown]> = [
    ['not an object', []],
    ['extra key', { ...base, extra: 1 }],
    ['missing stage (A6)', (({ stage: _s, ...rest }) => rest)(base)],
    ['bad boss slug', { ...base, bossId: 'Plantera' }],
    ['unknown stage', { ...base, stage: 'hardmode' }],
    ['unknown difficulty', { ...base, difficulty: 'journey' }],
    ['unknown class', { ...base, class: 'thrower' }],
    ['analyzedAt not ISO', { ...base, analyzedAt: '14 Oct 2026' }],
    ['analyzedAt with offset', { ...base, analyzedAt: '2026-10-14T12:00:00+02:00' }],
    ['loadout extra key', { ...base, loadout: { ...base.loadout, pet: null } }],
    ['4 accessory slots', { ...base, loadout: { ...base.loadout, accessories: [null, null, null, null] } }],
    ['8 accessory slots', { ...base, loadout: { ...base.loadout, accessories: Array(8).fill(null) } }],
    ['non-integer item id', { ...base, loadout: { ...base.loadout, mainWeapon: 1.5 } }],
    ['zero item id', { ...base, loadout: { ...base.loadout, helmet: 0 } }],
    ['null in ammo', { ...base, loadout: { ...base.loadout, ammo: [null] } }],
    ['string buff id', { ...base, loadout: { ...base.loadout, buffs: ['ironskin'] } }],
  ]

  it.each(valid.map((v) => [JSON.stringify(v).slice(0, 80), v]))('accepts %s like Zod', (_label, data) => {
    expect(parseReadiness(data)).toEqual(data)
    expect(ReadinessV1.safeParse(envelope(data)).success).toBe(true)
  })

  it.each(invalid)('rejects %s like Zod', (_label, data) => {
    expect(() => parseReadiness(data)).toThrow(TypeError)
    expect(ReadinessV1.safeParse(envelope(data)).success).toBe(false)
  })
})
