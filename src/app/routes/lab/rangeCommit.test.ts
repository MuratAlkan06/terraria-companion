/**
 * The max-mana slider commits once per adjustment (./rangeCommit.ts): a drag or tap at release, a
 * blur at once, keyboard steps half a second after the last one — so the session restarts, and the
 * announcer speaks, once per adjustment instead of once per step. Fake timers; the session is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLabSession } from '../../../lab/labSession'
import { labWeapons } from '../../../lab/labWeapons'
import { ALL_WEAPONS, LAB_SETUP } from '../../../lab/testing/labData'
import type { LabSettings } from '../../../sim'
import { RANGE_SETTLE_MS, RangeCommit } from './rangeCommit'
import { manaSettingAnnouncement } from './settingsCopy'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function recorder() {
  const commits: number[] = []
  return { commits, control: new RangeCommit((v) => commits.push(v)) }
}

describe('RangeCommit: one commit per adjustment', () => {
  it('keyboard steps commit once, RANGE_SETTLE_MS after the last step', () => {
    const { commits, control } = recorder()
    expect(RANGE_SETTLE_MS).toBe(500)
    for (const v of [220, 240, 260, 280]) {
      control.input(v)
      vi.advanceTimersByTime(200) // a key repeat / quick presses: never settles in between
    }
    expect(commits).toEqual([])
    expect(control.draft).toBe(280)
    vi.advanceTimersByTime(RANGE_SETTLE_MS - 200 - 1)
    expect(commits).toEqual([])
    vi.advanceTimersByTime(1)
    expect(commits).toEqual([280])
    expect(control.draft).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(commits).toEqual([280])
  })

  it('a drag commits once, at release — however long it pauses on the way', () => {
    const { commits, control } = recorder()
    control.pointerDown()
    for (const v of [220, 240, 260]) control.input(v)
    vi.advanceTimersByTime(3000) // holding still mid-drag is not a commit
    control.input(300)
    expect(commits).toEqual([])
    control.pointerUp()
    expect(commits).toEqual([300])
    control.pointerUp() // a stray release (the window listener) commits nothing more
    vi.advanceTimersByTime(5000)
    expect(commits).toEqual([300])
  })

  it('a tap on the track commits at release; leaving the slider commits at once; nothing pending commits nothing', () => {
    const { commits, control } = recorder()
    control.pointerDown()
    control.input(120)
    control.pointerUp()
    expect(commits).toEqual([120])
    control.input(140)
    control.blur()
    expect(commits).toEqual([120, 140])
    vi.advanceTimersByTime(RANGE_SETTLE_MS) // the settle timer was cancelled by the blur
    control.blur()
    control.commit()
    expect(commits).toEqual([120, 140])
  })
})

describe('the max-mana slider restarts the session once per adjustment, announced once', () => {
  it('Diamond Staff: four arrow presses and a ten-step drag — one restart and one announcement each', () => {
    const diamond = labWeapons(ALL_WEAPONS, LAB_SETUP).find((w) => w.name === 'Diamond Staff')!
    const created = createLabSession(diamond, { setup: LAB_SETUP, seed: () => 3 })
    if (!created.ok) throw new Error('refused')
    const session = created.session
    let restarts = 0
    session.onReset(() => restarts++)
    const announcements: string[] = []
    // LabPage's onSettingsChange: the session restarts the stats for a changed mana setting, and that is announced.
    const onSettingsChange = (patch: Partial<LabSettings>) => {
      const result = session.updateSettings(patch)
      if (result.ok && result.restarted) announcements.push(manaSettingAnnouncement(patch))
    }
    const control = new RangeCommit((maxMana) => onSettingsChange({ maxMana }))

    for (const v of [220, 240, 260, 280]) {
      control.input(v)
      vi.advanceTimersByTime(150)
    }
    expect(restarts).toBe(0)
    vi.advanceTimersByTime(RANGE_SETTLE_MS)
    expect(restarts).toBe(1)
    expect(announcements).toEqual(['Max mana 280 — the stats start again from zero.'])
    expect(session.getHud().mana).toMatchObject({ max: 280, current: 280 })

    control.pointerDown()
    for (let v = 300; v <= 400; v += 10) control.input(v - (v % 20))
    control.pointerUp()
    expect(restarts).toBe(2)
    expect(announcements).toHaveLength(2)
    expect(announcements[1]).toBe('Max mana 400 — the stats start again from zero.')
    expect(session.getHud().mana!.max).toBe(400)
  })
})
