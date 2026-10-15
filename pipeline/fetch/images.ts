/**
 * Wiki image metadata via `prop=imageinfo` (ADR-001 D2 source "Imageinfo", TO-VERIFY #8):
 * for each `File:` title the API returns the original file URL, byte size, dimensions, SHA-1
 * and MIME type. Titles are batched 50 per request (anonymous API limit) in sorted order, so
 * the request sequence is deterministic and cached like every other request.
 *
 * Only metadata is fetched here (it is part of the offline-replayable sync plan). The image
 * binaries are downloaded by the local-only `npm run pipeline:sprites` (AMENDMENTS-001 A10).
 */
import type { WikiClient } from './client'
import { FetchError } from './client'

export interface ImageInfo {
  /** Requested file name without the `File:` prefix, as stored in Cargo Items `imagefile`. */
  file: string
  /** Canonical title after normalization/redirects ("File:Zenith.png"). */
  title: string
  url: string
  descriptionUrl: string
  sha1: string
  bytes: number
  width: number
  height: number
  mime: string
}

export interface ImageInfoFetch {
  found: Map<string, ImageInfo>
  /** Requested file names the wiki does not have (missing / invalid / no imageinfo). */
  missing: string[]
  fetchedAt: string
}

type ImageInfoResponse = {
  query?: {
    normalized?: { from: string; to: string }[]
    redirects?: { from: string; to: string }[]
    pages?: {
      title: string
      missing?: boolean
      invalid?: boolean
      imageinfo?: { url: string; descriptionurl: string; sha1: string; size: number; width: number; height: number; mime: string }[]
    }[]
  }
}

export async function fetchImageInfo(client: WikiClient, files: readonly string[], cachePrefix: string): Promise<ImageInfoFetch> {
  const unique = [...new Set(files.map((f) => f.trim()).filter(Boolean))].sort()
  const found = new Map<string, ImageInfo>()
  const missing: string[] = []
  let newest = ''
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50)
    const titles = batch.map((f) => `File:${f}`)
    const { response, fetchedAt } = await client.get(
      { action: 'query', prop: 'imageinfo', iiprop: 'url|size|sha1|mime', titles: titles.join('|'), redirects: '1' },
      `${cachePrefix}/${String(i / 50).padStart(3, '0')}`,
    )
    if (fetchedAt > newest) newest = fetchedAt
    const q = (response as ImageInfoResponse).query
    if (!q || !Array.isArray(q.pages)) throw new FetchError(`imageinfo ${cachePrefix}: unexpected response shape`)
    const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]))
    const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]))
    const pages = new Map(q.pages.map((p) => [p.title, p]))
    batch.forEach((file, j) => {
      const normalized = norm.get(titles[j]) ?? titles[j]
      const title = redir.get(normalized) ?? normalized
      const info = pages.get(title)?.imageinfo?.[0]
      if (!info || pages.get(title)?.missing || pages.get(title)?.invalid) {
        missing.push(file)
        return
      }
      found.set(file, { file, title, url: info.url, descriptionUrl: info.descriptionurl, sha1: info.sha1, bytes: info.size, width: info.width, height: info.height, mime: info.mime })
    })
  }
  return { found, missing, fetchedAt: newest }
}
