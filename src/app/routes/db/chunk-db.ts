/**
 * `chunk-db` (UX_SPEC §1): the database section's single lazy chunk. Every database route
 * (/weapons, /items, /armor, /accessories) imports its page from here, so they share
 * one code-split chunk. Data files are separate lazy chunks (src/data-access).
 * /favorites (P7-S1) ships here too (UX_SPEC §1): its cards are the database's EntityCards.
 */
export { default as WeaponsListPage } from './weapons/WeaponsListPage'
export { default as WeaponDetailPage } from './weapons/WeaponDetailPage'
// P6 item encyclopedia (AMENDMENTS-016): /items and /items/:id
export { default as ItemsListPage } from './items/ItemsListPage'
export { default as ItemDetailPage } from './items/ItemDetailPage'
// PRD P6-S1/S2 (AMENDMENTS-016 B131(b)): /armor, /armor/:id, /accessories, /accessories/:id
export { default as ArmorListPage } from './armor/ArmorListPage'
export { default as ArmorDetailPage } from './armor/ArmorDetailPage'
export { default as AccessoriesListPage } from './accessories/AccessoriesListPage'
export { default as AccessoryDetailPage } from './accessories/AccessoryDetailPage'
export { default as FavoritesPage } from '../favorites/FavoritesPage'
