import { Check, Keyboard, MousePointerClick, RotateCcw, Timer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../../components/cx'
import { PixelArt } from '../../../components/PixelArt'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { Item, SpriteIndex } from '../../../data-access/types'
import { buildDummy } from '../../../lab/art/arenaArt'
import { ARENA_PALETTE } from '../../../lab/art/arenaPalette'
import { ammoClassName, type AmmoChoices } from '../../../lab/labSetup'
import { getField } from '../../../schemas/getField'
import { APPROXIMATIONS, DEFAULT_LAB_SETTINGS, type InsufficientManaPolicy, type LabSettings, type RenderState } from '../../../sim'
import { RangeCommit } from './rangeCommit'
import { AMMO_EFFECTS_NOTE, LOW_MANA_POLICY_TITLE } from './settingsCopy'

type DummyView = Pick<RenderState['dummies'][number], 'x' | 'width' | 'height' | 'defense'>

/**
 * TargetSettingsPanel (UX_SPEC §3.4 "Target & settings"): the Infinite Dummy, the setup and test
 * settings that apply to the equipped weapon, and how to attack. Nothing here is a disabled
 * placeholder: each section shows only when it applies; more targets arrive with their slices
 * (P3-S6/S12).
 *
 * - Ammo (PRD P3-S4 AC2, bows and guns): only the ammo that fits the weapon, as the engine accepts
 *   it (src/lab/labSetup.ts) — sprite, name, damage and its speed multiplier (every row). Choosing
 *   one loads it; the stats restart. The help says plainly that special ammo effects aren't modeled.
 * - Mana (PRD P3-S5, weapons with a mana cost): max mana; what a cast does without enough mana —
 *   the game's 40% slow cast (default, AMENDMENTS-008 B35, labeled with its wiki source) or the
 *   labeled "stop at zero" test setting; mana regeneration on/off; and the labeled "ignore mana
 *   (test mode)" toggle (the HUD shows an amber chip while it is on, UX_SPEC §5.7). Changing any of
 *   them restarts the stats (src/lab/labSession.ts), announced like an ammo switch — the max-mana
 *   slider once per adjustment, when it settles (./rangeCommit.ts), not on every step.
 * - ±15% damage variance on/off — the engine's own toggle.
 * The single Reset restores every default setting (the loaded ammo stays, like the weapon). While a
 * timed test runs, the panel is disabled by the page (inert, with a lock badge and the reason,
 * §5.7); `locked` also disables the inputs themselves.
 */
const TARGET_DUMMY_URL = 'https://terraria.wiki.gg/wiki/Target_Dummy'
export const VARIANCE_SETTING_ID = 'lab-setting-variance'
export const IGNORE_MANA_SETTING_ID = 'lab-setting-ignore-mana'
export const MANA_REGEN_SETTING_ID = 'lab-setting-mana-regen'
export const MAX_MANA_SETTING_ID = 'lab-setting-max-mana'
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

export interface TargetSettingsPanelProps {
  usesMana: boolean
  dummy: DummyView
  settings: LabSettings
  onSettingsChange: (patch: Partial<LabSettings>) => void
  locked: boolean
  /** The equipped weapon's attack verb ("swing", "thrust", "shoot", "cast"). */
  verb?: string
  /** Bows and guns: the ammo picker. */
  ammo?: AmmoPickerProps | null
}

export function TargetSettingsPanel({ usesMana, dummy, settings, onSettingsChange, locked, verb = 'swing', ammo = null }: TargetSettingsPanelProps) {
  const dummyRows = useMemo(() => buildDummy(), [])
  const { width, height, defense } = dummy
  const variance = APPROXIMATIONS['damage-variance']
  const varianceDefault = DEFAULT_LAB_SETTINGS.damageVariance

  return (
    <div className="space-y-6 text-sm">
      <section aria-labelledby="lab-target-title" className="space-y-3">
        <div className="flex items-center gap-3 border-2 border-gold-600 bg-night-700 p-3">
          <span className="grid size-16 shrink-0 place-items-center border-2 border-slot-border bg-slot">
            <PixelArt rows={dummyRows} palette={ARENA_PALETTE} className="h-12 w-8" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h3 id="lab-target-title" className="font-semibold">
              Infinite Dummy
            </h3>
            <p className="text-xs text-fg-muted">
              Never dies or moves · defense {defense} · {width} × {height} tiles
            </p>
            <p className="text-xs text-fg-muted" data-dummy-distance={dummy.x}>
              Centre {formatTiles(dummy.x)} tiles in front of you
            </p>
          </div>
        </div>
        <ProvenanceLink href={TARGET_DUMMY_URL} label="Target Dummy, on the wiki" />
      </section>

      {ammo ? <AmmoPicker {...ammo} locked={locked} /> : null}

      {usesMana ? <ManaSettings settings={settings} onSettingsChange={onSettingsChange} locked={locked} /> : null}

      <section aria-labelledby="lab-settings-title" className="space-y-3" data-lab-settings="">
        <h3 id="lab-settings-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
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
          <span>Reset restores the default settings, along with the test and the dummy{ammo ? '; the loaded ammo stays' : ''}.</span>
        </p>
      </section>

      <section aria-labelledby="lab-controls-title" className="space-y-2">
        <h3 id="lab-controls-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Controls
        </h3>
        <ul className="space-y-2 text-fg-muted">
          <li className="flex gap-2">
            <MousePointerClick aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Press and hold the arena (touch and hold on phones) to {verb} toward the pointer.</span>
          </li>
          <li className="flex gap-2">
            <Keyboard aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Hold Space to {verb} at the dummy.</span>
          </li>
          <li className="flex gap-2">
            <Timer aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>A 10s or 30s test resets the Lab and attacks the dummy for exactly that long; settings lock until it ends.</span>
          </li>
          <li className="flex gap-2">
            <RotateCcw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Reset stops a test and restores the stats, the dummy and the default settings instantly.</span>
          </li>
        </ul>
      </section>
    </div>
  )
}

const formatTiles = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

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
    <div className="space-y-1" data-lab-setting="max-mana">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={MAX_MANA_SETTING_ID} className="font-semibold">
          Max mana
        </label>
        <output htmlFor={MAX_MANA_SETTING_ID} className="font-semibold tabular-nums" data-max-mana={shown}>
          {shown}
        </output>
      </div>
      <input
        id={MAX_MANA_SETTING_ID}
        type="range"
        min={MAX_MANA_RANGE.min}
        max={MAX_MANA_RANGE.max}
        step={MAX_MANA_RANGE.step}
        value={shown}
        disabled={locked}
        onPointerDown={() => controlRef.current?.pointerDown()}
        onChange={(event) => {
          const next = Number(event.target.value)
          setDraft(next)
          controlRef.current?.input(next)
        }}
        onBlur={() => controlRef.current?.blur()}
        aria-describedby={`${MAX_MANA_SETTING_ID}-help`}
        className={PIXEL_RANGE}
      />
      <p id={`${MAX_MANA_SETTING_ID}-help`} className="text-xs text-fg-muted">
        20 to start, +20 per Mana Crystal: {DEFAULT_LAB_SETTINGS.maxMana} with all nine (the default). Higher values stand for mana from gear.
      </p>
    </div>
  )
}

/** A labeled on/off switch (native checkbox with role="switch"); its help text is `${id}-help`. */
function SettingSwitch({ id, label, checked, disabled, onChange }: { id: string; label: ReactNode; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
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
          {checked ? 'On' : 'Off'}
        </span>
      </label>
    </div>
  )
}
