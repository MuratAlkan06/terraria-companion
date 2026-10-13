/**
 * Archetype interpreter registry. The remaining schema archetypes (returning, piercing-beam,
 * minion-sentry, whip, explosive-aoe) slot in by adding a module + an entry here — the kernel
 * (`../world.ts`) never switches on archetype. Absent entries make the guard answer
 * `not-simulable / archetype-not-implemented` (never a guess).
 */
import type { Archetype } from '../../schemas'
import type { ArchetypeInterpreter } from '../contracts'
import { bowGun } from './bowGun'
import { magicBolt } from './magicBolt'
import { swingMelee } from './swingMelee'
import { thrust } from './thrust'

export type InterpreterRegistry = { readonly [A in Archetype]?: ArchetypeInterpreter<A> }

export const INTERPRETERS: InterpreterRegistry = {
  'swing-melee': swingMelee,
  thrust,
  'bow-gun': bowGun,
  'magic-bolt': magicBolt,
}

export function interpreterFor<A extends Archetype>(archetype: A): ArchetypeInterpreter<A> | undefined {
  return INTERPRETERS[archetype] as ArchetypeInterpreter<A> | undefined
}

export const IMPLEMENTED_ARCHETYPES: readonly Archetype[] = Object.keys(INTERPRETERS) as Archetype[]
