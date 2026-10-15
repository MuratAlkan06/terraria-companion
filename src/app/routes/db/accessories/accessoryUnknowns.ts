/**
 * Every Unknown an accessory page renders, in page order (the weapon / item pages' rule, design review P2-S3 #1):
 * the record's own unverified fields and those of the drop records its "how to obtain" shows. The partially-
 * verified badge reads this, so its count matches the Unknown markers on screen; accessories.test renders every
 * accessory and checks it. Mirrors AccessoryDetailView + AcquisitionView — change together.
 */
import type { Accessory, DropIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { dropUnknowns, type PageUnknown } from '../weapons/weaponUnknowns'
import { fieldLabel } from '../weapons/weaponDisplay'

const LABELS: Readonly<Record<string, string>> = {
  categories: 'Category',
  rarity: 'Rarity',
  stage: 'Game stage',
  effects: 'Effects',
  'wingStats.flightTimeTicks': 'Flight time',
  'wingStats.verticalSpeedTps': 'Vertical speed',
  'wingStats.hover': 'Can hover',
  acquisition: 'How to obtain',
  gatedBy: 'Required progress',
}

/** The wing-stat rows the effects panel shows (a row exists where the record carries or lists the field). */
export const WING_FIELDS = ['wingStats.flightTimeTicks', 'wingStats.verticalSpeedTps', 'wingStats.hover'] as const

/**
 * `acquisitionShown` = "how to obtain" is on screen (its data loaded); while it loads only the header and effects
 * count — the badge never names a marker that isn't there. "Which classes it counts for" shows its Unknown as a
 * sentence, not a marker.
 */
export function accessoryPageUnknowns(a: Accessory, drops: DropIndex | undefined, acquisitionShown: boolean): PageUnknown[] {
  const out: PageUnknown[] = []
  const add = (path: string, label = LABELS[path] ?? fieldLabel(path, a)) => out.push({ key: path, label, count: 1 })
  for (const path of ['categories', 'rarity', 'stage', 'effects', ...WING_FIELDS]) if (getField(a, path).status === 'unverified') add(path)
  if (!acquisitionShown) return out
  if (getField(a, 'acquisition').status === 'unverified') add('acquisition')
  else {
    a.acquisition.forEach((route, index) => {
      if (route.method === 'drop') {
        for (const id of route.dropIds) {
          const drop = drops?.byId.get(id)
          if (drop) out.push(...dropUnknowns(drop))
        }
        return
      }
      if (route.method === 'purchase' && getField(a, `acquisition.${index}.priceCopper`).status === 'unverified') add(`acquisition.${index}.priceCopper`, fieldLabel(`acquisition.${index}.priceCopper`, a))
      const hasConditionsRow = route.method === 'purchase' || route.method === 'loot' || route.method === 'fishing'
      if (hasConditionsRow && getField(a, `acquisition.${index}.conditions`).status === 'unverified') add(`acquisition.${index}.conditions`, fieldLabel(`acquisition.${index}.conditions`, a))
    })
  }
  const gate = getField(a, 'gatedBy')
  if (gate.status === 'unverified' || (gate.status !== 'not-applicable' && !gate.value)) add('gatedBy')
  return out
}
