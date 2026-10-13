/**
 * `npm run pipeline:validate` — runs the validate stage over dataset directories and, on
 * success, writes meta.json + gaps.json for each to pipeline/out/<manifest name>/ (gitignored).
 *
 *   tsx pipeline/cli/validate.ts [--dataset <dir>] [--out <dir>]
 *
 * Defaults: the emitted app dataset (src/data, when it has a dataset.json manifest) AND the
 * P2-S1 sample (pipeline/fixtures/sample). When a dataset directory carries committed
 * meta.json/gaps.json (src/data does), they must equal what validate recomputes (using the
 * committed generatedAt) — stale outputs fail, so data cannot drift from its reports.
 * Exit code 0 = pass, 1 = validation failed, 2 = usage error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { formatError, formatWarning, loadDatasetDir, validateDataset } from '../validate'

const repoRoot = resolve(import.meta.dirname, '..', '..')

function readJsonIfExists(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined
}

function validateDir(datasetDir: string, outOverride?: string): number {
  const shown = relative(process.cwd(), datasetDir) || '.'
  const loaded = loadDatasetDir(datasetDir)
  const committedMeta = readJsonIfExists(join(datasetDir, 'meta.json')) as { generatedAt?: string } | undefined
  const committedGaps = readJsonIfExists(join(datasetDir, 'gaps.json'))
  const now = committedMeta?.generatedAt ? new Date(committedMeta.generatedAt) : new Date()
  const result = loaded.errors.length > 0 ? { ok: false as const, errors: loaded.errors, warnings: [] } : validateDataset(loaded.raw, { now })

  console.log(`pipeline:validate — ${shown}`)
  if (result.warnings.length > 0) {
    console.log(`warnings (${result.warnings.length}):`)
    for (const w of result.warnings.slice(0, 25)) console.log(`  ${formatWarning(w)}`)
    if (result.warnings.length > 25) console.log(`  … ${result.warnings.length - 25} more`)
  }
  if (!result.ok) {
    console.error(`FAIL — ${result.errors.length} error(s):`)
    for (const e of result.errors.slice(0, 50)) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    if (result.errors.length > 50) console.error(`  … ${result.errors.length - 50} more`)
    return 1
  }

  const { manifest, gaps, meta } = result
  const stale: string[] = []
  if (committedMeta !== undefined && !isDeepStrictEqual(committedMeta, meta)) stale.push('meta.json')
  if (committedGaps !== undefined && !isDeepStrictEqual(committedGaps, gaps)) stale.push('gaps.json')
  if (stale.length > 0) {
    console.error(`FAIL — committed ${stale.join(' + ')} in ${shown} do not match the data (rerun npm run pipeline:build)`)
    return 1
  }

  const outDir = resolve(outOverride ?? join(repoRoot, 'pipeline/out', manifest.name))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  writeFileSync(join(outDir, 'gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`)

  const total = Object.values(meta.counts).reduce((a, b) => a + b, 0)
  const counts = Object.entries(meta.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
  const lab = gaps.summary.labCoverage
  const verified = Object.values(gaps.summary.perEntity).reduce((a, e) => a + e.verified, 0)
  console.log(`dataset "${manifest.name}": ${total} records (${counts})`)
  if (manifest.partial) console.log(`partial dataset: item universe ${manifest.partial.itemUniverse ? 'yes' : 'no'}; pending ${manifest.partial.pending.join(', ')}`)
  console.log(`verified records: ${verified}/${total}`)
  console.log(`lab coverage: archetype ${lab.archetype}, custom-scenario ${lab.customScenario}, limitation ${lab.limitation}, unhandled ${lab.unhandled}`)
  console.log(
    `gaps: ${meta.gapSummary.total} (${Object.entries(meta.gapSummary.byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')})`,
  )
  if (committedMeta !== undefined) console.log('committed meta.json + gaps.json are up to date')
  console.log(`PASS — wrote ${relative(process.cwd(), join(outDir, 'meta.json'))}, ${relative(process.cwd(), join(outDir, 'gaps.json'))}`)
  return 0
}

function main(): number {
  let values: { dataset?: string; out?: string }
  try {
    ;({ values } = parseArgs({ options: { dataset: { type: 'string' }, out: { type: 'string' } }, strict: true }))
  } catch (error) {
    console.error(`usage: tsx pipeline/cli/validate.ts [--dataset <dir>] [--out <dir>]\n${(error as Error).message}`)
    return 2
  }
  if (values.dataset !== undefined) return validateDir(resolve(values.dataset), values.out)
  if (values.out !== undefined) {
    console.error('usage: --out requires --dataset')
    return 2
  }
  const dirs = [join(repoRoot, 'src/data'), join(repoRoot, 'pipeline/fixtures/sample')].filter((d) => existsSync(join(d, 'dataset.json')))
  let code = 0
  for (const dir of dirs) {
    code = Math.max(code, validateDir(dir))
    console.log('')
  }
  return code
}

process.exitCode = main()
