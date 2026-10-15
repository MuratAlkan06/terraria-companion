import { FolderInput, Lock, Map as MapIcon, Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AssumptionChip } from '../../../../components/AssumptionChip'
import { buttonClass } from '../../../../components/buttonStyles'
import { ConditionChip } from '../../../../components/ConditionChip'
import { cx } from '../../../../components/cx'
import { ItemSlot } from '../../../../components/ItemSlot'
import { PixelPanel } from '../../../../components/PixelPanel'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import { DEMON_HEART_GATE_NODE, DEMON_HEART_SLOT_INDEX, DEMON_HEART_SOURCE, SLOT_COUNT } from '../../../../scoring/constants'
import type { LoadoutEntry, SlotRef } from '../../../../scoring/readiness'
import { analysisAssumption } from '../../../../scoring/readinessCopy'
import { READINESS_CLASSES, READINESS_DIFFICULTIES, type ReadinessClass, type ReadinessDifficulty, type ReadinessSetup } from '../../../../storage/readiness'
import type { ListSlot, SingleSlot } from '../../../readinessStore'
import { STAGES, type Stage } from '../../../stages'
import { bossMapHref, bossPageHref } from '../bossNav'
import type { ItemInfo } from '../bossPageModel'
import type { ReadinessPageData } from './readinessData'
import { GateGroup } from './ReadinessFactorCard'
import { targetKey, targetLabel, type PickerTarget } from './readinessUi'
import * as copy from './readinessUiCopy'

export interface SetupPaneProps {
  page: ReadinessPageData
  setup: ReadinessSetup
  /** Live resolution of every filled slot under the user's tracked progress (status shown per slot). */
  entries: readonly LoadoutEntry[]
  /** Bosses marked defeated on the map, as marked (B96a: actual marks, whatever the world evil). */
  markedCount: number
  worldEvilName: string | null
  /** Marked bosses a chosen world evil leaves out (the other world's evil boss), by name. */
  offWorldNames?: readonly string[]
  /** Wall of Flesh marked defeated (the Demon Heart slot opens). */
  demonHeartOpen: boolean
  stageNote?: string
  inactiveSlotItems: number
  errors: { boss: boolean; empty: boolean }
  onBoss: (id: string | null) => void
  onStage: (stage: Stage) => void
  onDifficulty: (d: ReadinessDifficulty) => void
  onClass: (c: ReadinessClass) => void
  onOpenPicker: (target: PickerTarget) => void
  onRemove: (target: PickerTarget, listIndex?: number) => void
  onAnalyze: () => void
  onClear: () => void
  /** Slot buttons register here so the page can move focus to them. */
  registerSlot: (key: string, el: HTMLElement | null) => void
  ids: { setup: string; boss: string; bossError: string; loadout: string; loadoutError: string }
  /** The builder's saved builds (UX_SPEC §3.8 "import saved build"): the import control shows when there are any. */
  savedBuilds?: readonly { buildId: string; name: string; updatedAt: string }[]
  onImport?: (buildId: string) => void
}

const FIELD = 'min-h-tap w-full border-2 border-panel-border bg-surface-sunken px-3 text-base text-fg focus:border-gold-600'
const LABEL = 'block text-xs font-semibold tracking-wide text-fg-muted uppercase'
const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

function sameSlot(a: SlotRef, b: PickerTarget, listIndex?: number): boolean {
  if (b.kind === 'accessory') return a.kind === 'accessory' && a.index === b.index
  if (b.kind === 'ammo') return a.kind === 'ammo' && a.index === listIndex
  if (b.kind === 'buffs') return a.kind === 'buff' && a.index === listIndex
  return a.kind === b.kind
}

export function SetupPane(props: SetupPaneProps) {
  const { page, setup, errors, ids } = props
  const offWorld = props.offWorldNames ?? []
  const byStage = STAGES.map((st) => ({ stage: st, bosses: page.bosses.filter((b) => b.stage === st.id) })).filter((g) => g.bosses.length > 0)
  return (
    // Two panes (md+): beside a longer analysis, the setup scrolls with the page until its foot (the
    // actions) comes into view, then stays there — never an empty column beside Improve (B96c). Beside
    // a shorter analysis it is the long column and scrolls normally. (End-aligned + sticky bottom: no
    // nested scroll area.)
    <PixelPanel
      as="section"
      aria-labelledby={ids.setup}
      data-setup=""
      className="space-y-5 md:sticky md:bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+1rem)] md:self-end lg:bottom-4"
    >
      <h2 id={ids.setup} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        {copy.SETUP_TITLE}
      </h2>
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor={ids.boss} className={LABEL}>
            {copy.BOSS_LABEL}
          </label>
          <select
            id={ids.boss}
            value={setup.bossId ?? ''}
            onChange={(e) => props.onBoss(e.target.value || null)}
            aria-invalid={errors.boss || undefined}
            aria-describedby={errors.boss ? ids.bossError : undefined}
            className={cx(FIELD, errors.boss && 'border-negative')}
          >
            <option value="">{copy.BOSS_PLACEHOLDER}</option>
            {byStage.map(({ stage, bosses }) => (
              <optgroup key={stage.id} label={stage.label}>
                {bosses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.boss ? (
            <p id={ids.bossError} className="text-sm text-negative">
              {copy.ERROR_NO_BOSS}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${ids.boss}-stage`} className={LABEL}>
            {copy.STAGE_LABEL}
          </label>
          <select id={`${ids.boss}-stage`} value={setup.stage} onChange={(e) => props.onStage(e.target.value as Stage)} className={FIELD}>
            {STAGES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
        </div>
        <ChoiceGroup legend={copy.DIFFICULTY_LABEL} name={`${ids.boss}-difficulty`} value={setup.difficulty} options={READINESS_DIFFICULTIES.map((d) => ({ value: d, label: copy.DIFFICULTY_NAMES[d] }))} onChange={(v) => props.onDifficulty(v as ReadinessDifficulty)} />
        <ChoiceGroup legend={copy.CLASS_LABEL} name={`${ids.boss}-class`} value={setup.class} options={READINESS_CLASSES.map((c) => ({ value: c, label: copy.CLASS_NAMES[c] }))} onChange={(v) => props.onClass(v as ReadinessClass)} />
        {setup.class === 'hybrid' ? <p className="text-xs text-fg-muted">{copy.HYBRID_NOTE}</p> : null}
      </div>

      <div data-tracking-context="" className="space-y-1 border-l-2 border-gold-600 pl-3 text-sm">
        <p data-marked-count={props.markedCount}>{copy.trackingContext(props.markedCount)}</p>
        <p className="text-fg-muted">{copy.worldContext(props.worldEvilName)}</p>
        {offWorld.length > 0 && props.worldEvilName ? (
          <p data-off-world="" className="text-fg-muted">
            {copy.offWorldMarks(offWorld, props.worldEvilName)}
          </p>
        ) : null}
        {props.stageNote ? (
          <p data-stage-note="" className="text-fg-muted">
            {props.stageNote}
          </p>
        ) : null}
        <Link to={bossMapHref()} className={cx('inline-flex min-h-tap items-center gap-1.5 font-semibold', LINK)}>
          <MapIcon aria-hidden="true" className="size-4" />
          {copy.OPEN_MAP}
        </Link>
      </div>

      <LoadoutEditor {...props} />

      <div data-setup-actions="" className="flex flex-wrap items-center gap-3 border-t-2 border-panel-border pt-4">
        <button type="button" onClick={props.onAnalyze} data-analyze="" className={buttonClass('primary')}>
          {copy.ANALYZE}
        </button>
        <button type="button" onClick={props.onClear} className={buttonClass('secondary')}>
          {copy.CLEAR}
        </button>
      </div>
    </PixelPanel>
  )
}

function ChoiceGroup({ legend, name, value, options, onChange }: { legend: string; name: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className={LABEL}>{legend}</legend>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'inline-flex min-h-tap cursor-pointer items-center border-2 px-3 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
              value === o.value ? 'border-gold-400 bg-night-700 text-accent shadow-slot-selected' : 'border-panel-border bg-night-900 text-fg hover:bg-night-800',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function LoadoutEditor(props: SetupPaneProps) {
  const { setup, page, ids, errors } = props
  const slots = SLOT_COUNT[setup.difficulty]
  const dhIndex = DEMON_HEART_SLOT_INDEX[setup.difficulty]
  const single = (kind: SingleSlot) => <SlotRow key={kind} {...props} target={{ kind }} id={setup.loadout[kind]} />
  return (
    <section aria-labelledby={ids.loadout} className="space-y-4">
      <div className="space-y-1">
        <h3 id={ids.loadout} tabIndex={-1} className="font-semibold text-accent focus:outline-none">
          {copy.LOADOUT_TITLE}
        </h3>
        <p className="text-sm text-fg-muted">{copy.LOADOUT_HINT}</p>
        {props.savedBuilds && props.savedBuilds.length > 0 && props.onImport ? <ImportBuild builds={props.savedBuilds} onImport={props.onImport} selectId={`${ids.loadout}-import`} /> : null}
        {errors.empty ? (
          <p id={ids.loadoutError} role="alert" className="text-sm text-negative">
            {copy.ERROR_EMPTY}
          </p>
        ) : null}
      </div>
      <Group title={copy.GROUP_WEAPONS}>{(['mainWeapon', 'altWeapon'] as const).map(single)}</Group>
      <Group title={copy.GROUP_ARMOR}>{(['helmet', 'chest', 'legs'] as const).map(single)}</Group>
      <Group title={copy.GROUP_ACCESSORIES}>
        {Array.from({ length: slots }, (_, index) => {
          const id = setup.loadout.accessories[index] ?? null
          const isDh = index === dhIndex
          if (isDh && !props.demonHeartOpen && id === null) return <LockedDemonHeart key={index} page={page} />
          return (
            <SlotRow
              key={index}
              {...props}
              target={{ kind: 'accessory', index }}
              id={id}
              extra={
                isDh ? (
                  <AssumptionChip
                    label={copy.DEMON_HEART_CHIP}
                    title={analysisAssumption.demonHeart(DEMON_HEART_SOURCE).title}
                    detail={analysisAssumption.demonHeart(DEMON_HEART_SOURCE).detail}
                    sourceUrl={DEMON_HEART_SOURCE}
                  />
                ) : null
              }
            />
          )
        })}
        {props.inactiveSlotItems > 0 ? <p className="text-xs text-fg-muted">{copy.inactiveSlots(props.inactiveSlotItems, copy.DIFFICULTY_NAMES[setup.difficulty])}</p> : null}
      </Group>
      <ListGroup {...props} list="ammo" title={copy.GROUP_AMMO} addLabel={copy.ADD_AMMO} />
      <ListGroup {...props} list="buffs" title={copy.GROUP_POTIONS} addLabel={copy.ADD_POTION} />
      <Group title={copy.GROUP_SUMMON}>{single('summon')}</Group>
    </section>
  )
}

/**
 * "Import a saved build" (UX_SPEC §3.8; AMENDMENTS-016 B106 queue): the builder's saved builds, newest
 * first and preselected, with one Import button — the page asks before it replaces an entered loadout.
 */
function ImportBuild({ builds, onImport, selectId }: { builds: readonly { buildId: string; name: string; updatedAt: string }[]; onImport: (buildId: string) => void; selectId: string }) {
  const sorted = [...builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  const [choice, setChoice] = useState(sorted[0]?.buildId ?? '')
  const value = sorted.some((b) => b.buildId === choice) ? choice : (sorted[0]?.buildId ?? '')
  return (
    <div className="space-y-1 pt-1" data-import-build="">
      <label htmlFor={selectId} className={LABEL}>
        {copy.IMPORT_LABEL}
      </label>
      <p className="text-xs text-fg-muted">{copy.IMPORT_HINT}</p>
      <div className="flex items-stretch gap-2">
        <select id={selectId} value={value} onChange={(e) => setChoice(e.target.value)} className={cx(FIELD, 'min-w-0 flex-1')}>
          {sorted.map((b) => (
            <option key={b.buildId} value={b.buildId}>
              {b.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onImport(value)} className={buttonClass('secondary', 'shrink-0 px-3 text-sm')} data-import-submit="">
          <FolderInput aria-hidden="true" className="size-4" />
          {copy.IMPORT}
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="space-y-1.5">
      <h4 aria-hidden="true" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h4>
      <div className="grid gap-1.5">{children}</div>
    </div>
  )
}

/** The closed Demon Heart slot: one sentence carries the message, the boss linked in it — no badge squeezed beside it (B96c). */
function LockedDemonHeart({ page }: { page: ReadinessPageData }) {
  const gate = page.graph.nodeById.get(DEMON_HEART_GATE_NODE)?.name ?? DEMON_HEART_GATE_NODE
  return (
    <div data-slot="demon-heart-locked" className="flex min-h-tap items-center gap-3 border-2 border-dashed border-earth-600 bg-night-900 p-1.5">
      <span aria-hidden="true" className="grid size-slot shrink-0 place-items-center border-2 border-slot-border bg-slot">
        <Lock className="size-5 text-gate" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold tracking-wide text-fg-muted uppercase">{copy.DEMON_HEART_SLOT}</span>
        <span className="block text-sm">
          {copy.DEMON_HEART_LOCKED_LEAD}
          <Link to={bossPageHref(DEMON_HEART_GATE_NODE) ?? bossMapHref(DEMON_HEART_GATE_NODE)} className={LINK}>
            {gate}
          </Link>
          {copy.DEMON_HEART_LOCKED_TAIL}
        </span>
      </span>
    </div>
  )
}

function SlotSprite({ info, page }: { info: ItemInfo | undefined; page: ReadinessPageData }) {
  return (
    <span aria-hidden="true" className="shrink-0">
      <ItemSlot
        item={
          info
            ? {
                name: info.name,
                sprite: info.kind === 'weapon' ? <SpriteImg src={info.sprite} sprites={page.sprites} damageClass={info.damageClass} box={32} /> : <SpriteImg src={info.sprite} sprites={page.sprites} placeholder="material" box={32} />,
              }
            : undefined
        }
      />
    </span>
  )
}

function SlotRow(props: SetupPaneProps & { target: PickerTarget; id: number | null; extra?: ReactNode; listIndex?: number }) {
  const { target, id, page, setup, listIndex } = props
  const label = targetLabel(target, setup.difficulty)
  const info = id !== null ? page.info(id) : undefined
  const entry = id !== null ? props.entries.find((e) => e.id === id && sameSlot(e.slot, target, listIndex)) : undefined
  const key = listIndex === undefined ? targetKey(target) : `${targetKey(target)}-${listIndex}`
  const body = (
    <>
      <SlotSprite info={info} page={page} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</span>
        <span className={cx('block truncate', info ? 'font-semibold' : 'text-fg-muted')}>{info ? info.name : copy.EMPTY_SLOT}</span>
      </span>
      {info ? null : <Plus aria-hidden="true" className="mr-1 size-5 shrink-0 text-link" />}
    </>
  )
  const frame = 'flex min-h-tap min-w-0 flex-1 items-center gap-3 border-2 border-panel-border bg-night-900 p-1.5 text-left'
  return (
    <div data-slot={key} className="space-y-1">
      <div className="flex items-stretch gap-1.5">
        {listIndex === undefined ? (
          <button
            ref={(el) => props.registerSlot(key, el)}
            type="button"
            onClick={() => props.onOpenPicker(target)}
            aria-label={info ? copy.changeSlot(label, info.name) : copy.emptySlot(label)}
            className={cx(frame, 'transition-colors duration-(--dur-ui) hover:bg-night-800')}
          >
            {body}
          </button>
        ) : (
          // A list entry (ammo, potion) is shown, not changed: add another or remove this one.
          <div className={frame}>{body}</div>
        )}
        {info ? (
          <button
            type="button"
            onClick={() => props.onRemove(target, listIndex)}
            aria-label={copy.removeFrom(info.name, label)}
            className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>
      {props.extra || entry ? (
        <div className="space-y-1 pl-1 text-xs">
          {props.extra ? <div>{props.extra}</div> : null}
          {entry ? <EntryStatus entry={entry} page={page} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * What the tracked progress makes of a filled slot: not counted (why), gated availability (counted —
 * owned items always count, B94(1) — one gate chip naming every boss, on its own row), Unknown
 * availability (counted), conditions.
 */
function EntryStatus({ entry, page }: { entry: LoadoutEntry; page: ReadinessPageData }) {
  const wikiUrl = (page.engine.weapons.get(entry.id) ?? page.engine.armor.get(entry.id) ?? page.engine.accessories.get(entry.id) ?? page.engine.items.get(entry.id))?.wikiUrl
  const nodeName = (id: string) => page.graph.nodeById.get(id)?.name ?? id
  return (
    <>
      {entry.reason ? (
        <p data-not-counted={entry.reason} className="font-semibold text-gate">
          {copy.NOT_COUNTED_TAG}: {copy.reasonText[entry.reason]}
        </p>
      ) : entry.availability.status === 'gated' ? (
        <div data-availability="gated" className="space-y-1 text-fg-muted">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{copy.AVAILABILITY}</span>
            <GateGroup gates={entry.availability.missing} ctx={{ bossName: nodeName }} />
          </p>
          <p>{copy.COUNTED_AS_YOURS}</p>
        </div>
      ) : entry.availability.status === 'unknown' ? (
        <div data-availability="unknown" className="space-y-1 text-fg-muted">
          <p className="flex flex-wrap items-center gap-x-1">
            {copy.AVAILABILITY} <UnknownValue field="gatedBy" sourceUrl={wikiUrl} />
          </p>
          <p>{copy.COUNTED_AS_YOURS}</p>
        </div>
      ) : null}
      {entry.availability.conditions.length > 0 ? (
        <p className="flex flex-wrap gap-1.5">
          {entry.availability.conditions.map((c) => (
            <ConditionChip key={c} name={page.conditions.byId.get(c)?.name ?? c} href={page.conditions.byId.get(c)?.wikiUrl} requires />
          ))}
        </p>
      ) : null}
    </>
  )
}

function ListGroup(props: SetupPaneProps & { list: ListSlot; title: string; addLabel: string }) {
  const { list, setup } = props
  const ids = setup.loadout[list]
  return (
    <Group title={props.title}>
      {ids.map((id, i) => (
        <SlotRow key={`${id}-${i}`} {...props} target={{ kind: list }} id={id} listIndex={i} />
      ))}
      <button
        ref={(el) => props.registerSlot(`${list}-add`, el)}
        type="button"
        onClick={() => props.onOpenPicker({ kind: list })}
        className="inline-flex min-h-tap items-center gap-2 justify-self-start border-2 border-dashed border-panel-border px-3 text-sm font-semibold text-link hover:bg-night-800"
      >
        <Plus aria-hidden="true" className="size-4" />
        {props.addLabel}
      </button>
    </Group>
  )
}
