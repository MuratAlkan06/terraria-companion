/**
 * Tells the weapon picker's two ways of choosing apart (WCAG 3.2.2 On Input). Arrow keys move
 * through the native radio group: the browser checks each radio it lands on and fires a click on
 * it — that is browsing (the weapon equips as a live preview, nothing else changes). A click or tap
 * on a row, Space or Enter is a deliberate pick: a "commit", on which the phone sheet closes.
 *
 * Fed the radio's native events in the order the browser dispatches them: keydown → [arrow move:
 * click] → keyup; pointerdown → click; Space: keydown → keyup → [click, only if the radio was not
 * already checked — Chromium fires none for a checked one]. Pure, so the sequences are unit-tested
 * without a DOM.
 */
const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export type PickerAction = 'commit' | null

export class PickerIntent {
  /** An arrow key is down: the clicks the browser fires now are arrow-key moves, not picks. */
  private browsing = false

  keyDown(key: string): PickerAction {
    this.browsing = ARROW_KEYS.has(key)
    // Enter does nothing on a native radio, so the picker gives it the "choose this row" meaning.
    return key === 'Enter' ? 'commit' : null
  }

  /**
   * Space picks on release, like a button. On a radio that is already checked (the usual case:
   * arrow keys check as they move) the browser fires no click, so the keyup itself commits; on an
   * unchecked one the click that follows checks it and commits.
   */
  keyUp(key: string, checked: boolean): PickerAction {
    this.browsing = false
    return key === ' ' && checked ? 'commit' : null
  }

  pointerDown(): void {
    this.browsing = false
  }

  /** A click on a radio: an arrow-key move while browsing, else a pick (pointer, tap or Space). */
  click(): PickerAction {
    return this.browsing ? null : 'commit'
  }
}
