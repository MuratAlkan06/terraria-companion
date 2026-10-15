/**
 * Weapon count reconciliation (PRD P2-S2 AC1, DATA_SCHEMA_SPEC §7a-13): the emitted weapon set is
 * reconciled against (1) the wiki's weapon category tree — every member article is classified —
 * and (2) the wiki's weapon list pages (Cargo Weapon_source, English rows), name by name.
 */
import type { Weapon } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import { stripMarkup } from '../parse/text'
import type { WeaponIdentification } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

export type PageBucket = 'weapon-article' | 'redirect' | 'excluded-weapon-rows' | 'out-of-scope-rows' | 'non-weapon-item-article' | 'no-item-infobox' | 'missing-page'

export const PAGE_BUCKET_LABEL: Record<PageBucket, string> = {
  'weapon-article': 'articles hosting ≥1 emitted weapon',
  redirect: 'redirects (category kept on a redirect page; the target article is classified on its own)',
  'excluded-weapon-rows': 'articles whose only weapon rows are excluded (no item ID / platform-exclusive)',
  'out-of-scope-rows': 'articles whose only matching rows are out of scope by rule (P2-S8: vanity accessories → item corpus P6-S0)',
  'non-weapon-item-article': 'item articles whose infobox type is not "weapon" (tools etc.)',
  'no-item-infobox': 'articles without an item infobox (list / overview / mechanic pages)',
  'missing-page': 'member titles that do not resolve to an existing page',
}

export interface CategoryReconciliation {
  rootTitle: string
  rootPages: number
  treeCategories: number
  treePages: number
  buckets: Record<PageBucket, string[]>
  /** Weapons hosted by the weapon-article pages. */
  weaponsOnTreePages: number
  /** Emitted weapons whose article is not in the category tree. */
  weaponsOutsideTree: string[]
  /** Non-weapon item articles: their Cargo item types (type → pages). */
  nonWeaponTypes: Map<string, number>
}

/**
 * Classifies every article of a category tree against the emitted records hosted on it. Used for the
 * weapon tree (P2-S2) and the ammunition tree (P2-S7): `weapons` = the emitted records, `identification`
 * = the builder's excluded rows ("weapon" in the bucket names is historical).
 */
export function reconcileCategories(
  tree: CategoryTree & { pageStatus: ReadonlyMap<string, { exists: boolean; resolvedTitle: string }> },
  itemRows: readonly CargoRow[],
  weapons: readonly Pick<Weapon, 'id' | 'name'>[],
  identification: Pick<WeaponIdentification, 'excluded'>,
  pageOf: ReadonlyMap<number, string>,
  /** P2-S8: rows of the family deliberately not emitted (vanity accessories) — their own bucket, no gap. */
  outOfScopeRows: readonly CargoRow[] = [],
): CategoryReconciliation {
  const weaponPages = new Map<string, number>()
  for (const w of weapons) {
    const p = pageOf.get(w.id) ?? ''
    weaponPages.set(p, (weaponPages.get(p) ?? 0) + 1)
  }
  const excludedPages = new Set(identification.excluded.map((e) => str(e.row._page)))
  const outOfScopePages = new Set(outOfScopeRows.map((r) => str(r._page)))
  const rowsByPage = new Map<string, CargoRow[]>()
  for (const r of itemRows) rowsByPage.set(str(r._page), [...(rowsByPage.get(str(r._page)) ?? []), r])
  const buckets = Object.fromEntries((Object.keys(PAGE_BUCKET_LABEL) as PageBucket[]).map((k) => [k, [] as string[]])) as Record<PageBucket, string[]>
  const nonWeaponTypes = new Map<string, number>()
  let weaponsOnTreePages = 0
  const treePages = new Set(tree.pages)
  for (const page of tree.pages) {
    const status = tree.pageStatus.get(page)
    if (weaponPages.has(page)) {
      buckets['weapon-article'].push(page)
      weaponsOnTreePages += weaponPages.get(page) ?? 0
    } else if (!status?.exists) buckets['missing-page'].push(page)
    else if (status.resolvedTitle !== page) buckets.redirect.push(`${page} → ${status.resolvedTitle}`)
    else if (excludedPages.has(page)) buckets['excluded-weapon-rows'].push(page)
    else if (outOfScopePages.has(page)) buckets['out-of-scope-rows'].push(page)
    else if ((rowsByPage.get(page) ?? []).length > 0) {
      buckets['non-weapon-item-article'].push(page)
      const types = [...new Set((rowsByPage.get(page) ?? []).flatMap((r) => str(r.type).split('^').map((t) => t.trim()).filter(Boolean)))].sort()
      const key = types.join(' + ') || '(no type)'
      nonWeaponTypes.set(key, (nonWeaponTypes.get(key) ?? 0) + 1)
    } else buckets['no-item-infobox'].push(page)
  }
  const weaponsOutsideTree = weapons.filter((w) => !treePages.has(pageOf.get(w.id) ?? '')).map((w) => `${w.name} (${pageOf.get(w.id)})`)
  const root = tree.roots[0]
  return {
    rootTitle: root,
    rootPages: tree.categories.get(root)?.pages.length ?? 0,
    treeCategories: tree.categories.size,
    treePages: tree.pages.length,
    buckets,
    weaponsOnTreePages,
    weaponsOutsideTree,
    nonWeaponTypes,
  }
}

export interface ListReconciliation {
  listPages: string[]
  rows: number
  names: number
  both: number
  listOnly: { name: string; why: string }[]
  emittedOnly: string[]
}

/**
 * Weapon_source (English rows) = the rows of the wiki's weapon list pages ("Melee weapons",
 * "Ranged weapons", "Magic weapons", "Summon weapons", "Consumables"). Names compared exactly.
 */
export function reconcileWeaponLists(sourceRows: readonly CargoRow[], itemRows: readonly CargoRow[], weapons: readonly Weapon[], identification: WeaponIdentification): ListReconciliation {
  const en = sourceRows.filter((r) => str(r.lang) === 'en')
  const listNames = new Set(en.map((r) => stripMarkup(str(r.weapon))).filter(Boolean))
  const emitted = new Set(weapons.map((w) => w.name))
  const excludedNames = new Map(identification.excluded.map((e) => [stripMarkup(str(e.row.name)), e.reason]))
  const typesByName = new Map<string, string>()
  for (const r of itemRows) {
    const n = stripMarkup(str(r.name))
    if (!typesByName.has(n)) typesByName.set(n, str(r.type).split('^').map((t) => t.trim()).filter(Boolean).join(', '))
  }
  const listOnly = [...listNames]
    .filter((n) => !emitted.has(n))
    .sort()
    .map((name) => ({
      name,
      why: excludedNames.has(name) ? `excluded: ${excludedNames.get(name)}` : typesByName.has(name) ? `wiki infobox type: ${typesByName.get(name) || '(none)'}` : 'no Cargo Items row with this name',
    }))
  return {
    listPages: [...new Set(en.map((r) => str(r._page)))].sort(),
    rows: en.length,
    names: listNames.size,
    both: [...listNames].filter((n) => emitted.has(n)).length,
    listOnly,
    emittedOnly: [...emitted].filter((n) => !listNames.has(n)).sort(),
  }
}
