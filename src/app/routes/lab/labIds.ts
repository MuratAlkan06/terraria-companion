/** DOM ids shared between Lab components (focus moves between the browser, panels and the dock). */
export const PANEL_WEAPONS = 'lab-weapons'
export const PANEL_SETTINGS = 'lab-settings'
/** The DpsGraph strip (the Graph toggle controls it). */
export const DPS_GRAPH_ID = 'lab-dps-graph'

/** The id of a weapon's radio in a picker instance (`name` is unique per instance). */
export const pickerOptionId = (name: string, weaponId: number) => `${name}-${weaponId}`

/** The button that shows/hides a side panel (one mounted per panel at a time). */
export const panelToggleId = (panelId: string) => `${panelId}-toggle`

/** A panel's lock notice (what a disabled panel or dock button is described by). */
export const lockNoticeId = (panelId: string) => `${panelId}-lock`

/** A timed test's start button ("10s test" / "30s test"). */
export const startTestId = (durationSec: number) => `lab-start-test-${durationSec}`
/** The running test's countdown (focusable: focus moves there when a test starts). */
export const TIMED_TEST_STATUS_ID = 'lab-timed-test-status'
/** The ResultsSummary heading (focusable: focus moves there when a test ends). */
export const RESULTS_TITLE_ID = 'lab-results-title'
