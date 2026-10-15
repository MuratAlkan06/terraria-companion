/**
 * The control that has focus — to hand focus back to once the overlay it opened closes — or null.
 *
 * Safari (macOS and iOS) doesn't focus a button, link, checkbox or radio when it's clicked or tapped: focus stays
 * where it was or lands on the nearest focusable ancestor, here the shell's <main tabIndex={-1}>. So after a click
 * document.activeElement is often <body> or <main>, not the control that was pressed (the B110/B124 Safari caveat,
 * reproduced in WebKit in the P7-S3 cross-browser pass). Only an element in the tab order counts; callers then fall
 * back to the element they know opened the overlay (a slot's own button, the step heading).
 */
export function focusedControl(doc: Pick<Document, 'activeElement' | 'body'> = document): HTMLElement | null {
  const el = doc.activeElement as HTMLElement | null
  if (!el || el === doc.body || typeof el.focus !== 'function' || !(el.tabIndex >= 0)) return null
  return el
}
