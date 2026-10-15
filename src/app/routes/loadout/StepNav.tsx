import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import * as copy from './loadoutCopy'
import { STEP_COUNT, STEPS, type Step } from './loadoutModel'

/**
 * StepWizard (UX_SPEC §3.1, §3.5, §7 "sticky wizard header"): the four numbered steps as links (the
 * URL holds the step, so back / forward and reloads land on the same step), the current one marked
 * `aria-current="step"`. Every step is reachable at any time — defaults make every input optional.
 */
export function StepNav({ step, hrefFor }: { step: Step; hrefFor: (step: Step) => string }) {
  return (
    <nav aria-label={copy.STEPS_LABEL} className="sticky top-header z-(--z-hud) -mx-4 border-y-2 border-panel-border bg-surface px-4 py-2 md:-mx-6 md:px-6" data-step-nav="">
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((n) => (
          <li key={n}>
            <Link
              to={hrefFor(n)}
              aria-current={n === step ? 'step' : undefined}
              className={cx(
                'flex min-h-tap flex-col items-start justify-center border-2 px-2 py-1 text-xs leading-tight font-semibold md:flex-row md:items-center md:gap-2 md:text-sm',
                n === step ? 'border-gold-400 bg-night-700 text-accent shadow-slot-selected' : 'border-panel-border bg-night-900 text-fg hover:bg-night-800',
              )}
              data-step-link={n}
            >
              {/* UX_SPEC §9 / B108 M8: Press Start 2P only at ≥ 14px */}
              <span className="font-display text-sm" aria-hidden="true">
                {n}
              </span>
              <span>
                <span className="sr-only">{copy.stepOf(n, STEP_COUNT)}: </span>
                {copy.STEP_NAMES[n]}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Back / Next at the foot of a step. */
export function StepFooter({ step, hrefFor }: { step: Step; hrefFor: (step: Step) => string }) {
  const prev = step > 1 ? ((step - 1) as Step) : undefined
  const next = step < STEP_COUNT ? ((step + 1) as Step) : undefined
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-panel-border pt-4" data-step-footer="">
      {prev ? (
        <Link to={hrefFor(prev)} className={buttonClass('secondary')} data-step-back={prev}>
          <ArrowLeft aria-hidden="true" className="size-5" />
          {copy.backTo(copy.STEP_NAMES[prev])}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={hrefFor(next)} className={buttonClass('primary')} data-step-next={next}>
          {copy.nextTo(copy.STEP_NAMES[next])}
          <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
      ) : null}
    </div>
  )
}
