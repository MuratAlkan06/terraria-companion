# AMENDMENTS-004 — Rulings from the weapons dataset (P2-S2 findings)

Status: BINDING · 2026-10-13 · Orchestrator rulings. Applies on top of DATA_SCHEMA_SPEC.md + AMENDMENTS-001/-002/-003.

## B14 — Use time semantics (TO-VERIFY #10 resolved): APPROVED
Wiki "Use time" = Iteminfo `useAnimation` (488/488 agreement). Both fields are emitted; `useAnimationTicks` is in the weapons list file; **the UI displays `useAnimationTicks` labeled "Use time"**. `useTimeTicks` remains the raw Iteminfo value for sim use (true per-hit cadence for multi-hit weapons). DATA_SCHEMA_SPEC §2.4 comment superseded.

## B15 — weapons.detail.json is an ARRAY: APPROVED (extends B11 to all emitted collections; §5 map language fully superseded).

## B16 — Sprite manifest extra fields (ref, sha1, bytes, width, height, rights note): APPROVED.

## B17 — Crit semantics: APPROVED
Summon weapons: crit not-applicable (per wiki Critical hit page). Classless weapons: damageClass "other", crit Unknown. The sim's universal base-4% convention stands (crit shown = 4% + weapon bonus).

## B18 — Fixture debt: the P2-S1 sample fixture stores wiki use time in `useTimeTicks` (Clockwork Assault Rifle), conflicting with B14. MUST be corrected in the next slice touching fixtures. Tracked here.

## B19 — Wiki self-conflicts are withheld: Pretty Mirror vendor (wiki tag says Clothier; 1.4.5.7 notes say Stylist) becomes Unknown acquisition + gap entry in the next pipeline run — consistent with the existing withheld set (Chik, Flower of Fire, Inferno Fork, Starlight). Never pick a side on conflicting sources.

## B20 — Fishing acquisition: known model gap
The `fishing` Acquisition arm exists in the schema but no structured wiki source is wired yet (affects Toxikarp + ~24 others, honestly Unknown). A fishing-extraction pass is REQUIRED before P6-S0 completes (encyclopedia needs fishing items); tracked as a named P6-S0 obligation.

## B21 — Staff of Regrowth stays excluded (wiki types it a tool); listed in the reconciliation report for review. Weapons set = wiki weapon-typed items only.
