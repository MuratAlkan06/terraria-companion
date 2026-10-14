/**
 * The debuff marker over a dummy (PRD P3-S11 AC2: "a debuff icon on the dummy") — pure, no PixiJS (the
 * arena draws it; Node tests check it). A dummy with any debuff active shows the icon of the debuff that
 * runs longest over its head with a timer bar under it: that debuff's share of its time left. It sits
 * beside a whip tag's marker (../summonVisuals.ts `tagMarker`), never on it: the tag keeps the centre,
 * the debuff moves aside when both show.
 *
 * Icons (design review P3-S11 #4): one original pixel-art glyph per KIND of debuff (../art/arenaArt.ts
 * `buildDebuffIcon`) — a flame for the burning ones, a snowflake for the freezing ones, a drop for the
 * rest (bleeding, poison, venom, acid) — with a timer bar in the glyph's own tint. Shape first, the tint
 * second, and the HUD's Debuff Dummy panel names every debuff in words: never colour alone.
 */
import type { RenderState } from '../sim'
import { GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { screenToWorld, type CameraFit } from './camera'
import { TAG_MARKER_LIFT_TILES } from './summonVisuals'

/** Sideways offset (tiles) of the debuff marker from the dummy's centre while a whip tag shares the spot. */
export const DEBUFF_BESIDE_TAG_TILES = 1.1

/** The glyph a debuff is drawn with. */
export type DebuffGlyph = 'flame' | 'frost' | 'drop'

/**
 * Debuffs by kind (buff registry ids): the burning ones (On Fire!, Hellfire, Cursed Inferno, Shadowflame,
 * Daybroken) and the freezing ones (Frostbite, Frostburn — the wiki: "frost" fire). Any other debuff —
 * Bleeding, Poisoned, Acid Venom, Potent Acid, Hemorrhage, or one the registry adds later — is the drop.
 */
const GLYPHS: Readonly<Record<string, DebuffGlyph>> = {
  'on-fire': 'flame',
  hellfire: 'flame',
  'cursed-inferno': 'flame',
  shadowflame: 'flame',
  daybroken: 'flame',
  frostbite: 'frost',
  frostburn: 'frost',
}

export const debuffGlyph = (buffId: string): DebuffGlyph => GLYPHS[buffId] ?? 'drop'

/**
 * Each glyph's tint (a design token): its icon's main colour and its timer bar's — gold for a flame,
 * the pale night blue for frost, the negative red for the drop (the bar colour before per-kind glyphs).
 */
export const DEBUFF_TINT_TOKENS: Readonly<Record<DebuffGlyph, string>> = {
  flame: 'gold-400',
  frost: 'night-200',
  drop: 'negative',
}

export interface DebuffMarker {
  /** Where the icon's bottom centre sits (tiles). */
  x: number
  y: number
  /** The longest-running debuff's time left, 0..1 — the timer bar's filled share. */
  left: number
  /** The longest-running debuff (its glyph is the icon). */
  buffId: string
  glyph: DebuffGlyph
  /** How many debuffs are active (more than one: the HUD lists them). */
  count: number
}

type MarkerDummy = Pick<RenderState['dummies'][number], 'x' | 'y' | 'height' | 'debuffs' | 'tag'>

/** A debuffed dummy's marker; null without a debuff. */
export function debuffMarker(d: MarkerDummy): DebuffMarker | null {
  const active = d.debuffs.filter((b) => b.remainingTicks > 0 && b.durationTicks > 0)
  if (active.length === 0) return null
  const longest = active.reduce((a, b) => (b.remainingTicks > a.remainingTicks ? b : a))
  return {
    x: d.x + (d.tag ? DEBUFF_BESIDE_TAG_TILES : 0),
    y: d.y - d.height / 2 - TAG_MARKER_LIFT_TILES,
    left: Math.min(1, Math.max(0, longest.remainingTicks / longest.durationTicks)),
    buffId: longest.buffId,
    glyph: debuffGlyph(longest.buffId),
    count: active.length,
  }
}

/**
 * A marker's bottom (world tiles), moved down if need be so the marker — `heightTiles` tall above it —
 * stays under the HUD's top row (`insetTop`, CSS px), as the damage numbers do (design review P3-S11: the
 * Imp Staff's flame at 375). Never moved up; a moved one lands on the art-pixel grid.
 */
export function markerClearOfHud(y: number, heightTiles: number, fit: CameraFit, insetTop: number): number {
  const lowest = screenToWorld(fit, 0, insetTop).y + heightTiles
  if (y >= lowest) return y
  const step = GAME_PX_PER_ART_PX / GAME_PX_PER_TILE
  return Math.ceil(lowest / step - 1e-9) * step
}
