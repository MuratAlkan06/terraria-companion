import { Bomb, Check, Hourglass, Keyboard, MousePointerClick, Move, MoveHorizontal, MoveVertical, RotateCcw, Shield, Star, Tag, Timer, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../../components/cx'
import { PixelArt } from '../../../components/PixelArt'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { Item, SpriteIndex, Weapon } from '../../../data-access/types'
import { buildDummy } from '../../../lab/art/arenaArt'
import { ARENA_PALETTE } from '../../../lab/art/arenaPalette'
import { namedBoss, type BossDefense } from '../../../lab/labBossDefense'
import type { ExplosiveShape } from '../../../lab/labSession'
import {
  ammoClassName,
  ARMORED_DEFENSE_RANGE,
  BOSS_SCALES,
  DEFAULT_ARMORED_DEFENSE,
  DEFAULT_BOSS_SCALE,
  DEFAULT_LAB_TARGET,
  DEFAULT_MOVING_SPEED,
  DEFAULT_ROW_COUNT,
  LAB_TARGET_KINDS,
  MOVING_AXES,
  MOVING_PATH_TILES,
  MOVING_SPEED_RANGE,
  ROW_COUNTS,
  type AmmoChoices,
  type LabTarget,
  type LabTargetKind,
} from '../../../lab/labSetup'
import { getField } from '../../../schemas/getField'
import {
  APPROXIMATIONS,
  DEFAULT_LAB_SETTINGS,
  MAX_MINION_SLOTS,
  MAX_SENTRY_SLOTS,
  WHIP_TAG_DURATION_TICKS,
  type DummyMotionAxis,
  type InsufficientManaPolicy,
  type LabSettings,
  type MinionAiClass,
  type RenderState,
} from '../../../sim'
import { RangeCommit } from './rangeCommit'
import { AMMO_EFFECTS_NOTE, bossSizeWords, DEFENSE_RULE, DEFENSE_RULE_PHRASE, LOW_MANA_POLICY_TITLE, MOVING_PATH_WORDS } from './settingsCopy'

type DummyView = Pick<RenderState['dummies'][number], 'x' | 'width' | 'height' | 'defense' | 'path'>

/** How the equipped weapon is steered, when it is more than "press to attack" (the Controls list says so). */
export type SteerHint = 'yoyo' | 'beam' | null

/**
 * TargetSettingsPanel (UX_SPEC §3.4 "Target & settings"): the target, the setup and test settings
 * that apply to the equipped weapon, and how to attack. Nothing here is a disabled placeholder: each
 * section shows only when it applies.
 *
 * - Target (UX_SPEC §3.4 target picker, in its order: Infinite / Boss-Sized / Moving / Multiple / Armored /
 *   Debuff; PRD P3-S6 AC1, P3-S11 AC3, P3-S12): the Infinite Dummy; the Boss-Sized Dummy — 2×, 3× (to
 *   start) or 4× the Infinite Dummy's size, a Lab test size; the Moving Dummy — away and back or up and
 *   back, at 1–16 tiles/s (4 to start), test values; Multiple Dummies — a row of 2–5 (3 to start) whose
 *   first dummy is the primary target; the Armored Dummy — defense 0–100 (20 to start), a test value the
 *   player picks, or a boss's verified defense picked from the wiki's NPC data with its source (the boss
 *   named only while the value is that boss's — ../../../lab/labBossDefense.ts); or the Debuff Dummy (a
 *   Lab target: the Infinite Dummy, its active debuffs listed in the HUD). Choosing one — or changing
 *   its values — restarts the stats (src/lab/labSession.ts `setTarget`); the speed and defense sliders
 *   commit once per adjustment (./rangeCommit.ts), like max mana. Reset restores the Infinite Dummy. The
 *   card under the picker describes the engine's own dummies (size, defense, distances, the path).
 * - Ammo (PRD P3-S4 AC2, bows and guns): only the ammo that fits the weapon, as the engine accepts
 *   it (src/lab/labSetup.ts) — sprite, name, damage and its speed multiplier (every row). Choosing
 *   one loads it; the stats restart. The help says plainly that special ammo effects aren't modeled.
 * - Mana (PRD P3-S5, weapons with a mana cost): max mana; what a cast does without enough mana —
 *   the game's 40% slow cast (default, AMENDMENTS-008 B35, labeled with its wiki source) or the
 *   labeled "stop at zero" test setting; mana regeneration on/off; and the labeled "ignore mana
 *   (test mode)" toggle (the HUD shows an amber chip while it is on, UX_SPEC §5.7). Changing any of
 *   them restarts the stats (src/lab/labSession.ts), announced like an ammo switch — the max-mana
 *   slider once per adjustment, when it settles (./rangeCommit.ts), not on every step.
 * - Summons (PRD P3-S9 AC1, P3-S10; minion / sentry staves and whips): the slot settings — minion slots
 *   1–11, sentry slots 1–6, the wiki's default 1 and gear maximums, standing in for gear — and, with a
 *   whip, the MINION LOADOUT: a minion staff whose minions are out beside the whip (a labeled Lab test
 *   setup, src/lab/labAssumptions.ts `minion-loadout`). Changing either restarts the stats; Reset clears
 *   the loadout and restores one slot.
 * - ±15% damage variance on/off — the engine's own toggle.
 * - Homing on/off (PRD P3-S8; UX_SPEC §3): never shown here — no weapon the Lab equips homes (the P3-S8
 *   audit, src/lab/labWeapons.ts `homesInGame`). A weapon whose data says it homes is a limitation, and its
 *   LimitationCard shows the switch disabled, with the reason (`SettingSwitch`, `HOMING_SETTING_ID`).
 * The single Reset restores every default setting (the loaded ammo stays, like the weapon). While a
 * timed test runs, the panel is disabled by the page (inert, with a lock badge and the reason,
 * §5.7); `locked` also disables the inputs themselves.
 */
const TARGET_DUMMY_URL = 'https://terraria.wiki.gg/wiki/Target_Dummy'
export const VARIANCE_SETTING_ID = 'lab-setting-variance'
export const IGNORE_MANA_SETTING_ID = 'lab-setting-ignore-mana'
export const MANA_REGEN_SETTING_ID = 'lab-setting-mana-regen'
export const MAX_MANA_SETTING_ID = 'lab-setting-max-mana'
/** PRD P3-S8: the homing switch (shown disabled on a homing weapon's LimitationCard — no simulated weapon homes). */
export const HOMING_SETTING_ID = 'lab-setting-homing'
/** Max mana slider: 20 base + 20 per Mana Crystal (200 with all nine, wiki Mana); above that, gear bonuses. */
const MAX_MANA_RANGE = { min: 20, max: 400, step: 20 } as const
/**
 * The slider in the brand's zero-radius pixel style (UX_SPEC: no rounded corners): a square gold
 * thumb with a dark pixel edge on a sunken track — the native round thumb can't be squared, so both
 * engines' thumb and track are drawn here (WebKit/Blink, Gecko).
 */
const PIXEL_RANGE = cx(
  'h-tap w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-60',
  '[&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:border-2 [&::-webkit-slider-runnable-track]:border-night-600 [&::-webkit-slider-runnable-track]:bg-night-900',
  '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-night-950 [&::-webkit-slider-thumb]:bg-gold-400',
  '[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-none [&::-moz-range-track]:border-2 [&::-moz-range-track]:border-night-600 [&::-moz-range-track]:bg-night-900',
  '[&::-moz-range-progress]:h-2 [&::-moz-range-progress]:bg-gold-600',
  '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-night-950 [&::-moz-range-thumb]:bg-gold-400',
)

export interface AmmoPickerProps {
  choices: AmmoChoices
  /** The loaded ammo's id. */
  selectedId: number | null
  onSelect: (item: Item) => void
  sprites: SpriteIndex | null
}

/** The minion loadout picker (a whip is equipped): the minion staves the Lab equips, and the one chosen. */
export interface LoadoutPickerProps {
  choices: readonly Weapon[]
  selectedId: number | null
  onSelect: (weapon: Weapon | null) => void
  sprites: SpriteIndex | null
}

/** Summon settings for a summon staff (`kind`) or a whip (`kind` null, with the loadout picker). */
export interface SummonSettingsProps {
  kind: 'minion' | 'sentry' | null
  loadout: LoadoutPickerProps | null
}

export const MINION_SLOTS_SETTING = 'lab-setting-minion-slots'
export const SENTRY_SLOTS_SETTING = 'lab-setting-sentry-slots'

export interface TargetSettingsPanelProps {
  usesMana: boolean
  /** The first (primary) dummy, as the engine places it. */
  dummy: DummyView
  /** Every dummy, nearest first (Multiple Dummies); default just `dummy`. */
  dummies?: readonly DummyView[]
  /** The current target, and the picker's change handler (no handler: the card alone). */
  target?: LabTarget
  onTargetChange?: (target: LabTarget) => void
  /** How the equipped weapon is steered beyond press-and-hold (a yoyo, a held beam). */
  steer?: SteerHint
  settings: LabSettings
  onSettingsChange: (patch: Partial<LabSettings>) => void
  locked: boolean
  /** The equipped weapon's attack verb ("swing", "thrust", "shoot", "cast"). */
  verb?: string
  /** Bows and guns: the ammo picker. */
  ammo?: AmmoPickerProps | null
  /** Summon staves and whips: the slot settings (and a whip's minion loadout). */
  summons?: SummonSettingsProps | null
  /** A thrown explosive (P3-S11): how it lands and goes off, for the Controls list. */
  explosive?: ExplosiveShape | null
  /** The Armored Dummy's verified boss-defense quick picks (empty: the slider alone). */
  bossDefenses?: readonly BossDefense[]
}

export function TargetSettingsPanel({
  usesMana,
  dummy,
  dummies,
  target = DEFAULT_LAB_TARGET,
  onTargetChange,
  steer = null,
  settings,
  onSettingsChange,
  locked,
  verb = 'swing',
  ammo = null,
  summons = null,
  explosive = null,
  bossDefenses = [],
}: TargetSettingsPanelProps) {
  // The card's dummy art matches the arena's: armored for the Armored Dummy (P3-S12).
  const plainRows = useMemo(() => buildDummy(), [])
  const armoredRows = useMemo(() => buildDummy('armored'), [])
  const dummyRows = dummy.defense > 0 ? armoredRows : plainRows
  const variance = APPROXIMATIONS['damage-variance']
  const varianceDefault = DEFAULT_LAB_SETTINGS.damageVariance
  const row = target.kind === 'row' ? (dummies ?? [dummy]) : null

  return (
    <div className="space-y-6 text-sm">
      <section aria-labelledby="lab-target-title" className="space-y-3" data-lab-setting="target">
        <h3 id="lab-target-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Target
        </h3>
        {onTargetChange ? <TargetPicker target={target} onChange={onTargetChange} locked={locked} bossDefenses={bossDefenses} /> : null}
        <TargetCard target={target} dummy={dummy} row={row} dummyRows={dummyRows} boss={target.kind === 'armored' ? namedBoss(target, bossDefenses) : null} />
        <ProvenanceLink href={TARGET_DUMMY_URL} label="Target Dummy, on the wiki" />
      </section>

      {ammo ? <AmmoPicker {...ammo} locked={locked} /> : null}

      {usesMana ? <ManaSettings settings={settings} onSettingsChange={onSettingsChange} locked={locked} /> : null}

      {summons ? <SummonSettings {...summons} settings={settings} onSettingsChange={onSettingsChange} locked={locked} /> : null}

      {/* Not "lab-settings-title": that is the desktop side panel's own heading (labIds PANEL_SETTINGS). */}
      <section aria-labelledby="lab-test-settings-title" className="space-y-3" data-lab-settings="">
        <h3 id="lab-test-settings-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Test settings
        </h3>
        <div className="space-y-1" data-lab-setting="variance">
          <SettingSwitch
            id={VARIANCE_SETTING_ID}
            label="Damage variance ±15%"
            checked={settings.damageVariance}
            disabled={locked}
            onChange={(checked) => onSettingsChange({ damageVariance: checked })}
          />
          <p id={`${VARIANCE_SETTING_ID}-help`} className="text-xs text-fg-muted">
            Each hit rolls 85–115% of its damage, as the wiki describes. Off: every hit deals the same damage — handy for comparing
            weapons. {varianceDefault ? 'On' : 'Off'} by default.
          </p>
          {variance.sourceUrl ? <ProvenanceLink href={variance.sourceUrl} label="Damage, on the wiki" className="text-xs" /> : null}
        </div>
        <p className="flex gap-2 text-xs text-fg-muted">
          <RotateCcw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <span>
            Reset restores the default settings, along with the test and the target{ammo ? '; the loaded ammo stays' : ''}
            {summons?.loadout ? '; the minion loadout is cleared' : ''}.
          </span>
        </p>
      </section>

      <section aria-labelledby="lab-controls-title" className="space-y-2">
        <h3 id="lab-controls-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Controls
        </h3>
        <ul className="space-y-2 text-fg-muted">
          {summons?.kind ? (
            <li className="flex gap-2" data-summon-hint={summons.kind}>
              <MousePointerClick aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                {summons.kind === 'sentry'
                  ? 'Click the arena (tap on phones) to place a sentry exactly there: it never moves and attacks dummies within its range.'
                  : 'Click the arena (tap on phones) to summon a minion there: it attacks the dummies on its own.'}{' '}
                Holding keeps summoning only while slots are free; with them full, a new click replaces the oldest.
              </span>
            </li>
          ) : (
            <li className="flex gap-2">
              <MousePointerClick aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>Press and hold the arena (touch and hold on phones) to {verb} toward the pointer.</span>
            </li>
          )}
          {summons && !summons.kind ? (
            <li className="flex gap-2" data-steer-hint="whip">
              <Tag aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                Each dummy the whip strikes is tagged for {WHIP_TAG_DURATION_TICKS / 60} seconds: minion and sentry hits on it gain the whip’s tag damage,
                and summons switch to the dummy struck last.
              </span>
            </li>
          ) : null}
          {steer === 'yoyo' ? (
            <li className="flex gap-2" data-steer-hint="yoyo">
              <Move aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>The yoyo stays out while you hold, following the pointer within its reach; let go to call it back.</span>
            </li>
          ) : steer === 'beam' ? (
            <li className="flex gap-2" data-steer-hint="beam">
              <Move aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>The beam stays on while you hold and follows the pointer; let go to stop it.</span>
            </li>
          ) : null}
          {explosive ? (
            <li className="flex gap-2" data-steer-hint="explosive">
              <Bomb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                Each throw lands on the ground below where you aim
                {explosive.fuseTicks !== null ? ` and goes off ${formatTiles(explosive.fuseTicks / 60)} seconds after the throw` : ' and goes off when it touches a dummy or lands'}: one explosion hits
                every dummy within its {formatTiles(explosive.blastRadiusTiles)}-tile radius once. Each throw uses up one explosive.
              </span>
            </li>
          ) : null}
          <li className="flex gap-2">
            <Keyboard aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              {summons?.kind === 'sentry'
                ? 'Press Space to place a sentry 2 tiles in front of you.'
                : summons?.kind === 'minion'
                  ? 'Press Space to summon a minion beside you.'
                  : `Hold Space to ${verb} at the ${row ? 'first ' : ''}dummy${steer === 'yoyo' ? ' — the yoyo goes to it and stays while you hold' : ''}.`}
            </span>
          </li>
          <li className="flex gap-2">
            <Timer aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>A 10s or 30s test resets the Lab and attacks the dummy for exactly that long; settings lock until it ends.</span>
          </li>
          <li className="flex gap-2">
            <RotateCcw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Reset stops a test and restores the stats, the target and the default settings instantly.</span>
          </li>
        </ul>
      </section>
    </div>
  )
}

const formatTiles = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const RADIO_CARD = cx(
  'flex min-h-tap items-center gap-3 border-2 px-3 py-1.5',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
  'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
)

/** Each target's radio card: its name and what it is for (UX_SPEC §3.4 order: `LAB_TARGET_KINDS`). */
const TARGET_CHOICES: Readonly<Record<LabTargetKind, { title: string; note: string }>> = {
  single: { title: 'Infinite Dummy', note: 'One dummy · default' },
  boss: { title: 'Boss-Sized Dummy', note: 'A bigger hitbox: spread and area attacks land more' },
  moving: { title: 'Moving Dummy', note: 'Glides back and forth: shots can miss' },
  row: { title: 'Multiple Dummies', note: `A row of ${ROW_COUNTS[0]}–${ROW_COUNTS.at(-1)}: piercing, multi-target and blast tests` },
  armored: { title: 'Armored Dummy', note: `Adjustable defense: ${DEFENSE_RULE_PHRASE}` },
  debuff: { title: 'Debuff Dummy', note: 'One dummy that lists its active debuffs and their time left' },
}

/** The values each target kind was last set to during this visit, so switching back and forth keeps them. */
interface TargetMemory {
  count: number
  scale: number
  axis: DummyMotionAxis
  speedTps: number
  defense: number
  bossId: string | null
}

/** The target `kind` with the values remembered for it. */
function targetOf(kind: LabTargetKind, m: TargetMemory): LabTarget {
  switch (kind) {
    case 'row':
      return { kind, count: m.count }
    case 'boss':
      return { kind, scale: m.scale }
    case 'moving':
      return { kind, axis: m.axis, speedTps: m.speedTps }
    case 'armored':
      return { kind, defense: m.defense, bossId: m.bossId }
    default:
      return { kind }
  }
}

/**
 * The target picker: the six targets as radio cards (as the panel's other choices), and under them the
 * chosen target's own settings — the row's size, the Boss-Sized Dummy's size, the Moving Dummy's path and
 * speed, the Armored Dummy's defense (and its boss picks). The values chosen last are kept for this visit,
 * so switching back and forth doesn't forget them.
 */
function TargetPicker({ target, onChange, locked, bossDefenses }: { target: LabTarget; onChange: (target: LabTarget) => void; locked: boolean; bossDefenses: readonly BossDefense[] }) {
  const [memory, setMemory] = useState<TargetMemory>(() => ({
    count: target.kind === 'row' ? target.count : DEFAULT_ROW_COUNT,
    scale: target.kind === 'boss' ? target.scale : DEFAULT_BOSS_SCALE,
    axis: target.kind === 'moving' ? target.axis : MOVING_AXES[0],
    speedTps: target.kind === 'moving' ? target.speedTps : DEFAULT_MOVING_SPEED,
    defense: target.kind === 'armored' ? target.defense : DEFAULT_ARMORED_DEFENSE,
    bossId: target.kind === 'armored' ? target.bossId : null,
  }))
  // The live target's values win over the remembered ones (a Reset, a carried-over target).
  const current: TargetMemory = {
    ...memory,
    ...(target.kind === 'row' ? { count: target.count } : {}),
    ...(target.kind === 'boss' ? { scale: target.scale } : {}),
    ...(target.kind === 'moving' ? { axis: target.axis, speedTps: target.speedTps } : {}),
    ...(target.kind === 'armored' ? { defense: target.defense, bossId: target.bossId } : {}),
  }
  const choose = (kind: LabTargetKind, patch: Partial<TargetMemory> = {}) => {
    const next = { ...current, ...patch }
    setMemory(next)
    onChange(targetOf(kind, next))
  }
  return (
    <div className="space-y-3">
      <fieldset className="min-w-0 space-y-1.5" data-lab-setting="target-kind">
        <legend className="sr-only">Target</legend>
        {LAB_TARGET_KINDS.map((kind) => {
          const id = `lab-target-${kind}`
          const checked = target.kind === kind
          const c = TARGET_CHOICES[kind]
          return (
            <div key={kind} className="relative">
              <input type="radio" id={id} name="lab-target" value={kind} checked={checked} disabled={locked} onChange={() => choose(kind)} className="peer sr-only" />
              <label htmlFor={id} className={cx(RADIO_CARD, checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong')}>
                <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center border-2', checked ? 'border-gold-300' : 'border-stone-500')}>
                  {checked ? <span className="size-1.5 bg-gold-300" /> : null}
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-xs text-fg-muted">{c.note}</span>
                </span>
              </label>
            </div>
          )
        })}
      </fieldset>
      {target.kind === 'row' ? (
        <NumberCards
          legend="Dummies in the row"
          name="lab-target-count"
          setting="target-count"
          options={ROW_COUNTS.map((n) => ({ value: n, label: String(n) }))}
          checked={target.count}
          locked={locked}
          onPick={(count) => choose('row', { count })}
        />
      ) : null}
      {target.kind === 'boss' ? (
        <NumberCards
          legend="Size (tiles)"
          name="lab-target-scale"
          setting="target-scale"
          options={BOSS_SCALES.map((n) => ({ value: n, label: bossSizeWords(n).replace(' tiles', ''), sub: `${n}×`, spoken: `${bossSizeWords(n)}, ${n} times the Infinite Dummy` }))}
          checked={target.scale}
          locked={locked}
          onPick={(scale) => choose('boss', { scale })}
          help="Test sizes: the Infinite Dummy scaled up, not any boss’s hitbox."
        />
      ) : null}
      {target.kind === 'moving' ? <MovingSettings target={target} locked={locked} onPick={(patch) => choose('moving', patch)} /> : null}
      {target.kind === 'armored' ? <ArmoredSettings target={target} bossDefenses={bossDefenses} locked={locked} onPick={(patch) => choose('armored', patch)} /> : null}
      <p className="flex gap-2 text-xs text-fg-muted" data-target-restart-note="">
        <RotateCcw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>Changing the target restarts the stats. Reset brings back the Infinite Dummy.</span>
      </p>
    </div>
  )
}

/** A row of numbered radio cards (the row's size, the Boss-Sized Dummy's size) with an optional help line. */
function NumberCards({
  legend,
  name,
  setting,
  options,
  checked,
  locked,
  onPick,
  help,
}: {
  legend: string
  name: string
  setting: string
  options: readonly { value: number; label: string; sub?: string; spoken?: string }[]
  checked: number
  locked: boolean
  onPick: (value: number) => void
  help?: string
}) {
  const helpId = help ? `${name}-help` : undefined
  return (
    <fieldset className="min-w-0" data-lab-setting={setting} aria-describedby={helpId}>
      <legend className="mb-1.5 font-semibold">{legend}</legend>
      <div className={cx('grid gap-1.5', options.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {options.map((o) => {
          const id = `${name}-${o.value}`
          const on = checked === o.value
          return (
            <div key={o.value} className="relative">
              <input type="radio" id={id} name={name} value={o.value} checked={on} disabled={locked} onChange={() => onPick(o.value)} className="peer sr-only" />
              <label
                htmlFor={id}
                className={cx(
                  RADIO_CARD,
                  'flex-col justify-center gap-0 px-0 font-semibold tabular-nums',
                  on ? 'border-gold-500 bg-night-800 text-accent' : 'border-panel-border bg-panel hover:border-border-strong',
                )}
              >
                <span aria-hidden={o.spoken ? true : undefined}>{o.label}</span>
                {o.sub ? (
                  <span aria-hidden="true" className="text-xs font-normal text-fg-muted">
                    {o.sub}
                  </span>
                ) : null}
                {o.spoken ? <span className="sr-only">{o.spoken}</span> : null}
              </label>
            </div>
          )
        })}
      </div>
      {help ? (
        <p id={helpId} className="mt-1.5 text-xs text-fg-muted">
          {help}
        </p>
      ) : null}
    </fieldset>
  )
}

export const MOVING_SPEED_SETTING_ID = 'lab-target-speed'
export const ARMORED_DEFENSE_SETTING_ID = 'lab-target-defense'

/**
 * The Moving Dummy's path (away and back, or up and back — MOVING_PATH_TILES long) and speed (a slider that
 * commits once per adjustment). Says plainly that both are test values and that Space doesn't lead it.
 */
function MovingSettings({ target, locked, onPick }: { target: Extract<LabTarget, { kind: 'moving' }>; locked: boolean; onPick: (patch: Partial<TargetMemory>) => void }) {
  return (
    <div className="space-y-3" data-lab-setting="target-moving">
      <fieldset className="min-w-0 space-y-1.5" data-lab-setting="target-axis">
        <legend className="mb-1 font-semibold">Path</legend>
        {MOVING_AXES.map((axis) => {
          const id = `lab-target-axis-${axis}`
          const checked = target.axis === axis
          const Icon = axis === 'horizontal' ? MoveHorizontal : MoveVertical
          return (
            <div key={axis} className="relative">
              <input type="radio" id={id} name="lab-target-axis" value={axis} checked={checked} disabled={locked} onChange={() => onPick({ axis })} className="peer sr-only" />
              <label htmlFor={id} className={cx(RADIO_CARD, checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong')}>
                <Icon aria-hidden="true" className={cx('size-4 shrink-0', checked ? 'text-accent' : 'text-fg-muted')} />
                <span className="flex flex-col">
                  <span className="font-semibold">{MOVING_PATH_WORDS[axis].replace(/^./, (c) => c.toUpperCase())}</span>
                  <span className="text-xs text-fg-muted">
                    {MOVING_PATH_TILES[axis]} tiles {axis === 'horizontal' ? 'away from you, then back' : 'up, then back down'}
                  </span>
                </span>
              </label>
            </div>
          )
        })}
      </fieldset>
      <CommitSlider
        id={MOVING_SPEED_SETTING_ID}
        label="Speed"
        unit="tiles/s"
        range={MOVING_SPEED_RANGE}
        value={target.speedTps}
        locked={locked}
        setting="target-speed"
        onCommit={(speedTps) => {
          if (speedTps !== target.speedTps) onPick({ speedTps })
        }}
        help={
          <>
            Test values, not any enemy’s speed or path. Space and the timed tests aim where it is at each attack, without leading it — so shots can miss;
            aim ahead of it with the pointer to lead them.
          </>
        }
      />
    </div>
  )
}

/**
 * The Armored Dummy's defense: a slider (a test value the player picks, committed once per adjustment) and
 * the bosses whose verified defense it can take (radio rows; none checked for a value of your own). A boss
 * picked is named — with its wiki source — while the value is that boss's; moving the slider makes it a test
 * value again.
 */
function ArmoredSettings({
  target,
  bossDefenses,
  locked,
  onPick,
}: {
  target: Extract<LabTarget, { kind: 'armored' }>
  bossDefenses: readonly BossDefense[]
  locked: boolean
  onPick: (patch: Partial<TargetMemory>) => void
}) {
  const named = namedBoss(target, bossDefenses)
  const helpId = 'lab-target-boss-defense-help'
  return (
    <div className="space-y-3" data-lab-setting="target-armored">
      <CommitSlider
        id={ARMORED_DEFENSE_SETTING_ID}
        label="Defense"
        range={ARMORED_DEFENSE_RANGE}
        value={target.defense}
        locked={locked}
        setting="target-defense"
        onCommit={(defense) => {
          if (defense !== target.defense) onPick({ defense, bossId: null })
        }}
        help={
          named ? (
            <>
              {named.name}’s defense{named.multiForm ? ' (its first form’s)' : ''}, as the wiki lists it. Only the defense is applied — not its hitbox, attacks or
              phases. {DEFENSE_RULE}
            </>
          ) : (
            <>A test value you choose, not any enemy’s stat — or pick a boss below. {DEFENSE_RULE}</>
          )
        }
      />
      {named ? <ProvenanceLink href={named.sourceUrl} label={`${named.name}, on the wiki`} className="text-xs" /> : null}
      {bossDefenses.length > 0 ? (
        <fieldset className="min-w-0 space-y-1.5" aria-describedby={helpId} data-lab-setting="target-boss-defense">
          <legend className="mb-1 font-semibold">Or a boss’s defense</legend>
          {bossDefenses.map((b) => {
            const id = `lab-target-boss-${b.id}`
            const checked = named?.id === b.id
            return (
              <div key={b.id} className="relative" data-boss-defense={b.id}>
                <input
                  type="radio"
                  id={id}
                  name="lab-target-boss"
                  value={b.id}
                  checked={checked}
                  disabled={locked}
                  onChange={() => onPick({ defense: b.defense, bossId: b.id })}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  className={cx(RADIO_CARD, 'justify-between py-1', checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong')}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="leading-tight font-semibold">{b.name}</span>
                    {b.multiForm ? <span className="text-xs text-fg-muted">first form</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                    <Shield aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.15em] text-accent" />
                    <span className="font-semibold text-fg">{b.defense}</span> defense
                  </span>
                </label>
              </div>
            )
          })}
          <p id={helpId} className="text-xs text-fg-muted">
            Normal-mode defense from the wiki’s NPC data (the same in Expert and Master). Bosses whose defense isn’t verified aren’t listed.
          </p>
        </fieldset>
      ) : null}
    </div>
  )
}

/** The card under the picker: the engine's own dummy (size, defense, where it stands, its path). */
function TargetCard({ target, dummy, row, dummyRows, boss }: { target: LabTarget; dummy: DummyView; row: readonly DummyView[] | null; dummyRows: string[]; boss: BossDefense | null }) {
  const { width, height, defense, path } = dummy
  const name = row ? `${row.length} Infinite Dummies` : TARGET_CHOICES[target.kind].title
  const moves = path !== null
  return (
    <div className="flex items-center gap-3 border-2 border-gold-600 bg-night-700 p-3" data-target-card={target.kind}>
      <span className="grid size-16 shrink-0 place-items-center border-2 border-slot-border bg-slot">
        <PixelArt rows={dummyRows} palette={ARENA_PALETTE} className="h-12 w-8" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold" data-target-name="">
          {name}
        </p>
        <p className="text-xs text-fg-muted">
          {row ? 'Never die or move' : moves ? 'Never dies' : 'Never dies or moves'} · defense {defense}
          {boss ? ` (${boss.name}’s)` : ''} · {formatTiles(width)} × {formatTiles(height)} tiles{row ? ' each' : ''}
        </p>
        {row ? (
          <>
            <p className="text-xs text-fg-muted" data-dummy-distance={dummy.x}>
              Centres {row.map((d) => formatTiles(d.x)).join(', ')} tiles in front of you
            </p>
            <p className="flex items-center gap-1 text-xs text-fg-muted" data-primary-note="">
              <Star aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
              <span>Dummy 1 is the primary target: Space and the timed tests aim at it.</span>
            </p>
          </>
        ) : path ? (
          <p className="text-xs text-fg-muted" data-dummy-distance={path.fromX} data-dummy-path={`${path.fromX},${path.fromY}~${path.toX},${path.toY}`}>
            Starts {formatTiles(path.fromX)} tiles in front of you;{' '}
            {path.toY === path.fromY ? `travels to ${formatTiles(path.toX)} tiles and back` : `rises ${formatTiles(path.fromY - path.toY)} tiles and comes back down`}
            {target.kind === 'moving' ? ` at ${target.speedTps} tiles/s` : ''}
          </p>
        ) : (
          <p className="text-xs text-fg-muted" data-dummy-distance={dummy.x}>
            Centre {formatTiles(dummy.x)} tiles in front of you
          </p>
        )}
        {target.kind === 'debuff' ? (
          <p className="flex items-start gap-1 text-xs text-fg-muted" data-debuff-dummy-note="">
            <Hourglass aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-accent" />
            <span>A Lab target: an Infinite Dummy whose active debuffs — name, damage per second and time left — are listed with the live stats.</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Plain words for a minion's AI class (AMENDMENTS-013 B63 P-6), for the loadout rows. */
const AI_CLASS_WORDS: Record<MinionAiClass, string> = {
  'melee-contact': 'flies into enemies',
  'ground-melee': 'fights on the ground',
  'hover-strike': 'hovers and strikes',
  'ranged-shot': 'shoots',
}

/**
 * The summon settings: slots as a row of numbered radio cards (1 to the gear maximum, the wiki default
 * marked), and with a whip the minion loadout picker under them — the slots first, so on a phone they
 * aren't buried under the long staff list (design review nit). Each change restarts the stats (labSession.ts).
 */
function SummonSettings({ kind, loadout, settings, onSettingsChange, locked }: SummonSettingsProps & Pick<TargetSettingsPanelProps, 'settings' | 'onSettingsChange' | 'locked'>) {
  const sentry = kind === 'sentry'
  const max = sentry ? MAX_SENTRY_SLOTS : MAX_MINION_SLOTS
  const value = sentry ? settings.sentrySlots : settings.minionSlots
  const id = sentry ? SENTRY_SLOTS_SETTING : MINION_SLOTS_SETTING
  const slotsHelp = APPROXIMATIONS['summon-slots']
  return (
    <section aria-labelledby="lab-summons-title" className="space-y-3" data-lab-setting="summons">
      <h3 id="lab-summons-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {loadout ? 'Minions' : 'Summons'}
      </h3>
      <fieldset className="min-w-0" data-lab-setting={sentry ? 'sentry-slots' : 'minion-slots'} aria-describedby={`${id}-help`}>
        <legend className="mb-1.5 font-semibold">{sentry ? 'Sentry slots' : 'Minion slots'}</legend>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
            const optionId = `${id}-${n}`
            const checked = value === n
            return (
              <div key={n} className="relative">
                <input
                  type="radio"
                  id={optionId}
                  name={id}
                  value={n}
                  checked={checked}
                  disabled={locked}
                  onChange={() => onSettingsChange(sentry ? { sentrySlots: n } : { minionSlots: n })}
                  className="peer sr-only"
                />
                <label
                  htmlFor={optionId}
                  className={cx(
                    RADIO_CARD,
                    'justify-center px-0 font-semibold tabular-nums',
                    checked ? 'border-gold-500 bg-night-800 text-accent' : 'border-panel-border bg-panel hover:border-border-strong',
                  )}
                >
                  {n}
                </label>
              </div>
            )
          })}
        </div>
      </fieldset>
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        The game gives one {sentry ? 'sentry' : 'minion'} slot by default (the default here too); gear raises it to {max}. Each {sentry ? 'sentry' : 'minion'} takes its
        slot cost; with the slots full a new one replaces the oldest. Changing the slots restarts the stats.
      </p>
      {slotsHelp.sourceUrl ? <ProvenanceLink href={slotsHelp.sourceUrl} label="Minion-summoning weapons, on the wiki" className="text-xs" /> : null}
      {loadout ? <LoadoutPicker {...loadout} locked={locked} /> : null}
    </section>
  )
}

/** The minion loadout (with a whip): none, or one of the minion staves the Lab equips — rows like the ammo picker's. */
function LoadoutPicker({ choices, selectedId, onSelect, sprites, locked }: LoadoutPickerProps & { locked: boolean }) {
  const helpId = 'lab-loadout-help'
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={helpId} data-lab-setting="loadout">
      <legend className="mb-1 font-semibold">Minion loadout (test setup)</legend>
      <LoadoutRow weapon={null} checked={selectedId === null} onSelect={onSelect} sprites={sprites} locked={locked} />
      {choices.map((w) => (
        <LoadoutRow key={w.id} weapon={w} checked={w.id === selectedId} onSelect={onSelect} sprites={sprites} locked={locked} />
      ))}
      <p id={helpId} className="flex gap-2 text-xs text-fg-muted">
        <Users aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>
          A Lab test setup: the chosen staff’s minions are out from the start, as many as your minion slots hold, so the whip’s tags can boost them. In-game
          you summon them before switching to the whip. Choosing one restarts the stats; Reset clears it.
        </span>
      </p>
    </fieldset>
  )
}

function LoadoutRow({ weapon, checked, onSelect, sprites, locked }: { weapon: Weapon | null; checked: boolean; onSelect: (w: Weapon | null) => void; sprites: SpriteIndex | null; locked: boolean }) {
  const id = `lab-loadout-${weapon?.id ?? 'none'}`
  const params = weapon?.labBehavior.kind === 'archetype' && weapon.labBehavior.params.archetype === 'minion-sentry' ? weapon.labBehavior.params : null
  const rarityView = weapon ? getField(weapon, 'rarity') : null
  const rarity = rarityView?.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  return (
    <div className="relative" data-loadout-option={weapon?.id ?? 'none'}>
      <input type="radio" id={id} name="lab-loadout" value={weapon?.id ?? ''} checked={checked} disabled={locked} onChange={() => onSelect(weapon)} className="peer sr-only" />
      <label
        htmlFor={id}
        className={cx(
          'flex min-h-tap items-center gap-2.5 border-2 px-2 py-1',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
          checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong',
        )}
      >
        {weapon ? (
          <span className="grid size-8 shrink-0 place-items-center border-2 border-slot-border bg-slot">
            <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={24} maxScale={1} />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          {weapon ? (
            <RarityText rarity={rarity} className="text-sm leading-tight font-semibold">
              {weapon.name}
            </RarityText>
          ) : (
            <span className="text-sm leading-tight font-semibold">None</span>
          )}
          <span className="text-xs text-fg-muted">
            {checked ? <span className="font-semibold text-accent">{weapon ? 'Out' : 'Selected'}</span> : null}
            {params ? `${checked ? ' · ' : ''}${AI_CLASS_WORDS[params.aiClass]}, every ${params.attackRateTicks} ticks` : checked ? '' : 'The whip alone'}
          </span>
        </span>
        {weapon ? (
          <span className="shrink-0 text-right text-xs text-fg-muted tabular-nums">
            <span className="font-semibold text-fg" data-loadout-damage={weapon.damage}>
              {weapon.damage}
            </span>{' '}
            damage
          </span>
        ) : null}
      </label>
    </div>
  )
}

function AmmoPicker({ choices, selectedId, onSelect, sprites, locked }: AmmoPickerProps & { locked: boolean }) {
  const className = ammoClassName(choices)
  const helpId = 'lab-ammo-help'
  return (
    <section aria-labelledby="lab-ammo-title" className="space-y-2" data-lab-setting="ammo">
      <h3 id="lab-ammo-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Ammo
      </h3>
      <fieldset className="min-w-0 space-y-1.5" aria-describedby={helpId}>
        <legend className="sr-only">Ammo to fire</legend>
        {choices.usable.map((item) => (
          <AmmoRow key={item.id} item={item} checked={item.id === selectedId} isDefault={item.id === choices.defaultAmmo?.id} onSelect={onSelect} sprites={sprites} locked={locked} />
        ))}
      </fieldset>
      <p id={helpId} className="text-xs text-fg-muted">
        Only ammo of the {className} type fits this weapon. Damage adds to the weapon’s; speed changes how fast shots fly.
        {choices.defaultAmmo ? ` ${choices.defaultAmmo.name} is loaded first: the basic ammo its type is named after.` : ''} Switching
        ammo restarts the stats. <span data-ammo-effects-note="">{AMMO_EFFECTS_NOTE}</span>
      </p>
      {choices.refused.length > 0 ? (
        <p className="text-xs text-fg-muted" data-ammo-refused={choices.refused.length}>
          Not listed: {choices.refused.map((r) => r.item.name).join(', ')} — the data the Lab needs for {choices.refused.length === 1 ? 'it' : 'them'} (such as
          damage) isn’t verified.
        </p>
      ) : null}
    </section>
  )
}

function AmmoRow({
  item,
  checked,
  isDefault,
  onSelect,
  sprites,
  locked,
}: {
  item: Item
  checked: boolean
  isDefault: boolean
  onSelect: (item: Item) => void
  sprites: SpriteIndex | null
  locked: boolean
}) {
  const id = `lab-ammo-${item.id}`
  const rarityView = getField(item, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const stats = item.ammoStats
  return (
    <div className="relative" data-ammo-option={item.id}>
      <input
        type="radio"
        id={id}
        name="lab-ammo"
        value={item.id}
        checked={checked}
        disabled={locked}
        onChange={() => onSelect(item)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cx(
          'flex min-h-tap items-center gap-2.5 border-2 px-2 py-1',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
          checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong',
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center border-2 border-slot-border bg-slot">
          <SpriteImg src={item.sprite} sprites={sprites} placeholder="ranged" box={24} maxScale={1} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <RarityText rarity={rarity} className="text-sm leading-tight font-semibold">
            {item.name}
          </RarityText>
          {/* Every row shows its speed multiplier, ×1 included, so arrows and bullets read alike. */}
          <span className="text-xs text-fg-muted">
            {checked ? <span className="font-semibold text-accent">Loaded</span> : isDefault ? 'Default' : null}
            <span data-ammo-speed={stats?.velocityMultiplier ?? 1}>
              {checked || isDefault ? ' · ' : ''}speed ×{stats?.velocityMultiplier ?? 1}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-right text-xs text-fg-muted tabular-nums">
          <span className="font-semibold text-fg" data-ammo-damage={stats?.damage}>
            +{stats?.damage}
          </span>{' '}
          damage
        </span>
      </label>
    </div>
  )
}

function ManaSettings({ settings, onSettingsChange, locked }: Pick<TargetSettingsPanelProps, 'settings' | 'onSettingsChange' | 'locked'>) {
  const rule = APPROXIMATIONS['insufficient-mana']
  const regen = APPROXIMATIONS['mana-regen']
  const policies: readonly { value: InsufficientManaPolicy; title: string; note: string }[] = [
    { value: 'slow-cast', title: LOW_MANA_POLICY_TITLE['slow-cast'], note: 'Game behavior since 1.4.5.7 · default' },
    { value: 'block', title: LOW_MANA_POLICY_TITLE.block, note: 'Test setting: casting waits until mana covers the cost' },
  ]
  return (
    <section aria-labelledby="lab-mana-title" className="space-y-3" data-lab-setting="mana">
      <h3 id="lab-mana-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Mana
      </h3>

      <MaxManaSlider value={settings.maxMana} locked={locked} onCommit={(maxMana) => onSettingsChange({ maxMana })} />

      <fieldset className="min-w-0 space-y-1.5" data-lab-setting="low-mana">
        <legend className="mb-1 font-semibold">Low-mana casting</legend>
        {policies.map((p) => {
          const id = `lab-low-mana-${p.value}`
          const checked = settings.insufficientMana === p.value
          return (
            <div key={p.value} className="relative">
              <input
                type="radio"
                id={id}
                name="lab-low-mana"
                value={p.value}
                checked={checked}
                disabled={locked}
                onChange={() => onSettingsChange({ insufficientMana: p.value })}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cx(
                  'flex min-h-tap items-center gap-3 border-2 px-3 py-1.5',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
                  'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
                  checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong',
                )}
              >
                <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center border-2', checked ? 'border-gold-300' : 'border-stone-500')}>
                  {checked ? <span className="size-1.5 bg-gold-300" /> : null}
                </span>
                <span className="flex flex-col">
                  <span className="font-semibold">{p.title}</span>
                  <span className="text-xs text-fg-muted">{p.note}</span>
                </span>
              </label>
            </div>
          )
        })}
        <p className="text-xs text-fg-muted">
          With too little mana, magic weapons still cast at 40% attack speed — the game’s rule since 1.4.5.7 (the Lab assumes such casts use no
          mana).
        </p>
        {rule.sourceUrl ? <ProvenanceLink href={rule.sourceUrl} label="Mana, on the wiki" className="text-xs" /> : null}
      </fieldset>

      <div className="space-y-1" data-lab-setting="mana-regen">
        <SettingSwitch
          id={MANA_REGEN_SETTING_ID}
          label="Mana regeneration"
          checked={settings.manaRegen !== 'none'}
          disabled={locked}
          onChange={(checked) => onSettingsChange({ manaRegen: checked ? 'wiki-1.4.5.7' : 'none' })}
        />
        <p id={`${MANA_REGEN_SETTING_ID}-help`} className="text-xs text-fg-muted">
          {regen.detail} Off: mana only drains.
        </p>
      </div>

      <div className="space-y-1" data-lab-setting="ignore-mana">
        <SettingSwitch
          id={IGNORE_MANA_SETTING_ID}
          label="Ignore mana (test mode)"
          checked={settings.ignoreMana}
          disabled={locked}
          onChange={(checked) => onSettingsChange({ ignoreMana: checked })}
        />
        <p id={`${IGNORE_MANA_SETTING_ID}-help`} className="text-xs text-fg-muted">
          A test mode, not game behavior: mana never runs short and the pool stays full; mana used is still counted. While it is on, an amber
          “Test mode” chip shows with the live stats.
        </p>
      </div>

      <p className="flex gap-2 text-xs text-fg-muted" data-mana-restart-note="">
        <RotateCcw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>Changing a mana setting restarts the stats, with a full pool.</span>
      </p>
    </section>
  )
}

/**
 * Max mana: a change restarts the stats, so the slider commits once per adjustment (./rangeCommit.ts)
 * — when a drag or tap ends, when focus leaves, or half a second after the last arrow key — and only
 * then is the restart announced. Until then its readout follows the draft.
 */
function MaxManaSlider({ value, locked, onCommit }: { value: number; locked: boolean; onCommit: (maxMana: number) => void }) {
  return (
    <CommitSlider
      id={MAX_MANA_SETTING_ID}
      label="Max mana"
      range={MAX_MANA_RANGE}
      value={value}
      locked={locked}
      setting="max-mana"
      onCommit={onCommit}
      help={<>20 to start, +20 per Mana Crystal: {DEFAULT_LAB_SETTINGS.maxMana} with all nine (the default). Higher values stand for mana from gear.</>}
    />
  )
}

/**
 * A pixel-style range input whose change is expensive (it restarts the stats): it commits once per
 * adjustment (./rangeCommit.ts) — when a drag or tap ends, when focus leaves, or half a second after the
 * last arrow key; until then its readout (`data-<setting>`) follows the draft. Max mana, and the Moving
 * Dummy's speed and the Armored Dummy's defense (P3-S12).
 */
function CommitSlider({
  id,
  label,
  unit,
  range,
  value,
  locked,
  setting,
  onCommit,
  help,
}: {
  id: string
  label: string
  /** Shown after the value in the readout (e.g. "tiles/s"). */
  unit?: string
  range: { readonly min: number; readonly max: number; readonly step: number }
  value: number
  locked: boolean
  /** `data-lab-setting` of the wrapper; the readout carries `data-<setting>` = the shown value. */
  setting: string
  onCommit: (value: number) => void
  help: ReactNode
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const commitRef = useRef(onCommit)
  const controlRef = useRef<RangeCommit | null>(null)
  useEffect(() => {
    commitRef.current = onCommit
  })
  // A drag released off the slider still ends it; a chosen value is committed even if the panel closes first.
  useEffect(() => {
    const control = new RangeCommit((committed) => {
      setDraft(null)
      commitRef.current(committed)
    })
    controlRef.current = control
    const release = () => control.pointerUp()
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      controlRef.current = null
      control.commit()
    }
  }, [])
  const shown = draft ?? value
  return (
    <div className="space-y-1" data-lab-setting={setting}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        <output htmlFor={id} className="font-semibold tabular-nums" {...{ [`data-${setting}`]: shown }}>
          {shown}
          {unit ? <span className="font-normal text-fg-muted"> {unit}</span> : null}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        disabled={locked}
        onPointerDown={() => controlRef.current?.pointerDown()}
        onChange={(event) => {
          const next = Number(event.target.value)
          setDraft(next)
          controlRef.current?.input(next)
        }}
        onBlur={() => controlRef.current?.blur()}
        aria-describedby={`${id}-help`}
        {...(unit ? { 'aria-valuetext': `${shown} ${unit}` } : {})}
        className={PIXEL_RANGE}
      />
      <p id={`${id}-help`} className="text-xs text-fg-muted">
        {help}
      </p>
    </div>
  )
}

/**
 * A labeled on/off switch (native checkbox with role="switch"); its help text is `${id}-help`. `stateText`
 * replaces the visible "On"/"Off" (a switch that can't be used says so — the help text says why).
 */
export function SettingSwitch({
  id,
  label,
  checked,
  disabled,
  onChange,
  stateText,
}: {
  id: string
  label: ReactNode
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  stateText?: string
}) {
  return (
    <div className="relative">
      <input
        type="checkbox"
        role="switch"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-help`}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cx(
          'flex min-h-tap items-center gap-3 border-2 border-panel-border bg-panel px-3 py-2 font-semibold',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        )}
      >
        <span aria-hidden="true" className={cx('grid size-5 shrink-0 place-items-center border-2', checked ? 'border-gold-300 bg-gold-500' : 'border-stone-500 bg-slot')}>
          {checked ? <Check className="size-3.5 text-fg-on-accent" strokeWidth={3} /> : null}
        </span>
        <span className="flex-1">{label}</span>
        <span aria-hidden="true" className="text-xs text-fg-muted">
          {stateText ?? (checked ? 'On' : 'Off')}
        </span>
      </label>
    </div>
  )
}
