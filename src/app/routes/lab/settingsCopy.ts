/**
 * Words for the Lab's setup changes shared by the TargetSettingsPanel and the aria-live announcer:
 * a new ammo or a changed mana setting restarts the stats (src/lab/labSession.ts), and both say so
 * the same way (design review P3-S4/S5 M6).
 */
import { LAB_ASSUMPTIONS } from '../../../lab/labAssumptions'
import type { InsufficientManaPolicy, LabSettings } from '../../../sim'

/** The low-mana casting choices, as the panel titles them. */
export const LOW_MANA_POLICY_TITLE: Record<InsufficientManaPolicy, string> = {
  'slow-cast': 'Keep casting at 40% attack speed',
  block: 'Stop at zero',
}

const RESTARTED = 'the stats start again from zero.'

/** "Wooden Arrow loaded — the stats start again from zero." */
export const ammoLoadedAnnouncement = (ammoName: string): string => `${ammoName} loaded — ${RESTARTED}`

/** "Stop at zero — the stats start again from zero." (one changed mana setting) */
export function manaSettingAnnouncement(patch: Partial<LabSettings>): string {
  const what =
    patch.insufficientMana !== undefined
      ? LOW_MANA_POLICY_TITLE[patch.insufficientMana]
      : patch.ignoreMana !== undefined
        ? `Ignore mana (test mode) ${patch.ignoreMana ? 'on' : 'off'}`
        : patch.manaRegen !== undefined
          ? `Mana regeneration ${patch.manaRegen === 'none' ? 'off' : 'on'}`
          : patch.maxMana !== undefined
            ? `Max mana ${patch.maxMana}`
            : 'Mana settings changed'
  return `${what} — ${RESTARTED}`
}

/**
 * Design review P3-S4/S5 H2: what the Lab does NOT take from an ammo, in one sentence — the picker's
 * help says exactly what the est. DPS tips say (`ammo-effects`).
 */
export const AMMO_EFFECTS_NOTE = LAB_ASSUMPTIONS['ammo-effects'].detail
