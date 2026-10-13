/**
 * `npm run pipeline:validate` — runs the validate stage over a dataset directory and, on
 * success, writes meta.json + gaps.json for it.
 *
 *   tsx pipeline/cli/validate.ts [--dataset <dir>] [--out <dir>]
 *
 * Defaults: --dataset pipeline/fixtures/sample, --out pipeline/out/<manifest name>.
 * Exit code 0 = pass, 1 = validation failed, 2 = usage error.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { formatError, formatWarning, loadDatasetDir, validateDataset } from '../validate'

const repoRoot = resolve(import.meta.dirname, '..', '..')

function main(): number {
  let values: { dataset?: string; out?: string }
  try {
    ;({ values } = parseArgs({ options: { dataset: { type: 'string' }, out: { type: 'string' } }, strict: true }))
  } catch (error) {
    console.error(`usage: tsx pipeline/cli/validate.ts [--dataset <dir>] [--out <dir>]\n${(error as Error).message}`)
    return 2
  }
  const datasetDir = resolve(values.dataset ?? join(repoRoot, 'pipeline/fixtures/sample'))
  const shown = relative(process.cwd(), datasetDir) || '.'

  const loaded = loadDatasetDir(datasetDir)
  const result = loaded.errors.length > 0 ? { ok: false as const, errors: loaded.errors, warnings: [] } : validateDataset(loaded.raw)

  console.log(`pipeline:validate — ${shown}`)
  if (result.warnings.length > 0) {
    console.log(`warnings (${result.warnings.length}):`)
    for (const w of result.warnings) console.log(`  ${formatWarning(w)}`)
  }
  if (!result.ok) {
    console.error(`FAIL — ${result.errors.length} error(s):`)
    for (const e of result.errors) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    return 1
  }

  const { manifest, gaps, meta } = result
  const outDir = resolve(values.out ?? join(repoRoot, 'pipeline/out', manifest.name))
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
  console.log(`verified records: ${verified}/${total}`)
  console.log(`lab coverage: archetype ${lab.archetype}, custom-scenario ${lab.customScenario}, limitation ${lab.limitation}, unhandled ${lab.unhandled}`)
  console.log(
    `gaps: ${meta.gapSummary.total} (${Object.entries(meta.gapSummary.byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')})`,
  )
  console.log(`PASS — wrote ${relative(process.cwd(), join(outDir, 'meta.json'))}, ${relative(process.cwd(), join(outDir, 'gaps.json'))}`)
  return 0
}

process.exitCode = main()
