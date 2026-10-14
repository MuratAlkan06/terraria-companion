# HANDOFF — Session pause point (2026-10-14)

Resume protocol: read this file + TASK_CONTRACT.md + PRD.md §7 + the AMENDMENTS chain (001–015, binding, later wins). Workflow: every slice = implementation-engineer → design-reviewer (UI) → verification-lead → github-workflow gate → commit. No AI-attribution trailers ever (owner ruling 2026-10-09).

## State at pause
- Branch `feat/p1-app-shell`, local-only (NO remote — user has not authorized one; ask before creating). Tag v0.2.0 = Phase 2 complete. ~57 commits, tree clean except possibly the two in-flight slices below.
- Overall ~60% done. Complete: P0, P1, P2 (all data + database UI + search + homepage), P3 S0–S10 (Lab: 134 simulable, 4 classes), P5 S1–S3 (map + all 18 boss pages), P6-S8 (guides v1), P7-S1 (favorites).

## In flight at pause (commit them on resume if not already committed)
1. **P5-S4 defeat tracking + unlock cascade** (bosses/map surface + shared src/app/progression module per SCORING_SPEC §2.4). NEEDS DESIGN REVIEW (signature moment — UX §12 cascade) before its verification is final.
2. **P3-S11 explosives + Debuff Dummy** (sim/lab + pipeline damage-verification for the 15 explosives). NEEDS DESIGN REVIEW (blast rendering, debuff panel).
If their work sits uncommitted: audit-first completion agents (the P3-S1/P2-S8 recovery pattern worked well), then review → verify → gate.

## Next queue (in order)
1. Design reviews + verification + commit for the two in-flight slices.
2. **P5-S5 "What Should I Do Next?"** recommender (consumes the shared progression module; homepage button gains `features: ['recommend']`).
3. **P5-S6/S7 Feature A (Boss Readiness Checker)** — SCORING_SPEC.md is the binding design; B69/Q9: improvements gate on tracked defeats only.
4. **P3-S8 homing toggle** (needs a homing-flagged simulable weapon — check coverage first), **P3-S12 dummy roster v2** (boss-sized/moving/armored — armored uses the sim defense math), **P3-S13 coverage gate** (targets: 100% resolved, ≥60% simulable overall, ≥80% per floor archetype — currently ~28% simulable overall; the gate review may need a target re-ruling vs A3's original numbers — flag to orchestrator).
5. **B70 P4-prep pipeline slice** (AMENDMENTS-014): potion corpus, B52 classes[], basic-ammo gating (B68), B78 base-material/shop/chest gating, B54 StatKind rows. HARD GATE before P4-S2.
6. **P4-S1→S4** (comparison, builder, scoring) per SCORING_SPEC.
7. **P6-S0 item corpus** (+ B20 fishing, vanity items) → P6-S1/S2 (armor/accessory views; B55 sprite download rides here) → P6-S3 encyclopedia → P6-S4 crafting trees → **P6-S5/S6 Feature B** → P6-S7 weapon detail v2 → P6-S9 guides v2.
8. **P7**: S2 export/import, S3 profiles, S4 quick compare, S5 challenge generator, S6 hardening audit, S7 honest final report + release-gate-overseer GO.

## Standing debts (all tracked in AMENDMENTS files; key ones)
- B82/B84 UI follow-ups: 375 drop-table layout (long ranges wrap), drop-row source icon wrap, "empress" search ranking inversion.
- Pipeline next-touch queue: Skeletron Hellforge caption; no-stated-quantity ruling proposal (coins stay Unknown); "drops together" linkage field; Duke/Cultist/Prime stats parse-reasons surfacing; stale comments (labParams:102, labDowngrade:38); gap-report wording (B77).
- Lab next-touch: duplicate lab-settings-title id; B44 label migration to engine registry; Xeno-named crit test + AC5 tie-break fragility.
- B66 schema candidates (yoyo spin, max-out counts, whip tag-duration, explosive ammo linkage, drops-together) — evaluate at consuming slices.
- CI + GitHub remote: BLOCKED on user authorization. On creation: push main+tag, backfill §11 checklist (branch protection, release, CI workflow with budgets) before further PRs.
- Deploy prereqs before public: takedown contact (src/app/site.ts), OFL font credits on licensing page, LICENSE files (MIT code + CC BY-NC-SA data per ADR D3).

## Facts that save time
- Pipeline rebuilds are offline/deterministic (`npm run pipeline:build` ×2 byte-identical is the standard proof). Full suite ~1,515+ tests. Budgets: entry ≤200KB gz (currently ~96–167 depending on chunk splits), Lab ≤500 (≈275), data files ≤300 each.
- The MCP browser throttles to ~1fps sometimes; reviewers fall back to scripted headless Chromium via Bash — established pattern.
- Concurrent agents: name exact file ownership (B80 lesson); pipeline rebuilds cannot run concurrently (shared src/data).
- Subagents keep running read-only git despite briefs (B65) — harmless, keep forbidding.
