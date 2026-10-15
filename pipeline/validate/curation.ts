/**
 * E_BOSS_CURATION{bossId, field} — the P5 gate (AMENDMENTS-001 A1 "boss curated-field staging"):
 * every boss whose page ships (the dataset manifest's `bossPages`, = src/schemas/bossPages.ts for
 * the emitted dataset) must carry its curated minimums before the page can ship:
 *
 * - attackPatternTags: ≥ 1 quoted tag (A1's only explicit minimum; no gap is accepted).
 * - prepChecklist, strategies, suggestedEquipment: ≥ 1 entry, OR an honest declared gap — the field
 *   is Unknown (absent + listed in unverifiedFields) AND the stage gap log carries the overlay's
 *   reason (`missing-field` entry for boss:<id> + field). Not curated at all (absent + listed with no
 *   reason) and an empty list (a present value claiming "nothing to suggest") both fail.
 * - A declared suggestedEquipment gap must be NECESSARY: SuggestedEquipment needs ≥ 1 weapon, so the
 *   gap is accepted only while none of the boss's own quoted strategies names a weapon that passes
 *   E_SUGGESTION_GATING for that boss. Once one does (the B70 P4-prep gating expansion made the first
 *   pre-Hardmode weapons qualify), the build fails until gear is authored — the same no-stale-withholding
 *   rule as overlays/withheld.json. AMENDMENTS-015 B83(b) (later than B78's "any weapon qualifies"):
 *   gear needs a quoted wiki recommendation AND passing gating — recommendation ≠ mere obtainability —
 *   so a weapon that merely passes the gate, named by no tip, does not make the gap stale.
 *
 * - Curated suggestedEquipment covers every gear class (P5-S3 honest partial): each of melee /
 *   ranged / magic / summon has ≥ 1 entry, or is a declared per-class gap — `suggestedEquipment.<class>`
 *   listed in unverifiedFields with its reason in the stage gap log. A per-class gap is stale when one
 *   of the boss's own quoted strategies names a weapon of that class that passes E_SUGGESTION_GATING:
 *   the wiki's advice we already carry recommends a weapon verified obtainable before the fight, so it
 *   must be suggested. (Gating alone does not make a weapon a recommendation; the quote does.)
 *
 * Datasets without boss pages (the P2-S1 sample) declare none, so the gate does not apply to them.
 */
import { isCoveredBy, type Boss, type GapEntry, type Weapon } from '../../src/schemas'
import type { Dataset } from './dataset'
import type { PipelineError } from './errors'
import { suggestionContext, suggestionGateFailures } from './suggestions'

export const GATED_LIST_FIELDS = ['prepChecklist', 'strategies', 'suggestedEquipment'] as const satisfies readonly (keyof Boss)[]

/** The classes a boss page's gear tabs show (the gear entries' DamageClass minus "other"). */
export const GEAR_CLASSES = ['melee', 'ranged', 'magic', 'summon'] as const

/**
 * Weapon names a quote mentions: exact, case-sensitive, whole words, longest name first; a
 * multi-word name may carry a plural "s" (the boss page's tip-linking rule).
 */
export function weaponNamesIn(text: string, names: readonly string[]): Set<string> {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length || a.localeCompare(b))
  const found = new Set<string>()
  if (sorted.length === 0) return found
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}'’-])(${sorted.map(escape).join('|')})(s?)(?![\\p{L}\\p{N}'’-])`, 'gu')
  for (const [, name, plural] of text.matchAll(pattern)) if (!plural || name.includes(' ')) found.add(name)
  return found
}

const curationError = (bossId: string, field: string, detail: string): PipelineError => ({
  code: 'E_BOSS_CURATION',
  bossId,
  field,
  message: `boss:${bossId} ${field}: ${detail}`,
})

export function checkBossCuration(ds: Dataset, bossPages: readonly string[], stageGaps: readonly GapEntry[]): PipelineError[] {
  if (bossPages.length === 0) return []
  const errors: PipelineError[] = []
  const bosses = new Map(ds.bosses.map((b) => [b.id, b]))
  const declared = new Set(stageGaps.filter((g) => g.kind === 'missing-field' && g.field).map((g) => `${g.ref}|${g.field}`))
  const ctx = suggestionContext(ds)
  const suggestableWeapons = (boss: Boss) => ds.weapons.filter((w) => suggestionGateFailures(w, boss, ctx).length === 0)
  const weaponNames = ds.weapons.map((w) => w.name)

  for (const id of bossPages) {
    const boss = bosses.get(id)
    if (!boss) {
      errors.push(curationError(id, '(record)', 'the dataset declares a page for this boss but has no boss record'))
      continue
    }
    if (!boss.attackPatternTags || boss.attackPatternTags.length === 0) {
      errors.push(curationError(id, 'attackPatternTags', 'a boss page needs at least one quoted attack-pattern tag'))
    }
    for (const field of GATED_LIST_FIELDS) {
      const value = boss[field]
      if (value !== undefined) {
        if (value.length === 0) errors.push(curationError(id, field, 'an empty list would claim there is nothing to show; author entries or declare a gap'))
        else if (field === 'suggestedEquipment') errors.push(...gearClassCoverage(boss, declared, () => suggestableWeapons(boss), weaponNames))
        continue
      }
      const unknown = isCoveredBy(boss._prov.unverifiedFields, field)
      if (!unknown || !declared.has(`boss:${id}|${field}`)) {
        errors.push(curationError(id, field, 'not curated: author entries in pipeline/overlays/bosses.json, or declare an honest gap with its reason'))
        continue
      }
      if (field === 'suggestedEquipment') {
        const quoted = new Set((boss.strategies ?? []).flatMap((s) => [...weaponNamesIn(s.text, weaponNames)]))
        const eligible = suggestableWeapons(boss).filter((w) => quoted.has(w.name))
        if (eligible.length > 0) {
          const sample = eligible.slice(0, 5).map((w) => `${w.name} (i:${w.id})`).join(', ')
          errors.push(curationError(id, field, `declared gap is stale: the boss's own quoted strategies name ${eligible.length} weapon(s) that pass E_SUGGESTION_GATING (${sample}${eligible.length > 5 ? ', …' : ''}) — author suggested equipment`))
        }
      }
    }
  }
  return errors
}

/** Curated gear covers every class: an entry, or a declared per-class gap that is not stale (module doc). */
function gearClassCoverage(boss: Boss, declared: ReadonlySet<string>, suggestable: () => Weapon[], weaponNames: readonly string[]): PipelineError[] {
  const errors: PipelineError[] = []
  const entries = boss.suggestedEquipment ?? []
  // every weapon name the boss's quotes mention (matched against ALL weapon names, longest first, so
  // "Flaming Mace" is never read as "Mace")
  const quoted = new Set((boss.strategies ?? []).flatMap((s) => [...weaponNamesIn(s.text, weaponNames)]))
  let eligible: Weapon[] | undefined
  for (const cls of GEAR_CLASSES) {
    const field = `suggestedEquipment.${cls}`
    const listed = isCoveredBy(boss._prov.unverifiedFields, field)
    if (entries.some((g) => g.class === cls)) {
      if (listed) errors.push(curationError(boss.id, field, 'the class has gear entries and is listed Unknown; drop one of them'))
      continue
    }
    if (!listed) {
      errors.push(curationError(boss.id, field, 'class not curated: author a gear entry for it, or declare a per-class gap with its reason'))
      continue
    }
    if (!declared.has(`boss:${boss.id}|${field}`)) {
      errors.push(curationError(boss.id, field, 'per-class gap without a declared reason in the stage gap log'))
      continue
    }
    eligible ??= suggestable()
    const named = eligible.filter((w) => w.damageClass === cls && quoted.has(w.name))
    if (named.length > 0) {
      errors.push(curationError(boss.id, field, `per-class gap is stale: the boss's own quoted strategies name ${named.map((w) => `${w.name} (i:${w.id})`).join(', ')}, which pass E_SUGGESTION_GATING — author a ${cls} gear entry`))
    }
  }
  return errors
}
