/**
 * Provenance envelope `_prov`, uniform on every emitted record (DATA_SCHEMA_SPEC §2.1).
 *
 * Global nullability policy (binding): emitted JSON never uses `null` for unknown.
 * - present                          → value (verified, or editorial if listed in editorialFields)
 * - absent + listed in unverifiedFields → unknown; UI renders "Unknown"
 * - absent + not listed              → not applicable; UI omits the row
 * - present + listed                 → FORBIDDEN at emit (pipeline E_UNVERIFIED_VALUE_EMITTED)
 * Read fields through `getField` (./getField.ts), never directly.
 */
import * as z from 'zod'
import { GAME_VERSION, IsoDate, Slug, WikiUrl } from './common'

export const SourceKind = z.enum([
  'iteminfo',
  // P2-S2a: data extracted from another wiki Lua module (Module:Recipes, Module:RecipeGroups,
  // Module:Recipes/l10n) — machine-extracted like iteminfo, NOT curated; rev required.
  'wiki-module',
  // P2-S7 (same reasoning as B8): data machine-extracted from a rendered wiki ARTICLE revision —
  // the Buff IDs table, item / buff infobox rows (velocity multiplier, buff effects). NOT curated; rev
  // (the article revision id) required.
  'wiki-article',
  'cargo:Items',
  'cargo:Recipes',
  'cargo:Drops',
  'cargo:NPCs',
  'cargo:Equipinfo',
  'cargo:Weapon_source',
  'cargo:Exclusive',
  'cargo:Imageinfo',
  'cargo:Modifiers',
  'curated',
])
export type SourceKind = z.infer<typeof SourceKind>

export const ProvSource = z
  .strictObject({
    kind: SourceKind,
    url: WikiUrl,
    rev: z.int().positive().optional(), // REQUIRED for kinds "iteminfo" / "wiki-module" / "wiki-article" (ADR D1 caveat)
    fetchedAt: IsoDate,
    overlay: Slug.optional(), // REQUIRED for kind "curated"
  })
  .refine((s) => (s.kind !== 'iteminfo' && s.kind !== 'wiki-module' && s.kind !== 'wiki-article') || s.rev !== undefined, {
    message: 'rev is required for kinds "iteminfo", "wiki-module" and "wiki-article" (ADR D1)',
    path: ['rev'],
  })
  .refine((s) => s.kind !== 'curated' || s.overlay !== undefined, {
    message: 'overlay is required for kind "curated"',
    path: ['overlay'],
  })
export type ProvSource = z.infer<typeof ProvSource>

export const Prov = z
  .strictObject({
    gameVersion: z.literal(GAME_VERSION),
    sources: z.array(ProvSource).min(1),
    verified: z.boolean(),
    unverifiedFields: z.array(z.string()), // dot-paths, e.g. "rates.expert"
    editorialFields: z.array(z.string()), // dot-paths sourced ONLY from curated overlays
    // AMENDMENTS-010 B49: dot-paths of values derived from a Lab MODELING CONVENTION (B44 / B46 / B47 —
    // registry `MODELING_CONVENTIONS` in weapon.ts, which names each path's ruling), so any consumer can
    // tell modeled geometry from extracted game data. Each path must be present (validate stage).
    modeledFields: z.array(z.string()).optional(),
  })
  // §2.1 rule 1: verified ⇒ no unverified fields (verified:false may also come from a
  // failed cross-check or an unconfirmed 1.4.5.7→1.4.5.8 patch-diff field).
  .refine((p) => !p.verified || p.unverifiedFields.length === 0, {
    message: 'verified:true requires an empty unverifiedFields list (§2.1 rule 1)',
    path: ['verified'],
  })
  // B49: a modeled value is present by definition, so it can never also be Unknown.
  .refine((p) => !(p.modeledFields ?? []).some((m) => p.unverifiedFields.some((u) => m === u || m.startsWith(`${u}.`))), {
    message: 'a modeledFields path must not be listed (or covered) in unverifiedFields (B49)',
    path: ['modeledFields'],
  })
export type Prov = z.infer<typeof Prov>
