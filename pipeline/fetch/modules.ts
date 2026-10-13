/**
 * Wiki Lua modules (other than Module:Iteminfo/data) and page-existence checks, fetched in ONE
 * request each via the revisions/query API. Revision ids are recorded for provenance.
 */
import type { WikiClient } from './client'
import { FetchError } from './client'

export const RECIPE_MODULE_TITLES = ['Module:RecipeGroups', 'Module:Recipes', 'Module:Recipes/l10n'] as const

export interface ModuleFetch {
  title: string
  rev: number
  revTimestamp: string
  content: string
  fetchedAt: string
}

type RevisionsResponse = {
  query?: { pages?: { title: string; missing?: boolean; revisions?: { revid: number; timestamp: string; slots: { main: { content: string } } }[] }[] }
}

export async function fetchRecipeModules(client: WikiClient): Promise<Record<(typeof RECIPE_MODULE_TITLES)[number], ModuleFetch>> {
  const { response, fetchedAt } = await client.get(
    { action: 'query', prop: 'revisions', titles: RECIPE_MODULE_TITLES.join('|'), rvprop: 'ids|timestamp|content', rvslots: 'main' },
    'modules/recipe-modules',
  )
  const pages = (response as RevisionsResponse).query?.pages ?? []
  const out = {} as Record<(typeof RECIPE_MODULE_TITLES)[number], ModuleFetch>
  for (const title of RECIPE_MODULE_TITLES) {
    const rev = pages.find((p) => p.title === title)?.revisions?.[0]
    if (!rev) throw new FetchError(`${title}: no revision content in response`)
    out[title] = { title, rev: rev.revid, revTimestamp: rev.timestamp, content: rev.slots.main.content, fetchedAt }
  }
  return out
}

/** One Lua module's current revision (P2-S7: Module:Projectileinfo/data), one request, cached. */
export async function fetchModuleRevision(client: WikiClient, title: string, cacheName: string): Promise<ModuleFetch> {
  const { response, fetchedAt } = await client.get({ action: 'query', prop: 'revisions', titles: title, rvprop: 'ids|timestamp|content', rvslots: 'main' }, cacheName)
  const rev = (response as RevisionsResponse).query?.pages?.find((p) => p.title === title)?.revisions?.[0]
  if (!rev) throw new FetchError(`${title}: no revision content in response`)
  return { title, rev: rev.revid, revTimestamp: rev.timestamp, content: rev.slots.main.content, fetchedAt }
}

/**
 * Existence check for curated overlay source URLs (every overlay entry must cite a real wiki
 * page). Titles are batched 50 per request (API limit for anonymous clients).
 */
export async function checkPagesExist(client: WikiClient, titles: readonly string[], cachePrefix: string): Promise<Map<string, { exists: boolean; resolvedTitle: string }>> {
  const unique = [...new Set(titles)].sort()
  const result = new Map<string, { exists: boolean; resolvedTitle: string }>()
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50)
    const { response } = await client.get({ action: 'query', titles: batch.join('|'), redirects: '1' }, `${cachePrefix}/${String(i / 50).padStart(2, '0')}`)
    const q = (response as { query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: { title: string; missing?: boolean; invalid?: boolean }[] } }).query
    const norm = new Map((q?.normalized ?? []).map((n) => [n.from, n.to]))
    const redir = new Map((q?.redirects ?? []).map((r) => [r.from, r.to]))
    const pages = new Map((q?.pages ?? []).map((p) => [p.title, p]))
    for (const title of batch) {
      const normalized = norm.get(title) ?? title
      const resolvedTitle = redir.get(normalized) ?? normalized
      const page = pages.get(resolvedTitle)
      result.set(title, { exists: page !== undefined && !page.missing && !page.invalid, resolvedTitle })
    }
  }
  return result
}
