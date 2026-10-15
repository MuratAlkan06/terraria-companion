/**
 * Words for the Lab's setup changes shared by the TargetSettingsPanel and the aria-live announcer:
 * a new ammo or a changed mana setting restarts the stats (src/lab/labSession.ts), and both say so
 * the same way (design review P3-S4/S5 M6). Also the announcer's words for a summon replacing the
 * oldest and for the single Reset.
 */
import { LAB_ASSUMPTIONS } from '../../../lab/labAssumptions'
import type { LabTarget } from '../../../lab/labSetup'
import { DEFAULT_DUMMY_HEIGHT_TILES, DEFAULT_DUMMY_WIDTH_TILES, type DummyMotionAxis, type InsufficientManaPolicy, type LabSettings, type SummonKind } from '../../../sim'

/** The low-mana casting choices, as the panel titles them. */
export const LOW_MANA_POLICY_TITLE: Record<InsufficientManaPolicy, string> = {
  'slow-cast': 'Keep casting at 40% attack speed',
  block: 'Stop at zero',
}

const RESTARTED = 'the stats start again from zero.'

/** The Moving Dummy's path in words: "away and back" / "up and back". */
export const MOVING_PATH_WORDS: Readonly<Record<DummyMotionAxis, string>> = { horizontal: 'away and back', vertical: 'up and back' }

/**
 * The Armored Dummy's defense rule, worded as the defense assumptions tip words it (APPROXIMATIONS.defense;
 * AMENDMENTS-016 B101c) — on its target card and under its defense slider.
 */
export const DEFENSE_RULE_PHRASE = 'each hit is reduced by half the dummy defense (rounded down, never below 1)'
export const DEFENSE_RULE = `${DEFENSE_RULE_PHRASE.charAt(0).toUpperCase()}${DEFENSE_RULE_PHRASE.slice(1)}.`

/** The Boss-Sized Dummy's size in words: "6 × 9 tiles". */
export const bossSizeWords = (scale: number): string => `${DEFAULT_DUMMY_WIDTH_TILES * scale} × ${DEFAULT_DUMMY_HEIGHT_TILES * scale} tiles`

/**
 * A target's name and what is set on it: { "Boss-Sized Dummy", "6 × 9 tiles" }, { "Moving Dummy", "away and
 * back at 4 tiles/s" }, { "Armored Dummy", "defense 36", "Plantera’s" } — `bossName`: the boss whose verified
 * defense an Armored Dummy uses, if any.
 */
function targetParts(target: LabTarget, bossName: string | null): { name: string; detail: string | null; boss: string | null } {
  switch (target.kind) {
    case 'row':
      return { name: `${target.count} Infinite Dummies in a row`, detail: null, boss: null }
    case 'debuff':
      return { name: 'Debuff Dummy', detail: null, boss: null }
    case 'boss':
      return { name: 'Boss-Sized Dummy', detail: bossSizeWords(target.scale), boss: null }
    case 'moving':
      return { name: 'Moving Dummy', detail: `${MOVING_PATH_WORDS[target.axis]} at ${target.speedTps} tiles/s`, boss: null }
    case 'armored':
      return { name: 'Armored Dummy', detail: `defense ${target.defense}`, boss: bossName ? `${bossName}’s` : null }
    default:
      return { name: 'Infinite Dummy', detail: null, boss: null }
  }
}

/**
 * "3 Infinite Dummies in a row — the stats start again from zero." (a new target: P3-S6 row, P3-S11 Debuff
 * Dummy, P3-S12 roster: "Armored Dummy, defense 36 (Plantera’s) — …").
 */
export function targetAnnouncement(target: LabTarget, bossName: string | null = null): string {
  if (target.kind === 'debuff') return `Debuff Dummy, listing its active debuffs — ${RESTARTED}`
  if (target.kind === 'single') return `One Infinite Dummy — ${RESTARTED}`
  const { name, detail, boss } = targetParts(target, bossName)
  return `${name}${detail ? `, ${detail}` : ''}${boss ? ` (${boss})` : ''} — ${RESTARTED}`
}

/**
 * The target in words for running text: "the Infinite Dummy", "3 Infinite Dummies in a row", "the Debuff
 * Dummy", "the Boss-Sized Dummy (6 × 9 tiles)", "the Moving Dummy (away and back at 4 tiles/s)", "the
 * Armored Dummy (defense 36, Plantera’s)".
 */
export function targetPhrase(target: LabTarget, bossName: string | null = null): string {
  const { name, detail, boss } = targetParts(target, bossName)
  if (target.kind === 'row') return name
  const inner = [detail, boss].filter(Boolean).join(', ')
  return inner ? `the ${name} (${inner})` : `the ${name}`
}

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

/** PRD P3-S8 (UX_SPEC §3 "homing on/off"): the homing switch, and the name of its off state. */
export const HOMING_SETTING_LABEL = 'Homing'
export const HOMING_WHAT_IF = 'what-if: homing disabled'

/**
 * The homing switch on the LimitationCard of a weapon whose data says it homes (src/lab/labWeapons.ts
 * `homesInGame`) — disabled, with why: no simulated weapon carries homing (the P3-S8 audit), so the
 * what-if can't run. "Part of how it behaves" also fits a weapon whose homing is a side projectile's.
 */
export const homingUnavailableNote = (weaponName: string): string =>
  `Homing is part of how ${weaponName} behaves in-game. Comparing with and without it (${HOMING_WHAT_IF}) needs the Lab to simulate this weapon, which it doesn’t — see why above.`

/**
 * Design review P3-S4/S5 H2: what the Lab does NOT take from an ammo, in one sentence — the picker's
 * help says exactly what the est. DPS tips say (`ammo-effects`).
 */
export const AMMO_EFFECTS_NOTE = LAB_ASSUMPTIONS['ammo-effects'].detail
