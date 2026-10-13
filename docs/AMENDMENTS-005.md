# AMENDMENTS-005 — Stage-unlock semantics ruling (P2-S3 finding)

Status: BINDING · 2026-10-13 · Orchestrator ruling. Applies on top of prior docs/amendments.

## B22 — gatedBy.stage must be the stage where the item becomes OBTAINABLE, not the gate's own stage
Finding: Breaker Blade (a Wall of Flesh drop) derives stage "Late Pre-Hardmode" because the derivation takes the WoF node's stage. Wrong for display and recommendations: defeating WoF transitions the world to Hardmode, so WoF-gated items are Early Hardmode content.

Ruling: `ProgressionNode` gains optional `unlocksStage: Stage` (set on stage-transition gates; initially only `wall-of-flesh` → `early-hm`; mech-boss and Plantera/Golem milestones set it if the stage model needs it). The §7b derivation becomes `stage = max(over gates: node.unlocksStage ?? node.stage)`. Items dropped BY a stage-transition boss use its `unlocksStage`.

Apply in the next pipeline slice that touches gating (P2-S6 follow-up or P2-S7). Until applied, affected weapons display the honest-but-mislabeled stage; the fix must come before any stage-based recommendation feature ships (P4+ hard dependency).

## Noted (no ruling needed)
- `item-universe.json` as the interim ingredient-name source for the UI is acceptable until P6-S0's full item corpus replaces it.
- Per-weapon acquisition data chunking: deferred; ADR D7 revisit triggers govern (current worst case ~280 KB gz across chunks on one detail view — within budgets).
