import { ArrowRight, Pickaxe } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { hasRoute } from '../../routes'
import * as copy from './planCopy'
import { planNewHref } from './planLinks'

/**
 * Feature B entry points (PRD §9 Feature B AC5; UX_SPEC §3.3 ActionRow "What Should I Grind For?" →
 * /plan/new?item=:id). Absent until the planner route ships — never a dead button (PRD P1-S2 AC3 pattern).
 * Tiny on purpose: the item / weapon pages, the builder and the readiness checker import it without the planner.
 */
export function GrindButton({ id, name, className }: { id: number; name: string; className?: string }) {
  if (!hasRoute('plan-new')) return null
  return (
    <Link to={planNewHref(id)} className={buttonClass('secondary', className)} data-grind-link={id}>
      <Pickaxe aria-hidden="true" className="size-5" />
      {copy.GRIND_CTA}
      <span className="sr-only">{copy.grindContext(name)}</span>
    </Link>
  )
}

/**
 * An inline "Plan it" link (the builder's gated track: one per gated item). A per-piece link already shows the
 * piece's name, so its screen-reader completion doesn't say the name again (AMENDMENTS-016 B120).
 */
export function PlanItLink({ id, name, label = copy.PLAN_IT, className }: { id: number; name: string; label?: string; className?: string }) {
  if (!hasRoute('plan-new')) return null
  return (
    <Link to={planNewHref(id)} data-plan-it={id} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong', className)}>
      {label}
      <span className="sr-only">{label === name ? copy.PLAN_IT_NAMED : copy.planItContext(name)}</span>
      <ArrowRight aria-hidden="true" className="size-4" />
    </Link>
  )
}
