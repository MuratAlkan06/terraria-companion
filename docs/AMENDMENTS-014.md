# AMENDMENTS-014 — SCORING_SPEC rulings (§10 open questions)

Status: BINDING · Orchestrator rulings. SCORING_SPEC.md (committed alongside) is ACCEPTED as the A9 prerequisite artifact with these rulings resolving its §10.

## B68 — Q1: NO "availability unverified" shelf in v1
Counts-only disclosure stands. The ammo-slot emptiness is real and honest; mitigation is DATA, not UI: the P4-prep pipeline slice must attempt gating derivation for vendor-purchasable and hand-craftable basic ammo (purchase/craft routes already carry conditions) — honest derivation only, never assumed. Revisit the shelf when gating-underived (1,097) shrinks materially.

## B69 — Q2/Q3/Q4/Q6/Q7/Q8/Q9: RATIFIED as proposed
Owned upgrades unknown→eligible, never gated→eligible (Q2). Demon Heart assumption chip, toggle deferred (Q3). Non-node conditions render as requirement chips, never block "yes" (Q4). VirtualDefeats definition + worldEvil-null conservatism; P5-S5 shares effectiveProgress (Q6). Sim figures linked as evidence only, never summed (Q7). jump-boost excluded until units verify (Q8). Builder = tracked ∪ virtual; Feature A improvements = tracked only (Q9 — the divergence is intentional and documented).

## B70 — Q5: potion/healing corpus scheduled
The P4-prep pipeline slice bundles: potion corpus emission (Lab/loadout-relevant set per A4), **B52 classes[] landing** (overdue — hard P4-S2 dependency), basic-ammo gating derivation (B68), and the B54 StatKind rows it needs. P4-S2 implementation does NOT start until that slice verifies.

## B71 — Implementation obligations carried from the spec
rarityRank special-tier order = pinned constant; PLAYER_DEFENSE_FACTOR verified against the wiki Defense page at implementation (TO-VERIFY); scoring constants under SCORING_CONSTANTS_VERSION with B38 golden discipline; src/scoring boundary purity test.

## B72 — B63/B67 application ratifications
(a) Default-card copy stays the design-reviewed string ("This weapon's unique behavior isn't modeled in the Lab.") — string parity with UI tests wins; the slight overstatement for plain no-family weapons (Phaseblades) is accepted copy debt. (b) The `<path>#<convention-id>` qualifier for params shared by two conventions is APPROVED and recorded as the binding format (spec-parity note alongside B58). (c) Raven Staff stays incomplete — its article contradicts the P-3 input; exemplary no-guessing. (d) `Evidence.sentence` (footnote-marker-tolerant verbatim check for article-extracted sentences) APPROVED alongside the strict quote check. Follow-ups assigned: sim README conventions table (next src/sim touch); dead old-string mapping removal in src/lab/labWeapons.ts:144 (P3-S6/S7 slice); Pygmy Staff "every 0.5 seconds" pattern widening (next pipeline touch).

## B73 — Boomerang return-pass ruling (P3-S7 finding)
The wiki states most boomerangs "instantly turn around after hitting enemies" — game accuracy beats the PRD's older "damage on both passes" wording (B35 precedent). RATIFIED: turn-on-strike ships; the return pass CAN hit (mechanics present) but never does against a stationary dummy on the retraced path — the observable both-pass case arrives with moving targets (P3-S12), which formally completes PRD P3-S7 AC2. Also ratified: yoyo 10-tick re-hit (wiki figure), Space-targets-dummy-1 keyboard alternative, beam verified via fixture only (no dataset channel-beam weapon exists — honest), the 29 returning-family reviewed limitations, and the labeled-not-modeled items (spin-time, max-out count, return speed) pending B66 evaluation.

## B74 — Boss map rulings (P5-S1 findings)
(a) On touch screens, the 44px target floor WINS over whole-tree fit-all: phone fit-all = full width at the floor zoom (~0.37×) with panning for depth. RATIFIED — reachability beats overview on small screens; the overview exists at tablet/desktop. (b) Ratified implementation choices: single-tap opens the focus card; wheel/trackpad always zooms; start node near the leading edge; phone legend collapsed by default. (c) `--edge-early` token addition ratified (UX §11 parity note). (d) `tc.v1.progress` domain registration ratified (ADR D6 key-list parity note — rides the amendments chain per B58 practice). (e) The `features` route-gate pattern for the hero button is APPROVED (P5-S5 adds `recommend`). (f) B27's "possibly outdated guide" caveat has no data field — acceptable; the edge sourceUrls carry the provenance.

## B75 — Fix-pass ratifications and parity (P5-S1/P3-S6/S7 review fixes)
Ratified: milestone short display labels (full name in card + accessible name); symmetric "Both" fork with the "or" chip at the junction; phone fit-all lands at the start; desktop zoom-controls bottom row; `inGameBehavior` overlay section + flavor-line stripping (tooltipBehavior/isFlavorLine in the shared schema — tooltip quote lines are flavor, never behavior; 55 cards corrected, 17 honest "No verified description yet." downgrades, 5 article-sentence replacements quote-checked); yoyo rendered at in-flight size (half icon; finer-than-arena pixel density accepted pending design re-review); "Hits/sec" readout for tethered weapons. Parity notes: UX §3.4/§3.7 supplements ride this amendments chain per B58 practice.

## B76 — Post-approval follow-ups (P5-S1/P3-S6/S7 final review)
Logged for future slices: (a) short desktop windows lose ~32% height to the header — a compact-header mode or folding map controls into the title row would lift landing zoom (owner: next bosses-route UI slice, likely P5-S4/S5); (b) phone opening view hides the EoW/BoC fork member off-left (documented choice; follow-up: a subtle off-screen indicator or initial nudge; same owner); (c) right-edge stage labels truncate instead of fading; (d) Light Disc wording polish; (e) repeated what/why text on Marrow, 3 Explosive Traps, Blade Staff, Sergeant United Shield, Pew-matic Horn (next overlay touch); (f) stale comments in labParams.ts:102 / labDowngrade.ts:38.
