/** DOM ids shared between Lab components (focus moves between the picker, panels and the dock). */
export const PANEL_WEAPONS = 'lab-weapons'
export const PANEL_SETTINGS = 'lab-settings'

/** The id of a weapon's radio in a picker instance (`name` is unique per instance). */
export const pickerOptionId = (name: string, weaponId: number) => `${name}-${weaponId}`

/** The button that shows/hides a side panel (one mounted per panel at a time). */
export const panelToggleId = (panelId: string) => `${panelId}-toggle`
