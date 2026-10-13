/**
 * Where keyboard focus goes through a timed test's lifecycle (design review P3-S2/S3 H2). Each step
 * unmounts the control that had focus — the start buttons give way to the countdown, the countdown
 * to the results, the results to the start buttons — so focus moves to what replaced it instead of
 * dropping to <body>; a keyboard user runs, reads, repeats and resets a test without tabbing back
 * in from the top of the page.
 * - start / Run again → the countdown (the control's running state).
 * - finish → the results heading, but only when focus was lost (it was on the countdown): if the
 *   user moved focus elsewhere meanwhile, it stays there (UX_SPEC §9: completion is announced
 *   politely; focus is not taken).
 * - Reset from the results → the start button of the test that just ran.
 */
import { RESULTS_TITLE_ID, startTestId, TIMED_TEST_STATUS_ID } from './labIds'

export type TimedTestFocusEvent =
  | { kind: 'start' }
  | { kind: 'run-again' }
  | { kind: 'finish'; focusLost: boolean }
  | { kind: 'results-reset'; durationSec: number }

/** The id of the element to focus after `event`, or null to leave focus where it is. */
export function timedTestFocusTarget(event: TimedTestFocusEvent): string | null {
  switch (event.kind) {
    case 'start':
    case 'run-again':
      return TIMED_TEST_STATUS_ID
    case 'finish':
      return event.focusLost ? RESULTS_TITLE_ID : null
    case 'results-reset':
      return startTestId(event.durationSec)
  }
}

/** Focus is nowhere in particular: on <body> (its element was removed) or nothing. */
export function focusIsLost(doc: Pick<Document, 'activeElement' | 'body'>): boolean {
  return doc.activeElement === null || doc.activeElement === doc.body
}
