import type { LabHudState } from '../../../lab/labSession'

/** HUD panel surface over the arena canvas — nearly opaque: the starfield must not show through the numbers. */
export const HUD_SURFACE = 'border-2 border-panel-border bg-night-950/95 shadow-pixel'
/** An interactive HUD panel (tips, buttons): it takes the pointer. Readout-only panels use HUD_SURFACE alone, so aiming passes through. */
export const HUD_PANEL = `pointer-events-auto ${HUD_SURFACE}`

export const formatInt = (n: number) => Math.round(n).toLocaleString('en-US')
export const format1 = (n: number) => n.toFixed(1)
export const format2 = (n: number) => n.toFixed(2)
/** "1/1" — slots may be fractional (a 0.5-slot minion): at most two decimals. */
export const slotNumber = (n: number) => String(Number(n.toFixed(2)))

/**
 * The most est. DPS the weapon could show against the current dummies — every activation hitting every
 * dummy at the top of the ±15% damage roll, a crit each time it can crit — so the compact Multiple-Dummies
 * readout can reserve that width from the first frame (design review P3-S11 nit: a thrown explosive's first
 * blast on a row took its DPS from "0.0" to "487.2", the stats box grew, the EquippedBar beside it re-wrapped
 * and the camera moved). Width only: it never shows.
 */
export function dpsCeiling(hud: Pick<LabHudState, 'weapon' | 'targets'>): number {
  const w = hud.weapon
  return w.baseHitDamage * 1.15 * (w.critChancePct > 0 ? 2 : 1) * Math.max(1, w.activationsPerUse) * (hud.targets?.dummies.length ?? 1) * w.nominalAttacksPerSec
}
