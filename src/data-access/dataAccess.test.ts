import { describe, expect, it, vi } from 'vitest'
import bosses from '../data/bosses.json'
import buffs from '../data/buffs.json'
import conditions from '../data/conditions.json'
import drops from '../data/drops.json'
import enemies from '../data/enemies.json'
import itemUniverse from '../data/item-universe.json'
import itemsDetail from '../data/items.detail.json'
import meta from '../data/meta.json'
import progression from '../data/progression.json'
import recipeGroups from '../data/recipe-groups.json'
import recipes from '../data/recipes.json'
import weaponsDetail from '../data/weapons.detail.json'
import weaponsList from '../data/weapons.list.json'
import spriteManifest from '../../public/sprites/manifest.json'
import runtimeIndexJson from '../../public/sprites/manifest.index.json'

/** The committed runtime manifest parts (AMENDMENTS-016 B104), as the app would fetch them. */
const SPRITE_PART_FILES = import.meta.glob<unknown>(['../../public/sprites/manifest.*.json', '!../../public/sprites/manifest.index.json'], { import: 'default' })
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

describe('data access: loadBosses (P2-S6 boss records)', () => {
  it('loads the boss array once with a synchronous peek afterwards; a failed chunk is a ChunkLoadError', async () => {
    const importer = vi.fn(async () => bosses)
    const da = access({ bosses: importer })
    expect(da.peekBosses()).toBeUndefined()
    const loaded = await da.loadBosses()
    await da.loadBosses()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(loaded.map((b) => b.id)).toContain('wall-of-flesh')
    expect(da.peekBosses()).toBe(loaded)
    const failing = access({ bosses: async () => Promise.reject(new Error('offline')) })
    await expect(failing.loadBosses()).rejects.toBeInstanceOf(ChunkLoadError)
    expect(failing.peekBosses()).toBeUndefined()
  })
})

describe('data access: loadEnemies (A5 enemy records)', () => {
  it('loads the enemy array once (lazy singleton); a failed chunk is a ChunkLoadError and is retried', async () => {
    const importer = vi.fn(async () => enemies)
    const da = access({ enemies: importer })
    const loaded = await da.loadEnemies()
    await da.loadEnemies()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(loaded.map((e) => e.id)).toContain('blue-slime')
    const failing = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(enemies)
    const retry = access({ enemies: failing })
    const error = await retry.loadEnemies().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChunkLoadError)
    expect(error).toMatchObject({ file: 'enemies', moduleImport: true })
    await expect(retry.loadEnemies()).resolves.toBe(enemies)
    expect(failing).toHaveBeenCalledTimes(2)
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
    ['items.detail', itemsDetail],
    ['buffs', buffs],
    ['recipes', recipes],
    ['recipe-groups', recipeGroups],
    ['drops', drops],
    ['conditions', conditions],
    ['item-universe', itemUniverse],
    ['progression', progression],
    ['bosses', bosses],
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

describe('P6 encyclopedia: item list + sharded item details (items.detail.index.json)', () => {
  const index = {
    shardSize: 1000,
    files: [
      { file: 'items.detail.json', ids: [97, 3335] },
      { file: 'items.detail.1.json', ids: [1294] },
      { file: 'items.detail.4.json', ids: [4372] },
    ],
  }
  const rec = (id: number, name: string) => ({ id, name })
  const shards: Record<string, unknown[]> = { 'items.detail.1.json': [rec(1294, 'Picksaw')], 'items.detail.4.json': [rec(4372, 'Ivy')] }

  function itemAccess(shard = vi.fn(async (file: string) => shards[file])) {
    const core = vi.fn(async () => [rec(97, 'Musket Ball'), rec(3335, 'Demon Heart')])
    const idx = vi.fn(async () => index)
    const da = createDataAccess({ validate: null, importers: { 'items.detail': core, 'items.detail.index': idx }, shardImporters: { 'items.detail-shard': shard } })
    return { da, core, idx, shard }
  }

  it('resolves an id through the index and loads only the file holding it (core or one shard), cached per file', async () => {
    const { da, core, idx, shard } = itemAccess()
    expect(da.peekItemDetail(1294)).toBeUndefined()
    await expect(da.loadItemDetail('1294')).resolves.toMatchObject({ name: 'Picksaw' })
    expect(shard).toHaveBeenCalledExactlyOnceWith('items.detail.1.json')
    expect(core).not.toHaveBeenCalled() // a shard record never loads the core file
    await expect(da.loadItemDetail(97)).resolves.toMatchObject({ name: 'Musket Ball' })
    expect(core).toHaveBeenCalledOnce()
    // second reads: no new imports; peek is synchronous once the file is loaded
    await da.loadItemDetail(1294)
    await da.loadItemDetail(3335)
    expect(shard).toHaveBeenCalledOnce()
    expect(core).toHaveBeenCalledOnce()
    expect(idx).toHaveBeenCalledOnce()
    expect(da.peekItemDetail(3335)).toMatchObject({ name: 'Demon Heart' })
    expect(da.peekItemDetail(4372)).toBeUndefined() // its shard is not loaded yet
    expect((await da.loadItemIndex()).ids).toEqual(new Set([97, 3335, 1294, 4372]))
  })

  it('NotFoundError for an id the index does not list or a malformed id — without loading any detail file', async () => {
    const { da, shard, core } = itemAccess()
    for (const id of ['4956', '999999', 'abc', '0']) {
      const error = await da.loadItemDetail(id).catch((e: unknown) => e)
      expect(error, id).toBeInstanceOf(NotFoundError)
    }
    expect(shard).not.toHaveBeenCalled()
    expect(core).not.toHaveBeenCalled()
  })

  it('a failed shard is a ChunkLoadError (module import → reload on retry) and is not cached', async () => {
    const shard = vi.fn().mockRejectedValueOnce(new Error('net::ERR_FAILED')).mockImplementation(async (file: string) => shards[file])
    const { da } = itemAccess(shard)
    const error = await da.loadItemDetail(4372).catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'ChunkLoadError', file: 'items.detail.4.json', moduleImport: true })
    await expect(da.loadItemDetail(4372)).resolves.toMatchObject({ name: 'Ivy' })
    expect(shard).toHaveBeenCalledTimes(2)
  })

  it('the real shard importer resolves every shard file the shipped index lists (one lazy chunk each)', async () => {
    const da = createDataAccess({ validate: validateDataFile })
    const idx = await da.loadItemIndex()
    const real = (await import('../data/items.detail.index.json')).default as typeof index
    for (const f of real.files) {
      const [id] = f.ids
      await expect(da.loadItemDetail(id), f.file).resolves.toMatchObject({ id, type: 'item' })
    }
    expect(idx.ids.size).toBe(real.files.reduce((n, f) => n + f.ids.length, 0))
    const list = await da.loadItemList()
    expect(list.map((i) => i.id).sort((a, b) => a - b)).toEqual([...idx.ids].sort((a, b) => a - b))
  })
})

describe('AMENDMENTS-016 B104: sprite index + lazy manifest parts', () => {
  const runtimeIndex = runtimeIndexJson as { fallbackMode: boolean; parts: { part: string; file: string; dir: string }[] }
  const partFile = (file: string) => {
    const load = SPRITE_PART_FILES[`../../public/sprites/${file}`]
    return load ? load() : Promise.reject(new Error(`no part ${file}`))
  }

  function spriteAccess(over: { index?: unknown } = {}) {
    const part = vi.fn(async (file: string) => partFile(file))
    const da = createDataAccess({ validate: validateDataFile, importers: { 'sprite-manifest': async () => over.index ?? runtimeIndex }, shardImporters: { 'sprite-part': part } })
    return { da, part }
  }

  it('loads the index, then only the parts asked for; others load on demand through index.load(path), once each', async () => {
    const { da, part } = spriteAccess()
    const sprites = await da.loadSpriteIndex(['weapons'])
    expect(part).toHaveBeenCalledExactlyOnceWith('manifest.weapons.json')
    expect(sprites.byPath.get('/sprites/weapons/4956.png')).toMatchObject({ ref: 'i:4956' })
    expect(sprites.byPath.has('/sprites/items/97.png')).toBe(false)
    expect(da.peekSpriteIndex(['weapons'])).toBe(sprites)
    expect(da.peekSpriteIndex(['bosses'])).toBeUndefined()
    // on demand: the part listing the path, then nothing more for paths of the same part
    await expect(sprites.load?.('/sprites/items/97.png')).resolves.toMatchObject({ ref: 'i:97' })
    await sprites.load?.('/sprites/items/98.png')
    expect(part.mock.calls.map(([f]) => f)).toEqual(['manifest.weapons.json', 'manifest.items.0.json'])
    expect(sprites.byPath.get('/sprites/items/97.png')).toMatchObject({ ref: 'i:97' }) // the live view grew
    // a path no part lists: undefined (placeholder), no fetch
    await expect(sprites.load?.('/sprites/thumbs/bosses/113.png')).resolves.toBeUndefined()
    expect(part).toHaveBeenCalledTimes(2)
    // "items" = every item part
    await da.loadSpriteIndex(['items'])
    expect(part.mock.calls.filter(([f]) => f.startsWith('manifest.items.'))).toHaveLength(runtimeIndex.parts.filter((p) => p.dir === 'items').length)
  })

  it('the D3 lever is the index flag; a failed part is a retryable ChunkLoadError (fetch), not cached', async () => {
    const lever = await spriteAccess({ index: { ...runtimeIndex, fallbackMode: true } }).da.loadSpriteIndex()
    expect(lever.fallbackMode).toBe(true)
    const part = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockImplementation(async (file: string) => partFile(file))
    const da = createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => runtimeIndex }, shardImporters: { 'sprite-part': part } })
    const error = await da.loadSpriteIndex(['bosses']).catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'ChunkLoadError', file: 'manifest.bosses.json', moduleImport: false })
    await expect(da.loadSpriteIndex(['bosses'])).resolves.toMatchObject({ fallbackMode: false })
    expect(part).toHaveBeenCalledTimes(2)
  })

  it('a complete manifest (tests, legacy) is a whole index: no part is ever fetched', async () => {
    const part = vi.fn()
    const da = createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => spriteManifest }, shardImporters: { 'sprite-part': part } })
    const sprites = await da.loadSpriteIndex(['weapons', 'items'])
    expect(sprites.byPath.size).toBe(spriteManifest.files.length)
    await expect(sprites.load?.('/sprites/items/97.png')).resolves.toMatchObject({ ref: 'i:97' })
    expect(part).not.toHaveBeenCalled()
  })
})
