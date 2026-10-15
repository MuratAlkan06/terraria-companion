/**
 * Re-pins the P3-S13 Weapon Lab goldens (labCoverage.ts B115 (b); AMENDMENTS-008 B38 discipline).
 *
 *   npx tsx pipeline/validate/pinLabGoldens.ts
 *
 * Validates each pinned dataset and applies exactly what the gate reports: a missing or failing golden takes
 * the fingerprint the weapon produces now (the error's `computed`), a stale one is removed, every passing pin
 * is kept as is. Any other validation error aborts with nothing written. Never touches the floor (raised by
 * hand — labCoverage.ts). Run it only for an intended engine or data change, and say why in the
 * src/sim/README.md changelog.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatError, loadDatasetDir, validateDataset } from './index'
import { LAB_COVERAGE_PINS, type LabGolden } from './labCoverage'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const GOLDENS_FILE = join(import.meta.dirname, 'labGoldens.json')
/** Dataset directories whose manifests may be pinned (the emitted app dataset). */
const DATASET_DIRS = [join(repoRoot, 'src/data')]

/** Canonical key order, so a re-pin diff shows only changed values. */
const canonical = (g: LabGolden): LabGolden => ({ ...(g.ammo !== undefined ? { ammo: g.ammo } : {}), total: g.total, dot: g.dot, hits: g.hits, crits: g.crits, uses: g.uses, digest: g.digest })

/** One golden per line, ids ascending. */
export function serializeGoldens(all: Readonly<Record<string, Readonly<Record<string, LabGolden>>>>): string {
  const sections = Object.keys(all)
    .sort()
    .map((name) => {
      const ids = Object.keys(all[name]).sort((a, b) => Number(a) - Number(b))
      const body = ids.length === 0 ? '{}' : `{\n${ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(canonical(all[name][id]))}`).join(',\n')}\n  }`
      return `  ${JSON.stringify(name)}: ${body}`
    })
  return `{\n${sections.join(',\n')}\n}\n`
}

function main(): number {
  const all = JSON.parse(readFileSync(GOLDENS_FILE, 'utf8')) as Record<string, Record<string, LabGolden>>
  let changed = 0
  for (const dir of DATASET_DIRS) {
    const loaded = loadDatasetDir(dir)
    if (loaded.errors.length > 0) {
      for (const e of loaded.errors) console.error(formatError(e))
      return 1
    }
    const name = (loaded.raw.manifest as { name?: string } | undefined)?.name ?? ''
    if (!LAB_COVERAGE_PINS[name]) continue
    const result = validateDataset(loaded.raw)
    if (result.ok) {
      console.log(`${name}: every golden passes — nothing to pin`)
      continue
    }
    const golden = result.errors.flatMap((e) => (e.code === 'E_LAB_COVERAGE' && e.rule !== 'simulable-floor' ? [e] : []))
    const other = result.errors.filter((e) => !(e.code === 'E_LAB_COVERAGE' && e.rule !== 'simulable-floor'))
    if (other.length > 0) {
      console.error(`${name}: FAIL — ${other.length} other validation error(s); nothing written:`)
      for (const e of other.slice(0, 20)) console.error(`  ${formatError(e)}`)
      return 1
    }
    const unpinnable = golden.filter((e) => e.rule === 'golden' && !e.computed)
    if (unpinnable.length > 0) {
      console.error(`${name}: FAIL — ${unpinnable.length} weapon(s) can't be pinned; nothing written:`)
      for (const e of unpinnable) console.error(`  ${e.message}`)
      return 1
    }
    const pins = { ...(all[name] ?? {}) }
    for (const e of golden) {
      const id = e.ref.replace(/^i:/, '')
      if (e.rule === 'stale-golden') delete pins[id]
      else if (e.computed) pins[id] = e.computed
      console.log(`  ${e.message}`)
      changed += 1
    }
    all[name] = pins
  }
  if (changed > 0) writeFileSync(GOLDENS_FILE, serializeGoldens(all))
  console.log(changed > 0 ? `re-pinned ${changed} golden(s) in ${GOLDENS_FILE}` : 'no change')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = main()
