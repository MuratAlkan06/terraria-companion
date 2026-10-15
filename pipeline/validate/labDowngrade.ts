/**
 * Weapon Lab honesty downgrades, applied during validate.
 *
 * 1. §2.1 rule 3 (pre-parse): a weapon whose `labBehavior.kind === "archetype"` has any
 *    sim-required field (see `simRequiredWeaponFields`) or any `labBehavior.*` path listed
 *    in `_prov.unverifiedFields` is downgraded to a limitation BEFORE strict parsing. This is
 *    what lets the merge stage hand over archetype candidates whose params could not be
 *    verified (absent + listed) without ever emitting an invented value.
 * 2. §7a-10 (post-parse, `checkAmmoClasses`): a weapon whose ammoClass matches no ammo record is
 *    build-failing once the ammo items are produced (P2-S7). While they are pending (partial
 *    datasets) the AMENDMENTS-001 A1 demotion applies: a WARNING and the labBehavior is downgraded
 *    with reason "compatible ammo data unverified".
 */
import { isCoveredBy, simRequiredWeaponFields, tooltipBehavior, type Archetype, type DamageClass, type Item, type LabBehavior, type Weapon } from '../../src/schemas'
import { danglingRef, type PipelineError, type PipelineWarning } from './errors'

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

/**
 * Limitation card. "What it does in-game" must be verified BEHAVIOR text (UX_SPEC §8): a reviewed,
 * quote-checked sentence of the weapon's article when the caller has one (lab-params overlay
 * `inGameBehavior`), else the tooltip's behavior lines — never its flavor-text line ("'Greetings,
 * programs!'", src/schemas tooltipBehavior) — else a pointer to the wiki page, which the app's
 * LimitationCard treats as no description (it states that none is verified, in its own wording).
 */
export function limitation(record: { name?: unknown; behaviorText?: unknown; wikiUrl?: unknown }, reason: string, behavior?: string): LabBehavior {
  const name = typeof record.name === 'string' ? record.name : 'this weapon'
  const tooltip = typeof record.behaviorText === 'string' ? tooltipBehavior(record.behaviorText) : undefined
  const inGameBehavior = behavior ?? tooltip ?? `See the ${name} wiki page for its in-game behavior.`
  return { kind: 'limitation', inGameBehavior, reason, sourceUrl: String(record.wikiUrl) }
}

/**
 * AMENDMENTS-010 B49: once labBehavior becomes a limitation its params are gone, so the record no
 * longer carries the modeled values `_prov.modeledFields` pointed at — drop those paths.
 */
function dropModeledLab<T>(prov: T): T {
  if (!isObject(prov) || !Array.isArray(prov.modeledFields)) return prov
  const { modeledFields, ...rest } = prov
  const kept = (modeledFields as unknown[]).filter((p) => !(typeof p === 'string' && (p === 'labBehavior' || p.startsWith('labBehavior.'))))
  return (kept.length > 0 ? { ...rest, modeledFields: kept } : rest) as T
}

/**
 * Unverified listed paths that block simulation of this archetype. `damageClass` (the record's, when
 * known): a classless weapon's critPct is not sim-required (src/schemas simRequiredWeaponFields, P3-S11).
 */
export function blockingUnverifiedFields(archetype: string, unverifiedFields: readonly string[], damageClass?: DamageClass): string[] {
  const required = ARCHETYPES.includes(archetype) ? simRequiredWeaponFields(archetype as Archetype, damageClass) : []
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
  const damageClass = typeof raw.damageClass === 'string' ? (raw.damageClass as DamageClass) : undefined
  const blocking = blockingUnverifiedFields(archetype, listed, damageClass)
  if (blocking.length === 0) return { record: raw }
  const reason = `required simulation parameter unverified: ${blocking.join(', ')}`
  return {
    record: { ...raw, labBehavior: limitation(raw, reason), _prov: dropModeledLab(raw._prov) },
    warning: { code: 'W_LAB_DOWNGRADE', ref: `i:${String(raw.id)}`, message: `labBehavior archetype "${archetype}" -> limitation (${reason})` },
  }
}

/**
 * Post-parse §7a-10 ammo-class check. The ammo records are the Items with `ammoStats` plus the
 * dual-role Weapons carrying `ammoStats` (Snowball).
 * - Items PRODUCED (P2-S7 on): a weapon ammoClass (or bow-gun params.ammoClass) that matches no ammo
 *   record is build-failing E_DANGLING_REF — the Lab ammo picker is non-empty by construction.
 * - Items PENDING (partial dataset, AMENDMENTS-001 A1 demotion): WARNING + downgrade of an archetype
 *   weapon to a limitation (the sim never consumes unverified ammo data); weapons that already are
 *   limitations get no per-weapon warning — their ammo classes are returned as `deferred` refs.
 */
export function checkAmmoClasses(
  weapons: readonly Weapon[],
  items: readonly Item[],
  itemsPending = false,
): { weapons: Weapon[]; warnings: PipelineWarning[]; deferred: Set<string>; errors: PipelineError[] } {
  const ammoClasses = new Set([...items, ...weapons].flatMap((i) => (i.ammoStats ? [i.ammoStats.ammoClass] : [])))
  const warnings: PipelineWarning[] = []
  const errors: PipelineError[] = []
  const deferred = new Set<string>()
  const out = weapons.map((weapon) => {
    const lab = weapon.labBehavior
    const declared = new Map<string, string>()
    if (weapon.ammoClass !== undefined) declared.set(weapon.ammoClass, 'ammoClass')
    if (lab.kind === 'archetype' && lab.params.archetype === 'bow-gun' && !declared.has(lab.params.ammoClass)) declared.set(lab.params.ammoClass, 'labBehavior.params.ammoClass')
    const unmatched = [...declared.keys()].filter((c) => !ammoClasses.has(c))
    if (unmatched.length === 0) return weapon
    const ref = `i:${weapon.id}`
    if (!itemsPending) {
      for (const c of unmatched) errors.push(danglingRef(ref, declared.get(c) as string, `ammoClass:${c}`, 'no ammo record (Item or Weapon ammoStats) has this ammo class (§7a-10)'))
      return weapon
    }
    const downgrade = lab.kind !== 'limitation'
    if (!downgrade) {
      for (const c of unmatched) deferred.add(c)
      return weapon
    }
    warnings.push({
      code: 'W_AMMO_CLASS_UNMATCHED',
      ref,
      message: `ammoClass ${unmatched.map((c) => `"${c}"`).join(', ')} matches no ammoStats.ammoClass while ammo items are pending — labBehavior "${lab.kind}" -> limitation (${AMMO_UNVERIFIED_REASON}) (A1 rule 10)`,
    })
    return { ...weapon, labBehavior: limitation(weapon, AMMO_UNVERIFIED_REASON), _prov: dropModeledLab(weapon._prov) }
  })
  return { weapons: out, warnings, deferred, errors }
}
