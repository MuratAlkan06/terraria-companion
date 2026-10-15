/**
 * `chunk-bosses` (UX_SPEC §1): the boss section's lazy chunk. Imported ONLY through the route
 * registry's dynamic import (src/app/routes.tsx): /bosses (the progression map, P5-S1) and
 * /bosses/:id (boss pages, P5-S2 — the pre-Hardmode bosses in src/schemas/bossPages.ts).
 */
export { default as BossMapPage } from './BossMapPage'
export { default as BossPage } from './BossPage'
