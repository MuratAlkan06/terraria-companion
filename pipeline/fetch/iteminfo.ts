/**
 * `Module:Iteminfo/data` raw Lua via the revisions API (ADR-001 D2 source #1). The revision id
 * is recorded because the module is synced to 1.4.5.7 while the site pins 1.4.5.8 (D1 caveat).
 */
import type { WikiClient } from './client'
import { FetchError } from './client'

export const ITEMINFO_TITLE = 'Module:Iteminfo/data'

export interface IteminfoFetch {
  title: string
  rev: number
  revTimestamp: string
  content: string
  fetchedAt: string
}

export async function fetchIteminfo(client: WikiClient): Promise<IteminfoFetch> {
  const { response, fetchedAt } = await client.get(
    { action: 'query', prop: 'revisions', titles: ITEMINFO_TITLE, rvprop: 'ids|timestamp|content', rvslots: 'main' },
    'iteminfo/data',
  )
  const page = (response as { query?: { pages?: { revisions?: { revid: number; timestamp: string; slots: { main: { content: string } } }[] }[] } })
    .query?.pages?.[0]
  const rev = page?.revisions?.[0]
  if (!rev || typeof rev.slots?.main?.content !== 'string') throw new FetchError(`${ITEMINFO_TITLE}: no revision content in response`)
  return { title: ITEMINFO_TITLE, rev: rev.revid, revTimestamp: rev.timestamp, content: rev.slots.main.content, fetchedAt }
}
