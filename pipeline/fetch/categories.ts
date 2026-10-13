/**
 * Wiki category trees via `list=categorymembers` (P2-S2 count reconciliation, PRD AC1). Each
 * category is listed with `cmlimit=500` and followed through `cmcontinue`; subcategories are
 * traversed breadth-first in sorted order (localized "<name>/<lang>" subcategories are skipped)
 * so the request sequence — and therefore the cache — is identical on every run.
 */
import type { WikiClient } from './client'
import { FetchError } from './client'

export interface CategoryTree {
  roots: string[]
  /** Category title → its direct article members (ns 0) and subcategories (ns 14), sorted. */
  categories: Map<string, { pages: string[]; subcats: string[] }>
  /** Every article (ns 0) anywhere in the tree, sorted. */
  pages: string[]
  fetchedAt: string
}

type MembersResponse = {
  continue?: { cmcontinue?: string }
  query?: { categorymembers?: { ns: number; title: string }[] }
}

const LOCALIZED = /\/[a-z]{2,3}(?:-[a-z]+)?$/

const cacheKey = (title: string) => title.replace(/^Category:/, '').replace(/[^A-Za-z0-9._-]+/g, '_')

async function listMembers(client: WikiClient, title: string): Promise<{ pages: string[]; subcats: string[]; fetchedAt: string }> {
  const pages: string[] = []
  const subcats: string[] = []
  let newest = ''
  let cont: string | undefined
  for (let page = 0; ; page += 1) {
    if (page >= 50) throw new FetchError(`categorymembers ${title}: pagination did not converge`)
    const params: Record<string, string> = { action: 'query', list: 'categorymembers', cmtitle: title, cmlimit: '500', cmprop: 'title', cmtype: 'page|subcat' }
    if (cont) params.cmcontinue = cont
    const { response, fetchedAt } = await client.get(params, `categories/${cacheKey(title)}/page-${String(page).padStart(2, '0')}`)
    if (fetchedAt > newest) newest = fetchedAt
    const body = response as MembersResponse
    const members = body.query?.categorymembers
    if (!Array.isArray(members)) throw new FetchError(`categorymembers ${title}: unexpected response shape`)
    for (const m of members) {
      if (m.ns === 0) pages.push(m.title)
      else if (m.ns === 14) subcats.push(m.title)
    }
    cont = body.continue?.cmcontinue
    if (!cont) break
  }
  return { pages: pages.sort(), subcats: subcats.sort(), fetchedAt: newest }
}

export async function fetchCategoryTree(client: WikiClient, roots: readonly string[]): Promise<CategoryTree> {
  const categories: CategoryTree['categories'] = new Map()
  const queue = [...roots]
  let newest = ''
  while (queue.length > 0) {
    const title = queue.shift() as string
    if (categories.has(title)) continue
    const m = await listMembers(client, title)
    if (m.fetchedAt > newest) newest = m.fetchedAt
    categories.set(title, { pages: m.pages, subcats: m.subcats })
    for (const sub of m.subcats) if (!LOCALIZED.test(sub) && !categories.has(sub)) queue.push(sub)
  }
  const pages = [...new Set([...categories.values()].flatMap((c) => c.pages))].sort()
  return { roots: [...roots], categories, pages, fetchedAt: newest }
}
