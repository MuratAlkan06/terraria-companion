# Terraria Companion Website — Full Requirements (User-Provided)

Source of truth for all planning and implementation. Game version: latest stable vanilla Terraria (user states 1.4.5.8 — VERIFY against https://terraria.wiki.gg/ before freezing). Data accuracy verified against the Official Terraria Wiki (https://terraria.wiki.gg/). Vanilla only; no modded content. Must be a REAL WORKING WEBSITE — every major feature functional, not mockups.

## 1. Homepage — "Terraria Companion"
- Terraria-inspired pixel-art background (forest, mountains, glowing crystals, night sky).
- Global search bar (weapons, armor, accessories, bosses, enemies, materials, items).
- Nav sections: Weapon Lab, Loadout Builder, Boss Progression, Item Database, Guides.
- Buttons: "Build My Loadout", "Test Weapons", "What Should I Do Next?".
- Featured weapon + boss (rotating). Recently viewed items and saved builds.
- Game-stage selector: Early Pre-Hardmode, Late Pre-Hardmode, Early Hardmode, Mid-Hardmode, Endgame.
- Immediately useful: start building/testing in seconds.

## 2. Weapon Lab (flagship feature)
Interactive browser-based weapon-testing arena (Canvas or game-rendering library, JS/TS). Pixel-art arena with platforms, ground, training dummies.
- Targets: Infinite Dummy, Boss-Sized Dummy, Moving Dummy (horizontal/vertical), Multiple Dummies, Armored Dummy (adjustable defense), Debuff Dummy.
- Instant reset of test/target/settings.
- Weapon browser inside the Lab: search all weapons; filter by class (melee/ranged/magic/summoner/other), game stage, rarity, source, damage, special abilities; switch weapons without leaving arena; equip compatible accessories/armor/buffs; choose ammo; adjust mana and test conditions.
- Real interaction: click/hold to attack; melee reach/swings/thrusts/projectiles/returning; bows/guns/repeaters with ammo; magic projectiles/homing/mana/piercing; summons/minions/sentries/whips; AoE, explosions, bouncing, chaining, multi-projectile; DoT/debuffs; unique abilities.
- Live stats: damage per hit, crit damage, attacks/sec, estimated DPS, total damage, total hits, ammo consumed, mana consumed, debuffs applied, projectile count/behavior, range/piercing. Live DPS graph + floating damage numbers. Stats reset button + standardized timed tests (10s/30s).
- LABEL: browser simulation, not the Terraria engine; approximations clearly labeled; never claim simulated DPS == in-game DPS.
- Weapons needing special conditions get a custom test scenario or an explained limitation.

## 3. Complete Weapon Database
EVERY vanilla weapon for the selected version — data-driven, not hardcoded samples. Searchable/filterable. Per-weapon detail page: name, sprite/visual, rarity, class, base damage, crit, use time, knockback, ammo/mana consumption, class bonus applicability; attack behavior explanation; projectile behavior; verified special/hidden mechanics; single-target vs group suitability; strengths/weaknesses; range/usability; acquisition (craft/drop/purchase/chest/fishing/other), materials + station, verified drop rates, progression stage; when to use it, recommended class/build, similar/upgrade weapons, synergies, stage-peer comparison. Unverified stats marked "unknown" — never invented. Working source links.

## 4. Loadout Builder
Step 1 inputs (skippable): progression stage; class (Melee/Ranged/Mage/Summoner/Hybrid); difficulty (Classic/Expert/Master); goal (max damage/survivability/mobility/exploration/boss/balanced); current or next boss; available equipment.
Step 2: full recommended loadout — main + alt weapons; helmet/chest/leggings with class-variant helmets; all accessory slots per mode+stage; ammo; buffs/potions; summons/support; short per-item rationale; inventory-style slots; items click through to detail pages.
Step 3: explain synergy, per-item contribution, strengths/weaknesses, damage/defense/mobility profile, obtainable-now vs boss-gated items, easier alternatives. Never hide progression dependencies.
Step 4: compare ≥2 loadouts side by side (est. damage, defense, mobility, class bonuses, survivability); transparent scoring per goal (boss DPS/exploration/defense/general) with explained math; no universal "best" claims. "Surprise Me" + "Save Build" buttons.

## 5. Armor & Accessory Database
Armor: defense, set bonuses, class bonuses, movement/regen/mana/summon effects, acquisition, stage, comparable sets. Accessories: exact effects, bonuses, upgrade/crafting trees, category (mobility/defense/offense/utility), best-fit loadouts, tinkering combinations. Set-bonus-aware comparisons (no naive stat summing).

## 6. Boss Progression Map
Visual node tree with arrows/branches/unlocks — NOT a plain list. Distinguish: recommended next, required gates, optional, alternative routes, early-challenge-possible. Include King Slime, Eye of Cthulhu, Eater of Worlds/Brain of Cthulhu (world-dependent alternatives), Queen Bee, Skeletron, Deerclops, Wall of Flesh, Queen Slime, the 3 mechanical bosses, Plantera, Golem, Empress of Light, Duke Fishron, Lunatic Cultist, Moon Lord + relevant events/milestones.
Per-boss page: visual; where/when; summoning method/conditions; prep checklist; suggested weapons/armor/accessories/buffs/arena; attack patterns + survival tips; per-class equipment; drops + unlocks; post-defeat next steps; links to next nodes.
Tracking: mark defeated/optional/not attempted; defeating updates recommendations and unlocks branches visually; persisted between visits. "What Should I Do Next?" uses world conditions + completed objectives; distinguishes recommended order from hard dependencies.

## 7. Item Encyclopedia
Materials/ores, potions/buffs, summoning items, accessories/mounts, hooks/movement, tools/mining, wings, ammo, crafting stations, exploration/utility items, event+boss drops. Each: effect, acquisition, progression fit. Crafting tree viewer: click item → full dependency tree (materials, intermediate recipes, stations, alternative sources).

## 8. Weapon Comparison Tool
2–3 weapons side by side: base damage/modifiers, attack speed, est. DPS, range, single vs multi-target, special effects, resource costs, ease-of-use estimates, acquisition difficulty, stage. Pros/cons each. Estimates labeled with assumptions. "Send to Weapon Lab" action.

## 9. Beginner Guides
Topics: new world, exploring safely, better equipment, armor/defense, damage classes, arena building, first boss prep, entering Hardmode, key resources, path to final boss. Tips, checklists, item links; optional advanced sections.

## 10. Extras (only if genuinely working; core first)
Favorites/collections; saved characters (multiple playthroughs); gear upgrade planner; class guides; crafting tree; random challenge generator (legit items only); arena planner; achievement checklist; quick compare vs equipped; search suggestions/typeahead with filters; build export/import (readable format); recently viewed.

## 11. Design
Dark atmospheric; quality pixel-art-inspired elements; forest greens/deep blues/earthy browns/stone gray/warm gold; Terraria-style inventory grids + item tooltips; crisp typography; restrained animations; strong hierarchy; responsive (desktop/tablet/phone); cohesive identity across all sections. Permitted assets or original pixel-art substitutes — no blank spaces. Polished fan-made gaming tool, not a school project.

## 12. Technical
Modern stack (React + TypeScript suggested) with suitable styling system; reusable components; organized structure; structured data files for all entity types; working navigation/search/filtering/comparison/interactivity/data loading; local persistence for builds/favorites/progress; responsive; handle empty/loading/invalid/missing states; performance-optimized for large datasets; external data from reliable, appropriately licensed sources (verify APIs exist; document data provenance); no secrets in client code; vanilla version-specific content.

## 13. Data Accuracy (EXTREMELY IMPORTANT)
Real maintainable data pipeline over hand-typed samples. Structured entries with IDs, names, stats, descriptions, acquisition. Verify mechanics/recipes/drops/dependencies against trustworthy sources. Missing/unverified records identifiable. Never invent stats/recipes/abilities/drops. If full coverage impossible: complete the structure + pipeline, populate verified data, report gaps honestly. Never present fake data as official.

## 14. Build Order (user-mandated)
1) Project setup + design system → 2) Navigation + homepage → 3) Structured item database + search → 4) Interactive Weapon Lab → 5) Loadout Builder + comparison → 6) Boss progression map + saved progress → 7) Armor/accessories/encyclopedia/crafting trees/guides → 8) Test main flows + fix. If too large for one pass: working foundation first (homepage, searchable data, Weapon Lab, progression), then extend without replacing working features. No nonfunctional major buttons, no placeholder cards, no false "implemented" claims. Final report: how to run, what works, what's incomplete, how to continue.

## FEATURE A (added): "Can I Beat This Boss?" — Boss Readiness Checker
Choose boss; select stage/difficulty/class; build current loadout (weapon/armor/accessories/ammo/buffs). Analysis: damage suitability vs that boss (range/style/est. output); defense/survivability; mobility vs boss attacks; equipment synergy; preparation (potions/buffs/ammo/summons/healing/arena); missing upgrades obtainable at current stage; boss-specific strategy per class+difficulty. Overall readiness assessment WITHOUT pretending to predict fight outcomes — explain what makes it easier/harder and why. Buttons: "Analyze My Build", "Improve My Build" (stage-legal upgrades only), "Show Me How to Get It" (jump to acquisition instructions). Respect progression dependencies explicitly. Works across classes/world conditions/difficulties. Uses real database entries, not random stats.

## FEATURE B (added): "What Should I Grind For?" — Item Acquisition Planner
Search/select any obtainable item → identify every requirement → step-by-step plan based on stated progression and owned items → checkable steps. Show: acquisition method; recipe; every ingredient + quantity; station; ingredient locations; enemy/boss drops with verified rates; required events/biomes/bosses/NPCs/world conditions; alternative recipes/methods; obtainable-now status. Visual recursive crafting/acquisition tree (click ingredients to expand/open). Personalized grinding checklist: enter owned quantities → auto-calc remaining → update on check-off; group tasks by biome/enemy/boss/activity for convenience. Buttons: "Make My Plan", "Where Do I Find This?", "Find an Easier Route". Boss prerequisites included in plan; multiple methods compared. Plans + checklist progress persisted locally.

## Integration rules for A+B
Integrate with existing weapon/armor DBs, loadout builder, boss progression, encyclopedia — no disconnected demo pages. Functioning inputs/calculations/buttons/navigation. Label estimates. Never invent data. EXCLUDED by user: weapon tournament feature; all-in-one playthrough tracker.
