# AMENDMENTS-010 — Lab coverage conventions (P3-S0 findings)

Status: BINDING · 2026-10-13 · Orchestrator rulings.

## B44 — Broadsword geometry convention: RATIFIED
Arc 180° (wiki: "swung over the player's head"), reach = sprite diagonal × Iteminfo scale ÷ 16. A labeled MODELING CHOICE in provenance + the Lab's AssumptionsTips — never presented as game data. 35 broadswords simulable under it.

## B45 — "Clean article screen" evidentiary standard: RATIFIED
For single-projectile defaults: absence of any contrary statement in the article lead/notes/tooltip/infobox, PLUS a human read of the article, confirms single-shot/no-spread. Documented in labParams.ts.

## B46 — Thrust reach convention: APPROVED (unlocks shortswords/spears)
Same family of modeling choice as B44: thrust reach = sprite diagonal × scale ÷ 16 + 1 tile arm extension, labeled as a modeling choice. Apply in the coverage-expansion slice (B48); spears and shortswords move from limitation to simulable where their other params pass the screen.

## B47 — "Slight spread" convention: APPROVED
Guns whose article says "slight spread" without an angle (Minishark, Megashark, S.D.M.G., etc.) use a documented 10° spread approximation, labeled in AssumptionsTips. Guns with an unstated NON-slight spread (Shotgun's "4–5 bullets") stay limitations — random count is a different problem.

## B48 — Coverage-expansion slice (scheduled BEFORE the P3-S13 gate; targets re-affirmed there, not at P3-S0)
One dedicated slice bundles: (a) `reuseDelay` into the sim attack rate (B38 fingerprint update; unlocks 3 weapons + fixes a 2× overstatement class); (b) `ProjectileSpec.damageMultiplierPct` schema extension for per-projectile multipliers (gem staffs) with wiki-sourced values; (c) DoT derivation from infobox debuff/chance/duration rows; (d) B46 + B47 application; (e) sim README cleanup (open-question #1 resolved by B36; record the reuseDelay finding; fix the stale fixtures.ts comment). P3-S1 (arena) proceeds NOW on the existing 71 — swing-melee's 35 broadswords satisfy P3-S1's ACs.

## Recorded for the schema owner
Sprite dimensions ride under `cargo:Imageinfo` provenance though they come from the imageinfo API — acceptable; rename to `wiki-imageinfo` only if a future audit demands it.

## B49 — B44 label location ruled (2026-10-13, post-verification)
A record-level marker is REQUIRED: archetype params derived from modeling conventions (B44/B46/B47) must list those param paths in a `_prov.modeledFields` array (sibling of editorialFields) so any consumer can distinguish modeled geometry from extracted game data. Until applied (rides B48), the sim's approximations registry + AssumptionsTips remain the sole user-facing label — acceptable because the Lab is currently the only params consumer. Verification check 7 is thereby resolved as deferred-by-ruling, not failed.
