/**
 * Plain-text + identifier helpers for the parse stage (AMENDMENTS-001 A15: ALL markup is
 * stripped from wiki-derived strings before they reach a record).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  thinsp: ' ',
  hairsp: ' ',
  ensp: ' ',
  emsp: ' ',
  ndash: '–',
  mdash: '—',
  times: '×',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * Wikitext/HTML → plain text: drops [[Category:]]/[[File:]] links, unwraps [[target|label]] /
 * [[target]], removes tags, bold/italic quote runs and templates, decodes entities, collapses
 * whitespace.
 */
export function stripMarkup(s: string): string {
  let out = s
  out = out.replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/gi, '')
  out = out.replace(/<br\s*\/?>/gi, ' ')
  out = out.replace(/<[^>]*>/g, '')
  // wikilinks may be split by removed tags; unwrap iteratively
  for (let i = 0; i < 3; i += 1) out = out.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
  out = out.replace(/\{\{[^{}]*\}\}/g, '')
  out = out.replace(/'{2,}/g, '')
  out = decodeEntities(out)
  return out.replace(/\s+/g, ' ').trim()
}

/** Lowercase kebab slug matching the shared Slug schema (`[a-z0-9]+(-[a-z0-9]+)*`). */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** FNV-1a 32-bit hash of the UTF-8 bytes, as 8 lowercase hex chars (record ID suffixes, §3). */
export function fnv1a32hex(s: string): string {
  let h = 0x811c9dc5
  for (const byte of Buffer.from(s, 'utf8')) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
