/**
 * Every Unknown the item page renders, in page order (the weapon pages' rule, design review P2-S3 #1):
 * the Item record's own unverified fields AND those of the drop records its acquisition section shows.
 * The partially-verified badge reads this, so its count matches the Unknown markers on screen; a test
 * renders items of every category and checks it. Mirrors ItemDetailView + AcquisitionView — change
 * together.
 */
import type { DropIndex, Item } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { dropUnknowns, type PageUnknown } from '../weapons/weaponUnknowns'
import { itemFieldLabel, itemStatRows } from './itemDisplay'

/**
 * `acquisitionShown` = the "How to obtain" section is on screen (its data loaded); while it loads the page shows
 * only the header and stats, so only their Unknowns count — the badge never names a marker that isn't there.
 */
export function itemPageUnknowns(item: Item, drops: DropIndex | undefined, acquisitionShown = drops !== undefined): PageUnknown[] {
  const out: PageUnknown[] = []
  const add = (path: string) => out.push({ key: path, label: itemFieldLabel(path, item), count: 1 })

  // header
  for (const path of ['rarity', 'stage']) if (getField(item, path).status === 'unverified') add(path)
  // stats panel
  for (const row of itemStatRows(item)) if (row.text === undefined) add(row.field)
  if (getField(item, 'buffGrants').status === 'unverified') add('buffGrants')
  else (item.buffGrants ?? []).forEach((_, i) => getField(item, `buffGrants.${i}.durationTicks`).status === 'unverified' && add(`buffGrants.${i}.durationTicks`))
  if (getField(item, 'summonsBossNode').status === 'unverified') add('summonsBossNode')
  if (!acquisitionShown) return out
  // how to obtain
  if (getField(item, 'acquisition').status === 'unverified') add('acquisition')
  else {
    item.acquisition.forEach((route, index) => {
      if (route.method === 'drop') {
        for (const id of route.dropIds) {
          const drop = drops?.byId.get(id)
          if (drop) out.push(...dropUnknowns(drop))
        }
        return
      }
      if (route.method === 'purchase' && getField(item, `acquisition.${index}.priceCopper`).status === 'unverified') add(`acquisition.${index}.priceCopper`)
      const hasConditionsRow = route.method === 'purchase' || route.method === 'loot' || route.method === 'fishing'
      if (hasConditionsRow && getField(item, `acquisition.${index}.conditions`).status === 'unverified') add(`acquisition.${index}.conditions`)
    })
  }
  const gate = getField(item, 'gatedBy')
  if (gate.status === 'unverified' || (gate.status !== 'not-applicable' && !gate.value)) add('gatedBy')
  return out
}
