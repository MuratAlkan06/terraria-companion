# AMENDMENTS-011 — Rulings from the armor/accessories dataset (P2-S8)

Status: BINDING · Orchestrator rulings on P2-S8 findings.

## B50 — Accessory.categories/effects min(1) dropped: APPROVED
A1-consistent: empty + listed in unverifiedFields = Unknown; validate rejects empty lists NOT marked Unknown. DATA_SCHEMA_SPEC §2.5 amended.

## B51 — Inexpressible sets (Beetle / Rain / Wizard): withholding RATIFIED
Schema extension for conditional/partial/combination sets (chest-dependent bonuses, missing slots, cross-set combinations) is DEFERRED to a P6-S1-era amendment; until then withheld-with-quoted-gaps is the honest state.

## B52 — Hybrid sets: `classes` per variant APPROVED as a scheduled amendment
The 10 hybrid sets forced to "other" lose class-matching fidelity. `ArmorSet.variants[].classes: DamageClass[]` (superseding the single `class`) lands BEFORE P4-S2 (loadout recommendations need it). Owner: the P4-prep pipeline slice.

## B53 — Tinkering two-way conversions: KEEP the links; cycle guards are BINDING
Band of Starpower ↔ Panic Necklace is true data. Every walker of combinedFrom/upgradesTo/crafting trees MUST be cycle-guarded (the §7b derivation already is). Do not exclude conversions.

## B54 — StatKind extensions: the 11 proposed new kinds are PRE-APPROVED
(fishing-power-flat, ammo-save-pct, knockback-pct, tag-effect-slots, lava-immunity-ticks, melee-scale-pct, tile-reach-flat, potion-cooldown-pct, armor-penetration-flat, minion-knockback, whip-speed-pct — evidence already in the gap report.) Applied when loadout/Lab math first consumes them (P3-S14 / P4-S2 prep), not before. The "existing kind, no value/unit" rows stay Unknown.

## B55 — Armor/accessory sprite binaries: download DEFERRED
Manifest entries exist; binaries download via the cached, resumable `pipeline:sprites` run when the first consuming UI ships (P3-S14 equip panel or P6-S1/S2 views). SpriteImg's placeholder fallback covers any interim rendering.

## Noted
search.test.ts count-pin updates by the data slice are the established pattern (ratified again). Equipinfo-only stats (3 items) reported-not-emitted stands. Vanity accessories → P6-S0.
