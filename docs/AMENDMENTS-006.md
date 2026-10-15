# AMENDMENTS-006 — Rulings from the boss dataset (P2-S6 findings)

Status: BINDING · 2026-10-13 · Orchestrator rulings. Applies on top of prior docs/amendments.

## B23 — Strict §7b gating: APPROVED (confirming the P2-S6 fix)
gatedBy is exact only when EVERY route is derivable or the best route has no gate. The previous least-derivable-route behavior produced false facts (Mud Ball "gated by Moon Lord"; Slime Staff "gated by King Slime") and is retroactively declared a defect in P2-S2 behavior. The 4 removed derivations are correct removals. Two-pass cycle resolution accepted.

## B24 — `hardmode` condition maps to the Hardmode MILESTONE node: APPROVED
Matches the post-mechanical-bosses pattern. BINDING CONSEQUENCE for P5: `isObtainableNow` must treat a milestone node as reached once all its required-gate predecessors are defeated. Note: B22 (unlocksStage) remains OPEN — boss-DROP-gated items (e.g. Breaker Blade from WoF) still display the gate node's own stage; apply B22 in the next pipeline slice that touches gating (hard dependency before P4+ stage-based recommendations).

## B25 — Schema/spec deviations: APPROVED
(a) `Boss.location.time` optional (WoF/Plantera/Cultist/Moon Lord state no time). (b) Dataset-manifest `fixtures` field scoping which fixture checks apply per dataset. (c) `pre-hardmode` root milestone node anchoring optional early-boss edges.

## B26 — Event-boss drops (132: Pumpking, Betsy, Pillars, etc.): APPROVED per A3
Events are milestone markers, not Boss records; these drops carry no bossId and Unknown gating. REVISIT at P5/P6: event-source gating (e.g. "requires Hardmode + Solar Eclipse") should become derivable via event conditions — tracked as a P6-S0-adjacent obligation alongside B20 fishing.

## B27 — Accepted disclosures
First-form boss stats only (per-phase stats are a P5 decision); Guide:Game progression-cited edges flagged as the wiki marks it possibly outdated; single-world progression assumption; Goblin Army has no edges (trigger isn't a node); Solar Eclipse "one-of-three mechs" inexpressible as edges — documented in overlay notes. B13 meta.ts comment still pending (next touch of that file).
