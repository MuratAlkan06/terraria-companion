# AMENDMENTS-008 — Sim-core rulings (engine findings)

Status: BINDING · 2026-10-13 · Orchestrator rulings.

## B35 — Low-mana casting default follows the PINNED GAME, not the older PRD text
The wiki documents that since 1.4.5.7 casting continues below mana cost at 40% attack speed. Data accuracy (REQUIREMENTS §13) outranks PRD P3-S5 AC2's "casting stops" wording, which predates this knowledge. Ruling: the sim's DEFAULT models the 1.4.5.8 behavior (`slow-cast` at 40%); "stop at zero" remains available as a labeled test setting; the labeled "ignore mana (test mode)" toggle is unchanged. PRD P3-S5 AC2 is amended accordingly; the Lab UI must label the 40% behavior with its wiki source.

## B36 — simRequiredWeaponFields gains `useAnimationTicks` (and `autoReuse` for melee archetypes)
Written pre-B14; without these the pipeline won't downgrade weapons whose attack cadence is unverified, leaving users a generic refusal instead of a proper limitation card. Apply in the next pipeline-touching slice (P3-S0), then re-run the build and report downgrade deltas.

## B37 — Archetype param semantics are BINDING for P3-S0 overlay authors
As documented in src/sim/README.md: `pierce` = extra dummies after the first; `projectilesPerUse` = per shot within an attack; ammo projectile speed derives only from ammo bonus/multiplier; magic-bolt speed from the archetype's ProjectileSpec, not weapon shootSpeed. P3-S0 tooling must link this section.

## B38 — Engine behavior changes require a deliberate golden-fingerprint update
The pinned determinism fingerprint (Node V8) is part of the engine's verification contract; any intentional behavior change updates it in the same commit with a changelog note in src/sim/README.md. Cross-JS-engine bit-identity is NOT promised (documented limitation).

## Accepted engine approximations (labeled in approximations.ts — ratified)
±15% damage variance (toggleable, wiki-verified), swing/thrust shapes, one-ammo-per-shot, mana-per-attack, homing turn model, DoT rules (no defense, no crit, refresh-not-stack), dummy hitbox = placed size. All surface in the Lab's AssumptionsTips per UX §8.
