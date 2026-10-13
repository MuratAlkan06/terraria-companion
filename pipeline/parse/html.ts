/**
 * Minimal HTML → tree parser for Cargo Wikitext cells (Drops rate/quantity/name/custom). Cargo
 * returns these cells as rendered HTML with nested spans (`mode-content`, `m-normal`,
 * `note-text`, `eico` platform icons…) — a tree is needed to read them reliably. Wikilinks and
 * entities stay in text nodes; callers strip them with `stripMarkup`.
 */

export type HNode =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'el'; tag: string; classes: string[]; attrs: Record<string, string>; children: HNode[] }

const VOID = new Set(['br', 'hr', 'img', 'wbr'])

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of src.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

export function parseHtml(src: string): HNode[] {
  const root: HNode[] = []
  const stack: { tag: string; children: HNode[] }[] = [{ tag: '#root', children: root }]
  const top = () => stack[stack.length - 1]
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+|</g)) {
    if (m[2] === undefined) {
      top().children.push({ type: 'text', text: m[0] })
      continue
    }
    const tag = m[2].toLowerCase()
    const closing = m[1] === '/'
    if (closing) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag)
      if (idx > 0) stack.length = idx // pop up to and including the matching element
      continue
    }
    if (tag === 'br') {
      top().children.push({ type: 'br' })
      continue
    }
    const attrs = parseAttrs(m[3])
    const el: HNode = { type: 'el', tag, classes: (attrs.class ?? '').split(/\s+/).filter(Boolean), attrs, children: [] }
    top().children.push(el)
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push({ tag, children: el.children })
  }
  return root
}

export const hasClass = (n: HNode, cls: string): boolean => n.type === 'el' && n.classes.includes(cls)

/** Depth-first search for elements matching `pred` (does not descend into matches). */
export function findAll(nodes: readonly HNode[], pred: (n: HNode) => boolean): HNode[] {
  const out: HNode[] = []
  const visit = (list: readonly HNode[]) => {
    for (const n of list) {
      if (pred(n)) out.push(n)
      else if (n.type === 'el') visit(n.children)
    }
  }
  visit(nodes)
  return out
}

/** Raw text content (br → newline), entities/wikilinks untouched. */
export function rawText(nodes: readonly HNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'br' ? '\n' : rawText(n.children))).join('')
}
