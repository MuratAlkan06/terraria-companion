/**
 * `chunk-db` (UX_SPEC §1): the database section's single lazy chunk. Every database route
 * (/weapons now; /armor, /accessories, /items later) imports its page from here, so they share
 * one code-split chunk. Data files are separate lazy chunks (src/data-access).
 * /favorites (P7-S1) ships here too (UX_SPEC §1): its cards are the database's EntityCards.
 */
export { default as WeaponsListPage } from './weapons/WeaponsListPage'
export { default as WeaponDetailPage } from './weapons/WeaponDetailPage'
export { default as FavoritesPage } from '../favorites/FavoritesPage'
