import { describe, expect, it, vi } from 'vitest'
import conditions from '../data/conditions.json'
import drops from '../data/drops.json'
import itemUniverse from '../data/item-universe.json'
import meta from '../data/meta.json'
import progression from '../data/progression.json'
import recipeGroups from '../data/recipe-groups.json'
import recipes from '../data/recipes.json'
import weaponsDetail from '../data/weapons.detail.json'
import weaponsList from '../data/weapons.list.json'
import spriteManifest from '../../public/sprites/manifest.json'
import { validateDataFile } from './devValidate'
import {
  ChunkLoadError,
  createDataAccess,
  DataValidationError,
  NotFoundError,
  parseItemId,
  SchemaVersionError,
  slugify,
  type Importers,
} from './index'
import { memo } from './memo'

const weapon = (id: number, name: string) => ({ id, name })
const okList = [{ id: 4956, name: 'Zenith' }]
const okDetail = [weapon(4956, 'Zenith'), weapon(98, 'Minishark')]

function access(importers: Partial<Importers>) {
  return createDataAccess({ importers, validate: null })
}

describe('memo (lazy singleton)', () => {
  it('runs the factory once, shares the in-flight promise, and exposes the settled value via peek', async () => {
    const factory = vi.fn(async () => 42)
    const m = memo(factory)
    expect(m.peek()).toBeUndefined()
    const [a, b] = await Promise.all([m.get(), m.get()])
    expect([a, b, m.peek()]).toEqual([42, 42, 42])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures: the next get() retries', async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok')
    const m = memo(factory)
    await expect(m.get()).rejects.toThrow('offline')
    expect(m.peek()).toBeUndefined()
    await expect(m.get()).resolves.toBe('ok')
    expect(factory).toHaveBeenCalledTimes(2)
  })
})

describe('data access: loadList / loadDetail (§4a)', () => {
  it('loads a list once and caches it (lazy singleton) with a synchronous peek afterwards', async () => {
    const importer = vi.fn(async () => okList)
    const da = access({ 'weapons.list': importer })
    expect(da.peekList('weapons')).toBeUndefined()
    await da.loadList('weapons')
    await da.loadList('weapons')
    expect(importer).toHaveBeenCalledTimes(1)
    expect(da.peekList('weapons')).toEqual(okList)
  })

  it('wraps a failed chunk import in ChunkLoadError{file, cause} and retries on the next call', async () => {
    const cause = new TypeError('Failed to fetch dynamically imported module')
    const importer = vi.fn().mockRejectedValueOnce(cause).mockResolvedValueOnce(okList)
    const da = access({ 'weapons.list': importer })
    const error = await da.loadList('weapons').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChunkLoadError)
    expect(error).toMatchObject({ file: 'weapons.list', cause, moduleImport: true })
    await expect(da.loadList('weapons')).resolves.toEqual(okList)
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('resolves a detail record by numeric or string id and exposes the index', async () => {
    const da = access({ 'weapons.detail': async () => okDetail })
    await expect(da.loadDetail('weapons', 4956)).resolves.toMatchObject({ name: 'Zenith' })
    await expect(da.loadDetail('weapons', '98')).resolves.toMatchObject({ name: 'Minishark' })
    expect(da.peekDetail('weapons', '4956')).toMatchObject({ name: 'Zenith' })
    expect(da.peekDetailIndex('weapons')?.size).toBe(2)
  })

  it('throws NotFoundError{ref} for an unknown id (→ styled 404)', async () => {
    const da = access({ 'weapons.detail': async () => okDetail })
    const error = await da.loadDetail('weapons', '999999').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error).toMatchObject({ ref: 'i:999999' })
    expect(da.peekDetail('weapons', '999999')).toBeUndefined()
  })

  it('throws NotFoundError for malformed ids without loading the chunk', async () => {
    const importer = vi.fn(async () => okDetail)
    const da = access({ 'weapons.detail': importer })
    for (const bad of ['abc', '0', '-1', '1.5', '', '0042', '12345678901']) {
      await expect(da.loadDetail('weapons', bad), bad).rejects.toBeInstanceOf(NotFoundError)
    }
    expect(importer).not.toHaveBeenCalled()
  })

  it('a detail chunk failure is a ChunkLoadError, not a 404', async () => {
    const da = access({ 'weapons.detail': async () => Promise.reject(new Error('net::ERR_FAILED')) })
    await expect(da.loadDetail('weapons', 4956)).rejects.toBeInstanceOf(ChunkLoadError)
  })

  it('runs the dev validator on every loaded file and surfaces DataValidationError', async () => {
    const da = createDataAccess({
      importers: { 'weapons.list': async () => [{ id: 1, name: 'Bad', extra: true }] },
      validate: validateDataFile,
    })
    const error = await da.loadList('weapons').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DataValidationError)
    expect((error as DataValidationError).file).toBe('weapons.list')
    expect((error as DataValidationError).zodIssues.length).toBeGreaterThan(0)
  })
})

describe('data access: loadMeta + indexes', () => {
  it('returns meta when dataSchemaVersion matches', async () => {
    await expect(access({}).loadMeta()).resolves.toMatchObject({ gameVersion: '1.4.5.8', dataSchemaVersion: 1 })
  })

  it('throws SchemaVersionError{expected, found} on a data schema mismatch', async () => {
    const da = access({ meta: async () => ({ ...meta, dataSchemaVersion: 2 }) })
    const error = await da.loadMeta().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SchemaVersionError)
    expect(error).toMatchObject({ expected: 1, found: 2 })
  })

  it('loads only the acquisition indexes a weapon needs', async () => {
    const recipesImporter = vi.fn(async () => [])
    const dropsImporter = vi.fn(async () => [])
    const da = access({
      recipes: recipesImporter,
      'recipe-groups': async () => [],
      drops: dropsImporter,
      conditions: async () => [{ id: 'hardmode', name: 'Hardmode' }],
      'item-universe': async () => ({ items: [{ id: 97, internalName: 'MusketBall', name: 'Musket Ball' }] }),
    })
    const data = await da.loadAcquisitionData({ recipes: false, drops: true, gates: false })
    expect(recipesImporter).not.toHaveBeenCalled()
    expect(dropsImporter).toHaveBeenCalledTimes(1)
    expect(data.conditions.byId.get('hardmode')?.name).toBe('Hardmode')
    expect(da.peekAcquisitionData({ recipes: false, drops: true, gates: false })).toBeDefined()
    expect(da.peekAcquisitionData({ recipes: true, drops: true, gates: false })).toBeUndefined()
    const names = await da.loadItemNames()
    expect(names.bySlug.get('musket-ball')).toBe('Musket Ball')
  })

  it('builds the sprite index from the manifest; a fetch failure is a ChunkLoadError', async () => {
    const ok = access({ 'sprite-manifest': async () => spriteManifest })
    const index = await ok.loadSpriteIndex()
    expect(index.byPath.get('/sprites/weapons/4956.png')).toMatchObject({ ref: 'i:4956' })
    const failing = access({ 'sprite-manifest': async () => Promise.reject(new Error('HTTP 404')) })
    const error = await failing.loadSpriteIndex().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChunkLoadError)
    // A fetch (not a module import) can be retried in place.
    expect(error).toMatchObject({ file: 'sprite-manifest', moduleImport: false })
  })
})

describe('data access: loadProgression (§4a "Load graph")', () => {
  it('returns nodes + edges with a node lookup; a failed chunk is a ChunkLoadError', async () => {
    const graph = await access({}).loadProgression()
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.nodeById.get(graph.nodes[0].id)).toBe(graph.nodes[0])
    const failing = access({ progression: async () => Promise.reject(new Error('offline')) })
    await expect(failing.loadProgression()).rejects.toBeInstanceOf(ChunkLoadError)
  })
})

describe('helpers', () => {
  it('parseItemId accepts only positive integer ids', () => {
    expect(['4956', 4956, '1'].map(parseItemId)).toEqual([4956, 4956, 1])
    expect(['abc', '0', '-3', '1e3', ' 1', undefined].map(parseItemId)).toEqual(Array(6).fill(undefined))
  })

  it('slugify mirrors the pipeline (ammo-class slugs)', () => {
    expect(slugify('Musket Ball')).toBe('musket-ball')
    expect(slugify("Explosive Jack 'O Lantern")).toBe('explosive-jack-o-lantern')
    expect(slugify('Rocket I')).toBe('rocket-i')
  })
})

describe('dev validation accepts the current emitted data (app ⇄ pipeline contract)', () => {
  const cases: Array<[Parameters<typeof validateDataFile>[0], unknown]> = [
    ['weapons.list', weaponsList],
    ['weapons.detail', weaponsDetail],
    ['recipes', recipes],
    ['recipe-groups', recipeGroups],
    ['drops', drops],
    ['conditions', conditions],
    ['item-universe', itemUniverse],
    ['progression', progression],
    ['meta', meta],
    ['sprite-manifest', spriteManifest],
  ]
  for (const [file, data] of cases) {
    it(file, () => {
      expect(() => validateDataFile(file, data)).not.toThrow()
    })
  }

  it('the list schema is strict (an extra field fails)', () => {
    expect(() => validateDataFile('weapons.list', [{ ...weaponsList[0], extra: 1 }])).toThrow(DataValidationError)
  })
})
