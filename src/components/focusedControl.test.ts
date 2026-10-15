import { describe, expect, it } from 'vitest'
import { focusedControl } from './focusedControl'

/** Stand-ins for what document.activeElement can be after a click (no DOM renderer needed). */
const el = (tabIndex: number) => ({ tabIndex, focus: () => {} }) as unknown as HTMLElement
const body = el(-1)
const doc = (active: Element | null) => ({ activeElement: active, body }) as Pick<Document, 'activeElement' | 'body'>

describe('focusedControl: an overlay’s opener, Safari-proof (P7-S3 cross-browser pass)', () => {
  it('a focused control in the tab order is the opener (keyboard use, and click focus in Chromium/Firefox)', () => {
    const button = el(0)
    expect(focusedControl(doc(button))).toBe(button)
  })

  it('Safari after a click: focus on <body> or on the shell’s <main tabIndex=-1> is no opener — the caller falls back', () => {
    expect(focusedControl(doc(body))).toBeNull()
    expect(focusedControl(doc(el(-1)))).toBeNull() // <main tabIndex={-1}>, a heading with tabIndex={-1}
    expect(focusedControl(doc(null))).toBeNull()
  })
})
