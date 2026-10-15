/**
 * The Loadout Builder's deep links from other pages (UX_SPEC §1 `/loadout?step=1..4`; §3.6 compare's
 * "Open in Builder", AMENDMENTS-016 B99f). Dependency-free on purpose: the compare chunk links here
 * without downloading the builder or the scoring engine.
 */

/** The builder route's path (registered in src/app/routes.tsx as id "loadout"). */
export const LOADOUT_PATH = '/loadout'

const STAFF_TAGS = ['minion-summon-items', 'sentry-summon-items']

/**
 * The builder at Step 1 with this weapon fixed in its slot, for its class: a summon staff in the summon
 * slot (class summon); a whip as a summoner's main weapon; a classless weapon under "hybrid" (its only
 * class that takes every weapon); otherwise the weapon's own class. No stage (AMENDMENTS-016 B108(c)):
 * the comparison has none to pass, so the builder asks for it at Step 1 rather than silently defaulting
 * to one that may not fit the weapon — and choosing it keeps the weapon.
 */
export function builderHrefFor(weapon: { id: number; damageClass?: string; tags: readonly string[] }): string {
  if (weapon.tags.some((t) => STAFF_TAGS.includes(t))) return `${LOADOUT_PATH}?class=summon&summon=${weapon.id}`
  const cls = weapon.damageClass === 'melee' || weapon.damageClass === 'ranged' || weapon.damageClass === 'magic' || weapon.damageClass === 'summon' ? weapon.damageClass : 'hybrid'
  return `${LOADOUT_PATH}?class=${cls}&main=${weapon.id}`
}
