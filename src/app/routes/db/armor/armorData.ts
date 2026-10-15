/**
 * Data for the armor pages (PRD P6-S1). Lazy data chunks, cached for the session by the data-access layer, so
 * returning to a page renders on its first frame:
 * - every page: the armor sets (armor-sets.json, 6 KB gz) and every armor piece (armor.detail.json, 15 KB gz) —
 *   the list's set rows need each set's pieces for its full-set defense, and a set page compares with any set —
 *   plus the sprite index with its "armor" manifest part (B104);
 * - below a page's header: the acquisition indexes its pieces need (recipes + names + item ids, drops, the
 *   progression graph for verified gates) and the search docs (each referenced item's name, sprite and page).
 */
import {
  loadAcquisitionData,
  loadArmorDetails,
  loadArmorSets,
  loadSearchDocs,
  loadSpriteIndex,
  peekAcquisitionData,
  peekArmorDetails,
  peekArmorSets,
  peekSearchDocs,
  peekSpriteIndex,
  type AcquisitionData,
  type AcquisitionNeeds,
} from '../../../../data-access'
import type { ArmorPiece, ArmorSet, SpriteIndex } from '../../../../data-access/types'
import type { SearchDoc } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'

/** Sprite-manifest parts loaded with the pages (AMENDMENTS-016 B104); any other sprite loads on demand. */
const SPRITE_DIRS = ['armor'] as const

export interface ArmorData {
  sets: ReadonlyMap<string, ArmorSet>
  armor: ReadonlyMap<number, ArmorPiece>
  /** null = sprite index unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
}

const spritesOrNull = (promise: Promise<SpriteIndex>): Promise<SpriteIndex | null> =>
  promise.catch((error: unknown) => {
    console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
    return null
  })

export async function loadArmorData(): Promise<ArmorData> {
  const [sets, armor, sprites] = await Promise.all([loadArmorSets(), loadArmorDetails(), spritesOrNull(loadSpriteIndex(SPRITE_DIRS))])
  return { sets, armor, sprites }
}

export function peekArmorData(): ArmorData | undefined {
  const sets = peekArmorSets()
  const armor = peekArmorDetails()
  return sets && armor ? { sets, armor, sprites: peekSpriteIndex(SPRITE_DIRS) ?? null } : undefined
}

/** What the "how to obtain" sections of these pieces need (recipes always: materials name and link through them). */
export function armorNeeds(pieces: readonly ArmorPiece[]): AcquisitionNeeds {
  return {
    recipes: true,
    drops: pieces.some((p) => p.acquisition.some((a) => a.method === 'drop')),
    gates: pieces.some((p) => {
      const gate = getField(p, 'gatedBy')
      return gate.status === 'verified' && ((gate.value as ArmorPiece['gatedBy'])?.bosses.length ?? 0) > 0
    }),
  }
}

export interface ArmorSectionsData {
  acquisition: AcquisitionData
  /** Every searchable entity by ref ("i:22"): names, sprites and pages of referenced items. */
  docs: ReadonlyMap<string, SearchDoc>
}

let docsFor: { source: readonly SearchDoc[]; byRef: ReadonlyMap<string, SearchDoc> } | undefined
export const docsByRef = (docs: readonly SearchDoc[]): ReadonlyMap<string, SearchDoc> => {
  if (docsFor?.source !== docs) docsFor = { source: docs, byRef: new Map(docs.map((d) => [d.id, d])) }
  return docsFor.byRef
}

export async function loadArmorSections(pieces: readonly ArmorPiece[]): Promise<ArmorSectionsData> {
  const [acquisition, docs] = await Promise.all([loadAcquisitionData(armorNeeds(pieces)), loadSearchDocs()])
  return { acquisition, docs: docsByRef(docs) }
}

export function peekArmorSections(pieces: readonly ArmorPiece[]): ArmorSectionsData | undefined {
  const acquisition = peekAcquisitionData(armorNeeds(pieces))
  const docs = peekSearchDocs()
  return acquisition && docs ? { acquisition, docs: docsByRef(docs) } : undefined
}
