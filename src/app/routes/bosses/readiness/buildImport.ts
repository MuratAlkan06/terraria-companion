/**
 * A saved build into the readiness checker (AMENDMENTS-016 B106 queue: "readiness import-from-build
 * link"; UX_SPEC §3.5 Step 4 "Check Readiness", §3.8 SetupPane "import saved build"). Pure, no React.
 *
 * What crosses over: the slots as saved (DATA_SCHEMA_SPEC §8a LoadoutSlots — the same shape both
 * domains store), the class, the difficulty, the stage (context only here, B94(6)/B97b) and — when the
 * build was made for one that still exists — its target boss. What doesn't: the builder's owned list
 * (the checker counts every loadout item as yours, B94(1)), its goal, and its availability rules — the
 * checker keeps its own: tracked defeats only (B69/Q9), never the build's stage hypothesis.
 */
import type { SavedBuild } from '../../../../storage/builds'
import { STORED_ACCESSORY_SLOTS, type ReadinessLoadout, type ReadinessSetup } from '../../../../storage/readiness'
import type { Stage } from '../../../stages'

export interface ReadinessImport {
  /** Present only when the build names a boss the data has. */
  bossId?: string
  stage: Stage
  difficulty: ReadinessSetup['difficulty']
  cls: ReadinessSetup['class']
  loadout: ReadinessLoadout
}

/** The readiness setup values a saved build imports as (accessories padded / cut to the stored 7). */
export function readinessImportFromBuild(build: SavedBuild, isBoss: (id: string) => boolean): ReadinessImport {
  const s = build.slots
  const accessories = [...s.accessories, ...Array<null>(STORED_ACCESSORY_SLOTS).fill(null)].slice(0, STORED_ACCESSORY_SLOTS)
  return {
    ...(build.targetBoss && isBoss(build.targetBoss) ? { bossId: build.targetBoss } : {}),
    stage: build.stage,
    difficulty: build.difficulty,
    cls: build.class,
    loadout: { mainWeapon: s.mainWeapon, altWeapon: s.altWeapon, helmet: s.helmet, chest: s.chest, legs: s.legs, accessories, ammo: [...s.ammo], buffs: [...s.buffs], summon: s.summon },
  }
}

const loadoutKey = (l: ReadinessLoadout) => JSON.stringify([l.mainWeapon, l.altWeapon, l.helmet, l.chest, l.legs, l.accessories, l.ammo, l.buffs, l.summon])

/** Any item anywhere in the stored loadout (inactive accessory slots included: they'd be lost too). */
const holdsItems = (l: ReadinessLoadout) => [l.mainWeapon, l.altWeapon, l.helmet, l.chest, l.legs, l.summon, ...l.accessories].some((x) => x !== null) || l.ammo.length > 0 || l.buffs.length > 0

/**
 * Would importing replace a loadout the user entered here? Then the page asks first (UX_SPEC §10.6:
 * destructive actions confirm). An empty setup, or one already holding exactly these slots, doesn't ask.
 */
export function importReplacesLoadout(setup: ReadinessSetup, imported: ReadinessImport): boolean {
  return holdsItems(setup.loadout) && loadoutKey(setup.loadout) !== loadoutKey(imported.loadout)
}
