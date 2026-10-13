/**
 * Weapon Lab honesty downgrades, applied during validate.
 *
 * 1. §2.1 rule 3 (pre-parse): a weapon whose `labBehavior.kind === "archetype"` has any
 *    sim-required field (see `simRequiredWeaponFields`) or any `labBehavior.*` path listed
 *    in `_prov.unverifiedFields` is downgraded to a limitation BEFORE strict parsing. This is
 *    what lets the merge stage hand over archetype candidates whose params could not be
 *    verified (absent + listed) without ever emitting an invented value.
 * 2. AMENDMENTS-001 A1 (demoted rule 10, post-parse): a weapon whose ammoClass matches no
 *    `Item.ammoStats.ammoClass` is a WARNING and its labBehavior is downgraded with reason
 *    "compatible ammo data unverified" — never build-fatal.
 */
import { isCoveredBy, simRequiredWeaponFields, type Archetype, type Item, type LabBehavior, type Weapon } from '../../src/schemas'
import type { PipelineWarning } from './errors'

const ARCHETYPES: readonly string[] = [
  'swing-melee',
  'thrust',
  'returning',
  'bow-gun',
  'magic-bolt',
  'piercing-beam',
  'minion-sentry',
  'whip',
  'explosive-aoe',
] satisfies readonly Archetype[]

export const AMMO_UNVERIFIED_REASON = 'compatible ammo data unverified'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function limitation(record: { name?: unknown; behaviorText?: unknown; wikiUrl?: unknown }, reason: string): LabBehavior {
  const name = typeof record.name === 'string' ? record.name : 'this weapon'
  const inGameBehavior =
    typeof record.behaviorText === 'string' && record.behaviorText.length > 0
      ? record.behaviorText
      : `See the ${name} wiki page for its in-game behavior.`
  return { kind: 'limitation', inGameBehavior, reason, sourceUrl: String(record.wikiUrl) }
}

/** Unverified listed paths that block simulation of this archetype. */
export function blockingUnverifiedFields(archetype: string, unverifiedFields: readonly string[]): string[] {
  const required = ARCHETYPES.includes(archetype) ? simRequiredWeaponFields(archetype as Archetype) : []
  return unverifiedFields.filter(
    (path) => path === 'labBehavior' || path.startsWith('labBehavior.') || required.some((f) => isCoveredBy([f], path)),
  )
}

/**
 * Pre-parse §2.1-3 downgrade on a raw (merged) weapon record. Returns the input untouched
 * when it is not an archetype weapon or is too malformed to judge (strict parse reports it).
 */
export function downgradeUnverifiedArchetype(raw: unknown): { record: unknown; warning?: PipelineWarning } {
  if (!isObject(raw) || !isObject(raw.labBehavior) || raw.labBehavior.kind !== 'archetype') return { record: raw }
  const params = raw.labBehavior.params
  const archetype = isObject(params) && typeof params.archetype === 'string' ? params.archetype : ''
  const prov = raw._prov
  const listed = isObject(prov) && Array.isArray(prov.unverifiedFields) ? prov.unverifiedFields.filter((p): p is string => typeof p === 'string') : []
  const blocking = blockingUnverifiedFields(archetype, listed)
  if (blocking.length === 0) return { record: raw }
  const reason = `required simulation parameter unverified: ${blocking.join(', ')}`
  return {
    record: { ...raw, labBehavior: limitation(raw, reason) },
    warning: { code: 'W_LAB_DOWNGRADE', ref: `i:${String(raw.id)}`, message: `labBehavior archetype "${archetype}" -> limitation (${reason})` },
  }
}

/** Post-parse A1 rule-10 check. Returns the (possibly downgraded) weapons and warnings. */
export function downgradeUnmatchedAmmo(weapons: readonly Weapon[], items: readonly Item[]): { weapons: Weapon[]; warnings: PipelineWarning[] } {
  const ammoClasses = new Set(items.flatMap((i) => (i.ammoStats ? [i.ammoStats.ammoClass] : [])))
  const warnings: PipelineWarning[] = []
  const out = weapons.map((weapon) => {
    const lab = weapon.labBehavior
    const declared = new Set<string>()
    if (weapon.ammoClass !== undefined) declared.add(weapon.ammoClass)
    if (lab.kind === 'archetype' && lab.params.archetype === 'bow-gun') declared.add(lab.params.ammoClass)
    const unmatched = [...declared].filter((c) => !ammoClasses.has(c))
    if (unmatched.length === 0) return weapon
    const ref = `i:${weapon.id}`
    const downgrade = lab.kind !== 'limitation'
    warnings.push({
      code: 'W_AMMO_CLASS_UNMATCHED',
      ref,
      message: `ammoClass ${unmatched.map((c) => `"${c}"`).join(', ')} matches no Item.ammoStats.ammoClass${
        downgrade ? ` — labBehavior "${lab.kind}" -> limitation (${AMMO_UNVERIFIED_REASON})` : ''
      } (A1 rule 10)`,
    })
    return downgrade ? { ...weapon, labBehavior: limitation(weapon, AMMO_UNVERIFIED_REASON) } : weapon
  })
  return { weapons: out, warnings }
}
