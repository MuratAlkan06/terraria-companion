/* tc.v1.builds (DATA_SCHEMA_SPEC §8a BuildsV1 / SavedBuildV1, AMENDMENTS-016 B106 BuildsV2; PRD P4-S2
 * "save/load named builds"; UX_SPEC §3.5 Step 4, §5.6, §6): persistence round-trip (a reload restores
 * every build, v2 fields included), a recorded v1 payload still loading (fields absent), overwrite vs
 * copy, delete, quarantine (set aside, never deleted), a failed save kept for the session, and the
 * hand-written parser's parity with the Zod schemas. */
import { describe, expect, it, vi } from 'vitest'
import { BuildSlotId, BuildsV1, BuildsV2 } from '../schemas'
import { SLOT_IDS } from '../scoring/recommend'
import { loadDomain, saveDomain, storageKey, type StorageBackend } from '../storage'
import { BUILD_SLOT_IDS, parseBuilds, type SavedBuild } from '../storage/builds'
import { emptyReadinessLoadout } from '../storage/readiness'
import { createBuildsStore, newBuildId, type BuildDraft } from './buildsStore'

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const envelope = (data: unknown, v = 2) => ({ v, savedAt: '2026-10-14T12:00:00.000Z', gameVersion: '1.4.5.8', data })
const T0 = new Date('2026-10-14T12:00:00.000Z')
const T1 = new Date('2026-10-14T13:30:00.000Z')
let n = 0
const ids = () => `build-${String(++n).padStart(4, '0')}`

/** A v1-era draft: no target boss, owned list or emptied-slot marker. */
const DRAFT_V1: BuildDraft = {
  name: 'Ranged · Early Hardmode',
  stage: 'early-hm',
  class: 'ranged',
  difficulty: 'expert',
  goal: 'boss',
  slots: { ...emptyReadinessLoadout(), mainWeapon: 434, helmet: 4982, chest: 4983, legs: 4984, accessories: [491, null, null, null, null, null, null], ammo: [97], buffs: [292], summon: 4281 },
}
/** What the builder saves since B106: + target boss, owned items, the slots the user emptied. */
const DRAFT: BuildDraft = { ...DRAFT_V1, targetBoss: 'plantera', ownedIds: [434, 197], emptiedSlots: ['acc1', 'buff1'] }

/** A tc.v1.builds payload in the exact shape the v1 builder wrote (envelope v: 1, before B106). */
const V1_RECORDED = JSON.stringify(
  envelope(
    {
      builds: [
        {
          name: 'Melee · Early Pre-Hardmode · Balanced',
          stage: 'early-prehm',
          class: 'melee',
          difficulty: 'classic',
          goal: 'balanced',
          slots: { mainWeapon: 3507, altWeapon: null, helmet: 727, chest: 728, legs: 729, accessories: [54, null, null, null, null, null, null], ammo: [], buffs: [292, 2349], summon: null },
          buildId: 'bmg8x2k1a7f3q9',
          createdAt: '2026-10-14T09:15:02.118Z',
          updatedAt: '2026-10-14T09:15:02.118Z',
        },
      ],
    },
    1,
  ),
)

describe('tc.v1.builds: save / load named builds', () => {
  it('starts empty; storageKey is tc.v1.builds', () => {
    expect(storageKey('builds')).toBe('tc.v1.builds')
    expect(createBuildsStore(memoryBackend(), ids).getState()).toMatchObject({ builds: [], loadStatus: 'empty', persistError: false })
  })

  it('create saves a BuildsV2 envelope (v: 2); a fresh store (a reload) restores the build exactly — target boss, owned items and emptied slots included', () => {
    const backend = memoryBackend()
    const store = createBuildsStore(backend, ids)
    const build = store.getState().create(DRAFT, T0)
    expect(build).toMatchObject({ ...DRAFT, createdAt: T0.toISOString(), updatedAt: T0.toISOString() })
    expect(build.buildId.length).toBeGreaterThanOrEqual(8)
    const raw = JSON.parse(backend.dump()['tc.v1.builds'])
    expect(raw.v).toBe(2)
    expect(BuildsV2.safeParse(raw).success).toBe(true)
    expect(raw.data).toEqual({ builds: [build] })
    const reloaded = createBuildsStore(backend, ids)
    expect(reloaded.getState()).toMatchObject({ loadStatus: 'loaded', builds: [build] })
    expect(reloaded.getState().builds[0]).toMatchObject({ targetBoss: 'plantera', ownedIds: [434, 197], emptiedSlots: ['acc1', 'buff1'] })
  })

  it('B106: a recorded v1 payload still loads — read as-is (no migration step changes it), its builds without the v2 fields — and the next save writes v2', () => {
    const backend = memoryBackend({ 'tc.v1.builds': V1_RECORDED })
    const recorded = JSON.parse(V1_RECORDED)
    expect(BuildsV1.safeParse(recorded).success).toBe(true)
    expect(loadDomain('builds', backend)).toEqual({ kind: 'loaded', data: recorded.data, migratedFrom: 1 })
    const store = createBuildsStore(backend, ids)
    expect(store.getState().loadStatus).toBe('loaded')
    const [old] = store.getState().builds
    expect(old).toEqual(recorded.data.builds[0])
    for (const key of ['targetBoss', 'ownedIds', 'emptiedSlots']) expect(key in old, key).toBe(false)
    // saving another build rewrites the list as v2; the v1 build rides along unchanged (still field-less)
    const added = store.getState().create(DRAFT, T1)
    const raw = JSON.parse(backend.dump()['tc.v1.builds'])
    expect(raw.v).toBe(2)
    expect(raw.data.builds).toEqual([added, recorded.data.builds[0]])
    expect(createBuildsStore(backend, ids).getState().builds).toEqual([added, old])
    expect(Object.keys(backend.dump()).some((k) => k.startsWith('tc.quarantine.'))).toBe(false)
  })

  it('a v1-era draft (no v2 fields) saves and reloads as such; saveDomain refuses a payload it could not read back', () => {
    const backend = memoryBackend()
    const build = createBuildsStore(backend, ids).getState().create(DRAFT_V1, T0)
    expect(createBuildsStore(backend, ids).getState().builds).toEqual([build])
    expect(() => saveDomain('builds', { builds: [{ ...build, emptiedSlots: ['acc9'] }] } as never, backend)).toThrow(TypeError)
  })

  it('update overwrites in place (id and creation time kept); "save as copy" is a second create (newest first)', () => {
    const backend = memoryBackend()
    const store = createBuildsStore(backend, ids)
    const first = store.getState().create(DRAFT, T0)
    const changed = store.getState().update(first.buildId, { ...DRAFT, name: 'Renamed', goal: 'survivability' }, T1)
    expect(changed).toMatchObject({ buildId: first.buildId, createdAt: T0.toISOString(), updatedAt: T1.toISOString(), name: 'Renamed', goal: 'survivability' })
    const copy = store.getState().create({ ...DRAFT, name: 'Renamed (copy)' }, T1)
    expect(store.getState().builds.map((b) => b.name)).toEqual(['Renamed (copy)', 'Renamed'])
    expect(copy.buildId).not.toBe(first.buildId)
    expect(store.getState().update('nope-0000', DRAFT, T1)).toBeUndefined()
    expect(createBuildsStore(backend, ids).getState().builds).toEqual(store.getState().builds)
  })

  it('remove deletes one build and persists; removing an unknown id is a no-op', () => {
    const backend = memoryBackend()
    const store = createBuildsStore(backend, ids)
    const a = store.getState().create(DRAFT, T0)
    const b = store.getState().create({ ...DRAFT, name: 'Second' }, T0)
    store.getState().remove(a.buildId)
    expect(store.getState().builds).toEqual([b])
    store.getState().remove('missing-123')
    expect(createBuildsStore(backend, ids).getState().builds).toEqual([b])
  })

  it('ids never collide within the list, and the default id is ≥ 8 characters', () => {
    const store = createBuildsStore(memoryBackend(), () => 'same-id-1')
    const a = store.getState().create(DRAFT, T0)
    const b = store.getState().create(DRAFT, T0)
    expect(a.buildId).not.toBe(b.buildId)
    expect(newBuildId(T0, () => 0.5).length).toBeGreaterThanOrEqual(8)
  })

  it('quarantines an unreadable payload (set aside under tc.quarantine.builds.*, never deleted) and starts empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = JSON.stringify(envelope({ builds: [{ buildId: 'x' }] }, 1))
    const backend = memoryBackend({ 'tc.v1.builds': raw })
    const store = createBuildsStore(backend, ids)
    expect(store.getState()).toMatchObject({ loadStatus: 'quarantined', builds: [] })
    const dump = backend.dump()
    expect(dump['tc.v1.builds']).toBeUndefined()
    expect(Object.entries(dump).find(([k]) => k.startsWith('tc.quarantine.builds.'))?.[1]).toBe(raw)
    warn.mockRestore()
  })

  it('a failed save keeps the change for this session and flags persistError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend: StorageBackend = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    const store = createBuildsStore(backend, ids)
    store.getState().create(DRAFT, T0)
    expect(store.getState()).toMatchObject({ persistError: true })
    expect(store.getState().builds).toHaveLength(1)
    warn.mockRestore()
  })

  it('loadDomain round-trips a two-build payload through the strict parser', () => {
    const backend = memoryBackend()
    const store = createBuildsStore(backend, ids)
    store.getState().create(DRAFT, T0)
    store.getState().create({ ...DRAFT, goal: undefined, notes: 'no goal: optional', name: 'B' } as BuildDraft, T1)
    const result = loadDomain('builds', backend)
    expect(result.kind).toBe('loaded')
  })
})

describe('the hand-written parser matches Zod BuildsV2 (and still reads every BuildsV1 payload)', () => {
  const v1: SavedBuild = { ...DRAFT_V1, buildId: 'build-0001', createdAt: T0.toISOString(), updatedAt: T0.toISOString() }
  const build: SavedBuild = { ...DRAFT, buildId: 'build-0001', createdAt: T0.toISOString(), updatedAt: T0.toISOString() }
  /** v1-shaped payloads: valid under BuildsV1 and, additively, BuildsV2. */
  const validV1: unknown[] = [
    { builds: [] },
    { builds: [v1] },
    { builds: [{ ...v1, goal: undefined }].map(({ goal: _g, ...rest }) => rest) },
    { builds: [{ ...v1, notes: 'a note', difficulty: 'master', class: 'hybrid', stage: 'endgame' }] },
    { builds: [{ ...v1, slots: { ...v1.slots, accessories: [1, 2, 3, null, null] } }] },
  ]
  /** v2 payloads: valid under BuildsV2 only (BuildsV1 is strict: the new keys are unknown to it). */
  const validV2: unknown[] = [
    { builds: [build] },
    { builds: [build, { ...v1, buildId: 'build-0002' }] },
    { builds: [{ ...build, ownedIds: [], emptiedSlots: [] }] },
    { builds: [(({ targetBoss: _t, ...rest }) => rest)(build)] },
    { builds: [{ ...build, emptiedSlots: [...BUILD_SLOT_IDS] }] },
  ]
  const invalid: Array<[string, unknown]> = [
    ['not an object', []],
    ['extra top-level key', { builds: [], extra: 1 }],
    ['builds not a list', { builds: {} }],
    ['short buildId', { builds: [{ ...build, buildId: 'b1' }] }],
    ['empty name', { builds: [{ ...build, name: '' }] }],
    ['bad createdAt', { builds: [{ ...build, createdAt: 'yesterday' }] }],
    ['unknown stage', { builds: [{ ...build, stage: 'hardmode' }] }],
    ['unknown class', { builds: [{ ...build, class: 'thrower' }] }],
    ['unknown difficulty', { builds: [{ ...build, difficulty: 'journey' }] }],
    ['unknown goal', { builds: [{ ...build, goal: 'speedrun' }] }],
    ['extra build key', { builds: [{ ...build, owned: [] }] }],
    ['missing slots', { builds: [(({ slots: _s, ...rest }) => rest)(build)] }],
    ['4 accessory slots', { builds: [{ ...build, slots: { ...build.slots, accessories: [null, null, null, null] } }] }],
    ['zero item id', { builds: [{ ...build, slots: { ...build.slots, mainWeapon: 0 } }] }],
    ['targetBoss not a slug', { builds: [{ ...build, targetBoss: 'Plantera' }] }],
    ['targetBoss null', { builds: [{ ...build, targetBoss: null }] }],
    ['ownedIds not a list', { builds: [{ ...build, ownedIds: 434 }] }],
    ['zero owned id', { builds: [{ ...build, ownedIds: [434, 0] }] }],
    ['fractional owned id', { builds: [{ ...build, ownedIds: [4.5] }] }],
    ['unknown emptied slot', { builds: [{ ...build, emptiedSlots: ['acc7'] }] }],
    ['emptied slot as LoadoutSlots key', { builds: [{ ...build, emptiedSlots: ['mainWeapon'] }] }],
    ['emptiedSlots not a list', { builds: [{ ...build, emptiedSlots: 'acc1' }] }],
  ]

  it.each(validV1.map((v) => [JSON.stringify(v).slice(0, 80), v]))('accepts v1 %s like Zod BuildsV1 and BuildsV2', (_label, data) => {
    expect(parseBuilds(data)).toEqual(data)
    expect(BuildsV1.safeParse(envelope(data, 1)).success).toBe(true)
    expect(BuildsV2.safeParse(envelope(data)).success).toBe(true)
  })

  it.each(validV2.map((v) => [JSON.stringify(v).slice(0, 80), v]))('accepts v2 %s like Zod BuildsV2', (_label, data) => {
    expect(parseBuilds(data)).toEqual(data)
    expect(BuildsV2.safeParse(envelope(data)).success).toBe(true)
  })

  it('v2-only payloads are not v1: BuildsV1 (the recorded v1 shape) rejects the new keys', () => {
    expect(BuildsV1.safeParse(envelope({ builds: [build] }, 1)).success).toBe(false)
  })

  it.each(invalid)('rejects %s like Zod', (_label, data) => {
    expect(() => parseBuilds(data)).toThrow(TypeError)
    expect(BuildsV2.safeParse(envelope(data)).success).toBe(false)
  })

  it('stricter than Zod by design: duplicate buildIds are unreadable (update / delete address builds by id)', () => {
    expect(() => parseBuilds({ builds: [build, build] })).toThrow(/duplicate buildId/)
  })

  it('the emptied-slot vocabulary is the builder’s slot list, in the storage module, the Zod schema and the engine alike', () => {
    expect(BUILD_SLOT_IDS).toEqual(SLOT_IDS)
    expect(BuildSlotId.options).toEqual([...SLOT_IDS])
  })
})
