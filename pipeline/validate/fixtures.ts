/**
 * §7a-13 fixtures — PRD P2-S6 AC1/AC3 as build-failing data checks (E_FIXTURE{name}). They run
 * whenever the dataset produces the progression graph (bosses/nodes/edges not `pending`). A dataset
 * that is a deliberate subset (the P2-S1 sample) restricts them with `manifest.fixtures`; absent =
 * every fixture applies. (The fourth §7a-13 fact — weapon count reconciled against the wiki
 * category — is the gap report's reconciliation table, P2-S2 AC1.)
 */
import type { Dataset } from './dataset'
import type { PipelineError } from './errors'
import { requiredGateUpstream } from './graph'

/** REQUIREMENTS §6 bosses (EoW / BoC = world-evil alternatives). */
export const REQUIREMENTS_BOSSES = [
  'king-slime', 'eye-of-cthulhu', 'eater-of-worlds', 'brain-of-cthulhu', 'queen-bee', 'skeletron', 'deerclops', 'wall-of-flesh',
  'queen-slime', 'the-twins', 'the-destroyer', 'skeletron-prime', 'plantera', 'golem', 'empress-of-light', 'duke-fishron',
  'lunatic-cultist', 'moon-lord',
] as const
export const MECHANICAL_BOSSES = ['the-twins', 'the-destroyer', 'skeletron-prime'] as const

export const FIXTURES = {
  'requirements-bosses': 'every REQUIREMENTS §6 boss is a Boss record with a boss node; Eater of Worlds / Brain of Cthulhu carry worldEvil corruption / crimson',
  'wall-of-flesh-gates-hardmode': 'wall-of-flesh --required-gate--> hardmode (a milestone node)',
  'plantera-requires-all-mechs': 'plantera has a required-gate path from each of the-twins, the-destroyer and skeletron-prime',
  'deerclops-queen-bee-optional': 'deerclops and queen-bee are optional: an optional edge reaches each, and neither has a required-gate edge into the progression line',
} as const
export type FixtureName = keyof typeof FIXTURES
export const FIXTURE_NAMES = Object.keys(FIXTURES) as [FixtureName, ...FixtureName[]]

export function checkFixtures(ds: Pick<Dataset, 'bosses' | 'nodes' | 'edges'>, names: readonly FixtureName[] = FIXTURE_NAMES): PipelineError[] {
  const errors: PipelineError[] = []
  const fail = (name: FixtureName, detail: string) => errors.push({ code: 'E_FIXTURE', name, message: `fixture ${name} (${FIXTURES[name]}): ${detail}` })
  const nodes = new Map(ds.nodes.map((n) => [n.id, n]))
  const bosses = new Map(ds.bosses.map((b) => [b.id, b]))
  const has = (from: string, to: string, type: string) => ds.edges.some((e) => e.from === from && e.to === to && e.type === type)

  for (const name of names) {
    switch (name) {
      case 'requirements-bosses': {
        for (const id of REQUIREMENTS_BOSSES) {
          if (!bosses.has(id)) fail(name, `boss:${id} missing`)
          if (nodes.get(id)?.kind !== 'boss') fail(name, `node:${id} missing or not a boss node`)
        }
        if (bosses.get('eater-of-worlds')?.worldEvil !== 'corruption') fail(name, 'boss:eater-of-worlds worldEvil is not corruption')
        if (bosses.get('brain-of-cthulhu')?.worldEvil !== 'crimson') fail(name, 'boss:brain-of-cthulhu worldEvil is not crimson')
        break
      }
      case 'wall-of-flesh-gates-hardmode': {
        if (nodes.get('wall-of-flesh')?.kind !== 'boss') fail(name, 'node:wall-of-flesh missing or not a boss node')
        if (nodes.get('hardmode')?.kind !== 'milestone') fail(name, 'node:hardmode missing or not a milestone')
        if (!has('wall-of-flesh', 'hardmode', 'required-gate')) fail(name, 'no required-gate edge wall-of-flesh -> hardmode')
        break
      }
      case 'plantera-requires-all-mechs': {
        const upstream = requiredGateUpstream(ds.nodes, ds.edges).get('plantera')
        if (!upstream) fail(name, 'node:plantera missing')
        else for (const m of MECHANICAL_BOSSES) if (!upstream.has(m)) fail(name, `no required-gate path ${m} -> plantera`)
        break
      }
      case 'deerclops-queen-bee-optional': {
        for (const id of ['deerclops', 'queen-bee']) {
          if (nodes.get(id)?.kind !== 'boss') fail(name, `node:${id} missing or not a boss node`)
          const out = ds.edges.filter((e) => e.from === id && e.type === 'required-gate')
          if (out.length > 0) fail(name, `node:${id} has required-gate edge(s) into ${out.map((e) => `node:${e.to}`).join(', ')}`)
          if (!ds.edges.some((e) => e.to === id && e.type === 'optional')) fail(name, `no optional edge reaches node:${id}`)
        }
        break
      }
    }
  }
  return errors
}
