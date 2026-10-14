/**
 * `chunk-bosses` (UX_SPEC §1): the boss section's lazy chunk. Imported ONLY through the route
 * registry's dynamic import (src/app/routes.tsx). /bosses (the progression map, P5-S1) now;
 * /bosses/:id (boss pages, P5-S2/S3) joins this chunk when it ships.
 */
export { default as BossMapPage } from './BossMapPage'
