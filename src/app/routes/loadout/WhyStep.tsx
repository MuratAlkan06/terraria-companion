import { useId, type ReactNode } from 'react'
import { EstimateLabel } from '../../../components/EstimateLabel'
import { hasAssumptions } from '../../../components/assumptions'
import { GatedSection } from '../../../components/GatedSection'
import { PixelPanel } from '../../../components/PixelPanel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { gatedCopy, profileCopy } from '../../../scoring/builderCopy'
import type { ProfileComponent } from '../../../scoring/goals'
import type { BuilderResult } from '../../../scoring/recommend'
import type { ProfileReference, ReferencedComponent } from '../../../scoring/references'
import { getStageInfo } from '../../stages'
import { bossMapHref, bossPageHref } from '../bosses/bossNav'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { Segments } from '../bosses/readiness/ReadinessFactorCard'
import { segmentContext } from '../bosses/readiness/readinessUi'
import { barScale, contributionParts } from './loadoutCompare'
import * as copy from './loadoutCopy'
import { ItemName, ItemSquare, LABEL, LINK, ProfileBar, ScoreFigure } from './LoadoutBits'
import { slotLabel, type EffectiveInputs } from './loadoutModel'

/**
 * Step 3 — why it works (PRD P4-S3; UX_SPEC §3.5 Step3 ExplanationView, §8; SCORING_SPEC §4.7, §5.1,
 * §5.3): the loadout's profile — five components for this one build, each a labelled bar with its
 * figure, "est." chip, stated scale, formula and the goal's weight (never folded into one number: a
 * composite exists only across compared builds) — how the pieces fit (set bonus, what each piece of
 * gear adds, class mismatches itemized, effects named but not scored), the gated track (GatedSection
 * per exact set of bosses, each item beside its obtainable-now alternative), what every slot was
 * scored from, and every assumption, skipped inputs included. AMENDMENTS-016 B108: every profile figure
 * carries its "est." chip (M11); the "not counted" list names every pick adding 0 counted points (H4);
 * the target boss's gated group comes first (M1, engine order).
 *
 * P4-S3 AC2 bars (AMENDMENTS-016 B113a): each figure's bar runs to the highest value of that figure found
 * among gear verified obtainable at the stage — pick-independent (src/scoring/references.ts), est.-labelled,
 * marked by a tick; a full bar is earned and said so. Class synergy runs to 100.
 */
export interface WhyStepProps {
  page: ReadinessPageData
  result: BuilderResult
  eff: EffectiveInputs
  /** The bars' references (absent: only class synergy, out of 100, gets a bar). */
  references?: Record<ReferencedComponent, ProfileReference>
}

/**
 * A profile figure's bar and the words saying what it is measured against (AMENDMENTS-016 B113a): the
 * highest figure found among gear verified obtainable at the stage, marked by a tick — never the
 * loadout itself, so a full bar is earned ("This loadout reaches the tick").
 */
function FigureBar({ c, reference }: { c: ProfileComponent; reference: ProfileReference | undefined }) {
  if (c.value === undefined) return null
  if (c.id === 'classSynergy') {
    const scale = barScale(c.value, 100)
    return scale ? (
      <div className="space-y-1" data-figure-bar={c.id}>
        <ProfileBar fill={scale.fill} />
        <p className="text-xs text-fg-muted" data-bar-scale="">
          {copy.BAR_OF_100}
        </p>
      </div>
    ) : null
  }
  if (!reference) return null
  const id = c.id as ReferencedComponent
  if (reference.value === undefined || reference.value <= 0) {
    return (
      <p className="text-xs text-fg-muted" data-bar-none="">
        {reference.value === undefined ? copy.barNoReference(copy.BAR_NONE_WORD[id]) : copy.barZeroReference(copy.BAR_NONE_WORD[id])}
      </p>
    )
  }
  const scale = barScale(c.value, reference.value)
  if (!scale) return null
  const figure: ReactNode = (
    <>
      <span className="font-semibold text-fg tabular-nums">{reference.text}</span>
      {reference.unit ? <span> {reference.unit}</span> : null}
      {hasAssumptions(reference.assumptions) ? <EstimateLabel assumptions={reference.assumptions} context={copy.referenceContext(copy.REFERENCE_WHAT[id])} className="ml-1 align-baseline" /> : null}
    </>
  )
  return (
    <div className="space-y-1.5 pt-1" data-figure-bar={c.id}>
      <ProfileBar fill={scale.fill} tick={scale.tick} past={scale.past} />
      <p className="text-xs text-fg-muted" data-bar-scale="">
        {copy.BAR_TICK_LEAD} {figure}
        {copy.BAR_TICK_BASIS[id]}
        {scale.past ? (
          <span className="block text-fg" data-bar-note="past">
            {copy.BAR_PAST_END}
          </span>
        ) : scale.fill >= 1 - 1e-9 ? (
          <span className="block text-fg" data-bar-note="reached">
            {copy.BAR_REACHED}
          </span>
        ) : null}
      </p>
    </div>
  )
}

export function WhyStep({ page, result, eff, references }: WhyStepProps) {
  const id = useId()
  const ctx = segmentContext(page, {})
  const goalName = copy.GOAL_NAMES[eff.goal]
  const specials = result.slots.flatMap((s) =>
    (s.pick?.score?.effects ?? []).filter((e) => e.status === 'special' || e.status === 'special-mismatch').map((e) => ({ item: s.pick?.name ?? '', from: e.from, text: e.text, url: e.sourceUrl })),
  )
  const mismatches = result.profile.synergy.mismatches
  const nodeName = (n: string) => page.graph.nodeById.get(n)?.name ?? n
  return (
    <div className="space-y-5" data-step-body="3">
      <PixelPanel as="section" aria-labelledby={`${id}profile`} className="space-y-3">
        <h3 id={`${id}profile`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.PROFILE_TITLE}
        </h3>
        <p className="text-sm text-fg-muted">{copy.PROFILE_NOTE}</p>
        <p className="text-sm text-fg-muted" data-bars-note="">
          {copy.PROFILE_BARS_NOTE}
        </p>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {result.profile.components.map((c) => {
            const tip = c.estimate ? (result.profile.estimates[c.estimate] ?? []) : []
            return (
              <li key={c.id} data-component={c.id} className="space-y-1.5 border-2 border-panel-border bg-night-900 p-3">
                <p className={LABEL}>{c.label}</p>
                {c.value !== undefined ? (
                  <>
                    <p className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-lg font-semibold tabular-nums">{c.text}</span>
                      <span className="text-sm text-fg-muted">{c.unit}</span>
                      {c.estimate && hasAssumptions(tip) ? <EstimateLabel assumptions={tip} context={profileCopy.estimateContext[c.estimate]} className="self-center" /> : null}
                    </p>
                    <FigureBar c={c} reference={c.id === 'classSynergy' ? undefined : references?.[c.id]} />
                  </>
                ) : (
                  <p className="text-sm text-fg-muted" data-excluded="">
                    <span className="font-semibold text-fg">{copy.EXCLUDED}: </span>
                    {c.excluded}
                  </p>
                )}
                <p className="text-xs text-fg-muted">{copy.goalWeight(goalName, Math.round(c.weight * 100))}</p>
                {c.formulaText ? <p className="text-xs tabular-nums">{c.formulaText}</p> : null}
                {c.notes.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg-muted">
                    {c.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
                {c.uncounted.length > 0 ? (
                  <ul className="space-y-0.5 text-xs text-fg-muted">
                    {c.uncounted.map((u) => (
                      <li key={`${u.from}:${u.text}`}>
                        {copy.notScoredFrom(u.from)} <span className="italic">“{u.text}”</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </PixelPanel>

      <PixelPanel as="section" aria-labelledby={`${id}synergy`} className="space-y-3">
        <h3 id={`${id}synergy`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.SYNERGY_TITLE}
        </h3>
        {result.profile.setBonus ? (
          <p className="text-sm" data-set-bonus={result.profile.setBonus.setId}>
            <span className="font-semibold">{copy.setBonusActive(result.profile.setBonus.name)}</span> <span className="italic">“{result.profile.setBonus.text.replace(/\n/g, ' · ')}”</span>
          </p>
        ) : (
          <p className="text-sm text-fg-muted">{copy.NO_SET}</p>
        )}
        <div data-contributions="">
          <p className={LABEL}>{copy.CONTRIB_TITLE}</p>
          <p className="text-xs text-fg-muted">{copy.CONTRIB_NOTE}</p>
          {result.profile.contributions.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{copy.CONTRIB_NONE}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {result.profile.contributions.map((c, i) => (
                <li key={`${c.kind}-${c.id ?? c.setId ?? i}`} data-contribution={c.kind}>
                  <span className="text-xs text-fg-muted">{copy.CONTRIB_KIND[c.kind]}: </span>
                  {c.id !== undefined ? (
                    <ItemName page={page} id={c.id} name={c.name} />
                  ) : c.setId && page.engine.sets.get(c.setId)?.wikiUrl ? (
                    <a href={page.engine.sets.get(c.setId)?.wikiUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} font-semibold`}>
                      {c.name}
                      <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="font-semibold">{c.name}</span>
                  )}
                  <span className="text-fg-muted"> — {contributionParts(c).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={LABEL}>{copy.mismatchesTitle(copy.CLASS_NAMES[eff.cls].toLowerCase())}</p>
          {mismatches.length === 0 && result.zeroPoint.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{copy.NO_MISMATCH}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" data-mismatches="">
              {mismatches.map((m) => (
                <li key={m.name}>
                  {m.name}: {m.phrases.join(', ')}
                </li>
              ))}
              {result.zeroPoint.map((z) => (
                <li key={z.slot} data-zero-point={z.slot}>
                  <ItemName page={page} id={z.id} name={z.name} /> {copy.zeroPointLine(slotLabel(z.slot))}
                  {z.specials.length > 0 ? (
                    <span className="block text-fg-muted">
                      {copy.ZERO_POINT_EFFECTS}{' '}
                      {z.specials.map((t, i) => (
                        <span key={i} className="italic">
                          {i > 0 ? ' · ' : ''}“{t}”
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        {specials.length > 0 ? (
          <div>
            <p className={LABEL}>{copy.SPECIALS_TITLE}</p>
            <p className="text-xs text-fg-muted">{copy.SPECIALS_NOTE}</p>
            <ul className="mt-1 space-y-1 text-sm" data-specials="">
              {specials.map((sp, i) => (
                <li key={i}>
                  <span className="font-semibold">{sp.from ?? sp.item}</span>: <span className="italic">“{sp.text}”</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PixelPanel>

      <PixelPanel as="section" aria-labelledby={`${id}gated`} className="space-y-3" data-gated-track="">
        <h3 id={`${id}gated`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.GATED_TITLE}
        </h3>
        <p className="text-sm text-fg-muted">{copy.GATED_INTRO}</p>
        {result.gated.length === 0 ? (
          <p className="text-sm text-fg-muted">{copy.GATED_NONE}</p>
        ) : (
          result.gated.map((g, gi) => (
            <GatedSection key={g.missing.join('+')} id={`${id}gate-${gi}`} gates={g.missing.map((n) => ({ id: n, name: nodeName(n), to: bossPageHref(n) ?? bossMapHref(n) }))}>
              <ul className="grid gap-2">
                {g.entries.map((e) => (
                  <li key={e.key} data-gated-entry={e.id} className="flex gap-3">
                    <ItemSquare page={page} id={e.id} />
                    <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                      <p className={LABEL}>{copy.gatedSlot[e.slot]}</p>
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <ItemName page={page} id={e.id} name={e.name} />
                        <ScoreFigure score={e.score} />
                        <span className="text-xs text-fg-muted">{e.score.label}</span>
                      </p>
                      <p className="text-fg-muted" data-alternative-now="">
                        <Segments segments={e.alternative ? gatedCopy.alternative({ kind: 'item', id: e.alternative.id, text: e.alternative.name }) : gatedCopy.noAlternative()} ctx={ctx} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </GatedSection>
          ))
        )}
      </PixelPanel>

      <PixelPanel as="section" aria-labelledby={`${id}pools`} className="space-y-2">
        <h3 id={`${id}pools`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.POOLS_TITLE}
        </h3>
        <dl className="space-y-1.5 text-sm" data-pools="">
          {result.slots
            .filter((s) => s.disclosure && !s.id.startsWith('acc') && !s.id.startsWith('buff'))
            .concat(result.slots.filter((s) => s.id === 'acc0' || s.id === 'buff0'))
            .map((s) => (
              <div key={s.id}>
                <dt className="font-semibold">{s.id === 'acc0' ? copy.GROUPS.accessories : s.id === 'buff0' ? copy.GROUPS.buffs : slotLabel(s.id)}</dt>
                <dd className="text-fg-muted">
                  <Segments segments={s.disclosure ?? []} ctx={ctx} />
                </dd>
              </div>
            ))}
        </dl>
      </PixelPanel>

      <PixelPanel as="section" aria-labelledby={`${id}assumptions`} className="space-y-3" data-assumptions="">
        <h3 id={`${id}assumptions`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.ASSUMPTIONS_TITLE}
        </h3>
        <div>
          <p className={LABEL}>{copy.INPUTS_USED}</p>
          <ul className="mt-1 space-y-0.5 text-sm" data-inputs-used="">
            <li>{copy.inputUsed(copy.STAGE_LABEL, getStageInfo(eff.stage).label, eff.skipped.stage)}</li>
            <li>{copy.inputUsed(copy.CLASS_LABEL, copy.CLASS_NAMES[eff.cls], eff.skipped.cls)}</li>
            <li>{copy.inputUsed(copy.DIFFICULTY_LABEL, copy.DIFFICULTY_NAMES[eff.difficulty], eff.skipped.difficulty)}</li>
            <li>{copy.inputUsed(copy.GOAL_LABEL, goalName, eff.skipped.goal)}</li>
            <li>{copy.inputUsed(copy.BOSS_LABEL, eff.bossId ? (page.engine.bosses.get(eff.bossId)?.name ?? eff.bossId) : copy.BOSS_NONE, eff.skipped.boss)}</li>
            <li>{copy.ownedCount(eff.owned.length)}</li>
          </ul>
        </div>
        <ul className="space-y-2">
          {result.assumptions.map((a) => (
            <li key={a.id} data-assumption={a.id}>
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="text-sm text-fg-muted">{a.detail}</p>
              {a.sourceUrl ? <ProvenanceLink href={a.sourceUrl} label={copy.RULE_SOURCE} srContext={`(${a.title})`} className="text-xs" /> : null}
            </li>
          ))}
        </ul>
      </PixelPanel>
    </div>
  )
}
