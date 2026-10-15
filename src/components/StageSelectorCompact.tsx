import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useSettingsStore } from '../app/settingsStore'
import { getStageInfo, isStage, STAGES } from '../app/stages'
import { cx } from './cx'

/**
 * StageSelectorCompact — header chip + 5-stage Radix dropdown (UX_SPEC §2, §3.1).
 * Writes `tc.v1.settings` through the settings store. Selection snaps instantly
 * (UX_SPEC §12: a setting, not a celebration).
 */
export function StageSelectorCompact({ className }: { className?: string }) {
  const selectedStage = useSettingsStore((s) => s.settings.selectedStage)
  const persistError = useSettingsStore((s) => s.persistError)
  const setStage = useSettingsStore((s) => s.setStage)
  const info = selectedStage ? getStageInfo(selectedStage) : null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cx(
          'group inline-flex min-h-tap items-center gap-2 border-2 bg-panel px-3 text-sm font-semibold shadow-pixel',
          'transition-colors duration-(--dur-ui) ease-out-strong hover:bg-night-700 data-[state=open]:bg-night-700',
          info ? 'border-gold-600 text-fg' : 'border-panel-border text-fg-muted',
          className,
        )}
      >
        <span aria-hidden="true" className={cx('size-2.5 border-2', info ? 'border-gold-300 bg-gold-500' : 'border-stone-400')} />
        <span>
          <span className="sr-only">Game stage: </span>
          {info ? (
            <>
              <span className="lg:hidden">{info.shortLabel}</span>
              <span className="hidden lg:inline">{info.label}</span>
            </>
          ) : (
            'Set stage'
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-(--dur-ui) group-data-[state=open]:rotate-180"
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-(--z-popover) min-w-60 border-2 border-panel-border bg-surface p-1 text-fg shadow-pixel-drop"
        >
          <DropdownMenu.Label className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Game stage
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={selectedStage ?? ''}
            onValueChange={(value) => {
              if (isStage(value)) setStage(value)
            }}
          >
            {STAGES.map((stage) => (
              <DropdownMenu.RadioItem
                key={stage.id}
                value={stage.id}
                className={cx(
                  'flex min-h-tap items-center gap-3 px-3 text-sm outline-none select-none',
                  'data-highlighted:bg-night-700 data-highlighted:outline-2 data-highlighted:-outline-offset-2 data-highlighted:outline-ring data-highlighted:outline-solid',
                  'data-[state=checked]:font-semibold data-[state=checked]:text-accent',
                )}
              >
                <span className="grid size-4 place-items-center" aria-hidden="true">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {stage.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Label className={cx('px-3 pt-1 pb-2 text-xs', persistError ? 'text-negative' : 'text-fg-muted')}>
            {persistError ? "Couldn't save on this device — kept for this visit only." : 'Saved on this device.'}
          </DropdownMenu.Label>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
