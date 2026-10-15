# AMENDMENTS-002 — Schema deltas from real-data contact (P2-S1 findings)

Status: BINDING · 2026-10-12 · Orchestrator rulings on schema gaps discovered by the P2-S1 engineer while entering verified wiki data. Applies on top of DATA_SCHEMA_SPEC.md + AMENDMENTS-001.md. **Apply these in slice P2-S2a** (schemas + validate updated in the same slice as the datasets that need them).

## B1 — Per-difficulty drop quantity
Real case: Creeper → Tissue Sample drops 2–5 (classic) / 1–3 (expert) / 1–2 (master). Change `DropSource.quantity` to:
`z.union([ Qty, z.strictObject({ classic: Qty.optional(), expert: Qty.optional(), master: Qty.optional() }) ])` where `Qty = {min, max}`. Single-Qty form remains valid for uniform drops.

## B2 — Ammo velocity multiplier
Real case: Musket Ball has a 2× velocity multiplier, not a flat bonus. Add `velocityMultiplier: z.number().positive().optional()` to `Item.ammoStats` (alongside the existing `velocityBonusTps`).

## B3 — Station alternatives ("Iron or Lead Anvil")
`RecipeStation` item arm becomes: `{ kind: "item", itemId }` OR new arm `{ kind: "group", groupId: Slug }` referencing a RecipeGroup (reuses the existing group mechanism; "Pre-Hardmode Anvils" becomes a RecipeGroup). Validate: station groups resolve like ingredient groups.

## B4 — Conditions on loot/other acquisition routes
Add `conditions: z.array(ConditionSlug)` to the `loot` and `other` Acquisition arms (default empty), so chest/ore gating is derivable by §7b.

## B5 — Debuff duration ranges
Real case: Wand of Sparking inflicts On Fire! for 1–4 s. `LabModifiers.dot.durationTicks` and `Item.buffGrants[].durationTicks` become `z.union([z.int().positive(), z.strictObject({ minTicks: z.int().positive(), maxTicks: z.int().positive() })])`.

## B6 — Derived-consistency error code
Add `E_DERIVED_MISMATCH{ref, field}` to the pipeline error taxonomy for derived-field disagreements (dropIds, set back-refs, tinkering symmetry, isStation, Boss↔Node, EoW/BoC pairing) — currently mapped onto E_DANGLING_REF, which conflates two failure kinds.

## B7 — maxStack on equipment
Cargo `stack` reports 9999 for weapons/armor; pipeline must omit `maxStack` for non-stackable equipment rather than emitting the bogus value (already the fixture behavior; now binding).
