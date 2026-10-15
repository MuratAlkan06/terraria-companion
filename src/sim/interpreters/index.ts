/**
 * Archetype interpreter registry: one module + one entry per archetype — the kernel (`../world.ts`)
 * never switches on archetype. Every schema archetype is registered since P3-S11 (explosive-aoe); an
 * absent entry would make the guard answer `not-simulable / archetype-not-implemented` (never a guess).
 * Registering an archetype is also what flips the pipeline's recorded "params complete, pending
 * interpreter" weapons to simulable on the next `npm run pipeline:build` (AMENDMENTS-013 B61).
 */
import type { Archetype } from '../../schemas'
import type { ArchetypeInterpreter } from '../contracts'
import { bowGun } from './bowGun'
import { explosiveAoe } from './explosiveAoe'
import { magicBolt } from './magicBolt'
import { minionSentry } from './minionSentry'
import { piercingBeam } from './piercingBeam'
import { returning } from './returning'
import { swingMelee } from './swingMelee'
import { thrust } from './thrust'
import { whip } from './whip'

export type InterpreterRegistry = { readonly [A in Archetype]?: ArchetypeInterpreter<A> }

export const INTERPRETERS: InterpreterRegistry = {
  'swing-melee': swingMelee,
  thrust,
  'bow-gun': bowGun,
  'magic-bolt': magicBolt,
  returning,
  'piercing-beam': piercingBeam,
  'minion-sentry': minionSentry,
  whip,
  'explosive-aoe': explosiveAoe,
}

export function interpreterFor<A extends Archetype>(archetype: A): ArchetypeInterpreter<A> | undefined {
  return INTERPRETERS[archetype] as ArchetypeInterpreter<A> | undefined
}

export const IMPLEMENTED_ARCHETYPES: readonly Archetype[] = Object.keys(INTERPRETERS) as Archetype[]
