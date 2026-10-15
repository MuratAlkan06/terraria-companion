/* M7: production builds ship React Router's production build, not its dev-warning build. B127: the bundled library
 * license texts. B131(e): the initial-JS budget (ADR-001 D7), enforced on the same in-memory production build. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build, resolveConfig, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import { LIBRARY_LICENSES_FILE, REACT_ROUTER_PRODUCTION_ALIASES } from './vite.config.ts'

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url))
/** Strings that exist only inside React Router's `if (ENABLE_DEV_WARNINGS)` blocks. */
const DEV_ONLY_MARKERS = ['You rendered descendant <Routes>', 'You should not include both `Component` and `element`', 'No routes matched location']

const routerAliases = (alias: readonly { find: string | RegExp }[]) => alias.filter((a) => String(a.find).includes('react-router'))

/**
 * One in-memory production build, shared by the checks below. Vitest runs with NODE_ENV=test, and Vite never
 * overrides a NODE_ENV that is already set — the build would bundle React's development files (~70 kB gz more than
 * `npm run build` ships). NODE_ENV is "production" while it builds, as under `vite build`, then restored.
 */
let built: Promise<(Rollup.OutputChunk | Rollup.OutputAsset)[]> | undefined
function productionBuild() {
  if (!built) {
    const nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    built = build({ configFile, logLevel: 'silent', build: { write: false, copyPublicDir: false } })
      .then((output) => {
        const outputs = output as Rollup.RollupOutput | Rollup.RollupOutput[]
        return (Array.isArray(outputs) ? outputs : [outputs]).flatMap((o) => o.output)
      })
      .finally(() => {
        process.env.NODE_ENV = nodeEnv
      })
  }
  return built
}

describe('React Router build selection (vite.config.ts)', () => {
  it('aliases react-router and react-router/dom to the package’s production files for builds only', async () => {
    const buildConfig = await resolveConfig({ configFile, logLevel: 'silent' }, 'build', 'production')
    const aliases = routerAliases(buildConfig.resolve.alias)
    expect(aliases.map((a) => String(a.find))).toEqual(['/^react-router$/', '/^react-router\\/dom$/'])
    for (const { replacement } of REACT_ROUTER_PRODUCTION_ALIASES) {
      expect(replacement).toMatch(/[\\/]dist[\\/]production[\\/][a-z-]+\.mjs$/)
      expect(existsSync(replacement)).toBe(true)
    }
    const serveConfig = await resolveConfig({ configFile, logLevel: 'silent' }, 'serve', 'development')
    expect(routerAliases(serveConfig.resolve.alias)).toEqual([])
  })

  it('the production build contains none of React Router’s dev-only warnings', { timeout: 60_000 }, async () => {
    // Sanity: the markers do exist in the development build (so their absence below means something).
    const devEntry = fileURLToPath(import.meta.resolve('react-router'))
    expect(devEntry).toMatch(/[\\/]dist[\\/]development[\\/]/)
    const devDir = dirname(devEntry)
    const devCode = readdirSync(devDir)
      .filter((f) => /^chunk-.*\.mjs$/.test(f))
      .map((f) => readFileSync(join(devDir, f), 'utf8'))
      .join('\n')
    for (const marker of DEV_ONLY_MARKERS) expect(devCode).toContain(marker)

    const chunks = (await productionBuild()).filter((f): f is Rollup.OutputChunk => f.type === 'chunk')
    expect(chunks.some((c) => c.isEntry)).toBe(true)
    const code = chunks.map((c) => c.code).join('\n')
    for (const marker of DEV_ONLY_MARKERS) expect(code).not.toContain(marker)
  })
})

describe('bundled library license texts (build.license, AMENDMENTS-016 B127)', () => {
  it('the build is configured to emit them under the name the Licensing page links (licensing.test.ts pins the page side)', async () => {
    const buildConfig = await resolveConfig({ configFile, logLevel: 'silent' }, 'build', 'production')
    expect(buildConfig.build.license).toEqual({ fileName: LIBRARY_LICENSES_FILE })
    expect(LIBRARY_LICENSES_FILE).toBe('licenses/third-party-software.txt')
  })

  it('every runtime dependency is in the generated file, each entry with its license text', { timeout: 60_000 }, async () => {
    const asset = (await productionBuild()).find((f): f is Rollup.OutputAsset => f.type === 'asset' && f.fileName === LIBRARY_LICENSES_FILE)
    expect(asset).toBeDefined()
    // "## <name> - <version> (<license id>)", then the package's license text
    const entries = new Map(
      String(asset?.source)
        .split(/^## /m)
        .slice(1)
        .map((section) => {
          const [heading, ...body] = section.split('\n')
          return [heading.split(' - ')[0], body.join('\n').trim() !== ''] as const
        }),
    )
    const deps = Object.keys((JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies)
    for (const dep of deps) {
      // an umbrella package (radix-ui) ships as its scoped parts (@radix-ui/react-dialog, …)
      const own = [...entries.keys()].filter((name) => name === dep || name.startsWith(`@${dep}/`))
      expect(own, dep).not.toEqual([])
      for (const name of own) expect(entries.get(name), name).toBe(true)
    }
  })
})

/**
 * ADR-001 D7 "initial route JS ≤ 200 KB gz", enforced (AMENDMENTS-016 B131(e)). Measured on the SAME in-memory
 * production build as the checks above — never on a `dist/` folder that may be stale or missing — so the number is
 * always the code this commit ships:
 * - the initial JS is the entry graph: every entry chunk (index.html's script — the shell + `/`, UX_SPEC §1) plus
 *   every chunk it STATICALLY imports, transitively (the files the browser must fetch before first render — Vite
 *   preloads exactly these). Dynamic imports (route chunks, data files, PixiJS) are lazy and not counted;
 * - each file is gzipped with Node's zlib at its default level — the same measure as Vite's own build report
 *   ("gzip: … kB"), whose kB are 1,000 bytes, so the budget is 200,000 bytes (the stricter reading of "200 KB").
 * CSS has its own budget (D7: 30 KB gz) and is not part of this number.
 */
export const INITIAL_JS_BUDGET_GZ_BYTES = 200_000

/** The entry graph's chunks (see above), each with its gzipped size. */
export function initialJsGraph(files: readonly (Rollup.OutputChunk | Rollup.OutputAsset)[]): { fileName: string; gz: number }[] {
  const chunks = new Map(files.filter((f): f is Rollup.OutputChunk => f.type === 'chunk').map((c) => [c.fileName, c]))
  const queue = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName)
  const seen = new Set<string>()
  while (queue.length > 0) {
    const name = queue.shift() as string
    if (seen.has(name)) continue
    seen.add(name)
    for (const next of chunks.get(name)?.imports ?? []) queue.push(next)
  }
  return [...seen].map((fileName) => ({ fileName, gz: gzipSync(chunks.get(fileName)?.code ?? '').length }))
}

describe('initial-JS budget (ADR-001 D7; AMENDMENTS-016 B131(e))', () => {
  it('the entry graph — entry chunk + its static imports — stays within 200 KB gz; no lazy section leaks into it', { timeout: 60_000 }, async () => {
    const graph = initialJsGraph(await productionBuild())
    const total = graph.reduce((n, f) => n + f.gz, 0)
    const report = graph
      .sort((a, b) => b.gz - a.gz)
      .map((f) => `${f.fileName} ${(f.gz / 1000).toFixed(1)} kB`)
      .join(', ')
    // The measure itself is sound: an entry exists and the graph holds real code (React alone is tens of kB gz).
    expect(graph.length).toBeGreaterThan(0)
    expect(total).toBeGreaterThan(50_000)
    // Lazy sections stay lazy (UX_SPEC §1, ADR D7): no route chunk, no data file, never the Lab's renderer.
    expect(graph.map((f) => f.fileName).filter((n) => /(^|\/)(chunk-|arena-|browserAll-|WebGLRenderer-|WebGPURenderer-)/.test(n))).toEqual([])
    expect(total, `initial JS ${(total / 1000).toFixed(1)} kB gz over ${INITIAL_JS_BUDGET_GZ_BYTES / 1000} kB: ${report}`).toBeLessThanOrEqual(INITIAL_JS_BUDGET_GZ_BYTES)
  })

  it('initialJsGraph counts static imports transitively and never a dynamic import', () => {
    const chunk = (fileName: string, isEntry: boolean, imports: string[], dynamicImports: string[], code: string) =>
      ({ type: 'chunk', fileName, isEntry, imports, dynamicImports, code }) as unknown as Rollup.OutputChunk
    const files = [
      chunk('entry.js', true, ['shared.js'], ['lazy.js'], 'a'.repeat(100)),
      chunk('shared.js', false, ['deep.js'], [], 'b'),
      chunk('deep.js', false, ['shared.js'], [], 'c'),
      chunk('lazy.js', false, ['lazy-dep.js'], [], 'd'),
      chunk('lazy-dep.js', false, [], [], 'e'),
    ]
    expect(initialJsGraph(files).map((f) => f.fileName).sort()).toEqual(['deep.js', 'entry.js', 'shared.js'])
    expect(initialJsGraph(files).every((f) => f.gz > 0)).toBe(true)
  })
})
