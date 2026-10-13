# AMENDMENTS-009 — Rulings from P2-S7 (ammo/buffs sync)

Status: BINDING · 2026-10-13 · Orchestrator rulings.

## B39 — Buffs in search docs: RATIFIED (overrides the orchestrator's "buffs NO" brief instruction)
The engineer was right: validate §7a-11 requires every entity in search docs, and the UI derives its scope text from meta.counts. Buff/ammo rows resolving to wiki targets is consistent with the boss/enemy interim pattern.

## B40 — `wiki-article` provenance kind (required article revision): APPROVED
For data machine-extracted from rendered articles (Buff IDs table, infobox rows). Same reasoning as B8. SourceKind enum amended.

## B41 — Ammo schema deltas: APPROVED
`AmmoStats` as a named schema with optional `damage` (A1-consistent; no-damage ammo lists Unknown, never 0); `Weapon.ammoStats` added for dual-role items (Snowball). One item ID lives in exactly one collection — the weapon collection wins for dual-role items.

## B42 — Assigned to the NEXT UI slice (P3-S1 or a dedicated pass):
(a) B30 UI wiring: SpriteImg prefers `entry.thumbnail` with a `full` opt-out flag for detail/boss pages; update the reduced-motion test. (b) `resolveTarget` in src/search/links.ts tries `doc.wikiUrl` before the wiki search page (also retires the interim boss/enemy URL loaders). (c) The 3× featured-card upscale cap + 360px hero-button ellipsis nits.

## Standing honest gaps (no action; tracked)
77/79 ammo stages Unknown until P6-S0 base-material acquisition; 20 velocity multipliers Unknown (list-article items); debuff target effects Unknown; regen effects text-only pending a unit definition (schema owner decides at P3-S14). B13 meta.ts comment still pending.
