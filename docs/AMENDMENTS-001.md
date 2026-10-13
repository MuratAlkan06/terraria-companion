# AMENDMENTS-001 — Binding P0 Errata (freeze delta)

Status: BINDING · 2026-10-12 · Result of risk-qa-architect P0 critique (verdict: REVISE, scoped). All 17 findings accepted by orchestrator. Where this document conflicts with PRD.md, ADR-001.md, UX_SPEC.md, or DATA_SCHEMA_SPEC.md, **this document wins**. P0 is FROZEN as of this document. Every implementation brief must cite this file alongside the base docs.

## A1 (BLOCKER fix) — Schema nullability rework: extracted stats are optional
The verified-or-Unknown policy must be emittable. Changes to DATA_SCHEMA_SPEC:
- **Optional now (with absent+`unverifiedFields` = Unknown):** `Weapon.damage`, `critPct`, `useTimeTicks`, `knockback`, `damageClass`; `ArmorPiece.defense`; `Boss.attackPatternTags` (min(1) dropped), `Boss.summon.text/sourceUrl`, `Boss.location.biomes` (min(1) dropped), `Boss.statsByDifficulty` unchanged (already optional).
- **Still required:** `id`, `name`, `slug`, `type`, `wikiUrl`, `labBehavior`, `_prov` (+ `Boss.id/name/nodeId/stage`).
- Weapons with unknown `damageClass` appear under an "unclassified" filter bucket and are EXCLUDED from class-based recommendations (same safe direction as stage rule A3 in schema §9).
- **Rule 10 demoted:** `Weapon.ammoClass` with no matching ammo item = WARNING + auto-downgrade that weapon's `labBehavior` to `limitation` (reason: "compatible ammo data unverified") — never build-fatal.
- **Boss curated-field staging:** curated minimums (attackPatternTags ≥1, prepChecklist, suggestedEquipment, strategies) are NOT enforced at P2-S6; they are enforced by a P5 gate check (`E_BOSS_CURATION{bossId,field}`) run before P5-S2/S3 ship. P2-S6 emits bosses with those fields absent+unverified.
- Cross-check "strip value, never fatal" is now consistent: stripping an optional field cannot fail strict validation.

## A2 (BLOCKER fix) — Dataset-production slices added to PRD §7/§8
- **P2-S2a "Recipes + Drops + Conditions + Enemies datasets"** — PREREQUISITE of P2-S2 emit (weapons' `acquisition.recipeIds/dropIds` and condition slugs must resolve). ACs mirror P2-S2: row-count reconciliation vs Cargo (Recipes 4,266 / Drops 3,253), 10-recipe + 10-drop spot-checks vs wiki, gap report, zero invented values.
- **P2-S7 "Ammo + Buffs datasets"** — before P3-S4. ACs: all ammo items with `ammoStats`, verified damage or Unknown; Lab-referenced buffs structured.
- **P2-S8 "Armor + Accessories + Sets datasets"** — before P3-S14 and P4-S2. ACs: set-variant bijection validates; tinkering derivation symmetric; spot-checks.
- **P6-S0 "Full item corpus dataset"** — before P6-S1…S6. ACs: count reconciliation vs Items table, category coverage report.
- PRD §8 dependency table is amended accordingly (these slices are the named producers).

## A3 (HIGH fix) — Overlay authoring owned; derivation-first; coverage targets; Q3 resolved
- **P3-S0 "Archetype params: derivation + overlay tooling"** (new, before P3-S1): auto-derive projectile velocity/count/rate/reach candidates from Iteminfo `shoot`/`shootSpeed`/`useTime`/class data wherever possible; hand-author only residuals; every overlay entry carries sourceUrl; tooling emits a per-archetype coverage report.
- **Coverage targets (bind P3-S13 gate):** 100% of weapons resolved (simulated / custom-scenario / limitation; unhandled = 0 — unchanged); ≥60% of ALL weapons simulated via archetypes at MVP; ≥80% of weapons within each floor archetype (swing-melee, bow-gun, magic-bolt) simulated. Remainder = honest limitation cards, counted in gaps.json.
- **P5-S0 "Boss overlays: pre-HM"** and **P5-S0b "Boss overlays: HM"** (align to P5-S2/S3): summon text, attack tags, prep, per-class suggested equipment (must pass `E_SUGGESTION_GATING`), strategies.
- **PRD Q3 RESOLVED:** events/milestones are milestone markers only in v1 — map nodes without full pages. P5-S3 scope reduced accordingly.

## A4 (HIGH fix) — Accessory slot model = f(difficulty, progression)
Real rule (verified vs wiki): Classic 5 always; Expert 5 → 6 after Demon Heart (WoF Expert+ treasure bag, works in Expert/Master only); Master 6 → 7 after Demon Heart. Recommendation/UI logic uses this function; pre-WoF the extra slot renders as a visible GateBadge'd locked slot ("After you defeat Wall of Flesh — Demon Heart"). Schema `LoadoutSlots.accessories` min(5).max(7) stands; the schema comment "5 classic / 6 expert / 7 master" is void. PRD P4-S2 AC2 and P5-S7 AC3 now read "all accessory slots for the chosen difficulty AND progression state".

## A5 (HIGH fix) — Enemy entity added (option a, minimal)
New entity + route + search type:
```ts
export const Enemy = z.strictObject({
  id: Slug, npcIds: z.array(z.int().positive()).optional(),
  name: z.string().min(1), sprite: z.string().optional(),
  biomes: z.array(z.string()).optional(),   // unverified if unstructured on wiki
  stage: Stage.optional(),
  dropIds: z.array(z.string()),             // DERIVED from DropSource
  wikiUrl: WikiUrl, _prov: Prov,
});
```
- Emitted `enemies.json` (produced in P2-S2a from NPCs + Drops Cargo tables); route `/enemies/:id` (chunk-db); SearchDoc type enum += `"enemy"`; TypedRef += `enemy:<slug>`.
- Feature B plan steps link enemies to these pages; `groupKey` uses enemy biomes when verified, else drop conditions. Satisfies Feature B AC1 without scope amendment to REQUIREMENTS.

## A6 — `ReadinessV1` gains `stage: Stage` (deterministic restore; no read from mutable settings).

## A7 — New storage domain `tc.v1.checklists`
`ChecklistsV1 = envelope(z.strictObject({ byKey: z.record(z.string(), z.array(z.string())) }))` — key = checklist id (`boss:<slug>:prep`, `guide:<slug>`), value = checked entry ids. DomainKey enum += `"checklists"`. Backs boss PrepChecklist (P5-S2) and guide checklists (P6-S8/S9).

## A8 — P1 coherence fixes
- P1 ships a hand-authored **stub `src/data/meta.json`** (gameVersion 1.4.5.8, generatedAt, `stub: true`) — replaced by pipeline output in P2; footer reads it from day one.
- Footer links are data-driven like the nav (Lab Coverage link appears at P3-S13; Favorites at P7-S1).
- **OmniSearch ships in P2-S4** — not mounted before (no dead search box). P1 header has logo/nav/stage chip only.
- P1-S1 gains AC5: `/about/licensing` page exists with CC BY-NC-SA 4.0 attribution + Re-Logic notice, linked from footer.

## A9 — SCORING_SPEC.md is a named prerequisite artifact of P4-S2 and P5-S6 (loadout recommendation logic, goal scoring math, readiness factor analysis). Authored and reviewed before those slices start; schemas' "Out of scope" pointer now resolves to it.

## A10 — Pipeline estimate + sprite storage decision
- Request estimate corrected: ~100–150 API requests per full sync (Imageinfo alone ≈ 23 pages @500 rows); sprite downloads ≈ 6.4k files ≈ 2h at 1 req/s — **full sprite sync runs locally with a persistent cache; never in CI**.
- **Sprites are NOT committed to the git repo** (`public/sprites/` gitignored except `manifest.json`): avoids permanent git-history redistribution of Re-Logic IP. Deploy artifact includes sprites from the local/CI-cached pipeline output. ADR D3/D7 amended; takedown lever unchanged.

## A11 — Parity pass
- PRD P3 table header reads: "9 archetypes + cross-cutting modifier layer (homing, bounce, chain, DoT, multi-hit)" (orchestrator ruling already recorded in DATA_SCHEMA_SPEC header).
- ADR D6 key list += `tc.v1.readiness`, `tc.v1.checklists`; reserved future scheme `tc.v1.<profile>.*` for P7-S3 profiles (v1 keys = profile "default").
- PRD Open Question 1 CLOSED: 1.4.5.8 verified in ADR-001 (same day). PRD §11 assumption superseded.

## A12 — Asset ownership attached to slices
- P1-S1/S2: hero background, 404 art, empty-state vignettes, pixel loading screen.
- P2-S2: placeholder sprite set (fallback mode).
- P3-S1: arena tileset, dummy sprites, projectile placeholders.
Produced in-slice as original pixel art or sourced from named permissively-licensed packs (CC0/OFL) — source recorded in the slice's verification evidence. "Quality pixel art is a craft risk" acknowledged: design-reviewer gates these slices.

## A13 — MVP floor restated: Lab floor archetypes = swing-melee (P3-S1), bow-gun (P3-S4), magic-bolt (P3-S5). Thrust joins at P3-S7 and is NOT floor. (PRD §4 table amended.)

## A14 — (merged into A11 ADR D6 note.)

## A15 — Plain-text rule (binding): the pipeline strips ALL markup from wiki-derived strings (`behaviorText`, `strategies[].text`, `setBonusText`, summon text, etc.); the UI renders wiki-derived strings as plain text only. No HTML/markup injection path exists.

## A16 — Verification mechanisms named
- EstimateLabel↔AssumptionsTip pairing: ESLint rule + component unit test.
- No-outcome-copy + disclaimer presence: grep-based copy-audit script in CI + design-reviewer screenshot pass per UI slice.
- 60fps Lab target: manual check recorded in verification matrix; CI proxy = headless sim tick ≤4 ms test.

## A17 — UX micro-fixes
- Homepage FeaturedBossCard renders only when the boss dataset is present (conditional, like nav).
- Rarity tokens extended: `--rarity--1` (gray) through `--rarity-11`, plus `--rarity-rainbow`, `--rarity-fiery-red`, `--rarity-amber` (matches schema Rarity union).
