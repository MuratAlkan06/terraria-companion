/** HUD panel surface over the arena canvas — nearly opaque: the starfield must not show through the numbers. */
export const HUD_SURFACE = 'border-2 border-panel-border bg-night-950/95 shadow-pixel'
/** An interactive HUD panel (tips, buttons): it takes the pointer. Readout-only panels use HUD_SURFACE alone, so aiming passes through. */
export const HUD_PANEL = `pointer-events-auto ${HUD_SURFACE}`

export const formatInt = (n: number) => Math.round(n).toLocaleString('en-US')
export const format1 = (n: number) => n.toFixed(1)
export const format2 = (n: number) => n.toFixed(2)
