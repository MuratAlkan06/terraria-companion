/**
 * TEST FIXTURES ONLY — never imported by the app. The committed dataset as the Lab loads it
 * (src/app/routes/lab/labData.ts): every weapon, and the setup built from the committed items and
 * buff registry, so Lab tests run on the real data (which may grow under them).
 */
import buffsJson from '../../data/buffs.json'
import itemsJson from '../../data/items.detail.json'
import weaponsJson from '../../data/weapons.detail.json'
import type { Buff, Item, Weapon } from '../../schemas'
import { labSetup } from '../labSetup'

export const ALL_WEAPONS = weaponsJson as Weapon[]
export const ALL_ITEMS = itemsJson as Item[]
export const ALL_BUFFS = buffsJson as Buff[]
/** The Lab's setup from the committed data: every ammo item and the buff registry. */
export const LAB_SETUP = labSetup(ALL_ITEMS, ALL_BUFFS)
