import { Check } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useSettingsStore } from '../app/settingsStore'
import { isStage, STAGES } from '../app/stages'
import { cx } from './cx'
import { NoBreak } from './NoBreak'

/**
 * StageSelector — full 5-chip stage picker (UX_SPEC §3.1/§3.2). Same store as the
 * header's StageSelectorCompact, so both stay in sync and persist to
 * `tc.v1.settings`. A Radix radio group: one tab stop, arrow keys move + select.
 * The selected chip gets a gold frame, a doubled inner frame and a check mark
 * (weight + glyph, not colour alone). Selection snaps instantly (UX_SPEC §12).
 * Keyboard focus is a separate dark-then-light double ring outside the frame, so
 * focused and selected never look alike (design review N4).
 * Labels never wrap: from md up the chips share rows, are never narrower than
 * their label and wrap whole, so every chip stays one line and the same height (N2).
 */
export interface StageSelectorProps {
  /** id of the visible heading that names the group. */
  labelledBy: string
  /** id of helper text describing the group. */
  describedBy?: string
  className?: string
}

export function StageSelector({ labelledBy, describedBy, className }: StageSelectorProps) {
  const selectedStage = useSettingsStore((s) => s.settings.selectedStage)
  const setStage = useSettingsStore((s) => s.setStage)

  return (
    <RadioGroup.Root
      value={selectedStage ?? ''}
      onValueChange={(value) => {
        if (isStage(value)) setStage(value)
      }}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cx('grid grid-cols-1 gap-2 md:flex md:flex-wrap', className)}
    >
      {STAGES.map((stage) => (
        <RadioGroup.Item
          key={stage.id}
          value={stage.id}
          className={cx(
            'group flex min-h-tap items-center gap-3 border-2 px-3 py-2 text-left text-sm font-semibold shadow-pixel',
            // md: at most three per row (four quarter-bases + gaps never fit) -> 3+2; lg+: one row sized by label.
            'md:grow md:basis-1/4 lg:basis-0',
            'transition-transform duration-(--dur-press) ease-out-strong active:scale-[0.97]',
            'focus-visible:outline-fg focus-visible:ring-2 focus-visible:ring-night-950',
            'data-[state=checked]:border-slot-selected data-[state=checked]:bg-slot-hover data-[state=checked]:text-accent data-[state=checked]:shadow-slot-selected',
            'data-[state=unchecked]:border-panel-border data-[state=unchecked]:bg-slot data-[state=unchecked]:text-fg data-[state=unchecked]:hover:bg-night-700',
          )}
        >
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center border-2 border-stone-400 group-data-[state=checked]:border-gold-300 group-data-[state=checked]:bg-gold-500"
          >
            <RadioGroup.Indicator>
              <Check className="size-3.5 text-fg-on-accent" strokeWidth={3} />
            </RadioGroup.Indicator>
          </span>
          <NoBreak>{stage.label}</NoBreak>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
