/**
 * Weapon Lab arena renderer — ADR-001 D5 layer 2. The ONLY module tree that imports PixiJS; the
 * Lab page loads it with a dynamic `import()` so PixiJS never reaches any other route.
 *
 * - `TextureStyle.defaultOptions.scaleMode = 'nearest'` + `roundPixels`: crisp pixel art.
 * - Fixed-step sim, interpolated rendering: every frame feeds `deltaMS` to the session (whole
 *   60 Hz ticks), then draws the blade between the last two ticks with the returned alpha. Swung
 *   sprites span the modeled reach (B44: reach = sprite diagonal × scale); thrust sprites stay at
 *   native art scale in the hand, the rest of the reach drawn as a streak. Once a timed test has
 *   finished, no blade, trail or guide is drawn.
 * - Floating damage numbers: three pre-installed BitmapFonts and a recycling BitmapText pool; each
 *   number is measured and placed by the collision-aware layout (../floatingNumbers.ts), so no two
 *   ever overlap, and crits draw on a layer above normal hits. Every number stays with its dummy
 *   (../numberZone.ts: a band over it, never back along the flight lane). Damage over time shows as
 *   smaller, muted numbers at their own half-second cadence (`DotNumberTicker`, UX_SPEC §12), rising
 *   from above the bullseye and kept off it.
 * - Bows, guns and magic weapons (P3-S4/S5): the weapon is held at the front hand at native art
 *   scale while an attack is in progress, pointing along the launch line; every shot is drawn from
 *   the engine's own path (../projectiles.ts) on the art-pixel grid — a small pixel shape with a
 *   trail of its last ticks of flight, seen from the hand on, ending at its hit (or leaving the
 *   arena / timing out) with a short fading tracer.
 * - Returning weapons (P3-S7, ../thrownVisuals.ts): the weapon's own sprite where the engine says it
 *   is, at the size it flies at in-game (native art scale; a yoyo at half its inventory icon, the
 *   in-game yoyo's size) — boomerangs and yoyos spinning in quarter turns, a flail head pointing
 *   along its chain — with a yoyo's string or a flail's chain drawn from the hand on the art-pixel
 *   grid. A held beam (P3-S6, the engine's `blade.kind === 'beam'`): a line of art pixels from the
 *   hand along the beam, a bright core with a glow cell either side.
 * - Summons and whips (P3-S9 / P3-S10, ../summonVisuals.ts): each minion or sentry the engine has, as
 *   original per-AI-class art (../art/arenaArt.ts `buildSummon`) where the engine has it, facing its
 *   target; a shooting summon's instant shot as a short tracer; a whip as a leather line from the hand
 *   to its range along the engine's sweep (bowed behind the swing) with its reach guide; a whip tag as
 *   a tag icon over the dummy with a shrinking timer bar — filled over the dummy the summons attack,
 *   hollow over any other tagged one. Minions of one kind on one dummy are fanned out sideways so each
 *   shows; a summon that leaves (the oldest replaced) fades out where it was with a small puff (only the
 *   fade under reduced motion). Summon hits are numbered in their own pale
 *   blue; on a tagged dummy the tag's share follows as a green "+N" ("19+4": the hit untagged, plus
 *   what the tag added — the HUD's tag bonus).
 * - Thrown explosives (P3-S11, ../explosiveVisuals.ts): each one the engine has in flight or at rest, as
 *   the weapon's own sprite at native art scale — tumbling in quarter turns while it flies, upright at
 *   rest, several resting on one spot fanned out sideways like a stack of minions — a fused one sparking
 *   at its fuse end every tick (reduced motion: a static glow), and each explosion as a ring of art-pixel
 *   cells at exactly its blast radius over a fading flash, growing from the centre (reduced motion: one
 *   static frame of the full ring). Its hits number over every dummy it reached, like any hit.
 * - Debuffs (P3-S11 AC2, ../debuffVisuals.ts): a debuffed dummy shows its longest-running debuff's glyph
 *   over its head — a flame, a snowflake, else a drop — with a timer bar in the glyph's tint (that
 *   debuff's time left), beside any whip tag marker.
 * - Multiple Dummies (P3-S6): one view per engine dummy, rebuilt whenever the engine's row changes,
 *   each numbered under its feet (the primary target's number in gold) as the HUD's hit strip names
 *   them; scene framing widens to keep the whole row in view (../camera.ts `sceneXFor`).
 * - Camera framing (../camera.ts): `scene` on tablet/desktop, `action` (zoomed onto the fight) on
 *   phones, both placed clear of the HUD rows; re-fit on resize, HUD inset changes, weapon changes
 *   (the reach — or a thrown explosive's whole blast circle — decides the zoom) and target changes.
 * - The canvas is decorative for assistive tech (`aria-hidden`); all meaningful output is the
 *   HTML HUD (UX_SPEC §9).
 */
import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, TextureStyle, TilingSprite, type Texture } from 'pixi.js'
import { PLACEHOLDER_PALETTE, PLACEHOLDER_ROWS, placeholderVariantFor } from '../../components/art/placeholderSprites'
import type { BladePose, RenderState } from '../../sim'
import { ARENA_LAYOUT, buildArenaBackdrop, buildDebuffIcon, buildDeepTile, buildDummy, buildPlayer, buildSummon, buildTagIcon, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE, silhouette, type SummonArt } from '../art/arenaArt'
import { A, ARENA_PALETTE } from '../art/arenaPalette'
import { bladeSpriteTransform, DEG, guideCells, heldWeaponVisual, holdStyleFor, interpolateBlade, streakCells, thrustVisual, trailSpan } from '../blade'
import { actionBox, fitCamera, sceneXFor, screenToWorld, worldToScreen, type CameraFit, type CameraFraming } from '../camera'
import { debuffMarker, DEBUFF_TINT_TOKENS, markerClearOfHud, type DebuffGlyph } from '../debuffVisuals'
import { blastPose, discSpans, ExplosiveStack, explosiveRotation, fuseSparkCells, fuseTip, ringCells } from '../explosiveVisuals'
import { DotNumberTicker, FloatLayout, floatPose, readsAsPartOfNumber, RecyclingPool, TRACER_CLEARANCE, type FloatRect, type MarkClearance } from '../floatingNumbers'
import { dotAnchor, numberZone } from '../numberZone'
import type { LabSession } from '../labSession'
import { bodyCells, ProjectileTracks, projectileStyleFor, toGamePx, trailCells, type ProjectileStyle, type ProjectileTone } from '../projectiles'
import { agentPosition, despawnPose, despawnPuffCells, ShotTracers, StackSpread, summonFocus, sweepOf, tagMarker, tagMarkerStyle, whipCells } from '../summonVisuals'
import { beamCells, dummySignature, handPoint, spinRotation, tetherCells, tetherFor, thrownPosition, thrownScale } from '../thrownVisuals'
import { glowTexture, loadImageTexture, textureFromRows, textureTopPoint, tokenHex } from './textures'

TextureStyle.defaultOptions.scaleMode = 'nearest'

export interface ArenaOptions {
  /** Live read of `prefers-reduced-motion` (numbers fade in place; no wobble). */
  reducedMotion: () => boolean
  /** CSS px reserved at the top of the canvas for the HUD (the camera centres below it). */
  insetTop?: () => number
  /** CSS px covered by the HUD's bottom controls (the fight and the numbers stay above them). */
  insetBottom?: () => number
  /** CSS px kept clear under the player's feet above the bottom controls (the first-use hint). */
  floorPx?: () => number
  /** `action` zooms onto the fight (phones); `scene` keeps the arena's set pieces whole. */
  framing?: () => CameraFraming
}

export interface ArenaWeaponSprite {
  /** Sprite file URL, or null for the original placeholder art (fallback mode / no sprite). */
  url: string | null
}

export interface ArenaHandle {
  setSession(session: LabSession, sprite: ArenaWeaponSprite): void
  /** Re-fit after the host changed size outside a window resize. */
  refit(): void
  destroy(): void
}

/** Frame timing for dev diagnostics / verification (never shipped as UI). */
export interface ArenaPerf {
  frames: number
  frameMs: number[]
  simMs: number[]
  /** Numbers retired early because no free spot existed (should stay 0 for every weapon). */
  evictions: number
  /** The camera's current fit. */
  fit?: CameraFit
  /** Screen boxes (CSS px) of the damage numbers drawn in the last frame, as rendered. */
  numbers: () => (FloatRect & { crit: boolean; text: string; alpha: number })[]
}

const DAMAGE_FONT = 'TcLabDamage'
const CRIT_FONT = 'TcLabCrit'
const DOT_FONT = 'TcLabDot'
/** A minion's or sentry's hit (P3-S9): pale blue, so summon damage reads apart from the weapon's own. */
const SUMMON_FONT = 'TcLabSummon'
/** The whip tag's share of a summon hit (P3-S10): a green "+N" after the number. */
const TAG_FONT = 'TcLabTag'
/**
 * Outline width per font (CSS px). Half of it is drawn outside the glyph box that BitmapText
 * measures, so the layout pads each number's box by it: outlines never touch either.
 */
const STROKE: Record<string, number> = { [DAMAGE_FONT]: 4, [CRIT_FONT]: 7, [DOT_FONT]: 3, [SUMMON_FONT]: 4, [TAG_FONT]: 3 }
/** Font size per kind of number (CSS px): crits larger, damage over time smaller (UX_SPEC §12). */
const FONT_SIZE: Record<string, number> = { [DAMAGE_FONT]: 16, [CRIT_FONT]: 24, [DOT_FONT]: 12, [SUMMON_FONT]: 16, [TAG_FONT]: 12 }
type NumberKind = 'normal' | 'crit' | 'dot' | 'summon'
const FONT_FOR: Record<NumberKind, string> = { normal: DAMAGE_FONT, crit: CRIT_FONT, dot: DOT_FONT, summon: SUMMON_FONT }
/** Space between a number and its tag suffix (CSS px). */
const SUFFIX_GAP = 2
const NUMBER_POOL = 48
const FLASH_MS = 110
/** Peak opacity of the white hit flash (kept low so fast weapons don't wash the dummy out). */
const FLASH_ALPHA = 0.5
const WOBBLE_MS = 520
const GUIDE_FADE_MS = 180
const GUIDE_ALPHA = 0.8
/** Reach-guide dash pattern along the arc (art px). */
const GUIDE_DASH = 4
const GUIDE_GAP = 3
const TRAIL_MAX_RAD = 110 * DEG

let fontsInstalled = false

async function installFonts(): Promise<void> {
  if (fontsInstalled) return
  try {
    await document.fonts.load('16px "Press Start 2P"')
  } catch {
    // Fall back to the monospace in the stack below.
  }
  const family = '"Press Start 2P", ui-monospace, monospace'
  const resolution = Math.max(1, Math.ceil(window.devicePixelRatio || 1))
  const shadow = tokenHex('var(--color-night-950)')
  BitmapFont.install({
    name: DAMAGE_FONT,
    chars: [['0', '9']],
    resolution,
    padding: 6,
    textureStyle: { scaleMode: 'nearest' },
    style: { fontFamily: family, fontSize: 16, fill: tokenHex('var(--color-fg)'), stroke: { color: shadow, width: STROKE[DAMAGE_FONT], join: 'miter' } },
  })
  BitmapFont.install({
    name: CRIT_FONT,
    chars: [['0', '9']],
    resolution,
    padding: 8,
    textureStyle: { scaleMode: 'nearest' },
    style: { fontFamily: family, fontSize: 24, fill: tokenHex('var(--color-gold-300)'), stroke: { color: shadow, width: STROKE[CRIT_FONT], join: 'miter' } },
  })
  BitmapFont.install({
    name: DOT_FONT,
    chars: [['0', '9']],
    resolution,
    padding: 5,
    textureStyle: { scaleMode: 'nearest' },
    style: { fontFamily: family, fontSize: FONT_SIZE[DOT_FONT], fill: tokenHex('var(--color-fg-muted)'), stroke: { color: shadow, width: STROKE[DOT_FONT], join: 'miter' } },
  })
  BitmapFont.install({
    name: SUMMON_FONT,
    chars: [['0', '9']],
    resolution,
    padding: 6,
    textureStyle: { scaleMode: 'nearest' },
    style: { fontFamily: family, fontSize: FONT_SIZE[SUMMON_FONT], fill: tokenHex('var(--color-night-200)'), stroke: { color: shadow, width: STROKE[SUMMON_FONT], join: 'miter' } },
  })
  BitmapFont.install({
    name: TAG_FONT,
    chars: [['0', '9'], '+'],
    resolution,
    padding: 5,
    textureStyle: { scaleMode: 'nearest' },
    style: { fontFamily: family, fontSize: FONT_SIZE[TAG_FONT], fill: tokenHex('var(--color-success)'), stroke: { color: shadow, width: STROKE[TAG_FONT], join: 'miter' } },
  })
  fontsInstalled = true
}

interface FloatingNumber {
  text: BitmapText
  font: string
  bornAt: number
  /** World impact point (tiles) + the layout's collision-free offset from it (CSS px). */
  x: number
  y: number
  offsetX: number
  offsetY: number
  crit: boolean
  /** The whip tag's share of a summon hit ("+N", P3-S10), drawn after the number; null until first needed. */
  suffix: BitmapText | null
  /** Half the gap + suffix width (CSS px): the number shifts left by it so the pair stays centred. */
  suffixShift: number
}

/** Damage numbers sit this far above the impact point (CSS px). */
const NUMBER_LIFT_PX = 4

export async function mountArena(host: HTMLElement, options: ArenaOptions): Promise<ArenaHandle> {
  const app = new Application()
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: tokenHex('var(--color-night-950)'),
    preference: 'webgl',
  })
  await installFonts()

  const canvas = app.canvas
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  host.appendChild(canvas)

  // ---------------------------------------------------------------------------- scene graph
  const owned: Texture[] = []
  const own = (t: Texture) => (owned.push(t), t)
  const world = new Container()
  // Damage numbers: crits on their own layer above normal hits, so a crit is never drawn under one.
  const normalNumbers = new Container()
  const critNumbers = new Container()
  app.stage.addChild(world, normalNumbers, critNumbers)

  const { backdrop } = ARENA_LAYOUT
  // Below the baked backdrop the rock continues as a repeating textured tile (never a flat slab).
  const deep = new TilingSprite({
    texture: own(textureFromRows(buildDeepTile(), ARENA_PALETTE)),
    width: backdrop.widthTiles * GAME_PX_PER_TILE + 8192,
    height: 4096,
    tileScale: { x: GAME_PX_PER_ART_PX, y: GAME_PX_PER_ART_PX },
  })
  deep.position.set(backdrop.x0 * GAME_PX_PER_TILE - 4096, (backdrop.y0 + backdrop.heightTiles) * GAME_PX_PER_TILE - GAME_PX_PER_ART_PX)
  const backdropSprite = new Sprite(own(textureFromRows(buildArenaBackdrop(), ARENA_PALETTE)))
  backdropSprite.position.set(backdrop.x0 * GAME_PX_PER_TILE, backdrop.y0 * GAME_PX_PER_TILE)
  backdropSprite.scale.set(GAME_PX_PER_ART_PX)

  const glow = own(glowTexture())
  const glows = new Container({ blendMode: 'add' })
  const moon = ARENA_LAYOUT.moon
  const lights = [
    { x: moon.x, y: moon.y, radiusTiles: 4.5, token: 'var(--color-gold-200)', alpha: 0.22 },
    ...ARENA_LAYOUT.torches.map((t) => ({ x: t.x, y: t.y - 0.85, radiusTiles: 2.6, token: 'var(--color-gold-400)', alpha: 0.42 })),
  ]
  for (const { x, y, radiusTiles, token, alpha } of lights) {
    const light = new Sprite(glow)
    light.anchor.set(0.5)
    light.position.set(x * GAME_PX_PER_TILE, y * GAME_PX_PER_TILE)
    light.width = light.height = radiusTiles * 2 * GAME_PX_PER_TILE
    light.tint = tokenHex(token)
    light.alpha = alpha
    glows.addChild(light)
  }

  const summonTextures = new Map<SummonArt, Texture>()
  const summonTexture = (art: SummonArt): Texture => {
    let texture = summonTextures.get(art)
    if (!texture) summonTextures.set(art, (texture = own(textureFromRows(buildSummon(art), ARENA_PALETTE))))
    return texture
  }
  const tagTexture = own(textureFromRows(buildTagIcon(), ARENA_PALETTE))
  const tagHollowTexture = own(textureFromRows(buildTagIcon('outline'), ARENA_PALETTE))
  const debuffTextures: Record<DebuffGlyph, Texture> = {
    flame: own(textureFromRows(buildDebuffIcon('flame'), ARENA_PALETTE)),
    frost: own(textureFromRows(buildDebuffIcon('frost'), ARENA_PALETTE)),
    drop: own(textureFromRows(buildDebuffIcon('drop'), ARENA_PALETTE)),
  }
  // A dummy's markers (the tallest icon, 2 art px over its bar's line, tiles): kept under the HUD's top row.
  const markerHeightTiles = ((Math.max(tagTexture.height, ...Object.values(debuffTextures).map((t) => t.height)) + 2) * GAME_PX_PER_ART_PX) / GAME_PX_PER_TILE

  const dummyRows = buildDummy()
  const dummyTexture = own(textureFromRows(dummyRows, ARENA_PALETTE))
  const dummyFlashTexture = own(textureFromRows(silhouette(dummyRows, A.white), ARENA_PALETTE))
  const dummies = new Container()

  const playerSprite = new Sprite(own(textureFromRows(buildPlayer(), ARENA_PALETTE)))
  playerSprite.anchor.set(0.5, 1)
  playerSprite.position.set(0, ARENA_LAYOUT.groundY * GAME_PX_PER_TILE)

  const guide = new Graphics()
  const trail = new Graphics()
  const blade = new Sprite()
  blade.anchor.set(0, 1)
  blade.visible = false
  // A bow, gun or staff in the hand while it attacks; its shots drawn over it (they leave the hand).
  const held = new Sprite()
  held.visible = false
  const shots = new Graphics()
  // A held beam (under the shots), and a thrown returning weapon on its string or chain.
  const beam = new Graphics()
  const tether = new Graphics()
  const thrown = new Sprite()
  thrown.anchor.set(0.5)
  thrown.visible = false
  // P3-S9 / P3-S10: whip tags over the dummies, the summons, a whip's lash, summons' instant shots.
  const tagLayer = new Container()
  const summonLayer = new Container()
  // The puff where a departing summon was (over the summons).
  const puffs = new Graphics()
  const lash = new Graphics()
  const tracerLines = new Graphics()
  // P3-S11: thrown explosives (one sprite per engine projectile), a fused one's spark, and their blasts' rings over the scene.
  const explosivesLayer = new Container()
  const sparks = new Graphics()
  const blastLayer = new Graphics()

  world.addChild(deep, backdropSprite, glows, dummies, tagLayer, summonLayer, puffs, playerSprite, guide, trail, blade, held, beam, lash, shots, tracerLines, tether, thrown, explosivesLayer, sparks, blastLayer)
  // Multiple Dummies: each dummy's number under its feet, in screen space (crisp at any zoom), under the damage numbers.
  const dummyLabels = new Container()
  app.stage.addChildAt(dummyLabels, app.stage.getChildIndex(normalNumbers))

  // The original placeholder art, one silhouette per damage class (fallback mode / no sprite).
  const placeholders = new Map<string, Texture>()
  const placeholderFor = (damageClass: string | undefined): Texture => {
    const variant = placeholderVariantFor(damageClass)
    let texture = placeholders.get(variant)
    if (!texture) placeholders.set(variant, (texture = own(textureFromRows(PLACEHOLDER_ROWS[variant], PLACEHOLDER_PALETTE as Record<string, string>))))
    return texture
  }
  const placeholderTexture = placeholderFor('melee')
  let weaponTexture: Texture = placeholderTexture
  /** The weapon sprite's fuse end (its topmost opaque pixel) from its centre, for a thrown explosive's spark. */
  let fuseOffset: { x: number; y: number } = { x: 0, y: -placeholderTexture.height / 2 }
  let loadedWeaponTexture: Texture | null = null

  // The reach guide is a modeled value (a Lab choice): drawn in the estimate gold, with a dark
  // drop so it reads as an overlay over sky, moon and torchlight alike (design review M1).
  const guideColor = tokenHex('var(--color-estimate)')
  const guideShadow = tokenHex('var(--color-night-950)')
  const trailColor = tokenHex('var(--color-white)')
  const rimColor = tokenHex('var(--color-gold-200)')
  // Shot colours per style (tokens): steel-tipped wooden arrows, hot gold slugs, pale-blue bolts.
  // A yoyo's string, a flail's chain, a held beam's core and glow (tokens).
  const stringColor = tokenHex('var(--color-white)')
  const chainColor = tokenHex('var(--color-stone-300)')
  const beamCore = tokenHex('var(--color-white)')
  const beamGlow = tokenHex('var(--color-night-200)')
  const primaryLabel = tokenHex('var(--color-gold-300)')
  // A whip's leather lash and its bright tip; a summon's shot; a tag's timer bar (tokens).
  const lashColor = tokenHex('var(--color-earth-400)')
  const lashTip = tokenHex('var(--color-gold-200)')
  const tracerColor = tokenHex('var(--color-night-200)')
  const tagBarColor = tokenHex('var(--color-success)')
  const tagBarBack = tokenHex('var(--color-night-950)')
  // A blast's ring and flash; a fuse's spark (core and sparks); a debuff's timer bar in its glyph's tint (tokens).
  const blastRing = tokenHex('var(--color-gold-300)')
  const blastFlash = tokenHex('var(--color-gold-200)')
  const sparkCore = tokenHex('var(--color-white)')
  const sparkGlow = tokenHex('var(--color-gold-300)')
  const debuffBarColors = Object.fromEntries(Object.entries(DEBUFF_TINT_TOKENS).map(([glyph, token]) => [glyph, tokenHex(`var(--color-${token})`)])) as Record<DebuffGlyph, number>
  const puffColor = tokenHex('var(--color-stone-200)')
  const shotTones: Record<ProjectileStyle, Partial<Record<ProjectileTone, number>> & { trail: number; trailAlpha: number }> = {
    arrow: { tip: tokenHex('var(--color-stone-200)'), shaft: tokenHex('var(--color-earth-400)'), fletch: tokenHex('var(--color-white)'), trail: tokenHex('var(--color-stone-300)'), trailAlpha: 0.35 },
    bullet: { core: tokenHex('var(--color-white)'), glow: tokenHex('var(--color-gold-300)'), trail: tokenHex('var(--color-gold-400)'), trailAlpha: 0.6 },
    bolt: { core: tokenHex('var(--color-white)'), glow: tokenHex('var(--color-night-200)'), trail: tokenHex('var(--color-night-200)'), trailAlpha: 0.45 },
  }

  // ---------------------------------------------------------------------------- diagnostics
  const layout = new FloatLayout<FloatingNumber>()
  // Rendered boxes including the outline (½ stroke beyond the measured glyph box, × the pop scale).
  const renderedNumbers = () =>
    [...normalNumbers.children, ...critNumbers.children]
      .filter((t) => t.visible)
      .map((t) => {
        const crit = t.parent === critNumbers
        const b = t.getBounds()
        const half = ((STROKE[String((t as BitmapText).style.fontFamily)] ?? STROKE[DAMAGE_FONT]) / 2) * t.scale.x
        return { x: b.x - half, y: b.y - half, w: b.width + 2 * half, h: b.height + 2 * half, crit, text: (t as BitmapText).text, alpha: t.alpha }
      })
  const perf: ArenaPerf = {
    frames: 0,
    frameMs: [],
    simMs: [],
    evictions: 0,
    numbers: renderedNumbers,
  }
  const record = (list: number[], value: number) => {
    list.push(value)
    if (list.length > 240) list.shift()
  }
  // Dev diagnostics hook, attached by the instance that receives a session (React StrictMode
  // mounts and discards a first instance in development).
  const devHook = window as unknown as { __tcLabPerf?: ArenaPerf }

  // ---------------------------------------------------------------------------- camera
  let destroyed = false
  let session: LabSession | null = null
  let fit: CameraFit = fitCamera(1, 1, 1)
  const refit = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    app.renderer.resize(width, height)
    const blast = session?.blastFrame() ?? null
    fit = fitCamera(width, height, app.renderer.resolution, {
      insetTop: options.insetTop?.() ?? 0,
      insetBottom: options.insetBottom?.() ?? 0,
      floorPx: options.floorPx?.() ?? 0,
      reachTiles: session?.frameTiles ?? 0,
      framing: options.framing?.() ?? 'scene',
      // A thrown explosive: its whole blast circle in the action box, kept whole past the scene's zoom, and
      // kept whole by the scene framing too (P3-S11 #3).
      action: session ? actionBox(session.frameTiles, session.sim.renderState().dummies, blast) : null,
      actionWhole: session?.explosive != null,
      blast,
      sceneX: sceneXFor(session?.sim.renderState().dummies ?? []),
    })
    world.position.set(fit.originX, fit.originY)
    world.scale.set(fit.scale)
    perf.fit = fit
  }
  refit()
  const resizeObserver = new ResizeObserver(refit)
  resizeObserver.observe(host)

  // ---------------------------------------------------------------------------- session
  let unsubscribeReset: (() => void) | null = null
  let spriteRequest = 0
  const dummyViews = new Map<string, { root: Container; flash: Sprite; hitAt: number; dir: number; label: BitmapText | null; x: number }>()
  let builtDummies = ''

  const numbers = new RecyclingPool<FloatingNumber>(NUMBER_POOL, () => {
    const text = new BitmapText({ text: '', style: { fontFamily: DAMAGE_FONT, fontSize: 16 } })
    text.anchor.set(0.5, 1)
    text.visible = false
    normalNumbers.addChild(text)
    return { text, font: DAMAGE_FONT, bornAt: 0, x: 0, y: 0, offsetX: 0, offsetY: 0, crit: false, suffix: null, suffixShift: 0 }
  })
  const retireNumber = (n: FloatingNumber) => {
    n.text.visible = false
    if (n.suffix) n.suffix.visible = false
    numbers.release(n)
    layout.remove(n)
  }
  // Summons: one sprite per engine agent (by id); tag markers per dummy; summons' instant-shot tracers.
  const summonSprites = new Map<number, Sprite>()
  const tagViews = new Map<string, { icon: Sprite; bar: Graphics }>()
  const debuffViews = new Map<string, { icon: Sprite; bar: Graphics }>()
  // Thrown explosives (by engine projectile id) and the blasts still drawn (world tiles, when they went off).
  const explosiveSprites = new Map<number, Sprite>()
  // Explosives resting on one spot, fanned out sideways (steady from frame to frame).
  const explosiveStack = new ExplosiveStack()
  let blasts: { x: number; y: number; radiusTiles: number; bornAt: number }[] = []
  const clearExplosives = () => {
    for (const sprite of explosiveSprites.values()) sprite.destroy()
    explosiveSprites.clear()
    explosiveStack.clear()
    sparks.clear()
    blasts = []
    blastLayer.clear()
  }
  const tracers = new ShotTracers()
  // Minions sharing a spot, fanned out sideways (steady from frame to frame).
  const spread = new StackSpread()
  // Summons that left (dismissed), fading out where they were drawn last (game px, mirrored scale).
  let departing: { sprite: Sprite; bornAt: number; x: number; y: number; scaleX: number; scaleY: number }[] = []
  const clearDeparting = () => {
    for (const d of departing) d.sprite.destroy()
    departing = []
    puffs.clear()
  }
  let lastSwingEnd = { at: -Infinity, facing: 1 as 1 | -1 }
  const tracks = new ProjectileTracks()
  const dotNumbers = new DotNumberTicker()
  let shotStyle: ProjectileStyle = 'bolt'
  /** First sim tick after the attack in progress (the held weapon shows until then). */
  let heldUntil = -Infinity

  const clearEffects = () => {
    for (const n of numbers.active) {
      n.text.visible = false
      if (n.suffix) n.suffix.visible = false
    }
    numbers.releaseAll()
    layout.clear()
    tracks.clear()
    dotNumbers.clear()
    shots.clear()
    beam.clear()
    tether.clear()
    lash.clear()
    tracers.clear()
    tracerLines.clear()
    clearDeparting()
    // A new world numbers its summons from 1 again: never reuse a sprite (and its art) from the last one.
    for (const sprite of summonSprites.values()) sprite.destroy()
    summonSprites.clear()
    spread.clear()
    thrown.visible = false
    held.visible = false
    heldUntil = -Infinity
    clearExplosives()
    for (const view of dummyViews.values()) {
      view.hitAt = -Infinity
      view.flash.alpha = 0
      view.root.rotation = 0
    }
    lastSwingEnd = { at: -Infinity, facing: 1 }
  }

  const buildDummies = (s: LabSession) => {
    dummies.removeChildren().forEach((c) => c.destroy({ children: true }))
    dummyLabels.removeChildren().forEach((c) => c.destroy())
    tagLayer.removeChildren().forEach((c) => c.destroy())
    dummyViews.clear()
    tagViews.clear()
    debuffViews.clear()
    const list = s.sim.renderState().dummies
    builtDummies = dummySignature(list)
    for (const [i, d] of list.entries()) {
      const root = new Container()
      root.position.set(d.x * GAME_PX_PER_TILE, (d.y + d.height / 2) * GAME_PX_PER_TILE)
      const body = new Sprite(dummyTexture)
      const flash = new Sprite(dummyFlashTexture)
      for (const sprite of [body, flash]) {
        sprite.anchor.set(0.5, 1)
        sprite.width = d.width * GAME_PX_PER_TILE
        sprite.height = d.height * GAME_PX_PER_TILE
      }
      flash.alpha = 0
      root.addChild(body, flash)
      dummies.addChild(root)
      // A row's dummies are numbered as the HUD's hit strip names them; the primary target (1) in gold.
      let label: BitmapText | null = null
      if (list.length > 1) {
        label = new BitmapText({ text: String(i + 1), style: { fontFamily: DOT_FONT, fontSize: FONT_SIZE[DOT_FONT] } })
        label.anchor.set(0.5, 0)
        if (i === 0) label.tint = primaryLabel
        dummyLabels.addChild(label)
      }
      dummyViews.set(d.id, { root, flash, hitAt: -Infinity, dir: 1, label, x: d.x })
      // The whip tag marker over its head (hidden until a whip tags it).
      const icon = new Sprite(tagTexture)
      icon.anchor.set(0.5, 1)
      icon.scale.set(GAME_PX_PER_ART_PX)
      icon.visible = false
      const bar = new Graphics()
      tagLayer.addChild(icon, bar)
      tagViews.set(d.id, { icon, bar })
      // The debuff marker over its head (hidden until a debuff lands on it; its glyph set per frame).
      const drop = new Sprite(debuffTextures.drop)
      drop.anchor.set(0.5, 1)
      drop.scale.set(GAME_PX_PER_ART_PX)
      drop.visible = false
      const dropBar = new Graphics()
      tagLayer.addChild(drop, dropBar)
      debuffViews.set(d.id, { icon: drop, bar: dropBar })
    }
  }

  /** A marker's bottom (game px): under the HUD's top row, like the damage numbers; level with its neighbour. */
  const markerBottom = (y: number) => markerClearOfHud(y, markerHeightTiles, fit, options.insetTop?.() ?? 0) * GAME_PX_PER_TILE

  /**
   * Debuffs (P3-S11 AC2): over each debuffed dummy's head the glyph of its longest-running debuff (a
   * flame, a snowflake, else a drop) and, under it, a timer bar in that glyph's tint — the share of that
   * debuff's time left — on the art-pixel grid, beside any tag marker.
   */
  const drawDebuffs = (state: RenderState) => {
    for (const d of state.dummies) {
      const view = debuffViews.get(d.id)
      if (!view) continue
      const marker = debuffMarker(d)
      view.bar.clear()
      view.icon.visible = marker !== null
      if (!marker) continue
      view.icon.texture = debuffTextures[marker.glyph]
      const px = GAME_PX_PER_ART_PX
      const barW = 8 * px
      const bottom = markerBottom(marker.y)
      view.icon.position.set(marker.x * GAME_PX_PER_TILE, bottom - 2 * px)
      const left = Math.round(marker.x * GAME_PX_PER_TILE - barW / 2)
      view.bar.rect(left - px, bottom - px, barW + 2 * px, px * 2).fill({ color: tagBarBack, alpha: 0.85 })
      const filled = Math.max(px, Math.round((barW * marker.left) / px) * px)
      view.bar.rect(left, bottom - px / 2, filled, px).fill({ color: debuffBarColors[marker.glyph], alpha: 1 })
    }
  }

  /**
   * Thrown explosives (P3-S11): each one the engine has, as the weapon's sprite at native art scale where
   * the engine has it (interpolated) — tumbling in quarter turns in flight, upright at rest, several at
   * rest on one spot fanned out sideways (`offsets`, tiles: ../explosiveVisuals.ts `ExplosiveStack`); a
   * fused one (`fused`) sparks at its fuse end every tick, a static glow under reduced motion (design
   * review P3-S11 #9).
   */
  const drawExplosives = (state: RenderState, alpha: number, offsets: ReadonlyMap<number, number>, fused: boolean, reduced: boolean) => {
    const live = new Set<number>()
    const px = GAME_PX_PER_ART_PX
    const core: [number, number][] = []
    const glow: [number, number][] = []
    for (const p of state.projectiles) {
      live.add(p.id)
      let sprite = explosiveSprites.get(p.id)
      if (!sprite) {
        sprite = new Sprite(weaponTexture)
        sprite.anchor.set(0.5)
        explosivesLayer.addChild(sprite)
        explosiveSprites.set(p.id, sprite)
      }
      const at = toGamePx(thrownPosition(p, alpha))
      at.x += (offsets.get(p.id) ?? 0) * GAME_PX_PER_TILE
      sprite.position.set(at.x, at.y)
      sprite.rotation = explosiveRotation(p, state.tick - 1 + alpha, state.facing)
      if (fused) {
        const cells = fuseSparkCells(fuseTip(at, fuseOffset, sprite.rotation), state.tick, reduced, px)
        core.push(...cells.core)
        glow.push(...cells.glow)
      }
    }
    sparks.clear()
    if (glow.length > 0) {
      for (const [x, y] of glow) sparks.rect(x, y, px, px)
      sparks.fill({ color: sparkGlow, alpha: reduced ? 0.55 : 0.9 })
    }
    if (core.length > 0) {
      for (const [x, y] of core) sparks.rect(x, y, px, px)
      sparks.fill({ color: sparkCore, alpha: reduced ? 0.8 : 1 })
    }
    for (const [id, sprite] of explosiveSprites) {
      if (live.has(id)) continue
      sprite.destroy()
      explosiveSprites.delete(id)
    }
  }

  /**
   * Blasts (P3-S11 AC1): a ring of art-pixel cells at exactly the blast radius (growing from the centre,
   * then fading) over a flash disc; reduced motion: one static frame of the full ring (../explosiveVisuals.ts).
   */
  const drawBlasts = (now: number, reduced: boolean) => {
    blastLayer.clear()
    if (blasts.length === 0) return
    const px = GAME_PX_PER_ART_PX
    blasts = blasts.filter((b) => {
      const pose = blastPose(now - b.bornAt, reduced)
      if (!pose) return false
      const center = { x: b.x * GAME_PX_PER_TILE, y: b.y * GAME_PX_PER_TILE }
      const radius = b.radiusTiles * GAME_PX_PER_TILE * pose.radiusFrac
      if (pose.flashAlpha > 0) {
        const spans = discSpans(center, radius, px)
        for (const [x, y, w] of spans) blastLayer.rect(x, y, w, px)
        if (spans.length > 0) blastLayer.fill({ color: blastFlash, alpha: pose.flashAlpha })
      }
      const cells = ringCells(center, radius, px)
      for (const [x, y] of cells) blastLayer.rect(x, y, px, px)
      if (cells.length > 0) blastLayer.fill({ color: blastRing, alpha: pose.ringAlpha })
      return true
    })
  }

  /**
   * Whip tags (P3-S10 AC1): the tag icon over each tagged dummy's head — filled over the dummy the
   * summons attack, hollow over another (`tagMarkerStyle`) — and under it a timer bar — the share of
   * the tag's 4 seconds still left — on the art-pixel grid.
   */
  const drawTags = (state: RenderState) => {
    const focus = summonFocus(state.agents)
    for (const d of state.dummies) {
      const view = tagViews.get(d.id)
      if (!view) continue
      const marker = tagMarker(d)
      view.bar.clear()
      view.icon.visible = marker !== null
      if (!marker) continue
      view.icon.texture = tagMarkerStyle(d.id, focus) === 'filled' ? tagTexture : tagHollowTexture
      const px = GAME_PX_PER_ART_PX
      const barW = 8 * px
      const bottom = markerBottom(marker.y)
      view.icon.position.set(marker.x * GAME_PX_PER_TILE, bottom - 2 * px)
      const left = Math.round(marker.x * GAME_PX_PER_TILE - barW / 2)
      view.bar.rect(left - px, bottom - px, barW + 2 * px, px * 2).fill({ color: tagBarBack, alpha: 0.85 })
      const filled = Math.max(px, Math.round((barW * marker.left) / px) * px)
      view.bar.rect(left, bottom - px / 2, filled, px).fill({ color: tagBarColor, alpha: 1 })
    }
  }

  /**
   * Minions and sentries where the engine has them (interpolated), per-class art facing their target —
   * minions of one kind on one dummy fanned out sideways (`offsets`, tiles: ../summonVisuals.ts `StackSpread`).
   */
  const drawSummons = (state: RenderState, alpha: number, offsets: ReadonlyMap<number, number>) => {
    const live = new Set<number>()
    for (const a of state.agents) {
      live.add(a.id)
      let sprite = summonSprites.get(a.id)
      if (!sprite) {
        sprite = new Sprite(summonTexture(a.kind === 'sentry' ? 'sentry' : a.aiClass))
        sprite.anchor.set(0.5)
        summonLayer.addChild(sprite)
        summonSprites.set(a.id, sprite)
      }
      const at = agentPosition(a, alpha)
      sprite.position.set((at.x + (offsets.get(a.id) ?? 0)) * GAME_PX_PER_TILE, at.y * GAME_PX_PER_TILE)
      sprite.scale.set(a.facing * GAME_PX_PER_ART_PX, GAME_PX_PER_ART_PX)
    }
    for (const [id, sprite] of summonSprites) {
      if (live.has(id)) continue
      sprite.destroy()
      summonSprites.delete(id)
    }
  }

  /** A summon the engine dismissed (the oldest replaced): its sprite stays where it was drawn last, to fade out there. */
  const depart = (agentId: number, now: number) => {
    const sprite = summonSprites.get(agentId)
    if (!sprite) return
    summonSprites.delete(agentId)
    departing.push({ sprite, bornAt: now, x: sprite.position.x, y: sprite.position.y, scaleX: sprite.scale.x, scaleY: sprite.scale.y })
  }

  /** Departing summons: fading (rising and shrinking a little, unless reduced motion), with a puff of four pixels. */
  const drawDeparting = (now: number, reduced: boolean) => {
    puffs.clear()
    if (departing.length === 0) return
    const px = GAME_PX_PER_ART_PX
    departing = departing.filter((d) => {
      const age = now - d.bornAt
      const pose = despawnPose(age, reduced)
      if (!pose) {
        d.sprite.destroy()
        return false
      }
      d.sprite.alpha = pose.alpha
      d.sprite.position.set(d.x, d.y + pose.dy * GAME_PX_PER_TILE)
      d.sprite.scale.set(d.scaleX * pose.scale, d.scaleY * pose.scale)
      const cells = despawnPuffCells({ x: d.x, y: d.y }, age, reduced, px, 5 * px, 10 * px)
      for (const [x, y] of cells) puffs.rect(x, y, px, px)
      if (cells.length > 0) puffs.fill({ color: puffColor, alpha: 0.85 * pose.alpha })
      return true
    })
  }

  /** Summons' instant shots: a fading one-art-pixel line from the summon to where the shot landed. */
  const drawTracers = (now: number) => {
    tracerLines.clear()
    const px = GAME_PX_PER_ART_PX
    for (const t of tracers.visuals(now)) {
      const cells = streakCells(toGamePx(t.from), toGamePx(t.to), px)
      if (cells.length === 0) continue
      for (const [x, y] of cells) tracerLines.rect(x, y, px, px)
      tracerLines.fill({ color: tracerColor, alpha: 0.8 * t.alpha })
    }
  }

  /**
   * A whip (engine `blade.kind === 'whip'`): the lash from the hand to the tip at the whip's range along
   * the sweep, bowed behind it, with a bright tip — minus any cell beside a live damage number — and
   * the reach guide at its range (fading after the swing, as a sword's).
   */
  const drawWhip = (pose: BladePose | null, facing: 1 | -1, alpha: number, now: number, rangeTiles: number, arcDegrees: number) => {
    lash.clear()
    guide.clear()
    const r = rangeTiles * GAME_PX_PER_TILE
    const px = GAME_PX_PER_ART_PX
    if (pose && pose.kind === 'whip') {
      const { angle } = interpolateBlade(pose, alpha)
      const { line, tip } = whipCells(handPoint(facing), angle, r, sweepOf(pose), px)
      const clear = cellsClearOfNumbers(line)
      for (const [x, y] of clear) lash.rect(x, y, px, px)
      if (clear.length > 0) lash.fill({ color: lashColor, alpha: 1 })
      lash.rect(tip[0] - px / 2, tip[1] - px / 2, px * 2, px * 2).fill({ color: lashTip, alpha: 1 })
      lastSwingEnd = { at: now, facing }
      drawGuide(guide, guideCellsClearOfNumbers(facing, arcDegrees, r), guideColor, guideShadow, GUIDE_ALPHA)
    } else {
      const since = now - lastSwingEnd.at
      if (since < GUIDE_FADE_MS) drawGuide(guide, guideCellsClearOfNumbers(lastSwingEnd.facing, arcDegrees, r), guideColor, guideShadow, GUIDE_ALPHA * (1 - since / GUIDE_FADE_MS))
    }
  }

  const setWeaponTexture = (texture: Texture) => {
    weaponTexture = texture
    fuseOffset = textureTopPoint(texture) ?? { x: 0, y: -texture.height / 2 }
    blade.texture = texture
    held.texture = texture
    thrown.texture = texture
    for (const sprite of explosiveSprites.values()) sprite.texture = texture
  }

  const setSession = (next: LabSession, sprite: ArenaWeaponSprite) => {
    if (import.meta.env.DEV) devHook.__tcLabPerf = perf
    unsubscribeReset?.()
    session?.releaseAll()
    session = next
    unsubscribeReset = next.onReset(clearEffects)
    clearEffects()
    buildDummies(next)
    shotStyle = projectileStyleFor(next.weapon)
    thrown.visible = false
    tether.clear()
    beam.clear()
    // Action framing follows the equipped weapon's reach.
    refit()
    const request = ++spriteRequest
    const previous = loadedWeaponTexture
    loadedWeaponTexture = null
    setWeaponTexture(placeholderFor(next.weapon.damageClass))
    previous?.destroy(true)
    if (sprite.url) {
      loadImageTexture(sprite.url).then(
        (texture) => {
          if (request !== spriteRequest || destroyed) return void texture.destroy(true)
          loadedWeaponTexture = texture
          setWeaponTexture(texture)
        },
        () => {
          /* keep the placeholder art */
        },
      )
    }
  }

  // ---------------------------------------------------------------------------- input
  let activePointer: number | null = null
  const toWorld = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    return screenToWorld(fit, event.clientX - rect.left, event.clientY - rect.top)
  }
  const onPointerDown = (event: PointerEvent) => {
    if (!session || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    activePointer = event.pointerId
    try {
      host.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic / already-released pointers can't be captured; holding still works in-bounds.
    }
    session.press('pointer', toWorld(event))
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId === activePointer) session?.setAim(toWorld(event))
  }
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return
    activePointer = null
    session?.release('pointer')
  }
  const onContextMenu = (event: Event) => event.preventDefault()
  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerEnd)
  host.addEventListener('pointercancel', onPointerEnd)
  host.addEventListener('lostpointercapture', onPointerEnd)
  host.addEventListener('contextmenu', onContextMenu)

  // ---------------------------------------------------------------------------- frame
  const spawnNumber = (event: { amount: number; x: number; y: number; dummyId: string; tagBonus?: number; blastKeptPct?: number }, kind: NumberKind, now: number, reduced: boolean, state: RenderState) => {
    // Numbers stay with their dummy (../numberZone.ts); damage over time rises from above its bullseye.
    // A blast's hits (P3-S11) land on several dummies at once, each at its edge nearest the blast: each
    // number rises from its own dummy's centre instead, so a row's numbers have room side by side.
    const dummy = state.dummies.find((d) => d.id === event.dummyId)
    const from = dummy && kind === 'dot' ? dotAnchor(dummy) : dummy && event.blastKeptPct !== undefined ? { x: dummy.x, y: dummy.y } : event
    const n = numbers.acquire()
    // A full pool recycles its oldest number: forget that one's spot.
    layout.remove(n)
    const crit = kind === 'crit'
    const font = FONT_FOR[kind]
    if (n.font !== font) {
      n.text.style.fontFamily = font
      n.text.style.fontSize = FONT_SIZE[font]
      n.font = font
    }
    // A summon hit on a whip-tagged dummy: the hit as it would be untagged, then the tag's share ("19+4").
    const bonus = event.tagBonus !== undefined && event.tagBonus > 0 ? event.tagBonus : 0
    n.text.text = String(event.amount - bonus)
    n.text.scale.set(1)
    n.text.visible = true
    n.bornAt = now
    n.x = from.x
    n.y = from.y
    n.crit = crit
    let suffixW = 0
    if (bonus > 0) {
      if (!n.suffix) {
        n.suffix = new BitmapText({ text: '', style: { fontFamily: TAG_FONT, fontSize: FONT_SIZE[TAG_FONT] } })
        n.suffix.anchor.set(0, 1)
      }
      n.suffix.text = `+${bonus}`
      n.suffix.scale.set(1)
      n.suffix.visible = true
      suffixW = n.suffix.getLocalBounds().width + SUFFIX_GAP
    } else if (n.suffix) {
      n.suffix.visible = false
    }
    n.suffixShift = suffixW / 2
    // Measured, rendered size at scale 1, plus the outline drawn outside it → a spot whose box
    // never meets a live number's box. The box is anchored where the outline ends (½ stroke below
    // the text's own anchor); the returned offset moves both alike.
    const bounds = n.text.getLocalBounds()
    const stroke = STROKE[font]
    const impact = worldToScreen(fit, from.x, from.y)
    const insetTop = options.insetTop?.() ?? 0
    const insetBottom = options.insetBottom?.() ?? 0
    const at = { x: impact.x, y: impact.y - NUMBER_LIFT_PX + stroke / 2 }
    const placed = layout.place(
      n,
      now,
      at,
      { w: bounds.width + suffixW + stroke, h: bounds.height + stroke },
      crit,
      reduced,
      { left: 0, top: insetTop, right: fit.cssWidth, bottom: fit.cssHeight - insetBottom },
      dummy ? numberZone(fit, dummy, kind === 'dot') : {},
    )
    for (const other of placed.evicted) retireNumber(other)
    perf.evictions += placed.evicted.length
    n.offsetX = placed.dx
    n.offsetY = placed.dy
    // Crits on the crit layer (always above normal hits); newest on top within a layer.
    const layer = crit ? critNumbers : normalNumbers
    layer.addChild(n.text)
    if (n.suffix && bonus > 0) layer.addChild(n.suffix)
  }

  /**
   * Overlay cells (the reach guide's dashes, a thrust's streak) minus any beside a live damage
   * number: a mark next to a number at its height reads as a minus sign ("–15"). Numbers are
   * positioned for this frame first.
   */
  const cellsClearOfNumbers = <C extends readonly [number, number, ...unknown[]]>(cells: C[], live: FloatRect[] = renderedNumbers(), clearance?: MarkClearance): C[] => {
    if (live.length === 0) return cells
    const size = GAME_PX_PER_ART_PX * fit.scale
    // Each cell's screen box (CSS px), with its one-art-pixel drop below it.
    return cells.filter(([x, y]) => !readsAsPartOfNumber({ x: fit.originX + x * fit.scale, y: fit.originY + y * fit.scale, w: size, h: 2 * size }, live, clearance))
  }

  const guideCellsClearOfNumbers = (facing: 1 | -1, arcDegrees: number, radius: number) =>
    cellsClearOfNumbers(guideCells(facing, arcDegrees, radius, GAME_PX_PER_ART_PX, GUIDE_DASH, GUIDE_GAP))

  const drawSwing = (pose: BladePose | null, facing: 1 | -1, alpha: number, now: number, reach: number, arcDegrees: number) => {
    trail.clear()
    guide.clear()
    if (pose) {
      const { angle } = interpolateBlade(pose, alpha)
      const t = bladeSpriteTransform(angle, facing, weaponTexture.width, weaponTexture.height, reach)
      blade.visible = true
      blade.position.set(0, 0)
      blade.rotation = t.rotation
      blade.scale.set(t.scaleX, t.scaleY)
      lastSwingEnd = { at: now, facing }
      const r = reach * GAME_PX_PER_TILE
      const [from, to] = trailSpan(angle, facing, arcDegrees, TRAIL_MAX_RAD)
      drawWedge(trail, from, to, r * 0.42, r, trailColor, 0.2)
      drawWedge(trail, from, to, r * 0.86, r, rimColor, 0.5)
      drawGuide(guide, guideCellsClearOfNumbers(facing, arcDegrees, r), guideColor, guideShadow, GUIDE_ALPHA)
    } else {
      blade.visible = false
      const since = now - lastSwingEnd.at
      if (since < GUIDE_FADE_MS) {
        const cells = guideCellsClearOfNumbers(lastSwingEnd.facing, arcDegrees, reach * GAME_PX_PER_TILE)
        drawGuide(guide, cells, guideColor, guideShadow, GUIDE_ALPHA * (1 - since / GUIDE_FADE_MS))
      }
    }
  }

  /**
   * A thrust (engine `blade.kind === 'thrust'`; design review P3-S2/S3 H1): the weapon at its native
   * art scale in the front hand, lunging along the aim (`thrustVisual`); the reach left past its
   * tip is a faint one-art-pixel streak with a brighter leading point, so the sprite never implies
   * a weapon as long as the reach. No swing trail, no arc guide.
   */
  const drawThrust = (pose: BladePose | null, facing: 1 | -1, alpha: number, reach: number) => {
    trail.clear()
    guide.clear()
    if (!pose || reach <= 0) {
      blade.visible = false
      return
    }
    const { angle, length } = interpolateBlade(pose, alpha)
    const v = thrustVisual(angle, length, reach, facing, weaponTexture.width, weaponTexture.height)
    blade.visible = true
    blade.position.set(v.handle.x, v.handle.y)
    blade.rotation = v.transform.rotation
    blade.scale.set(v.transform.scaleX, v.transform.scaleY)
    if (v.pierce) drawPierce(trail, cellsClearOfNumbers(streakCells(v.pierce.from, v.pierce.to, GAME_PX_PER_ART_PX)), trailColor, rimColor)
  }

  /**
   * A projectile weapon in the hand while its attack is in progress, pointing along the launch line
   * (centre → aim), at native art scale (../blade.ts `heldWeaponVisual`).
   */
  const drawHeld = (state: RenderState) => {
    if (state.tick - 1 >= heldUntil) {
      held.visible = false
      return
    }
    const angle = Math.atan2(state.aim.y - state.player.y, state.aim.x - state.player.x)
    const { width, height } = weaponTexture
    const v = heldWeaponVisual(angle, state.facing, width, height, holdStyleFor(width, height))
    held.visible = true
    held.anchor.set(v.anchor.x, v.anchor.y)
    held.position.set(v.handle.x, v.handle.y)
    held.rotation = v.transform.rotation
    held.scale.set(v.transform.scaleX, v.transform.scaleY)
  }

  /**
   * Every shot and fading tracer at sim time `renderT` (../projectiles.ts), on the art-pixel grid —
   * minus any cell beside a live damage number (a streak next to "14" reads as "−14"). A trail —
   * the line a tracer leaves at the impact, where numbers spawn — keeps the wider TRACER_CLEARANCE.
   */
  const drawShots = (renderT: number, now: number) => {
    shots.clear()
    const visuals = tracks.visuals(renderT, now)
    if (visuals.length === 0) return
    const tones = shotTones[shotStyle]
    const px = GAME_PX_PER_ART_PX
    const live = renderedNumbers()
    for (const v of visuals) {
      const trailPath = v.trail.map(toGamePx)
      const cells = cellsClearOfNumbers(trailCells(trailPath), live, TRACER_CLEARANCE)
      if (cells.length > 0) {
        for (const [x, y] of cells) shots.rect(x, y, px, px)
        shots.fill({ color: tones.trail, alpha: tones.trailAlpha * v.alpha })
      }
      if (!v.head) continue
      const byTone = new Map<ProjectileTone, [number, number][]>()
      for (const [x, y, tone] of cellsClearOfNumbers(bodyCells(shotStyle, toGamePx(v.head), v.dir), live)) {
        const list = byTone.get(tone)
        if (list) list.push([x, y])
        else byTone.set(tone, [[x, y]])
      }
      for (const [tone, list] of byTone) {
        for (const [x, y] of list) shots.rect(x, y, px, px)
        shots.fill({ color: tones[tone] ?? tones.trail, alpha: v.alpha })
      }
    }
  }

  /**
   * A returning weapon in flight (../thrownVisuals.ts): its sprite at its in-game size (`thrownScale`) where the
   * engine has it (interpolated like the blade), boomerangs and yoyos spinning in quarter turns, a
   * flail head pointing along its chain; the string or chain from the hand on the art-pixel grid,
   * minus any cell beside a live damage number.
   */
  const drawThrown = (state: RenderState, alpha: number, variant: 'boomerang' | 'flail' | 'yoyo') => {
    tether.clear()
    const p = state.projectiles[0]
    if (!p) {
      thrown.visible = false
      return
    }
    const at = toGamePx(thrownPosition(p, alpha))
    const hand = handPoint(state.facing)
    thrown.visible = true
    thrown.position.set(at.x, at.y)
    // Sprites are drawn handle bottom-left, tip top-right: a flail head turned that diagonal toward its flight.
    thrown.rotation = variant === 'flail' ? Math.atan2(at.y - hand.y, at.x - hand.x) + Math.atan2(weaponTexture.height, weaponTexture.width) : spinRotation(state.tick - 1 + alpha, state.facing)
    // The size it flies at in-game: native art scale, a yoyo at half its inventory icon (thrownScale).
    thrown.scale.set(thrownScale(variant))
    const kind = tetherFor(variant)
    const cells = cellsClearOfNumbers(tetherCells(kind, hand, at, GAME_PX_PER_ART_PX))
    if (cells.length === 0) return
    for (const [x, y] of cells) tether.rect(x, y, GAME_PX_PER_ART_PX, GAME_PX_PER_ART_PX)
    tether.fill({ color: kind === 'chain' ? chainColor : stringColor, alpha: kind === 'chain' ? 0.9 : 0.7 })
  }

  /**
   * A held beam (engine `blade.kind === 'beam'`): from the hand along the beam to its end, core + glow
   * cells — drawn whole, under the damage numbers: unlike a short streak, a continuous beam never reads
   * as a minus sign beside a number, and cutting it around the numbers would break it up.
   */
  const drawBeam = (pose: BladePose | null, facing: 1 | -1) => {
    beam.clear()
    if (!pose || pose.kind !== 'beam') return
    const hand = handPoint(facing)
    // The beam starts at the player's centre in the engine; drawn from the hand, it ends where the engine's does.
    const end = { x: Math.cos(pose.angle) * pose.length * GAME_PX_PER_TILE, y: Math.sin(pose.angle) * pose.length * GAME_PX_PER_TILE }
    const length = Math.hypot(end.x - hand.x, end.y - hand.y)
    const cells = beamCells(hand, Math.atan2(end.y - hand.y, end.x - hand.x), length, GAME_PX_PER_ART_PX)
    const px = GAME_PX_PER_ART_PX
    for (const [x, y] of cells.glow) beam.rect(x, y, px, px)
    beam.fill({ color: beamGlow, alpha: 0.45 })
    for (const [x, y] of cells.core) beam.rect(x, y, px, px)
    beam.fill({ color: beamCore, alpha: 0.9 })
  }

  /** Each row dummy's number, under its feet (screen space, whole CSS pixels). */
  const placeDummyLabels = () => {
    for (const view of dummyViews.values()) {
      if (!view.label) continue
      const p = worldToScreen(fit, view.x, ARENA_LAYOUT.groundY + 0.25)
      view.label.position.set(Math.round(p.x), Math.round(p.y))
    }
  }

  /** Nothing moves once a timed test has finished: the frame stays clean under the results (UX_SPEC §12). */
  const clearAttack = () => {
    blade.visible = false
    held.visible = false
    thrown.visible = false
    trail.clear()
    guide.clear()
    shots.clear()
    beam.clear()
    tether.clear()
    lash.clear()
    tracers.clear()
    tracerLines.clear()
    clearDeparting()
    clearExplosives()
    lastSwingEnd = { at: -Infinity, facing: 1 }
  }

  const update = () => {
    const s = session
    if (!s) return
    const simStart = performance.now()
    const { alpha, events } = s.frame(app.ticker.deltaMS)
    record(perf.simMs, performance.now() - simStart)
    const now = performance.now()
    const reduced = options.reducedMotion()
    const state = s.sim.renderState()
    const finished = s.getHud().timedTest.status === 'finished'
    // The target changed (Multiple Dummies, Reset): new dummy views, and a framing that shows them all.
    if (dummySignature(state.dummies) !== builtDummies) {
      buildDummies(s)
      refit()
    }
    // Minions sharing a spot, fanned out sideways (their shots leave from where they are drawn).
    const offsets = spread.update(state.agents, state.dummies, state.player.x, app.ticker.deltaMS, reduced)
    // Thrown explosives resting on one spot, fanned out the same way.
    const restingOffsets = s.explosive ? explosiveStack.update(state.projectiles, state.player.x, app.ticker.deltaMS, reduced) : null

    for (const event of events) {
      if (event.type === 'damage') {
        // Damage over time: collected into its own slower cadence of small numbers (no hit flash).
        if (event.source === 'dot') {
          dotNumbers.add(event)
          continue
        }
        const summonHit = event.source === 'minion' || event.source === 'sentry'
        if (!s.returning && !s.explosive) tracks.impact(event)
        // A summon's instant shot (no projectile of its own): a tracer from the summon to the hit.
        if (summonHit && !event.sourceId.startsWith('proj:')) {
          const agent = state.agents.find((a) => `${a.kind}:${a.id}` === event.sourceId)
          if (agent && agent.aiClass === 'ranged-shot') tracers.add({ x: agent.x + (offsets.get(agent.id) ?? 0), y: agent.y }, event, now)
        }
        spawnNumber(event, event.crit ? 'crit' : summonHit ? 'summon' : 'normal', now, reduced, state)
        const view = dummyViews.get(event.dummyId)
        if (view) {
          view.hitAt = now
          view.dir = event.x <= state.dummies.find((d) => d.id === event.dummyId)!.x ? 1 : -1
        }
      } else if (event.type === 'projectile-spawn') {
        // A returning weapon or a thrown explosive is drawn as itself (drawThrown / drawExplosives), not as a shot.
        if (!s.returning && !s.explosive) tracks.spawn(event, state.facing)
      } else if (event.type === 'projectile-despawn') {
        if (!s.returning && !s.explosive) tracks.despawn(event)
      } else if (event.type === 'explosion') {
        blasts.push({ x: event.x, y: event.y, radiusTiles: event.radiusTiles, bornAt: now })
      } else if (event.type === 'use-start') {
        heldUntil = event.tick + event.durationTicks
      } else if (event.type === 'dismiss') {
        depart(event.agentId, now)
      }
    }
    // A finished test shows the DoT it dealt up to the last tick.
    for (const n of dotNumbers.drain(state.tick, finished)) spawnNumber(n, 'dot', now, reduced, state)
    if (!s.returning && !s.explosive) tracks.sync(state.projectiles, state.tick, state.facing)

    for (const view of dummyViews.values()) {
      const age = now - view.hitAt
      view.flash.alpha = age < FLASH_MS ? FLASH_ALPHA * (1 - age / FLASH_MS) : 0
      view.root.rotation = !reduced && age < WOBBLE_MS ? view.dir * 0.09 * Math.exp(-age / 160) * Math.sin((age / 1000) * Math.PI * 2 * 5) : 0
    }

    // Numbers before the swing: the reach guide keeps its dashes clear of where they are now.
    for (const n of [...numbers.active]) {
      const pose = floatPose(now - n.bornAt, n.crit, reduced)
      if (!pose) {
        retireNumber(n)
        continue
      }
      const p = worldToScreen(fit, n.x, n.y)
      n.text.position.set(Math.round(p.x + n.offsetX - n.suffixShift * pose.scale), Math.round(p.y - NUMBER_LIFT_PX + n.offsetY + pose.dy))
      n.text.alpha = pose.alpha
      n.text.scale.set(pose.scale)
      if (n.suffix?.visible) {
        // the tag's "+N" right after the number, on its baseline
        const half = (n.text.getLocalBounds().width / 2) * pose.scale
        n.suffix.position.set(Math.round(n.text.position.x + half + SUFFIX_GAP), n.text.position.y)
        n.suffix.alpha = pose.alpha
        n.suffix.scale.set(pose.scale)
      }
    }
    placeDummyLabels()
    drawTags(state)
    drawDebuffs(state)
    drawSummons(state, finished ? 1 : alpha, offsets)
    drawDeparting(now, reduced)

    playerSprite.scale.set(state.facing * GAME_PX_PER_ART_PX, GAME_PX_PER_ART_PX)
    // A finished test halts the engine mid-attack: no frozen blade, shot, trail or reach guide.
    if (finished) clearAttack()
    else {
      if (s.swing) drawSwing(state.blade, state.facing, alpha, now, s.swing.reachTiles, s.swing.arcDegrees)
      else if (s.whip) drawWhip(state.blade, state.facing, alpha, now, s.whip.rangeTiles, s.whip.arcDegrees)
      else if (s.returning) drawThrown(state, alpha, s.returning.variant)
      else if (s.explosive) drawExplosives(state, alpha, restingOffsets ?? new Map(), s.explosive.trigger === 'timed', reduced)
      else if (s.firesProjectiles) drawHeld(state)
      else drawThrust(state.blade?.kind === 'thrust' ? state.blade : null, state.facing, alpha, s.reachTiles)
      if (s.beam) drawBeam(state.blade, state.facing)
      // Any projectile the engine runs. Render time trails the sim by one tick, like the blade.
      drawShots(state.tick - 1 + alpha, now)
      drawTracers(now)
      drawBlasts(now, reduced)
    }
    perf.frames++
    record(perf.frameMs, app.ticker.deltaMS)
  }
  app.ticker.add(update)

  return {
    setSession,
    refit,
    destroy() {
      if (destroyed) return
      destroyed = true
      if (devHook.__tcLabPerf === perf) delete devHook.__tcLabPerf
      session?.releaseAll()
      unsubscribeReset?.()
      resizeObserver.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerEnd)
      host.removeEventListener('pointercancel', onPointerEnd)
      host.removeEventListener('lostpointercapture', onPointerEnd)
      host.removeEventListener('contextmenu', onContextMenu)
      app.ticker.remove(update)
      loadedWeaponTexture?.destroy(true)
      app.destroy({ removeView: true }, { children: true })
      for (const t of owned) t.destroy(true)
    },
  }
}

/** Annular sector from angle `a0` to `a1` (radians, either order) between two radii (game px). */
function drawWedge(g: Graphics, a0: number, a1: number, inner: number, outer: number, color: number, alpha: number): void {
  const span = Math.abs(a1 - a0)
  if (span < 0.01) return
  const steps = Math.max(2, Math.ceil(span / (6 * DEG)))
  const points: number[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    points.push(Math.cos(a) * outer, Math.sin(a) * outer)
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps
    points.push(Math.cos(a) * inner, Math.sin(a) * inner)
  }
  // Brighter toward the blade: the leading half drawn again on top.
  g.poly(points, true).fill({ color, alpha: alpha * 0.55 })
  const mid = a0 + (a1 - a0) * 0.5
  const lead: number[] = []
  const leadSteps = Math.max(2, Math.ceil(steps / 2))
  for (let i = 0; i <= leadSteps; i++) {
    const a = mid + ((a1 - mid) * i) / leadSteps
    lead.push(Math.cos(a) * outer, Math.sin(a) * outer)
  }
  for (let i = leadSteps; i >= 0; i--) {
    const a = mid + ((a1 - mid) * i) / leadSteps
    lead.push(Math.cos(a) * inner, Math.sin(a) * inner)
  }
  g.poly(lead, true).fill({ color, alpha: alpha * 0.45 })
}

/**
 * The thrust's reach past the weapon tip: a faint white streak of art-pixel cells, its last two
 * cells (the point the thrust has reached) brighter in the trail's gold rim.
 */
function drawPierce(g: Graphics, cells: readonly [number, number][], color: number, point: number): void {
  if (cells.length === 0) return
  const px = GAME_PX_PER_ART_PX
  const lead = Math.max(0, cells.length - 2)
  for (const [x, y] of cells.slice(0, lead)) g.rect(x, y, px, px)
  if (lead > 0) g.fill({ color, alpha: 0.32 })
  for (const [x, y] of cells.slice(lead)) g.rect(x, y, px, px)
  g.fill({ color: point, alpha: 0.75 })
}

/**
 * The swing's full extent at the modeled reach: a dashed pixel-art arc on the art-pixel grid
 * (`guideCells`: dashes of GUIDE_DASH art px, gaps of GUIDE_GAP), drawn over a one-art-pixel dark drop.
 */
function drawGuide(g: Graphics, cells: readonly [number, number][], color: number, shadow: number, alpha: number): void {
  if (cells.length === 0 || alpha <= 0) return
  const px = GAME_PX_PER_ART_PX
  for (const [x, y] of cells) g.rect(x, y + px, px, px)
  g.fill({ color: shadow, alpha: alpha * 0.7 })
  for (const [x, y] of cells) g.rect(x, y, px, px)
  g.fill({ color, alpha })
}
