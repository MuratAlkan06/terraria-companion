import { useEffect } from 'react'
import { SITE } from './site'

/** Sets `<title>` to "Page · Terraria Companion" (or just the site name). */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE.name}` : SITE.name
  }, [title])
}
