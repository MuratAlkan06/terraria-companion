import { ChevronDown, ClipboardList, Columns2, FolderOpen, X } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { hasAssumptions } from '../../../components/assumptions'
import { ItemSlot } from '../../../components/ItemSlot'
import { PixelPanel } from '../../../components/PixelPanel'
import { comparisonCopy, GOAL_WORD } from '../../../scoring/builderCopy'
import type { ComparedBuild, ProfileComponent } from '../../../scoring/goals'
import type { BuilderResult, Pins } from '../../../scoring/recommend'
import type { Goal } from '../../../schemas'
import { BUILD_GOALS, type SavedBuild } from '../../../storage/builds'
import { getStageInfo } from '../../stages'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { readinessBuildHref } from '../bosses/readiness/readinessLinks'
import { Segments } from '../bosses/readiness/ReadinessFactorCard'
import { segmentContext } from '../bosses/readiness/readinessUi'
import { hasRoute } from '../../routes'
import { differingSlots, diffSlots, goalFit, profileRows, type SavedRun, type SideSlot, type SlotDiffRow } from './loadoutCompare'
import * as copy from './loadoutCopy'
import { ChoiceGroup, FIELD, ItemName, ItemSquare, LABEL, ProfileBar } from './LoadoutBits'
import { COMPARISON_ID, type EffectiveInputs } from './loadoutModel'

/**
 * Step 4's comparison (PRD P4-S4 AC1/AC2; UX_SPEC §3.5 Step4 CompareView "side-by-side columns ·
 * ScoreBreakdown per goal"; SCORING_SPEC §5.3, §5.4): the draft beside a saved build (`?vs=`) —
 * - the five profile figures, each with its "est." chip, a bar per build running to the higher of the
 *   two (class synergy: to 100) and the difference stated as draft − saved;
 * - the set bonus each has active (the class bonuses AC1 names);
 * - the goal fit of each under a goal the user picks (default: the draft's), relative to these two
 *   builds only, with "How was this scored?" — every figure scaled, weighted and added up;
 * - slot by slot: what each holds, emptied-by-you told apart from left-empty-by-the-recommendation.
 * Nothing names a build as ahead: no winner wording, no highlight on the larger figure, both bars
 * neutral colours told apart by their labels.
 */
export interface ComparePanelProps {
  page: ReadinessPageData
  builds: readonly SavedBuild[]
  draft: { result: BuilderResult; pins: Pins; eff: EffectiveInputs }
  /** The compared build scored as saved (absent: none chosen). */
  saved?: SavedRun
  /** `?vs=` names a build this browser doesn't have. */
  vsMissing: boolean
  /** The saved build the draft edits, if any. */
  editingId?: string
  onCompare: (buildId: string | undefined) => void
  openHref: (b: SavedBuild) => string
}

const byRecent = (a: SavedBuild, b: SavedBuild) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)

export function ComparePanel(props: ComparePanelProps) {
  const id = useId()
  const { builds, saved } = props
  const sorted = useMemo(() => [...builds].sort(byRecent), [builds])
  const [choice, setChoice] = useState(saved?.build.buildId ?? '')
  return (
    <PixelPanel as="section" aria-labelledby={`${id}title`} className="space-y-4" data-compare-panel="">
      <div className="space-y-1">
        <h3 id={`${id}title`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.COMPARE_TITLE}
        </h3>
        <p className="text-sm text-fg-muted">{copy.COMPARE_INTRO}</p>
      </div>
      {props.vsMissing ? (
        <p role="status" className="text-sm text-fg-muted" data-compare-missing="">
          {copy.COMPARE_MISSING}
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <p className="text-sm text-fg-muted" data-compare-empty="">
          {copy.COMPARE_NO_BUILDS}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            props.onCompare(choice || undefined)
          }}
          data-compare-form=""
        >
          <div className="min-w-0 flex-1 basis-56 space-y-1">
            <label htmlFor={`${id}pick`} className={LABEL}>
              {copy.COMPARE_PICK_LABEL}
            </label>
            <select id={`${id}pick`} value={choice} onChange={(e) => setChoice(e.target.value)} className={FIELD}>
              <option value="">{copy.COMPARE_PICK_NONE}</option>
              {sorted.map((b) => (
                <option key={b.buildId} value={b.buildId}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary')} data-compare-show="">
            <Columns2 aria-hidden="true" className="size-5" />
            {copy.COMPARE_SHOW}
          </button>
          {saved ? (
            <button
              type="button"
              onClick={() => {
                setChoice('')
                props.onCompare(undefined)
              }}
              className="inline-flex min-h-tap items-center gap-1.5 px-1 text-sm font-semibold text-link hover:text-accent-strong"
              data-compare-clear=""
            >
              <X aria-hidden="true" className="size-4" />
              {copy.COMPARE_CLEAR}
            </button>
          ) : null}
        </form>
      )}
      {saved ? <Comparison {...props} saved={saved} /> : null}
    </PixelPanel>
  )
}

/** "Ranged · Early Hardmode · Expert Mode · Boss fight". */
const metaOf = (cls: EffectiveInputs['cls'], stage: EffectiveInputs['stage'], difficulty: EffectiveInputs['difficulty'], goal: Goal | undefined) =>
  copy.buildMeta(copy.CLASS_NAMES[cls], getStageInfo(stage).label, copy.DIFFICULTY_NAMES[difficulty], goal ? copy.GOAL_NAMES[goal] : undefined)

function Comparison(props: ComparePanelProps & { saved: SavedRun }) {
  const id = useId()
  const { page, draft, saved } = props
  const savedName = saved.build.name
  const rows = useMemo(() => profileRows(draft.result.profile, saved.result.profile), [draft.result, saved.result])
  const slots = useMemo(() => diffSlots(draft, saved), [draft, saved])
  const ctx = segmentContext(page, {})
  return (
    <div id={COMPARISON_ID} tabIndex={-1} aria-label={copy.comparisonRegion(savedName)} className="scroll-mt-40 space-y-5 border-t-2 border-panel-border pt-4 focus:outline-2 focus:outline-offset-2 focus:outline-ring" data-comparison={saved.build.buildId}>
      {props.editingId === saved.build.buildId ? (
        <p className="text-sm" data-compare-editing="">
          {copy.COMPARE_EDITING}
        </p>
      ) : null}
      {/* the two columns' identities: every row below repeats them in its own labels */}
      <div className="grid grid-cols-2 gap-3 text-sm" data-compare-columns="">
        <div className="min-w-0 border-l-4 border-gold-400 pl-2">
          <p className="font-semibold">{copy.DRAFT_COLUMN}</p>
          <p className="text-xs text-fg-muted">{metaOf(draft.eff.cls, draft.eff.stage, draft.eff.difficulty, draft.eff.goal)}</p>
        </div>
        <div className="min-w-0 border-l-4 border-night-200 pl-2">
          <p className="font-semibold break-words">
            <span className="sr-only">{copy.SAVED_COLUMN_SR}</span>
            {savedName}
          </p>
          <p className="text-xs text-fg-muted">{metaOf(saved.eff.cls, saved.eff.stage, saved.eff.difficulty, saved.build.goal)}</p>
        </div>
      </div>

      <section aria-labelledby={`${id}profile`} className="space-y-2">
        <h4 id={`${id}profile`} className={LABEL}>
          {copy.PROFILE_COMPARE_TITLE}
        </h4>
        <p className="text-xs text-fg-muted">{copy.PROFILE_COMPARE_NOTE}</p>
        <ul className="grid gap-2" data-compare-profile="">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1.5 border-2 border-panel-border bg-night-900 p-2.5" data-compare-figure={r.id}>
              {/* B113(e): the difference sits in the same place on every card — under the label below md, at the right from md */}
              <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-x-3">
                <p className="text-sm font-semibold">{r.label}</p>
                <p className="text-xs text-fg-muted tabular-nums" data-delta={r.deltaText}>
                  {copy.deltaLine(r.deltaText)}
                </p>
              </div>
              <div className="grid gap-1.5 md:grid-cols-2 md:gap-3">
                <FigureLine label={copy.DRAFT_COLUMN} c={r.draft} bar={r.draftBar} tone="draft" estimates={draft.result.profile.estimates} who={copy.COMPARE_DRAFT_WHO} />
                <FigureLine label={savedName} c={r.saved} bar={r.savedBar} tone="saved" estimates={saved.result.profile.estimates} who={savedName} />
              </div>
            </li>
          ))}
          <li className="space-y-1 border-2 border-panel-border bg-night-900 p-2.5" data-compare-figure="setBonus">
            <p className="text-sm font-semibold">{copy.SET_BONUS_ROW}</p>
            <div className="grid gap-1 text-sm md:grid-cols-2 md:gap-3">
              <p>
                <span className="text-xs text-fg-muted">{copy.DRAFT_COLUMN}: </span>
                {draft.result.profile.setBonus?.name ?? copy.SET_NONE}
              </p>
              <p className="break-words">
                <span className="text-xs text-fg-muted">{savedName}: </span>
                {saved.result.profile.setBonus?.name ?? copy.SET_NONE}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <GoalFit {...props} saved={saved} />

      <section aria-labelledby={`${id}slots`} className="space-y-2">
        <h4 id={`${id}slots`} className={LABEL}>
          {copy.SLOTS_TITLE}
        </h4>
        <p className="text-sm" data-slots-differ={differingSlots(slots)}>
          {copy.slotsDiffer(differingSlots(slots))}
        </p>
        <ul className="grid gap-1.5" data-compare-slots="">
          {slots.map((row) => (
            <SlotRow key={row.slot} row={row} page={page} savedName={savedName} />
          ))}
        </ul>
        {saved.result.notices.length > 0 ? (
          <div className="text-sm text-fg-muted" data-saved-notices="">
            <p>{copy.SAVED_NOT_PLACED}</p>
            <ul className="list-disc pl-5">
              {saved.result.notices.map((n, i) => (
                <li key={i}>
                  <Segments segments={n} ctx={ctx} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link to={props.openHref(saved.build)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-compare-open={saved.build.buildId}>
          <FolderOpen aria-hidden="true" className="size-4" />
          {copy.OPEN_SAVED}
        </Link>
        {hasRoute('readiness') ? (
          <Link to={readinessBuildHref(saved.build.buildId)} aria-label={copy.analyzeBuildSr(savedName)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-compare-analyze={saved.build.buildId}>
            <ClipboardList aria-hidden="true" className="size-4" />
            {copy.ANALYZE_BUILD}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

/** One build's figure: its label, bar, number, unit and "est." chip (or why it isn't computed). */
function FigureLine({
  label,
  c,
  bar,
  tone,
  estimates,
  who,
}: {
  label: string
  c: ProfileComponent
  bar: number | undefined
  tone: 'draft' | 'saved'
  estimates: BuilderResult['profile']['estimates']
  who: string
}) {
  const tip = c.estimate ? (estimates[c.estimate] ?? []) : []
  return (
    <div className="min-w-0 space-y-1" data-figure-side={tone}>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <span className="max-w-full truncate text-xs text-fg-muted">{label}</span>
        {c.value !== undefined ? (
          <>
            <span className="font-semibold tabular-nums">{c.text}</span>
            <span className="text-xs text-fg-muted">{c.unit}</span>
            {c.estimate && hasAssumptions(tip) ? <EstimateLabel assumptions={tip} context={copy.compareContext(copy.COMPARE_WHAT[c.estimate], who)} className="self-center" /> : null}
          </>
        ) : (
          <span className="text-xs text-fg-muted" data-excluded="">
            {copy.EXCLUDED}: {c.excluded}
          </span>
        )}
      </p>
      {bar !== undefined ? <ProfileBar fill={bar} tone={tone} /> : null}
    </div>
  )
}

/**
 * The goal fit under a chosen goal (SCORING_SPEC §5.4; AMENDMENTS-016 B113b): ONE signed difference in
 * the "Draft − saved" grammar's terms ("Under Survivability weights: saved +24.4", "same" on a tie) with
 * its est. chip; each build's weighted sum only inside "How was this scored?". No per-build score up
 * front, and no build pinned at 100 (each figure is split between the two in proportion to their values).
 */
function GoalFit({ draft, saved }: ComparePanelProps & { saved: SavedRun }) {
  const id = useId()
  const [goal, setGoal] = useState<Goal>(draft.eff.goal)
  const [open, setOpen] = useState(false)
  const cmp = useMemo(() => goalFit(draft.result.profile, saved.result.profile, goal), [draft.result, saved.result, goal])
  const names = [copy.DRAFT_COLUMN, saved.build.name]
  const diff = cmp.difference
  return (
    <section aria-labelledby={`${id}fit`} className="space-y-2" data-goal-fit={goal}>
      <h4 id={`${id}fit`} className={LABEL}>
        {copy.FIT_TITLE}
      </h4>
      <p className="text-xs text-fg-muted">{copy.FIT_NOTE}</p>
      <ChoiceGroup legend={copy.FIT_GOAL_LABEL} name={`${id}goal`} value={goal} options={BUILD_GOALS.map((g) => ({ value: g, label: copy.GOAL_NAMES[g] }))} onChange={(g) => setGoal(g)} />
      {diff ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 border-l-4 border-panel-border bg-night-900 py-1.5 pl-2" data-fit-difference={diff.sign}>
          <span className="text-sm">{copy.fitUnder(copy.GOAL_NAMES[goal])}</span>
          <span className="text-lg font-semibold tabular-nums">{diff.sign === 0 ? copy.FIT_SAME : copy.fitLeaning(diff.sign > 0 ? copy.FIT_SIDE.saved : copy.FIT_SIDE.draft, diff.text)}</span>
          {hasAssumptions(diff.assumptions) ? <EstimateLabel assumptions={diff.assumptions} context={comparisonCopy.estimateContext(GOAL_WORD[goal])} className="self-center" /> : null}
        </p>
      ) : (
        <p className="text-sm text-fg-muted" data-fit-difference="none">
          {comparisonCopy.noFit}
        </p>
      )}
      <button type="button" aria-expanded={open} aria-controls={`${id}breakdown`} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-tap items-center gap-1.5 px-1 text-sm font-semibold text-link hover:text-accent-strong" data-fit-toggle="">
        <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform duration-(--dur-ui)', open && 'rotate-180')} />
        {open ? copy.HIDE_SCORE : copy.HOW_SCORED}
      </button>
      {open ? (
        <div id={`${id}breakdown`} className="space-y-3 text-sm" data-fit-breakdown="">
          {cmp.builds.map((b, i) => (
            <FitBreakdown key={i} build={b} name={names[i]} />
          ))}
          {diff ? (
            <p className="text-xs" data-fit-difference-formula="">
              <span className="font-semibold">{copy.FIT_DIFFERENCE}: </span>
              {diff.formulaText}
            </p>
          ) : null}
          {cmp.dropped.length > 0 ? <p className="text-xs text-fg-muted">{copy.fitDropped(cmp.dropped.map((d) => d.label).join(', '))}</p> : null}
          {cmp.zeroMax.map((z) => (
            <p key={z.id} className="text-xs text-fg-muted">
              {comparisonCopy.zeroMax(z.label)}
            </p>
          ))}
          <p className="text-xs text-fg-muted">{copy.FIT_FOOTER(cmp.constantsVersion)}</p>
        </div>
      ) : null}
    </section>
  )
}

function FitBreakdown({ build, name }: { build: ComparedBuild; name: string }) {
  return (
    <div className="space-y-1" data-fit-build="">
      <p className="font-semibold break-words">{name}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-left text-xs tabular-nums">
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-1 pr-2 font-semibold">
                {copy.FIT_COLUMNS.figure}
              </th>
              <th scope="col" className="py-1 pr-2 font-semibold">
                {copy.FIT_COLUMNS.scaled}
              </th>
              <th scope="col" className="py-1 pr-2 font-semibold">
                {copy.FIT_COLUMNS.weight}
              </th>
              <th scope="col" className="py-1 font-semibold">
                {copy.FIT_COLUMNS.adds}
              </th>
            </tr>
          </thead>
          <tbody>
            {build.components.map((c) => (
              <tr key={c.id} className="border-t border-panel-border align-top" data-fit-component={c.id}>
                <th scope="row" className="py-1 pr-2 font-normal">
                  {c.label}
                  {c.raw !== undefined ? <span className="block text-fg-muted">{`${c.text} ${c.unit}`.trim()}</span> : null}
                </th>
                <td className="py-1 pr-2">{c.dropped ? copy.FIT_LEFT_OUT : <span className="block">{c.scaledFormula}</span>}</td>
                <td className="py-1 pr-2">{c.weight}</td>
                <td className="py-1">{c.contribution !== undefined ? String(Number(c.contribution.toFixed(2))) : copy.FIT_LEFT_OUT}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {build.fit ? (
        <p className="text-xs" data-fit-formula="">
          {copy.fitSum(build.fit.formulaText)}
        </p>
      ) : null}
    </div>
  )
}

/** One slot, both builds: what each holds (sprite + linked name) or why it's empty, and the difference. */
function SlotRow({ row, page, savedName }: { row: SlotDiffRow; page: ReadinessPageData; savedName: string }) {
  return (
    <li className="border-2 border-panel-border bg-night-900 p-2" data-slot-diff={row.slot} data-status={row.status}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className={LABEL}>{row.label}</p>
        <span
          className={cx(
            'border px-1 text-[0.6875rem] leading-4 font-semibold',
            row.status === 'same' || row.status === 'both-empty' ? 'border-stone-600 text-fg-muted' : 'border-gold-600 text-accent',
          )}
        >
          {copy.SLOT_STATUS[row.status]}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Side side={row.draft} page={page} label={copy.DRAFT_COLUMN} />
        <Side side={row.saved} page={page} label={savedName} />
      </div>
    </li>
  )
}

/**
 * One side of a slot row. AMENDMENTS-016 B113(e) M6: below sm the square sits above the name, so a name
 * gets the cell's whole width and wraps between words ("Band of Regeneration"), never mid-word.
 */
function Side({ side, page, label }: { side: SideSlot; page: ReadinessPageData; label: string }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
      {side.kind === 'item' ? <ItemSquare page={page} id={side.pieces?.find((x) => x > 0) ?? side.id} /> : <ItemSlot />}
      <p className="w-full min-w-0 text-sm break-words sm:w-auto sm:flex-1">
        <span className="block truncate text-xs text-fg-muted">{label}</span>
        {side.kind === 'item' ? <ItemName page={page} id={side.id} name={side.name} className="hyphens-auto" /> : <span className="text-fg-muted" data-side-empty={side.kind}>{copy.SIDE_EMPTY[side.kind]}</span>}
      </p>
    </div>
  )
}
