import { Keyboard, MousePointerClick, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { PixelArt } from '../../../components/PixelArt'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { buildDummy } from '../../../lab/art/arenaArt'
import { ARENA_PALETTE } from '../../../lab/art/arenaPalette'
import { APPROXIMATIONS, type RenderState } from '../../../sim'

type DummyView = Pick<RenderState['dummies'][number], 'width' | 'height' | 'defense'>

/**
 * TargetSettingsPanel (UX_SPEC §3.4), P3-S1 scope: the Infinite Dummy as the only target, the
 * test settings that apply to the equipped weapon, and how to attack. More targets and settings
 * arrive with their slices (P3-S2/S3) — nothing here is a disabled placeholder. The panel's own
 * title ("Target") names it, so the dummy's section is labelled by the dummy's name.
 *
 * Low-mana casting (AMENDMENTS-008 B35): the Lab must label the 40% rule with its wiki source
 * wherever it applies — shown only while the equipped weapon uses mana (none of the swords the
 * Lab equips so far do). The copy and link come from the engine's `insufficient-mana` approximation.
 */
const TARGET_DUMMY_URL = 'https://terraria.wiki.gg/wiki/Target_Dummy'

export function TargetSettingsPanel({ usesMana, dummy }: { usesMana: boolean; dummy: DummyView }) {
  const dummyRows = useMemo(() => buildDummy(), [])
  const { width, height, defense } = dummy
  const mana = APPROXIMATIONS['insufficient-mana']

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

      {usesMana ? (
        <section aria-labelledby="lab-settings-title" className="space-y-2" data-lab-setting="low-mana">
          <h3 id="lab-settings-title" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Test settings
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
            <span>Press and hold the arena (touch and hold on phones) to swing toward the pointer.</span>
          </li>
          <li className="flex gap-2">
            <Keyboard aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Hold Space to swing at the dummy.</span>
          </li>
          <li className="flex gap-2">
            <RotateCcw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>Reset clears the stats and the dummy instantly.</span>
          </li>
        </ul>
      </section>
    </div>
  )
}
