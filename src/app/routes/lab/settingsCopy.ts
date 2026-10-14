/**
 * Words for the Lab's setup changes shared by the TargetSettingsPanel and the aria-live announcer:
 * a new ammo or a changed mana setting restarts the stats (src/lab/labSession.ts), and both say so
 * the same way (design review P3-S4/S5 M6). Also the announcer's words for a summon replacing the
 * oldest and for the single Reset.
 */
import { LAB_ASSUMPTIONS } from '../../../lab/labAssumptions'
import type { LabTarget } from '../../../lab/labSetup'
import type { InsufficientManaPolicy, LabSettings, SummonKind } from '../../../sim'

/** The low-mana casting choices, as the panel titles them. */
export const LOW_MANA_POLICY_TITLE: Record<InsufficientManaPolicy, string> = {
  'slow-cast': 'Keep casting at 40% attack speed',
  block: 'Stop at zero',
}

const RESTARTED = 'the stats start again from zero.'

/** "3 Infinite Dummies in a row — the stats start again from zero." (a new target, P3-S6) */
export const targetAnnouncement = (target: LabTarget): string =>
  `${target.kind === 'row' ? `${target.count} Infinite Dummies in a row` : 'One Infinite Dummy'} — ${RESTARTED}`

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

/** "Minion slots 3 — the stats start again from zero." (a slot setting while summons are involved) */
export function slotsAnnouncement(patch: Partial<LabSettings>): string {
  const what = patch.minionSlots !== undefined ? `Minion slots ${patch.minionSlots}` : patch.sentrySlots !== undefined ? `Sentry slots ${patch.sentrySlots}` : 'Slots changed'
  return `${what} — ${RESTARTED}`
}

/** "Minion loadout: Slime Staff — its minions are out, and the stats start again from zero." / "Minion loadout off — …" */
export const loadoutAnnouncement = (name: string | null): string =>
  name ? `Minion loadout: ${name} — its minions are out, and ${RESTARTED}` : `Minion loadout off — ${RESTARTED}`

/**
 * "Oldest minion replaced — 2/2 slots." (design review M1): a summon with the slots full replaced the
 * oldest — `count` of them at once, when one new summon needed the room of several. The data has no
 * name for a staff's minion, so it says "minion" / "sentry".
 */
export function replacedAnnouncement(kind: SummonKind, count: number, slotsUsed: string, slots: number): string {
  const what = count > 1 ? `${count} oldest ${kind === 'sentry' ? 'sentries' : 'minions'}` : `Oldest ${kind}`
  return `${what} replaced — ${slotsUsed}/${slots} slots.`
}

/**
 * The single Reset, said (PRD P3-S2 AC3, P3-S9 AC4): what it restored, and the summons it cleared —
 * a staff's summons that were out, or the whip's minion loadout.
 */
export function resetAnnouncement({ weaponName, stopped, summonsCleared, loadoutCleared }: { weaponName: string; stopped: boolean; summonsCleared: boolean; loadoutCleared: boolean }): string {
  const cleared = loadoutCleared ? ', minion loadout cleared' : summonsCleared ? ', summons cleared' : ''
  return `${stopped ? 'Test stopped. ' : ''}Reset: stats, target and default settings restored${cleared} — ${weaponName} is ready.`
}

/**
 * Design review P3-S4/S5 H2: what the Lab does NOT take from an ammo, in one sentence — the picker's
 * help says exactly what the est. DPS tips say (`ammo-effects`).
 */
export const AMMO_EFFECTS_NOTE = LAB_ASSUMPTIONS['ammo-effects'].detail
