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
 * - Floating damage numbers: two pre-installed BitmapFonts and a recycling BitmapText pool; each
 *   number is measured and placed by the collision-aware layout (../floatingNumbers.ts), so no two
 *   ever overlap, and crits draw on a layer above normal hits.
 * - Camera framing (../camera.ts): `scene` on tablet/desktop, `action` (zoomed onto the fight) on
 *   phones, both placed clear of the HUD rows; re-fit on resize, HUD inset changes and weapon
 *   changes (the reach decides the zoom).
 * - The canvas is decorative for assistive tech (`aria-hidden`); all meaningful output is the
 *   HTML HUD (UX_SPEC §9).
 */
import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, TextureStyle, TilingSprite, type Texture } from 'pixi.js'
import { PLACEHOLDER_PALETTE, PLACEHOLDER_ROWS } from '../../components/art/placeholderSprites'
import type { BladePose, SimEvent } from '../../sim'
import { ARENA_LAYOUT, buildArenaBackdrop, buildDeepTile, buildDummy, buildPlayer, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE, silhouette } from '../art/arenaArt'
import { A, ARENA_PALETTE } from '../art/arenaPalette'
import { bladeSpriteTransform, DEG, guideCells, interpolateBlade, streakCells, thrustVisual, trailSpan } from '../blade'
import { actionBox, fitCamera, screenToWorld, worldToScreen, type CameraFit, type CameraFraming } from '../camera'
import { FloatLayout, floatPose, readsAsPartOfNumber, RecyclingPool, type FloatRect } from '../floatingNumbers'
import type { LabSession } from '../labSession'
import { glowTexture, loadImageTexture, textureFromRows, tokenHex } from './textures'

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
/**
 * Outline width per font (CSS px). Half of it is drawn outside the glyph box that BitmapText
 * measures, so the layout pads each number's box by it: outlines never touch either.
 */
const STROKE: Record<string, number> = { [DAMAGE_FONT]: 4, [CRIT_FONT]: 7 }
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

  world.addChild(deep, backdropSprite, glows, dummies, playerSprite, guide, trail, blade)

  const placeholderTexture = own(textureFromRows(PLACEHOLDER_ROWS.melee, PLACEHOLDER_PALETTE as Record<string, string>))
  let weaponTexture: Texture = placeholderTexture
  let loadedWeaponTexture: Texture | null = null

  // The reach guide is a modeled value (a Lab choice): drawn in the estimate gold, with a dark
  // drop so it reads as an overlay over sky, moon and torchlight alike (design review M1).
  const guideColor = tokenHex('var(--color-estimate)')
  const guideShadow = tokenHex('var(--color-night-950)')
  const trailColor = tokenHex('var(--color-white)')
  const rimColor = tokenHex('var(--color-gold-200)')

  // ---------------------------------------------------------------------------- diagnostics
  const layout = new FloatLayout<FloatingNumber>()
  // Rendered boxes including the outline (½ stroke beyond the measured glyph box, × the pop scale).
  const renderedNumbers = () =>
    [...normalNumbers.children, ...critNumbers.children]
      .filter((t) => t.visible)
      .map((t) => {
        const crit = t.parent === critNumbers
        const b = t.getBounds()
        const half = ((crit ? STROKE[CRIT_FONT] : STROKE[DAMAGE_FONT]) / 2) * t.scale.x
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
    fit = fitCamera(width, height, app.renderer.resolution, {
      insetTop: options.insetTop?.() ?? 0,
      insetBottom: options.insetBottom?.() ?? 0,
      floorPx: options.floorPx?.() ?? 0,
      reachTiles: session?.reachTiles ?? 0,
      framing: options.framing?.() ?? 'scene',
      action: session ? actionBox(session.reachTiles, session.sim.renderState().dummies) : null,
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
  const dummyViews = new Map<string, { root: Container; flash: Sprite; hitAt: number; dir: number }>()

  const numbers = new RecyclingPool<FloatingNumber>(NUMBER_POOL, () => {
    const text = new BitmapText({ text: '', style: { fontFamily: DAMAGE_FONT, fontSize: 16 } })
    text.anchor.set(0.5, 1)
    text.visible = false
    normalNumbers.addChild(text)
    return { text, font: DAMAGE_FONT, bornAt: 0, x: 0, y: 0, offsetX: 0, offsetY: 0, crit: false }
  })
  const retireNumber = (n: FloatingNumber) => {
    n.text.visible = false
    numbers.release(n)
    layout.remove(n)
  }
  let lastSwingEnd = { at: -Infinity, facing: 1 as 1 | -1 }

  const clearEffects = () => {
    for (const n of numbers.active) n.text.visible = false
    numbers.releaseAll()
    layout.clear()
    for (const view of dummyViews.values()) {
      view.hitAt = -Infinity
      view.flash.alpha = 0
      view.root.rotation = 0
    }
    lastSwingEnd = { at: -Infinity, facing: 1 }
  }

  const buildDummies = (s: LabSession) => {
    dummies.removeChildren().forEach((c) => c.destroy({ children: true }))
    dummyViews.clear()
    for (const d of s.sim.renderState().dummies) {
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
      dummyViews.set(d.id, { root, flash, hitAt: -Infinity, dir: 1 })
    }
  }

  const setWeaponTexture = (texture: Texture) => {
    weaponTexture = texture
    blade.texture = texture
  }

  const setSession = (next: LabSession, sprite: ArenaWeaponSprite) => {
    if (import.meta.env.DEV) devHook.__tcLabPerf = perf
    unsubscribeReset?.()
    session?.releaseAll()
    session = next
    unsubscribeReset = next.onReset(clearEffects)
    clearEffects()
    buildDummies(next)
    // Action framing follows the equipped weapon's reach.
    refit()
    const request = ++spriteRequest
    const previous = loadedWeaponTexture
    loadedWeaponTexture = null
    setWeaponTexture(placeholderTexture)
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
  const spawnNumber = (event: Extract<SimEvent, { type: 'damage' }>, now: number, reduced: boolean) => {
    const n = numbers.acquire()
    // A full pool recycles its oldest number: forget that one's spot.
    layout.remove(n)
    const font = event.crit ? CRIT_FONT : DAMAGE_FONT
    if (n.font !== font) {
      n.text.style.fontFamily = font
      n.text.style.fontSize = event.crit ? 24 : 16
      n.font = font
    }
    n.text.text = String(event.amount)
    n.text.scale.set(1)
    n.text.visible = true
    n.bornAt = now
    n.x = event.x
    n.y = event.y
    n.crit = event.crit
    // Measured, rendered size at scale 1, plus the outline drawn outside it → a spot whose box
    // never meets a live number's box. The box is anchored where the outline ends (½ stroke below
    // the text's own anchor); the returned offset moves both alike.
    const bounds = n.text.getLocalBounds()
    const stroke = STROKE[font]
    const impact = worldToScreen(fit, event.x, event.y)
    const insetTop = options.insetTop?.() ?? 0
    const insetBottom = options.insetBottom?.() ?? 0
    const at = { x: impact.x, y: impact.y - NUMBER_LIFT_PX + stroke / 2 }
    const placed = layout.place(n, now, at, { w: bounds.width + stroke, h: bounds.height + stroke }, event.crit, reduced, {
      left: 0,
      top: insetTop,
      right: fit.cssWidth,
      bottom: fit.cssHeight - insetBottom,
    })
    for (const other of placed.evicted) retireNumber(other)
    perf.evictions += placed.evicted.length
    n.offsetX = placed.dx
    n.offsetY = placed.dy
    // Crits on the crit layer (always above normal hits); newest on top within a layer.
    ;(event.crit ? critNumbers : normalNumbers).addChild(n.text)
  }

  /**
   * Overlay cells (the reach guide's dashes, a thrust's streak) minus any beside a live damage
   * number: a mark next to a number at its height reads as a minus sign ("–15"). Numbers are
   * positioned for this frame first.
   */
  const cellsClearOfNumbers = (cells: [number, number][]) => {
    const live = renderedNumbers()
    if (live.length === 0) return cells
    const size = GAME_PX_PER_ART_PX * fit.scale
    // Each cell's screen box (CSS px), with its one-art-pixel drop below it.
    return cells.filter(([x, y]) => !readsAsPartOfNumber({ x: fit.originX + x * fit.scale, y: fit.originY + y * fit.scale, w: size, h: 2 * size }, live))
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

  /** Nothing moves once a timed test has finished: the frame stays clean under the results (UX_SPEC §12). */
  const clearAttack = () => {
    blade.visible = false
    trail.clear()
    guide.clear()
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

    for (const event of events) {
      if (event.type !== 'damage') continue
      spawnNumber(event, now, reduced)
      const view = dummyViews.get(event.dummyId)
      if (view) {
        view.hitAt = now
        view.dir = event.x <= state.dummies.find((d) => d.id === event.dummyId)!.x ? 1 : -1
      }
    }

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
      n.text.position.set(Math.round(p.x + n.offsetX), Math.round(p.y - NUMBER_LIFT_PX + n.offsetY + pose.dy))
      n.text.alpha = pose.alpha
      n.text.scale.set(pose.scale)
    }

    playerSprite.scale.set(state.facing * GAME_PX_PER_ART_PX, GAME_PX_PER_ART_PX)
    // A finished test halts the engine mid-attack: no frozen blade, trail or reach guide.
    if (s.getHud().timedTest.status === 'finished') clearAttack()
    else if (s.swing) drawSwing(state.blade, state.facing, alpha, now, s.swing.reachTiles, s.swing.arcDegrees)
    else drawThrust(state.blade?.kind === 'thrust' ? state.blade : null, state.facing, alpha, s.reachTiles)
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
