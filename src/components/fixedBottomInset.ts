/**
 * Height of fixed chrome along the bottom edge that is on screen right now (the mobile tab bar,
 * including its safe-area padding), so popovers can treat it as a collision edge instead of
 * opening underneath it. Bars opt in with `data-fixed-bottom`; hidden bars (lg+) measure 0.
 */
export function fixedBottomInset(): number {
  if (typeof document === 'undefined') return 0
  let inset = 0
  for (const bar of document.querySelectorAll<HTMLElement>('[data-fixed-bottom]')) {
    const rect = bar.getBoundingClientRect()
    if (rect.height > 0) inset = Math.max(inset, window.innerHeight - rect.top)
  }
  return Math.max(0, inset)
}
