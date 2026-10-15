/**
 * ADR-001 D5 layer 2 + D7 lazy boundary (P3-S1): PixiJS is lazy-loaded ONLY on the Lab route.
 *
 * Static source scan of every shipped module under src/ (tests excluded):
 * 1. Only src/lab/arena/ imports PixiJS.
 * 2. src/lab/arena/ is reached only through ArenaCanvas's dynamic `import()` (type-only imports
 *    are erased and allowed), so even the Lab chunk loads the renderer on demand.
 * 3. src/app/routes/lab/ (chunk-lab) is reached only through the route registry's dynamic import,
 *    so no other route (or the entry chunk) ever pulls Lab UI code.
 * The build-output check (chunk sizes) is reported per slice; this test keeps the graph honest.
 */
import { describe, expect, it } from 'vitest'

const raw = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.ts', '!../**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** POSIX-style join + normalize ("src/lab" + "../app/x.ts" → "src/app/x.ts"). */
function join(dir: string, relative: string): string {
  const out: string[] = []
  for (const part of `${dir}/${relative}`.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}
const dirname = (file: string) => file.slice(0, file.lastIndexOf('/'))

/** Glob keys are relative to src/lab; normalize to repo paths ("src/app/routes.tsx"). */
const files = new Map(Object.entries(raw).map(([key, text]) => [join('src/lab', key), text]))

type ImportKind = 'type' | 'static' | 'dynamic'
interface ImportRef {
  spec: string
  kind: ImportKind
}

function importsOf(text: string): ImportRef[] {
  const refs: ImportRef[] = []
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    refs.push({ spec: m[2], kind: m[1] ? 'type' : 'static' })
  }
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push({ spec: m[1], kind: 'dynamic' })
  return refs
}

/** Relative specifier → the repo file it names (or the bare specifier for packages). */
function resolve(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec
  const base = join(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(candidate)) return candidate
  }
  return base
}

const graph = [...files].flatMap(([file, text]) => importsOf(text).map((ref) => ({ file, ...ref, target: resolve(file, ref.spec) })))

const ARENA = 'src/lab/arena/'
const CHUNK_LAB = 'src/app/routes/lab/'
const isPixi = (spec: string) => /^(pixi\.js|@pixi\/)/.test(spec)

describe('PixiJS lazy boundary (ADR-001 D5/D7)', () => {
  it('scans the whole app source tree', () => {
    expect(files.size).toBeGreaterThan(100)
    expect(files.has('src/app/routes.tsx')).toBe(true)
    expect(files.has('src/lab/arena/index.ts')).toBe(true)
  })

  it('only src/lab/arena/ imports PixiJS', () => {
    const importers = graph.filter((e) => isPixi(e.spec)).map((e) => e.file)
    expect(importers.length).toBeGreaterThan(0)
    for (const file of importers) expect(file.startsWith(ARENA), `${file} imports PixiJS`).toBe(true)
  })

  it('the renderer is reached only by ArenaCanvas’s dynamic import (type imports are erased)', () => {
    const intoArena = graph.filter((e) => e.target.startsWith(ARENA) && !e.file.startsWith(ARENA))
    const dynamic = intoArena.filter((e) => e.kind === 'dynamic')
    expect(dynamic.map((e) => e.file)).toEqual(['src/app/routes/lab/ArenaCanvas.tsx'])
    for (const e of intoArena.filter((e) => e.kind === 'static')) expect.fail(`${e.file} statically imports ${e.spec}`)
  })

  it('chunk-lab is reached only by the route registry’s dynamic import', () => {
    const intoLab = graph.filter((e) => e.target.startsWith(CHUNK_LAB) && !e.file.startsWith(CHUNK_LAB))
    expect(intoLab.filter((e) => e.kind === 'dynamic').map((e) => [e.file, e.target])).toEqual([
      ['src/app/routes.tsx', 'src/app/routes/lab/chunk-lab.ts'],
    ])
    for (const e of intoLab.filter((e) => e.kind !== 'dynamic')) expect.fail(`${e.file} imports ${e.spec} outside the lazy boundary`)
  })

  it('other routes reach the Lab only through labLinks.ts, which loads nothing at runtime (no sim, no Zod)', () => {
    const shared = graph.filter((e) => e.target.startsWith('src/lab/') && !e.file.startsWith('src/lab/') && !e.file.startsWith(CHUNK_LAB))
    expect(shared.length).toBeGreaterThan(0)
    for (const e of shared) expect(e.kind === 'type' || e.target === 'src/lab/labLinks.ts', `${e.file} imports ${e.spec}`).toBe(true)
    const own = graph.filter((e) => e.file === 'src/lab/labLinks.ts')
    expect(own.length).toBeGreaterThan(0)
    for (const e of own) expect(e.kind, `labLinks.ts imports ${e.spec} at runtime`).toBe('type')
  })
})
