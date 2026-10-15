/**
 * Every Unknown an armor page renders, in page order (the weapon / item pages' rule, design review P2-S3 #1): the
 * set's own unverified fields, each piece's, and those of the drop records the pieces' "how to obtain" shows. The
 * partially-verified badge reads this, so its count matches the Unknown markers on screen; armor.test renders
 * every set and checks it. Mirrors ArmorSetView / ArmorPieceCard + AcquisitionView — change together.
 */
import type { ArmorPiece, ArmorSet, DropIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { dropUnknowns, type PageUnknown } from '../weapons/weaponUnknowns'
import { fieldLabel } from '../weapons/weaponDisplay'
import type { CompareRow, SetTotals } from './armorModel'
import { statLabel } from './equipmentDisplay'

const FIELD_WORDS: Readonly<Record<string, string>> = {
  rarity: 'rarity',
  stage: 'game stage',
  defense: 'defense',
  effects: 'effects',
  gatedBy: 'required progress',
  acquisition: 'how to obtain',
  setId: 'set',
}

/**
 * One piece's Unknowns as its card shows them: header facts and stats, then (once the acquisition data is on
 * screen) its routes and required progress. `prefix` names the piece on a set page (several pieces share it).
 */
export function pieceUnknowns(piece: ArmorPiece, drops: DropIndex | undefined, acquisitionShown: boolean, prefix: boolean): PageUnknown[] {
  const out: PageUnknown[] = []
  const lead = prefix ? `${piece.name} — ` : ''
  const add = (path: string, label?: string) => out.push({ key: `piece:${piece.id}:${path}`, label: `${lead}${label ?? FIELD_WORDS[path] ?? path}`, count: 1 })
  for (const path of ['rarity', 'stage', 'defense', 'effects']) if (getField(piece, path).status === 'unverified') add(path)
  // a loose piece's own page shows its set (Unknown when the wiki ties it to a set this dataset can't record)
  if (!prefix && getField(piece, 'setId').status === 'unverified') add('setId')
  if (!acquisitionShown) return out
  if (getField(piece, 'acquisition').status === 'unverified') add('acquisition')
  else {
    piece.acquisition.forEach((route, index) => {
      if (route.method === 'drop') {
        for (const id of route.dropIds) {
          const drop = drops?.byId.get(id)
          if (drop) for (const u of dropUnknowns(drop)) out.push({ ...u, key: `piece:${piece.id}:${u.key}`, label: `${lead}${u.label}` })
        }
        return
      }
      if (route.method === 'purchase' && getField(piece, `acquisition.${index}.priceCopper`).status === 'unverified') add(`acquisition.${index}.priceCopper`, fieldLabel(`acquisition.${index}.priceCopper`, piece))
      const hasConditionsRow = route.method === 'purchase' || route.method === 'loot' || route.method === 'fishing'
      if (hasConditionsRow && getField(piece, `acquisition.${index}.conditions`).status === 'unverified') add(`acquisition.${index}.conditions`, fieldLabel(`acquisition.${index}.conditions`, piece))
    })
  }
  const gate = getField(piece, 'gatedBy')
  if (gate.status === 'unverified' || (gate.status !== 'not-applicable' && !gate.value)) add('gatedBy')
  return out
}

/** The set page: header stage, the totals' Unknown defense, every piece, the comparison's Unknown cells. */
export function setPageUnknowns(
  set: ArmorSet,
  pieces: readonly ArmorPiece[],
  totals: readonly SetTotals[],
  drops: DropIndex | undefined,
  acquisitionShown: boolean,
  compare?: { rows: readonly CompareRow[]; names: [string, string] },
): PageUnknown[] {
  const out: PageUnknown[] = []
  if (getField(set, 'stage').status === 'unverified') out.push({ key: 'set:stage', label: 'Set — game stage', count: 1 })
  for (const t of totals) {
    if (t.defense.kind === 'unknown') out.push({ key: `totals:${t.variant.key}:defense`, label: `Full set${t.variant.label ? ` with the ${t.variant.label}` : ''} — defense`, count: 1 })
  }
  for (const piece of pieces) out.push(...pieceUnknowns(piece, drops, acquisitionShown, true))
  if (compare) {
    for (const row of compare.rows) {
      const label = row.stat === 'defense' ? 'Defense' : statLabel(row.stat, row.scope)
      ;(['a', 'b'] as const).forEach((side, i) => {
        if (row[side].kind === 'unknown') out.push({ key: `compare:${row.key}:${side}`, label: `Comparison — ${compare.names[i]}: ${label}`, count: 1 })
      })
    }
  }
  return out
}
