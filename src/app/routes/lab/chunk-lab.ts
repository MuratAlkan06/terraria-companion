/**
 * `chunk-lab` (UX_SPEC §1): the Weapon Lab route's lazy chunk. Imported ONLY through the route
 * registry's dynamic import (src/app/routes.tsx). PixiJS is not in this chunk either: the arena
 * renderer (src/lab/arena) is a further dynamic import made by ArenaCanvas, so it downloads only
 * when the arena mounts (enforced by src/lab/boundaries.test.ts).
 */
export { default as LabPage } from './LabPage'
