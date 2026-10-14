# AMENDMENTS-013 — Remaining-family rulings (P3-S0 extension findings)

Status: BINDING · Orchestrator rulings.

## B61 — Pending-interpreter emission design: APPROVED
Params for families without a sim interpreter are recorded in decisions/report and emitted as family-specific limitations; registering an interpreter + `pipeline:build` flips them to archetypes automatically (unit-tested). Clean and honest.

## B62 — Ratifications (B45/B59 standard)
The 125 reviewed overlay entries; "functions like Bomb/Dynamite" value inheritance (9 entries — the wiki's own equivalence statement is the evidence); boomerangs/launched flails default fire-and-forget; family definitions (piercing-beam = 3 data-signal members; Charged Blaster Cannon + Laser Machinegun stay magic-bolt; launchers counted in explosive-aoe).

## B63 — Convention rulings (P-1…P-6)
- **P-1 APPROVED:** whip arc = 180° forward (same "swung overhead" basis as B44), modeledFields + labeled. Completes 6.
- **P-2 APPROVED:** summon attack rate from a stated average/random cooldown; rounding rule = round-half-to-even to ticks, documented. Completes 4.
- **P-3 APPROVED:** contact-minion rate from stated immunity frames as a labeled UPPER BOUND ("maximum rate; actual depends on minion AI pathing") — AssumptionsTip must carry that caveat. Completes 7.
- **P-4 REJECTED for now:** Manhattan-distance sentry range completes nothing alone; stays incomplete rather than ruling a conversion that benefits zero weapons.
- **P-5 APPROVED:** square blast area → inscribed-circle radius (half the side; conservative, never overstates coverage), modeledFields + labeled. Completes 5.
- **P-6 APPROVED:** the four AI-class definitions as the binding taxonomy (P3-S9 needs them).
Application rides the next pipeline pass (or P3-S6+ slices). Expected: +22 param-complete weapons.

## B64 — Sim obligations recorded (block P3-S9/S10 if unaddressed)
The guard's required fields include critPct, which is NOT APPLICABLE for all 64 summon weapons (B17) — the guard must treat summon-class crit as not-required or every summon weapon gets refused. The 10 param-complete explosives stay downgraded until their damage/crit/knockback verify — honest, not a defect.

## B65 — Process note
Read-only git by subagents keeps happening despite briefs; harmless but noted. Future briefs continue to forbid it; no retroactive action.

## B66 — Schema gap candidates recorded (no action yet)
Max-boomerangs-out, yoyo spin duration, explosive ammo linkage, whip swings-per-use — evaluate when their consuming slices (P3-S7/S11) land.

## B67 — Default limitation-card copy debt (verification finding)
`LAB_DEFAULT_REASON` (pipeline/merge/weapons.ts:96) says "Not simulated yet: … parameters have not been assigned" on 103 no-family weapons, and a dormant template at labParams.ts:875 would reintroduce "yet". Both get the no-forward-promise copy treatment in the NEXT pipeline slice (the B63 conventions-application pass). All 289 family/overlay/specific reasons are already clean. Also open: live confirmation of the Whips-table range values when a fetch budget allows.
