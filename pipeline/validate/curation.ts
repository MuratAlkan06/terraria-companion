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
 *   gap is accepted only while no weapon in the dataset passes E_SUGGESTION_GATING for that boss.
 *   Once one does (e.g. when base-material acquisition lands, P6-S0), the build fails until gear is
 *   authored — the same no-stale-withholding rule as overlays/withheld.json.
 *
 * Datasets without boss pages (the P2-S1 sample) declare none, so the gate does not apply to them.
 */
import { isCoveredBy, type Boss, type GapEntry } from '../../src/schemas'
import type { Dataset } from './dataset'
import type { PipelineError } from './errors'
import { suggestionContext, suggestionGateFailures } from './suggestions'

export const GATED_LIST_FIELDS = ['prepChecklist', 'strategies', 'suggestedEquipment'] as const satisfies readonly (keyof Boss)[]

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
        continue
      }
      const unknown = isCoveredBy(boss._prov.unverifiedFields, field)
      if (!unknown || !declared.has(`boss:${id}|${field}`)) {
        errors.push(curationError(id, field, 'not curated: author entries in pipeline/overlays/bosses.json, or declare an honest gap with its reason'))
        continue
      }
      if (field === 'suggestedEquipment') {
        const eligible = suggestableWeapons(boss)
        if (eligible.length > 0) {
          const sample = eligible.slice(0, 5).map((w) => `${w.name} (i:${w.id})`).join(', ')
          errors.push(curationError(id, field, `declared gap is stale: ${eligible.length} weapon(s) now pass E_SUGGESTION_GATING for this boss (${sample}${eligible.length > 5 ? ', …' : ''}) — author suggested equipment`))
        }
      }
    }
  }
  return errors
}
