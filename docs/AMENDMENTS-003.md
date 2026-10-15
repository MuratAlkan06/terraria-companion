# AMENDMENTS-003 — Rulings from the first real wiki sync (P2-S2a findings)

Status: BINDING · 2026-10-13 · Orchestrator rulings on items raised by the P2-S2a engineer. Applies on top of DATA_SCHEMA_SPEC.md + AMENDMENTS-001/-002.

## B8 — `wiki-module` provenance kind: APPROVED (already implemented)
Data extracted from wiki Lua modules other than Iteminfo (e.g., recipe-group definitions) uses `SourceKind "wiki-module"` with a REQUIRED `rev`. Labeling it "curated" would misstate provenance. DATA_SCHEMA_SPEC §2.1 SourceKind enum is amended accordingly.

## B9 — `Recipe.conditions` field: APPROVED
Add `conditions: z.array(ConditionSlug)` (default empty) to Recipe for availability requirements ("after Moon Lord", moon phases, Torch God's Favor, etc.). The 17 recipes currently storing these as environment-type stations MUST be migrated to `conditions` in the next pipeline slice that touches recipes (P2-S2 or P2-S6); environment stations remain only for genuine crafting environments (water, Demon Altar, Ecto Mist).

## B10 — NPC variant IDs: APPROVED
`npcIds` entries become `z.int()` with a nonzero refinement (Terraria uses negative IDs for enemy variants). Multi-part boss attribution and non-NPC sources (e.g., Shadow Orb) stay Unknown + gap entries — never guessed.

## B11 — Emitted collection format: arrays are binding
Groups and conditions (and any collection the validator consumes) are emitted as ARRAYS of records, not slug-keyed maps. DATA_SCHEMA_SPEC §3/§5 "map by slug" language is superseded; lookups are built at runtime per §3's index contract.

## B12 — P2-S6 obligations recorded
The boss/progression slice MUST provide: boss registry resolving the 568 pending `bossId` drops; progression nodes `wall-of-flesh`, `plantera`, `golem`, `moon-lord`; and the `all-mechanical-bosses` milestone node backing the post-mech condition. The partial-dataset warnings in validate convert to hard checks at that point.

## B13 — Pipeline contact pointer
`TC_PIPELINE_CONTACT` env var feeds the User-Agent contact field; set it when a public repo URL exists. Until then the UA carries the project name only. The stale stub comment in `src/data/meta.ts` is cleaned up in the next slice touching that file.

## Accepted interpretation calls (for the record)
"A / B (Hardmode)" rates split into two condition-scoped records; wiki name-lookup choice for 4 duplicate names (listed in gap report); only wiki-documented station alternatives modeled.
