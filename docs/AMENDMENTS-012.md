# AMENDMENTS-012 — Rulings from the coverage expansion (B48 findings)

Status: BINDING · Orchestrator rulings.

## B56 — Wiki-stated thrust range SUPERSEDES the B46 formula
Where the article states "maximum range of approximately N tiles", use N as a quote-checked EXTRACTED value (normal provenance, NOT modeledFields — it is wiki data, not a convention). B46's formula applies ONLY where no range is stated (its original premise). The `thrust-range-stated` hard-limitation is lifted: the 9 plain spears (Adamantite Glaive, Cobalt Naginata, Mythril Halberd, Orichalcum Halberd, Palladium Pike, Titanium Trident, Spear, Trident, Swordfish) become simulable with their stated ranges → thrust 18/31. The formula-vs-stated table stays in the gap report as a calibration record.

## B57 — Ratifications
(a) damageMultiplierPct truncation (⌊⌋, wiki-confirmed via Sapphire). (b) Clockwork Assault Rifle 3-ammo-per-burst labeled approximation (game uses 1) — stands until ammo-economy modeling matters (P3-S4+). (c) MODELING_CONVENTIONS registry (dot-paths in modeledFields + registry mapping to ruling IDs) — no inline objects needed. (d) Spear one-hit-per-thrust stays a labeled assumption (in-game pierce unverified). (e) The two undocumented low-mana/cooldown interactions MUST be added to the approximations registry (honesty: every modeling choice is listed even when no current weapon exercises it).

## B58 — Spec parity debt
DATA_SCHEMA_SPEC §2.1/§2.4 lacks `modeledFields`, `damageMultiplierPct`, `reuseDelayTicks` — the amendments chain (B48/B49 + this file) is the binding record; a consolidation pass into the spec rides the next docs-touching slice.

## Lab-side follow-ups confirmed for the next src/lab pass
Remove the redundant cadence override; migrate B44's label to the engine registry; pass the buff list so Stylish Scissors / Brand of the Inferno / Frost Staff DoT simulate in the UI.

## B59 — B56 application ratified
The 9 reviewer-judgment overlay entries clearing article-screen flags (modifier advice, knockback "hold", Trident water-movement/light) are RATIFIED under the B45 evidentiary standard. The schema `always:false` change for the thrust convention is approved (merge stage + emitted-data test retain enforcement). The "approximately N tiles" measurement-semantics caveat is accepted as a labeled source citation (the stated value IS the wiki's claim; the Lab never promises engine parity).

## B60 — P3-S4/S5 Lab choices: RATIFIED
(a) Ranged/magic target distance 6 tiles (melee point-blank) — labeled Lab choice in panel + assumptions; the Quad-Barrel ~25% DPS consequence is the honest cost of "projectiles travel" and is disclosed. (b) Default ammo = class-defining basic tier (Wooden Arrow / Musket Ball). (c) Reset preserves loaded ammo; ammo switch restarts the session/stats. (d) Default Lab weapon rule = weakest by base damage (currently Wooden Bow). (e) Mana regeneration on/off setting (PRD P3-S5 AC2 "configurable regen behavior"). Follow-up for the sim owner queue: migrate the B44 swing-geometry label into the engine registry (third mention — bundle with the next src/sim touch).
