import { useSyncExternalStore } from 'react'
import type { LabHudState, LabSession } from '../../../lab/labSession'

/** Live HUD numbers for a Lab session (re-renders only when the session publishes). */
export function useLabHud(session: LabSession): LabHudState {
  return useSyncExternalStore(session.subscribe, session.getHud, session.getHud)
}
