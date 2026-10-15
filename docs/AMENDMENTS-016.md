# AMENDMENTS-016

## B99 — P4-S1 comparison rulings
(a) CONFIRMED: 2–3 weapons and ?w= per PRD AC1/UX §1 — the spec wins over the looser brief; COMPARE_MAX stays 3.
(b) RULED: Compare gets a desktop More-menu entry (B96b parity — same reasoning as Readiness); rides the next fix round on this surface with nav pin updates.
(c) RATIFIED: "Not compared here" footnote for PRD-listed rows the data can't honestly hold (range, ease of use, reforges, single-vs-multi-target) — the B78 honest-absence pattern; rows appear if/when verified data exists.
(d) RATIFIED: compare-adapted ammo assumption wording ("No ammo is chosen here…") — §2.2's builder string doesn't fit a builder-less surface; spec parity rides this entry per B58.
(e) RATIFIED: editorial pros/cons derivation rules (verified-fields-only, auto-reuse/mana/ammo/consumable/classless/explosive/unobtainable tags), Unknown-heavy threshold 3, per-weapon Lab links (labLinks is single-weapon), picker marks-not-hides compared weapons.
(f) QUEUED: Lab results-panel "Compare" wiring (lab surface — after P3-S12 lands); "Open in Builder" awaits P4-S2; other-world-evil gate badge on compare columns adopts the B97a out-of-play treatment (nit); explosive held-attack estimates → design review judges.

## B100 — P3-S12 roster rulings
RATIFIED: bosses-data parallel load for Armored defense picks (+25 KB gz, within the Lab's 500 budget; no panel loading state — revisit only if budgets tighten); missed-shots stat counts summon projectiles (honest totals); test-value ranges (2/3/4× sizes; 1–16 t/s from 4; 8-across/5-up paths; defense 0–100 from 20 — all framed as player-chosen test values, boss names only on verified matches with wiki links); no combined targets in v1 (not PRD-promised; possible future); tick-derived motion (no accumulation drift — frame-rate-proof by construction); 16 prior goldens unchanged + 7 new pins with README changelog (B38 discipline); duplicate lab-settings-title fix. QUEUED: ?target= deep link (UX spec, not S12-gated); B44 label registry + AC5 tie-break untouched (still queued); Lab results-panel "Compare" wiring now unblocked (B99f — lab surface free). UX_SPEC parity rides this entry per B58.

## B101 — Compare/roster review rulings
(a) RULED (H1): uniform §2.2 numbers stay, but weapons breaking the held-attack assumption or consumed-on-use get an IN-CELL secondary qualifier line (the "Not applicable"/"Not estimated" pattern): e.g. "One click per throw · uses 1.5/s · blast and fuse not counted"; tips say "assumes a click every 40 ticks — it has no auto-reuse" and state usage rates for consumables. §2.2 spec parity rides per B58.
(b) RULED (H2): the compare table fills its frame at 1–2 weapons on desktop (stretch columns or size the frame to content — implementer's call, no dead bands).
(c) M1: Armored copy fixes to the assumptions tip's correct wording ("each hit is reduced by half the dummy defense").
(d) Nits to the same round: doubled "×" in rate tips; URL cleaned of invalid ids after the notice (notice announced once, then canonical link); "Stat" corner cell becomes a proper header; Compare desktop More-menu entry lands (B99b). RATIFIED as-is: per-target settings reset on switch (explicit v1 choice; memory = possible future); Cannon's page-scoped unknown count (popover wording already scopes it). Pre-existing queued: est.-chip tap-through under the sheet close X; Blast "200" wrap at 375.
(e) Roster judgments adopted: 375 up-and-back zoom APPROVED; defense-label/hint proximity = nit; 2–4px timed-test shift = nit (pre-existing, lab next-touch).

## B102 — B101 fix-round ratifications
RATIFIED: qualifier parts derive each from one verified field (autoReuse false → "one click per throw/attack"; maxStack verified → "uses N/s"; wiki Explosives tag → "blast and fuse not counted") — including the 110 no-auto-reuse melee weapons ("One click per attack"): the held-attack assumption genuinely breaks there and the wiki confirms; uniform field-derived honesty beats category exemptions. Explosives detection via the wiki tag (covers Scarab/Freeze) over the Lab's editorial archetype. URL canonicalization via replaceState with one-time announcement; 1024+ full-width column sharing (768 unchanged per the original review's finding scope). QUEUED nits: one-weapon desktop Change/Remove buttons stretch wide; §2.2 spec parity rides per B58.

## B103 — Batch approval notes
Re-check APPROVED P4-S1+P3-S12. Confirmed intended: the crit row hides only when NO column can crit (single classless weapon) and shows "Not applicable" whenever any column can. Nits queued: shared tip's "held-attack rate" sentence sitting beside the per-weapon no-auto-reuse override (reads fine, could harmonize); one-weapon desktop button stretch (already B102).
