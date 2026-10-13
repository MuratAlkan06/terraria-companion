import { Check, Keyboard, MousePointerClick, RotateCcw, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { cx } from '../../../components/cx'
import { PixelArt } from '../../../components/PixelArt'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { buildDummy } from '../../../lab/art/arenaArt'
import { ARENA_PALETTE } from '../../../lab/art/arenaPalette'
import { APPROXIMATIONS, DEFAULT_LAB_SETTINGS, type LabSettings, type RenderState } from '../../../sim'

type DummyView = Pick<RenderState['dummies'][number], 'width' | 'height' | 'defense'>

/**
 * TargetSettingsPanel (UX_SPEC §3.4): the Infinite Dummy as the only target, the test settings that
 * apply to the equipped weapon, and how to attack. Nothing here is a disabled placeholder; more
 * targets arrive with their slices (P3-S6/S12).
 *
 * Test settings (PRD P3-S2 AC3): ±15% damage variance on/off — the engine's own toggle, which the
 * variance AssumptionsTip already says "can be turned off". The single Reset restores the default
 * (on). While a timed test runs, the panel's controls are disabled by the page (inert, with a lock
 * badge and the reason, UX_SPEC §5.7); `locked` also disables the inputs themselves.
 *
 * Low-mana casting (AMENDMENTS-008 B35): the Lab must label the 40% rule with its wiki source
 * wherever it applies — shown only while the equipped weapon uses mana. The copy and link come
 * from the engine's `insufficient-mana` approximation.
 */
const TARGET_DUMMY_URL = 'https://terraria.wiki.gg/wiki/Target_Dummy'
export const VARIANCE_SETTING_ID = 'lab-setting-variance'

export interface TargetSettingsPanelProps {
  usesMana: boolean
  dummy: DummyView
  settings: LabSettings
  onSettingsChange: (patch: Partial<LabSettings>) => void
  locked: boolean
  /** The equipped weapon's attack verb ("swing", "thrust"). */
  verb?: string
}

export function TargetSettingsPanel({ usesMana, dummy, settings, onSettingsChange, locked, verb = 'swing' }: TargetSettingsPanelProps) {
  const dummyRows = useMemo(() => buildDummy(), [])
  const { width, height, defense } = dummy
  const mana = APPROXIMATIONS['insufficient-mana']
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
          </div>
        </div>
        <ProvenanceLink href={TARGET_DUMMY_URL} label="Target Dummy, on the wiki" />
      </section>

      <section aria-labelledby="lab-settings-title" className="space-y-3" data-lab-settings="">
        <h3 id="lab-settings-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Test settings
        </h3>
        <div className="space-y-1" data-lab-setting="variance">
          <div className="relative">
            <input
              type="checkbox"
              role="switch"
              id={VARIANCE_SETTING_ID}
              checked={settings.damageVariance}
              disabled={locked}
              onChange={(event) => onSettingsChange({ damageVariance: event.target.checked })}
              aria-describedby={`${VARIANCE_SETTING_ID}-help`}
              className="peer sr-only"
            />
            <label
              htmlFor={VARIANCE_SETTING_ID}
              className={cx(
                'flex min-h-tap items-center gap-3 border-2 border-panel-border bg-panel px-3 py-2 font-semibold',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
              )}
            >
              <span
                aria-hidden="true"
                className={cx('grid size-5 shrink-0 place-items-center border-2', settings.damageVariance ? 'border-gold-300 bg-gold-500' : 'border-stone-500 bg-slot')}
              >
                {settings.damageVariance ? <Check className="size-3.5 text-fg-on-accent" strokeWidth={3} /> : null}
              </span>
              <span className="flex-1">Damage variance ±15%</span>
              <span aria-hidden="true" className="text-xs text-fg-muted">
                {settings.damageVariance ? 'On' : 'Off'}
              </span>
            </label>
          </div>
          <p id={`${VARIANCE_SETTING_ID}-help`} className="text-xs text-fg-muted">
            Each hit rolls 85–115% of its damage, as the wiki describes. Off: every hit deals the same damage — handy for comparing
            weapons. {varianceDefault ? 'On' : 'Off'} by default.
          </p>
          {variance.sourceUrl ? <ProvenanceLink href={variance.sourceUrl} label="Damage, on the wiki" className="text-xs" /> : null}
        </div>
        <p className="flex gap-2 text-xs text-fg-muted">
          <RotateCcw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <span>Reset restores the default settings, along with the test and the dummy.</span>
        </p>
      </section>

      {usesMana ? (
        <section aria-labelledby="lab-mana-title" className="space-y-2" data-lab-setting="low-mana">
          <h3 id="lab-mana-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Mana
          </h3>
          <p className="font-semibold">Low-mana casting</p>
          <p className="text-fg-muted">With too little mana, magic weapons still cast at 40% attack speed — the game’s rule since 1.4.5.7.</p>
          {mana.sourceUrl ? <ProvenanceLink href={mana.sourceUrl} label="Mana, on the wiki" /> : null}
        </section>
      ) : null}

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
