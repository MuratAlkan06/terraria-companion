/* M7: production builds ship React Router's production build, not its dev-warning build. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, resolveConfig, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import { LIBRARY_LICENSES_FILE, REACT_ROUTER_PRODUCTION_ALIASES } from './vite.config.ts'

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url))
/** Strings that exist only inside React Router's `if (ENABLE_DEV_WARNINGS)` blocks. */
const DEV_ONLY_MARKERS = ['You rendered descendant <Routes>', 'You should not include both `Component` and `element`', 'No routes matched location']

const routerAliases = (alias: readonly { find: string | RegExp }[]) => alias.filter((a) => String(a.find).includes('react-router'))

/** One in-memory production build, shared by the checks below. */
let built: Promise<(Rollup.OutputChunk | Rollup.OutputAsset)[]> | undefined
function productionBuild() {
  built ??= build({ configFile, logLevel: 'silent', build: { write: false, copyPublicDir: false } }).then((output) => {
    const outputs = output as Rollup.RollupOutput | Rollup.RollupOutput[]
    return (Array.isArray(outputs) ? outputs : [outputs]).flatMap((o) => o.output)
  })
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
