# Task Contract — Terraria Companion Website
Status: v1 (2026-10-12) — ACTIVE. Owner: Lead Orchestrator. Requirements: docs/REQUIREMENTS.md (source of truth).

## Objective
Build a real, working, data-driven Terraria companion website (vanilla, latest stable version — verify user-stated 1.4.5.8 against terraria.wiki.gg) with: homepage, complete weapon/armor/accessory/item databases, interactive canvas Weapon Lab, Loadout Builder + comparison, interactive boss progression map with persisted tracking, item encyclopedia + crafting trees, beginner guides, Boss Readiness Checker, and Item Acquisition Planner.

## Non-Goals
- No modded content; no platform-variant mixing without labeling.
- No weapon tournament feature; no all-in-one playthrough tracker (explicitly excluded by user).
- No invented stats/recipes/drops — unverified = marked unknown.
- No backend/accounts in v1: persistence is local (localStorage/IndexedDB per ADR).
- No broken decorative extras; core features before extras.

## Hard Constraints
- Data provenance: terraria.wiki.gg (verify license + API; document pipeline). No secrets client-side.
- Simulation honesty: Weapon Lab labeled as approximation, never claimed to match in-game DPS.
- Progression honesty: recommendations never hide boss-gating.
- Responsive; empty/loading/error states handled; performance-safe for large datasets.
- Git/GitHub: NO AI-attribution trailers in commits/PRs/tags/releases (owner ruling 2026-10-09).

## Phase Plan (user-mandated order; each phase = narrow slices w/ acceptance criteria)
- P0 Planning: PRD, ADR (stack/pipeline/licensing/rendering/persistence), data schemas, UX flows. FREEZE before implementation.
- P1 Scaffold: project setup, design system, navigation shell, homepage.
- P2 Data: wiki pipeline + structured datasets, item database UI, global search.
- P3 Weapon Lab: arena, dummies, weapon behaviors, live stats/DPS graph.
- P4 Loadout Builder + Weapon Comparison.
- P5 Boss progression map + tracking + "What Should I Do Next?" + Boss Readiness Checker (Feature A).
- P6 Encyclopedia + crafting trees + Acquisition Planner (Feature B) + armor/accessory DB views + guides.
- P7 Extras (only working ones), polish, full verification, release gate.

## Definition of Done (per slice)
Implementation evidence + independent verification (verification-lead) + design review for UI slices (design-reviewer APPROVE) + doc parity + release-gate-overseer GO at phase boundaries. Final: run instructions, working-feature list, honest gap report.

## Risks
R1 Data completeness/licensing (CC BY-NC-SA) → pipeline-first, provenance docs, gap reporting. R2 Weapon Lab scope explosion → behavior archetype system, per-weapon params, labeled approximations. R3 Progression-logic correctness → encode dependencies as data, test against wiki. R4 Project size → strict slices, foundation-first fallback per §14.
