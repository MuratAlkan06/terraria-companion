/**
 * `tc.v1.settings` domain (DATA_SCHEMA_SPEC §8a `SettingsV1`).
 *
 * Hand-written strict validator for P1; the Zod `SettingsV1` schema replaces it
 * when the schemas package lands in P2. Shape and strictness match the spec
 * (strictObject: exactly these keys, no extras).
 */
import { isStage, type Stage } from '../app/stages'
import type { DomainDef } from './types'

export interface SettingsData {
  selectedStage: Stage | null
  spriteFallback: boolean
  labIgnoreManaDefault: boolean
}

export const DEFAULT_SETTINGS: SettingsData = {
  selectedStage: null,
  spriteFallback: false,
  labIgnoreManaDefault: false,
}

const SETTINGS_KEYS = ['selectedStage', 'spriteFallback', 'labIgnoreManaDefault'] as const

export function parseSettings(input: unknown): SettingsData {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('settings: expected an object')
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  const unexpected = keys.filter((k) => !(SETTINGS_KEYS as readonly string[]).includes(k))
  if (unexpected.length > 0) throw new TypeError(`settings: unexpected keys ${unexpected.join(', ')}`)

  const { selectedStage, spriteFallback, labIgnoreManaDefault } = record
  if (selectedStage !== null && !isStage(selectedStage)) {
    throw new TypeError('settings.selectedStage: expected a stage id or null')
  }
  if (typeof spriteFallback !== 'boolean') throw new TypeError('settings.spriteFallback: expected boolean')
  if (typeof labIgnoreManaDefault !== 'boolean') {
    throw new TypeError('settings.labIgnoreManaDefault: expected boolean')
  }
  return { selectedStage, spriteFallback, labIgnoreManaDefault }
}

export const settingsDomain: DomainDef<SettingsData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseSettings,
}
