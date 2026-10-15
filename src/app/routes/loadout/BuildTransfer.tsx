import { ClipboardCopy, ClipboardPaste, FileInput, Plus, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { InventoryGrid } from '../../../components/InventoryGrid'
import { meta } from '../../../data/meta'
import type { SavedBuild } from '../../../storage/builds'
import { readBuildText, type BuildCodeError, type BuildCodeRead, type BuildRecord } from '../../../storage/transfer'
import { getStageInfo } from '../../stages'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { copyText, importPreview, isKnownItem } from './buildText'
import * as text from './buildTextCopy'
import { ItemSquare, LABEL } from './LoadoutBits'
import * as copy from './loadoutCopy'
import { buildHeadingId } from './loadoutModel'
import { SAVED_FLASH_MS } from './SaveStep'

/**
 * BuildExportDialog / the build import (UX_SPEC §3.1, §4(f); ADR D6 export/import; P7-S2b, AMENDMENTS-016
 * B123(a)).
 * - Export: the build's readable text (header + slots + `#code:` line) in a read-only field, with Copy —
 *   the button says "Copied ✓" for 2 s and a status line says what happened; where the browser won't copy,
 *   the text is selected and the line says how to copy it by hand.
 * - Import (the saved-builds list): paste the text (or its `#code:` line) → Read the build → a preview (its
 *   inputs, its slots as a grid, every item this site's data doesn't know listed by id, a duplicate of a
 *   saved build said) → Add to my builds (a NEW build; nothing is saved before). A paste that can't be read
 *   gets its honest reason under the field, which takes focus (UX_SPEC §9).
 */

/** The text field's styling (FIELD, multi-line): the long code line wraps anywhere. */
const TEXT_AREA = 'block w-full border-2 border-panel-border bg-surface-sunken px-3 py-2 font-mono text-xs leading-relaxed text-fg wrap-anywhere focus:border-gold-600'

export interface BuildExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The build's name (the dialog's title). */
  name: string
  /** The readable block, `#code:` line included. */
  value: string
  /** Where focus goes when it closes (the control that opened it). */
  returnFocus: () => HTMLElement | null | undefined
}

export function BuildExportDialog({ open, onOpenChange, name, value, returnFocus }: BuildExportDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            const button = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>('[data-export-copy]')
            if (!button) return
            event.preventDefault()
            button.focus()
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus()
            if (!target) return
            event.preventDefault()
            target.focus()
          }}
          data-build-export=""
          className="fixed top-1/2 left-1/2 z-(--z-dialog) flex max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] -translate-1/2 flex-col border-2 border-panel-border bg-surface text-fg shadow-pixel-drop data-[state=open]:animate-fade-in"
        >
          {open ? <ExportBody name={name} value={value} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ExportBody({ name, value }: { name: string; value: string }) {
  const id = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [flash, setFlash] = useState(false)
  const [status, setStatus] = useState<{ tone: 'done' | 'warn'; text: string } | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), SAVED_FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])
  const select = () => {
    areaRef.current?.focus()
    areaRef.current?.select()
  }
  const onCopy = async () => {
    const copied = await copyText(value, {
      clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
      fallback: () => {
        select()
        return document.execCommand('copy')
      },
    })
    if (copied) {
      setFlash(true)
      setStatus({ tone: 'done', text: text.COPIED_STATUS })
    } else {
      select()
      setStatus({ tone: 'warn', text: text.COPY_FAILED })
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-4 py-2">
        <Dialog.Title className="min-w-0 font-display text-sm leading-relaxed break-words text-accent text-shadow-pixel md:text-base">{text.exportTitle(name)}</Dialog.Title>
        <Dialog.Close aria-label={text.CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        <Dialog.Description className="text-sm text-fg-muted">{text.EXPORT_DESCRIPTION}</Dialog.Description>
        <div className="space-y-1">
          <label htmlFor={`${id}text`} className={LABEL}>
            {text.TEXT_LABEL}
          </label>
          <textarea ref={areaRef} id={`${id}text`} readOnly value={value} rows={12} spellCheck={false} onFocus={(e) => e.currentTarget.select()} className={TEXT_AREA} data-export-text="" />
        </div>
        <p role="status" className={cx('text-sm', status?.tone === 'warn' ? 'text-negative' : 'text-success')} data-export-copy-status="">
          {status?.text ?? ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t-2 border-panel-border px-4 py-3">
        <Dialog.Close className={buttonClass('secondary')}>{text.DONE}</Dialog.Close>
        <button type="button" onClick={() => void onCopy()} className={buttonClass('primary')} data-export-copy="">
          <ClipboardCopy aria-hidden="true" className="size-5" />
          {flash ? text.COPIED : text.COPY}
        </button>
      </div>
    </>
  )
}

// --- import -----------------------------------------------------------------------------------------------

export interface BuildImportProps {
  page: ReadinessPageData
  builds: readonly SavedBuild[]
  /** Saves the build as a NEW saved build and returns it. */
  onAdd: (build: BuildRecord) => SavedBuild
}

type ImportState = { step: 'idle'; error?: BuildCodeError } | { step: 'preview'; read: Extract<BuildCodeRead, { ok: true }> }

export function BuildImport({ page, builds, onAdd }: BuildImportProps) {
  const id = useId()
  const panelId = `${id}panel`
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [state, setState] = useState<ImportState>({ step: 'idle' })
  const [status, setStatus] = useState('')
  /** The build an import just added: its card heading takes focus once the list shows it. */
  const focusBuild = useRef<string | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (state.step === 'preview') previewRef.current?.focus()
  }, [state])
  // The added build's card renders with the store's update: focus its heading then.
  useEffect(() => {
    if (!focusBuild.current) return
    const heading = document.getElementById(buildHeadingId(focusBuild.current))
    if (!heading) return
    heading.focus()
    focusBuild.current = null
  }, [builds])

  const openPanel = () => {
    setOpen(true)
    setStatus('')
    requestAnimationFrame(() => areaRef.current?.focus())
  }
  const close = () => {
    setOpen(false)
    setValue('')
    setState({ step: 'idle' })
    requestAnimationFrame(() => toggleRef.current?.focus())
  }
  const read = () => {
    const result = readBuildText(value)
    setStatus('')
    if (!result.ok) {
      setState({ step: 'idle', error: result.error })
      // UX_SPEC §9: an import error focuses the invalid field.
      requestAnimationFrame(() => areaRef.current?.focus())
      return
    }
    setState({ step: 'preview', read: result })
  }
  const add = () => {
    if (state.step !== 'preview') return
    const created = onAdd(state.read.build)
    setOpen(false)
    setValue('')
    setState({ step: 'idle' })
    setStatus(text.added(created.name))
    focusBuild.current = created.buildId
  }

  const error = state.step === 'idle' ? state.error : undefined
  const errorId = `${id}error`
  return (
    <div className="space-y-3" data-build-import="">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : openPanel())}
          className={buttonClass('secondary', 'min-h-tap px-3 text-sm')}
          data-import-toggle=""
        >
          <ClipboardPaste aria-hidden="true" className="size-4" />
          {text.IMPORT_OPEN}
        </button>
        <p role="status" className="text-sm text-success" data-import-status="">
          {status}
        </p>
      </div>
      <div id={panelId} hidden={!open}>
        {open ? (
          <section aria-labelledby={`${id}title`} className="space-y-3 border-2 border-panel-border bg-night-900 p-3 md:p-4" data-import-panel="">
            <div className="space-y-1">
              <h3 id={`${id}title`} className="font-semibold">
                {text.IMPORT_TITLE}
              </h3>
              <p className="text-sm text-fg-muted">{text.IMPORT_INTRO}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}text`} className={LABEL}>
                {text.IMPORT_LABEL}
              </label>
              <textarea
                ref={areaRef}
                id={`${id}text`}
                value={value}
                rows={6}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setValue(e.target.value)
                  // The preview (or an error) was for the text as it was.
                  if (state.step !== 'idle' || state.error) setState({ step: 'idle' })
                }}
                className={cx(TEXT_AREA, error && 'outline-2 outline-offset-2 outline-negative outline-solid')}
                data-import-text=""
              />
              {error ? (
                <div id={errorId} role="alert" className="space-y-1 text-sm text-negative" data-import-error={error.kind}>
                  <p>{text.importError(error)}</p>
                  {error.kind === 'invalid' ? (
                    <p className="text-fg-muted">
                      {text.TECHNICAL} <code className="font-mono text-xs break-words">{error.failure.message}</code>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {state.step === 'preview' ? (
              <BuildImportPreview page={page} builds={builds} read={state.read} headingRef={previewRef} headingId={`${id}preview`} onAdd={add} onCancel={close} />
            ) : (
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={read} className={buttonClass('primary')} data-import-read="">
                  <FileInput aria-hidden="true" className="size-5" />
                  {text.IMPORT_READ}
                </button>
                <button type="button" onClick={close} className={buttonClass('secondary')} data-import-cancel="">
                  {text.IMPORT_CANCEL}
                </button>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

export interface BuildImportPreviewProps {
  page: ReadinessPageData
  builds: readonly SavedBuild[]
  read: Extract<BuildCodeRead, { ok: true }>
  headingId: string
  headingRef?: RefObject<HTMLHeadingElement | null>
  onAdd: () => void
  onCancel: () => void
}

/** UX_SPEC §4(f): the read build before anything is saved — inputs, slots, unknown items by id, a duplicate. */
export function BuildImportPreview({ page, builds, read, headingId, headingRef, onAdd, onCancel }: BuildImportPreviewProps) {
  const b = read.build
  const model = importPreview(
    b,
    (itemId) => isKnownItem(page.engine, itemId),
    (slug) => page.engine.bosses.has(slug),
    builds,
  )
  const boss = b.targetBoss && !model.missingBoss ? page.engine.bosses.get(b.targetBoss)?.name : undefined
  return (
    <section aria-labelledby={headingId} className="space-y-2 border-t-2 border-panel-border pt-3" data-import-preview="">
      <h4 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold break-words focus:outline-none">
        {text.previewTitle(b.name)}
      </h4>
      <p className="text-sm text-fg-muted">{text.PREVIEW_LEAD}</p>
      <p className="text-xs text-fg-muted">{copy.buildMeta(copy.CLASS_NAMES[b.class], getStageInfo(b.stage).label, copy.DIFFICULTY_NAMES[b.difficulty], b.goal ? copy.GOAL_NAMES[b.goal] : undefined)}</p>
      {boss ? <p className="text-xs text-fg-muted">{copy.madeFor(boss)}</p> : null}
      {model.missingBoss ? <p className="text-sm">{text.previewBossMissing(model.missingBoss)}</p> : null}
      {read.gameVersion !== meta.gameVersion ? <p className="text-sm text-fg-muted">{text.previewGame(read.gameVersion, meta.gameVersion)}</p> : null}
      <p className="text-sm" data-import-counts="">
        {text.itemsCount(model.items.length)} {text.ownedCount((b.ownedIds ?? []).length)}
      </p>
      {model.items.length > 0 ? (
        <InventoryGrid label={copy.previewLabel(b.name)} columns={10}>
          {model.items.map((itemId, i) => (
            <ItemSquare key={`${itemId}-${i}`} page={page} id={itemId} />
          ))}
        </InventoryGrid>
      ) : null}
      {model.unknown.length > 0 ? (
        <div className="space-y-1 border-l-4 border-gold-600 bg-night-950 px-3 py-2 text-sm" data-import-unknown={model.unknown.length}>
          <p>{text.unknownTitle(model.unknown.length, meta.gameVersion)}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {model.unknown.map((row) => (
              <li key={row.id} data-unknown-id={row.id}>
                {text.unknownRow(row.id, row.where.join(', '))}
              </li>
            ))}
          </ul>
          <p className="text-fg-muted">{text.UNKNOWN_KEPT}</p>
        </div>
      ) : null}
      {model.duplicateOf ? (
        <p className="text-sm" data-import-duplicate={model.duplicateOf.buildId}>
          {text.alreadySaved(model.duplicateOf.name)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3 pt-1">
        <button type="button" onClick={onAdd} className={buttonClass('primary')} data-import-add="">
          <Plus aria-hidden="true" className="size-5" />
          {text.ADD}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('secondary')} data-import-cancel="">
          {text.IMPORT_CANCEL}
        </button>
      </div>
    </section>
  )
}
