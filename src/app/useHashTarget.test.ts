/* AMENDMENTS-016 B113c: hash anchors on async-mounted sections — the handler's logic (which hash it acts on,
 * scroll + focus once per history entry), the ids the item page offers, and the readiness link's anchor. */
import { describe, expect, it } from 'vitest'
import { ACQUISITION_ANCHOR } from './routes/bosses/readiness/ImprovePanel'
import { ITEM_SECTION_IDS } from './routes/db/items/itemNav'
import { ACQUISITION_TITLE_ID } from './routes/db/weapons/AcquisitionView'
import { hashTargetId, revealHashTarget, type HashTargetDocument } from './useHashTarget'

/** A stand-in document recording what was done to each element. */
function fakeDocument(present: readonly string[]) {
  const log: string[] = []
  const doc: HashTargetDocument = {
    getElementById: (id) =>
      present.includes(id)
        ? {
            scrollIntoView: (arg?: boolean | ScrollIntoViewOptions) => void log.push(`scroll ${id} ${JSON.stringify(arg)}`),
            focus: (opts?: FocusOptions) => void log.push(`focus ${id} ${JSON.stringify(opts)}`),
          }
        : null,
  }
  return { doc, log }
}

describe('useHashTarget (B113c)', () => {
  it('acts only on a hash naming one of the section ids (decoded); anything else is left to the browser', () => {
    expect(hashTargetId('#acq-title', ITEM_SECTION_IDS)).toBe('acq-title')
    expect(hashTargetId('#item-used-title', ITEM_SECTION_IDS)).toBe('item-used-title')
    expect(hashTargetId('#acq%2Dtitle', ITEM_SECTION_IDS)).toBe('acq-title')
    for (const hash of ['', '#', 'acq-title', '#main', '#nope', '#%E0%A4%A']) expect(hashTargetId(hash, ITEM_SECTION_IDS), hash).toBeUndefined()
  })

  it('a hard load or an in-app navigation (a new history entry): scrolls the heading to the top and focuses it without a second scroll — once', () => {
    const done = new Set<string>()
    const { doc, log } = fakeDocument(['acq-title'])
    expect(revealHashTarget('#acq-title', 'default', ITEM_SECTION_IDS, doc, done)).toBe(true) // the initial entry's key (hard load)
    expect(log).toEqual(['scroll acq-title {"block":"start"}', 'focus acq-title {"preventScroll":true}'])
    // the same entry again (a re-render, a section loading below, or back to it): no second jump
    expect(revealHashTarget('#acq-title', 'default', ITEM_SECTION_IDS, doc, done)).toBe(false)
    // an in-app navigation is a new entry: it jumps
    expect(revealHashTarget('#acq-title', 'k7f2a', ITEM_SECTION_IDS, doc, done)).toBe(true)
    expect(log).toHaveLength(4)
  })

  it('the section not mounted yet: nothing happens and the entry stays open, so the mount that brings it reveals it', () => {
    const done = new Set<string>()
    const before = fakeDocument([])
    expect(revealHashTarget('#acq-title', 'abc', ITEM_SECTION_IDS, before.doc, done)).toBe(false)
    expect(before.log).toEqual([])
    const after = fakeDocument(['acq-title'])
    expect(revealHashTarget('#acq-title', 'abc', ITEM_SECTION_IDS, after.doc, done)).toBe(true)
  })

  it('the readiness checker’s "how to get it" anchor is the acquisition heading both detail pages render', () => {
    expect(ACQUISITION_ANCHOR).toBe(ACQUISITION_TITLE_ID)
    expect(ITEM_SECTION_IDS).toContain(ACQUISITION_ANCHOR)
  })
})
