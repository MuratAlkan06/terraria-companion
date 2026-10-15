import { Search, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useMemo, useState } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { slotOptions, type BuilderData, type BuilderInput, type SlotId, type SlotOption } from '../../../scoring/recommend'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import * as copy from './loadoutCopy'
import { AvailabilityChips, ItemName, ItemSquare, NoAmmoLine, ScoreFigure } from './LoadoutBits'

/**
 * Swap-a-pick (PRD P4-S2 scope; UX_SPEC §3.5): the slot's whole legal pool — verified obtainable at the
 * user's progress, or gear they own with Unknown availability — ranked by the slot's own score given
 * what the OTHER slots hold. Candidates that can't go here (in another slot, a second pair of wings,
 * a direct upgrade pair, a buff already in the loadout) are listed with the reason, never hidden. A
 * modal dialog (Radix: focus trap, Esc, focus back to the slot's Swap button). Rows are not buttons:
 * each has its own "Use this", so the estimate chip beside the score stays a separate control.
 * AMENDMENTS-016 B108: rows tied with the current pick say so; an ammo weapon scored without ammo says
 * so in its row (M9); the count keeps owned gear of Unknown availability apart from the verified (H3).
 */
export interface SwapSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slot: SlotId | null
  label: string
  input: BuilderInput
  data: BuilderData
  page: ReadinessPageData
  pinned: boolean
  onPick: (option: SlotOption) => void
  onEmpty: () => void
  onReset: () => void
  returnFocus: () => HTMLElement | null | undefined
}

/** Rows drawn at once; the filter narrows the rest. */
export const SWAP_ROWS = 40

export function SwapSheet(props: SwapSheetProps) {
  const { open, onOpenChange, slot } = props
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            props.returnFocus()?.focus()
          }}
          data-swap-sheet={slot ?? ''}
          className={cx(
            'fixed z-(--z-dialog) flex flex-col bg-surface text-fg shadow-pixel-drop',
            'inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85dvh] md:w-[min(40rem,calc(100vw-2rem))] md:-translate-1/2 md:border-2 md:border-panel-border',
          )}
        >
          {slot ? <SheetBody {...props} slot={slot} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SheetBody({ slot, label, input, data, page, pinned, onPick, onEmpty, onReset }: SwapSheetProps & { slot: SlotId }) {
  const options = useMemo(() => slotOptions(input, data, slot), [input, data, slot])
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matching = q === '' ? options.options : options.options.filter((o) => o.name.toLowerCase().includes(q))
  const shown = matching.slice(0, SWAP_ROWS)
  const owned = matching.filter((o) => o.ownedUnknown).length
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Dialog.Title className="font-display text-sm leading-relaxed text-accent md:text-base">{copy.swapTitle(label)}</Dialog.Title>
        <Dialog.Close aria-label={copy.SWAP_CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="px-3 pt-2 text-sm text-fg-muted">{copy.SWAP_DESCRIPTION}</Dialog.Description>
      <div className="space-y-2 px-3 py-2">
        {options.options.length > SWAP_ROWS || q !== '' ? (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              aria-label={copy.SWAP_FILTER}
              placeholder={copy.SWAP_FILTER}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              className="h-tap w-full min-w-0 border-2 border-panel-border bg-surface-sunken pr-3 pl-10 text-base text-fg placeholder:text-fg-muted focus:border-gold-600"
            />
          </div>
        ) : null}
        <p role="status" className="text-xs text-fg-muted">
          {options.options.length === 0 ? copy.SWAP_NO_POOL : matching.length === 0 ? copy.SWAP_NONE : copy.swapCount(shown.length, matching.length, owned)}
        </p>
        <div className="flex flex-wrap gap-2">
          {options.canEmpty ? (
            <button type="button" onClick={onEmpty} className={buttonClass('secondary', 'min-h-tap text-sm')} data-swap-empty="">
              {copy.SWAP_EMPTY_OPTION}
            </button>
          ) : null}
          {pinned ? (
            <button type="button" onClick={onReset} className={buttonClass('secondary', 'min-h-tap text-sm')} data-swap-reset="">
              {copy.RESET_PICK}
            </button>
          ) : null}
        </div>
      </div>
      <ul aria-label={copy.swapTitle(label)} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-safe">
        {shown.map((o) => (
          <li key={o.key} data-option={o.id} data-blocked={o.blocked ?? undefined} className={cx('flex items-center gap-3 border-2 px-2 py-1.5', o.current ? 'border-gold-600 bg-night-800' : 'border-transparent')}>
            <ItemSquare page={page} id={o.id} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-2">
                <ItemName page={page} id={o.id} name={o.name} tap />
                {o.current ? <span className="text-xs font-semibold text-accent">{copy.SWAP_CURRENT}</span> : null}
                {o.tied ? (
                  <span className="border border-stone-600 px-1 text-[0.6875rem] leading-4 font-semibold text-fg-muted" data-tied="">
                    {copy.TIED}
                  </span>
                ) : null}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <ScoreFigure score={o.score} />
                <span className="text-xs text-fg-muted">{o.score.label}</span>
              </p>
              {o.score.qualifier ? <p className="text-xs text-fg-muted">{o.score.qualifier}</p> : null}
              <NoAmmoLine score={o.score} />
              <AvailabilityChips page={page} availability={o.availability} ownedUnknown={o.ownedUnknown} id={o.id} />
              {o.blocked ? <p className="text-xs text-fg-muted">{copy.SWAP_BLOCKED[o.blocked]}</p> : null}
            </div>
            {!o.current && !o.blocked ? (
              <button type="button" onClick={() => onPick(o)} aria-label={copy.useThisSr(o.name, label)} className={buttonClass('primary', 'min-h-tap shrink-0 px-3 text-sm')} data-pick={o.id}>
                {copy.USE_THIS}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}
