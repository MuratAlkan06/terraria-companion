import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import type { Weapon } from '../../../../data-access/types'
import { useProgressStore } from '../../../progressStore'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { COMPARE_PARAM, compareSearch } from './compareLinks'
import * as copy from './compareCopy'
import { loadCompareData, peekCompareData } from './compareData'
import { ADD_BUTTON_ID, changeButtonId, linkCleanup, parseCompareParam, resolveSelection, withAdded, withRemoved, withSwapped } from './compareModel'
import { ComparePicker, type PickerMode } from './ComparePicker'
import { CompareView } from './CompareView'

/**
 * /compare (PRD P4-S1; UX_SPEC §1, §3.6, §10.11). The URL is the whole state — `?w=4956,757,1308`, ids in
 * column order — so a comparison is shareable and restores on reload or back navigation (AC5). Every
 * add / change / remove rewrites the link in place (replace: the comparison is one page, not a history
 * of edits) with the dataset's ids only, so a cleaned-up link drops what the notices reported. A link
 * that names anything not compared shows and announces its notices once, then is rewritten in place to
 * the canonical link (AMENDMENTS-016 B101d) — the notices stay on screen until the next edit.
 * Tracked defeats come from the shared progress store, so gate badges follow the boss map live.
 */
export default function ComparePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const raw = params.get(COMPARE_PARAM)
  const selection = useMemo(() => parseCompareParam(raw), [raw])
  const resource = useResource('compare-data', loadCompareData, peekCompareData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const progress = useProgressStore((s) => s.progress)
  const data = resource.status === 'ready' ? resource.data : undefined
  const resolved = useMemo(() => (data ? resolveSelection(selection.ids, data.weapons) : undefined), [data, selection])

  const [picker, setPicker] = useState<{ open: boolean; mode: PickerMode }>({ open: false, mode: { kind: 'add' } })
  const [announcement, setAnnouncement] = useState('')
  // B101d: the notices of a link rewritten to its canonical form — `from` the link as given, `to` the canonical one.
  const [cleaned, setCleaned] = useState<{ from: string | null; to: string | null; notices: readonly string[] } | null>(null)
  // Focus after an edit: the edited column's Change button, or the add button after a removal.
  const pendingFocus = useRef<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  useDocumentTitle(resolved && resolved.weapons.length > 0 ? `${copy.PAGE_TITLE}: ${copy.andList(resolved.weapons.map((w) => w.name))}` : copy.PAGE_TITLE)

  // B101d: a link naming what isn't compared shows its notices, is replaced by the canonical link, and the
  // notices stay (and are announced, once) on that canonical link until the next edit. The notices are
  // remembered while rendering (React's "adjust state when an input changes"); the effect only syncs the URL.
  const cleanup = useMemo(() => (resolved ? linkCleanup(selection, resolved) : undefined), [resolved, selection])
  if (cleanup && cleaned?.from !== raw) setCleaned({ from: raw, to: new URLSearchParams(cleanup.search).get(COMPARE_PARAM), notices: cleanup.notices })
  useEffect(() => {
    if (cleanup) navigate({ search: cleanup.search }, { replace: true })
  }, [cleanup, navigate])
  const onCleanedLink = !cleanup && cleaned !== null && cleaned.to === raw
  const notices = cleanup?.notices ?? (onCleanedLink ? cleaned.notices : [])
  // The live region starts empty and gains the notices once the link is canonical, so they're announced once.
  const liveText = onCleanedLink ? cleaned.notices.join(' ') : announcement

  // The link is committed asynchronously; move focus once the edited column exists.
  useEffect(() => {
    if (picker.open || !pendingFocus.current) return
    const target = document.getElementById(pendingFocus.current)
    if (!target) return
    target.focus()
    pendingFocus.current = null
  }, [raw, picker.open])

  const ids = resolved?.weapons.map((w) => w.id) ?? []
  const commit = (next: number[], message: string, focusId: string) => {
    pendingFocus.current = focusId
    setCleaned(null)
    setAnnouncement(message)
    navigate({ search: compareSearch(next) }, { replace: true })
  }
  const nameOf = (id: number) => data?.weapons.get(id)?.name ?? String(id)

  const openPicker = (mode: PickerMode, from: string) => {
    opener.current = document.getElementById(from)
    setPicker({ open: true, mode })
  }
  const onPick = (id: number) => {
    if (picker.mode.kind === 'swap') {
      const from = picker.mode.weapon
      commit(withSwapped(ids, from.id, id), copy.announceSwapped(from.name, nameOf(id)), changeButtonId(id))
    } else {
      const next = withAdded(ids, id)
      commit(next, copy.announceAdded(nameOf(id), next.length), changeButtonId(id))
    }
    setPicker((p) => ({ ...p, open: false }))
  }
  const onRemove = (weapon: Weapon) => {
    const next = withRemoved(ids, weapon.id)
    commit(next, copy.announceRemoved(weapon.name, next.length), ADD_BUTTON_ID)
  }

  if (resource.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <ErrorState title={copy.LOAD_ERROR_TITLE} error={resource.error} onRetry={resource.retry} />
      </div>
    )
  }
  if (!data || !resolved) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {showSkeleton ? <SkeletonPanel label={copy.LOADING} lines={8} /> : <div className="min-h-[50dvh]" aria-hidden="true" />}
      </div>
    )
  }

  return (
    <>
      <CompareView
        selection={selection}
        weapons={resolved.weapons}
        missing={resolved.missing}
        notices={notices}
        data={data}
        progress={progress}
        announcement={liveText}
        onAdd={() => openPicker({ kind: 'add' }, ADD_BUTTON_ID)}
        onChange={(weapon) => openPicker({ kind: 'swap', weapon }, changeButtonId(weapon.id))}
        onRemove={onRemove}
      />
      <ComparePicker
        open={picker.open}
        onOpenChange={(open) => setPicker((p) => ({ ...p, open }))}
        mode={picker.mode}
        selectedIds={ids}
        weapons={data.weapons}
        graph={data.graph}
        progress={progress}
        sprites={data.sprites}
        onPick={onPick}
        returnFocus={() => (pendingFocus.current ? document.getElementById(pendingFocus.current) : null) ?? (opener.current?.isConnected ? opener.current : null)}
      />
    </>
  )
}
