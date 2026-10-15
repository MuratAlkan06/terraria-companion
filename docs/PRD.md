# PRD & Slice Plan — Terraria Companion Website (v1)

> **AMENDED BY [AMENDMENTS-001.md](./AMENDMENTS-001.md) (binding — read together).**
> **B58 parity sweep (AMENDMENTS-016 B121, 2026-10-15):** acceptance criteria are kept verbatim; where AMENDMENTS-015 (B85+) / AMENDMENTS-016 rule on how an AC is read or met, an indented "Amended" note follows it with the B-number. The amendments chain stays binding and wins on any conflict.
> **Release closeout (AMENDMENTS-016 B131/B132, 2026-10-15):** the release gate's scope rulings are recorded as "Cut (B131(b))" / "Amended" notes on the affected slices (P3-S13 AC2, P3-S14, P4-S2, P4-S4, P6-S1/S2, P6-S4, P6-S7, P6-S9, P7-S3/S4/S5) and annotated under §10's cut line. Final report: [RELEASE.md](./RELEASE.md).

Status: Draft for P0 freeze · 2026-10-12 · Refines docs/TASK_CONTRACT.md phases P1–P7 into slices. Source of truth: docs/REQUIREMENTS.md. Authored by product-architect agent.

---

## 1. Problem Being Solved

Terraria players constantly alt-tab to the wiki to answer three questions: *"Is this weapon actually good for me right now?"*, *"Am I ready for this boss?"*, and *"What do I need to farm to get item X?"* The wiki has the data but none of the interactivity: you can't feel a weapon, you can't evaluate a full loadout against your progression stage, and crafting chains require manual recursive lookup. This product turns verified wiki data into an interactive decision tool: test weapons hands-on, see honest readiness analysis, and get a checkable grind plan — without ever inventing data or pretending to be the game engine.

## 2. Target User

A vanilla Terraria player (Classic/Expert/Master, PC latest stable 1.4.5.x) mid-playthrough, on desktop or phone next to their game. Secondary: new players following the guides path. Not served in v1: modded players, speedrunners needing frame-exact data, multiplayer coordination.

## 3. Core User Journey

1. Land on homepage → set game stage (e.g., "Early Hardmode") → it persists.
2. Search "zenith" or browse the Weapon Lab → test weapons against dummies, read live labeled DPS estimates.
3. Open Boss Progression Map → mark defeated bosses → "What Should I Do Next?" recommends the next node honestly (required vs. recommended).
4. Run "Can I Beat This Boss?" on the next boss with their real loadout → see factor-by-factor analysis + stage-legal upgrade suggestions.
5. Click a suggested upgrade → "What Should I Grind For?" generates a persistent checkable acquisition plan.
6. Return tomorrow: stage, defeated bosses, saved builds, and checklist progress are all still there (local persistence).

## 4. MVP Definition (honors REQUIREMENTS §14 fallback rule)

**The working foundation — never cut, never replaced, only extended:**

| Foundation pillar | Minimum shippable form |
|---|---|
| Homepage | Hero + working global search + game-stage selector (persisted) + nav to only-working sections. No dead buttons, no placeholder cards. |
| Searchable data | Complete weapons dataset (all vanilla weapons for the pinned version, verified or marked "unknown"), item database UI with filters, global typeahead search, weapon detail pages v1 with provenance links. |
| Interactive Weapon Lab | Arena + Infinite Dummy + in-Lab weapon browser + live stats/DPS graph + the four highest-coverage archetypes (swing-melee, bow/gun w/ ammo, magic bolt, thrust). Every weapon not yet simulated shows an honest "explained limitation" card — never broken behavior, never a fake simulation. |
| Boss progression | Visual node map (all bosses + world-evil alternatives), per-boss pages (minimal: summon, location, drops, prep), defeat tracking persisted locally, visual unlock updates. |

**Everything else is an extension layer** added in P4–P7 without modifying foundation contracts: Loadout Builder, Comparison, Feature A, Feature B, armor/accessory/encyclopedia views, crafting trees, guides, extras. If the project must shrink, extensions drop in reverse value order (see §10 cut line); the foundation ships complete or the project is not done.

## 5. User Value Statements (per major feature)

- **Homepage.** Gets a player from arrival to a useful action in under ten seconds: search anything, set your stage once, jump to testing or planning. It is the honest table of contents — it only links to things that work.
- **Global Search + Item Database.** One search box over every weapon, armor, accessory, boss, enemy, and material eliminates the wiki tab-juggle. Filters by class/stage/rarity answer "what can I even use right now?" in one view.
- **Weapon Lab (flagship).** Players can *feel* a weapon — swing arc, projectile spread, ammo burn, mana drain — before farming three hours for it. Live labeled DPS estimates and standardized 10s/30s tests make comparisons concrete while staying honest that this is a browser approximation, not the game engine.
- **Weapon Database detail pages.** Every stat, acquisition route, and verified mechanic for every vanilla weapon, with source links and explicit "unknown" markers. It answers "how do I get it and when should I use it" without leaving the page.
- **Loadout Builder.** Converts "stage + class + goal" into a complete, slot-by-slot recommended kit with per-item rationale. It never hides that an item is boss-gated and always offers an obtainable-now alternative.
- **Weapon Comparison Tool.** Two or three weapons side by side with labeled estimate assumptions settles "which should I craft" debates in seconds, and "Send to Weapon Lab" lets you verify by hand.
- **Armor & Accessory Database.** Set-bonus-aware comparisons stop players from naively summing defense numbers. Tinkering/upgrade trees show the real path from Cloud in a Bottle to endgame mobility.
- **Boss Progression Map.** A visual tree with required gates vs. recommended order vs. optional branches replaces the misleading "boss list" mental model. Tracking defeats updates recommendations and persists, so it becomes the player's home base between sessions.
- **Item Encyclopedia + Crafting Trees.** Every material, potion, and utility item with a click-to-expand recursive crafting tree kills the worst wiki pain: six-deep ingredient lookups.
- **Beginner Guides.** A curated path from fresh world to Moon Lord with item links into the database turns the overwhelming early game into a checklist.
- **Feature A — Boss Readiness Checker.** Answers the most-asked question in Terraria ("am I ready for Plantera?") with a factor-by-factor analysis of the player's *actual* loadout — damage fit, survivability, mobility, prep — and stage-legal fixes, explicitly without pretending to predict the fight outcome.
- **Feature B — Item Acquisition Planner.** Turns "I want the Ankh Shield" into a persistent, checkable, biome-grouped grind plan with verified drop rates and boss prerequisites included. It is the wiki's crafting tree made executable.

## 6. Explicit Non-Goals (carried over + confirmed)

- No modded content; no platform-variant mixing without labeling. Vanilla, pinned version only.
- No weapon tournament feature (user-excluded).
- No all-in-one playthrough tracker (user-excluded). Boss-defeat tracking, saved builds, and grind checklists exist as *separate per-feature persistence* — they are not merged into a unified playthrough dashboard.
- No invented data, ever: unverified stats/recipes/drops render as "Unknown" with a provenance note.
- No backend, no accounts, no server-side anything in v1. All persistence is local to the browser.
- No claim that Weapon Lab output equals in-game DPS; no readiness verdicts framed as fight-outcome predictions.
- No decorative non-functional UI: no dead major buttons, no placeholder cards, no "coming soon" sections in the nav.

## 7. Slice Plan (P1–P7)

Every slice: independently shippable, ≤ ~1 focused work session, acceptance criteria are observable behaviors. Data dependencies marked **[D: …]**, consolidated in §8.

### P1 — Scaffold

**P1-S1 "App Shell & Design Tokens"**
1. Visiting the site shows the shell with the Terraria-inspired dark palette (forest green/deep blue/earth brown/stone gray/warm gold) applied via tokens, on desktop and a 375px-wide viewport without horizontal scroll.
2. The nav renders only sections that exist (data-driven nav config); no nav item leads to an empty or placeholder page.
3. Navigating to an unknown URL shows a styled 404 with a working link back home.
4. A Terraria-style item tooltip component and inventory-grid component render correctly with mock props in at least one visible location (used for real in P2).

**P1-S2 "Homepage v1"**
1. Homepage shows pixel-art hero background (licensed or original substitute — no blank areas) with the "Terraria Companion" identity.
2. Game-stage selector offers the five stages (Early Pre-HM → Endgame); selection persists across a full page reload.
3. Every button visible on the homepage performs its action; buttons whose target feature doesn't exist yet are absent, not disabled.
4. Page is fully usable on phone, tablet, and desktop breakpoints.

### P2 — Data + Search + Item Database UI

**P2-S1 "Entity Schema & Provenance Contract"**
1. Schemas exist for weapon, armor, accessory, item, recipe, boss, and progression-edge entities, each with ID, stats, acquisition, source-URL, and verified/unknown field markers.
2. A validation run over a 20-record sample dataset passes, and intentionally corrupting a record makes it fail with a named error.
3. Rendering a record with a missing stat shows "Unknown" in the UI, never a blank, zero, or invented value.
4. Every rendered entity shows a working link to its wiki source page.

**P2-S2 "Weapons Dataset v1 (complete coverage)"** [D: produces the foundation dataset]
1. Dataset contains every vanilla weapon for the pinned version; total count is reconciled against the wiki category count with any gap listed in a human-readable gap report.
2. Spot-check of 10 named weapons across classes (e.g., Zenith, Terra Blade, Minishark, Daedalus Stormbow, Razorblade Typhoon, Terraprisma, Kaleidoscope, Night's Edge, Toxikarp, Celebration Mk2) shows correct base damage, class, use time, rarity, and acquisition vs. wiki.
3. Any stat not verified renders as "Unknown"; zero records contain invented values.
4. Each weapon has a sprite (licensed or original substitute) and a provenance link.

**P2-S3 "Item Database UI + Weapon Detail v1"** [D: P2-S2]
1. A browsable weapon list renders all weapons with virtualized/paginated performance (no visible jank scrolling the full list).
2. Filtering by class, game stage, and rarity updates results correctly and combinably; an empty filter result shows a designed empty state.
3. Clicking any weapon opens a detail page with name, sprite, rarity, class, damage, crit, use time, knockback, ammo/mana use, acquisition (method, materials, station, verified drop rate), and source link.
4. A weapon with unverified fields displays "Unknown" markers on exactly those fields.

**P2-S4 "Global Search + Typeahead"** [D: P2-S2 minimum; grows with each dataset]
1. Typing "zenith" in the homepage global search shows the weapon within suggestions; pressing Enter or clicking navigates to its detail page.
2. Suggestions appear within ~150ms of typing on a warm cache and are grouped/labeled by entity type.
3. Searching a nonsense string shows a designed "no results" state with no console errors.
4. Search is reachable from every page (shell-level), not just the homepage.
5. As later datasets ship (bosses, armor, items), their entities appear in the same search with no UI change required.

**P2-S5 "Homepage v2 (data-aware)"** [D: P2-S2; boss dataset P2-S6 for featured boss]
1. Featured weapon rotates (per visit or per day) and links to its real detail page.
2. "Recently viewed" shows the last items the user opened and persists across reload; empty state is designed, not blank.
3. "Test Weapons" button navigates into the Weapon Lab once P3-S1 ships; until then the button does not exist on the page.

**P2-S6 "Boss + Progression Dataset"** [D: produces data for P5; can ship any time before P5-S1]
1. All bosses from REQUIREMENTS §6 exist as records (incl. Eater of Worlds/Brain of Cthulhu as world-dependent alternatives) plus key events/milestones as nodes.
2. Progression edges are typed: required-gate / recommended-next / optional / alternative-route / early-challenge-possible, each with a wiki provenance link.
3. Spot-check: Wall of Flesh is a required gate to Hardmode; Plantera requires all three mechanical bosses; Deerclops and Queen Bee are optional.
4. Boss records appear in global search.

### P3 — Weapon Lab (behavior-archetype system)

**Archetype model (the scope-control mechanism).** Every vanilla weapon maps to exactly one of ~10 behavior archetypes plus a shared parameter set — never bespoke per-weapon code:

| # | Archetype | Covers (examples) | Key params |
|---|---|---|---|
| 1 | Swing-melee | broadswords, Zenith-class arcs | arc size, swing speed, optional emitted projectile |
| 2 | Thrust | shortswords, spears | reach, thrust rate |
| 3 | Returning | boomerangs, flails, yoyos (variants) | throw range, return behavior, tether/control mode |
| 4 | Bow/gun w/ ammo | bows, guns, repeaters, consumable throwns | ammo type, projectile count, spread, velocity |
| 5 | Magic bolt | most magic weapons | mana cost, projectile count/spread, velocity |
| 6 | Piercing/beam | channeled beams, pierce projectiles | pierce count, channel, tick rate |
| 7 | Homing | homing subweapons across classes | homing strength, target acquisition (modifier layer on 4/5) |
| 8 | Minion/sentry | all summon weapons (sentry = stationary variant) | slot cost, minion AI class, attack rate |
| 9 | Whip | all whips | arc, range, tag-damage bonus |
| 10 | Explosive/AoE | grenades, launchers, rockets | blast radius, self-knockback, AoE falloff |

Cross-cutting modifier params (apply to any archetype): bounce, chain, DoT/debuff application, multi-hit locality. Weapons whose unique mechanic exceeds archetype+params get either a **custom test scenario** or an **explained-limitation card** — never silent misbehavior.

**Slice order rationale:** engine + highest-coverage archetypes first (melee + ranged + magic ≈ bulk of all weapons), summoner completeness next (class equity), special cases last behind a coverage gate.

**P3-S1 "Arena Core + Swing-Melee"** [D: weapon core stats + swing params for broadswords]
1. The Lab renders a pixel-art arena (ground, platforms) with an Infinite Dummy; a visible, permanent label states this is a browser simulation with approximate values, not the Terraria engine.
2. With a broadsword equipped, click/hold swings the weapon with a visible arc; arc contact with the dummy produces a floating damage number.
3. Per-hit damage, total damage, and total hits display and update live; a reset button zeroes stats and restores the dummy instantly.
4. Switching between two different broadswords changes arc size, speed, and damage observably — driven by data params, not per-weapon code.
5. Crit rolls occur at the weapon's crit chance and render visually distinct.

**P3-S2 "In-Lab Weapon Browser + Instant Reset"** [D: full weapons dataset]
1. Inside the Lab, a browser panel searches and filters all weapons by class, stage, rarity, source, and damage without leaving the arena.
2. Selecting any simulatable weapon equips it immediately; selecting a not-yet-simulated weapon shows its explained-limitation card with a link to its detail page — never a broken equip.
3. One control resets test, target, and settings together in a single action.
4. The currently equipped weapon's name, sprite, and base stats are always visible in the arena HUD.

**P3-S3 "Live Stats Engine + DPS Graph + Timed Tests"**
1. Attacks/sec, estimated DPS (labeled "estimated"), total damage, and total hits update live during any attack sequence.
2. A rolling live DPS graph renders during combat and clears on stats reset.
3. Starting a standardized 10s or 30s test runs a countdown, locks the config, and presents a results summary (est. DPS, hits, totals) at the end.
4. All derived numbers carry an "approximation" label or info-tooltip stating assumptions; nowhere does the UI claim parity with in-game DPS.

**P3-S4 "Bow/Gun/Repeater + Ammo"** [D: ammo dataset: arrows, bullets, darts, rockets w/ damage modifiers]
1. Equipping a bow or gun and holding attack fires projectiles at the weapon's use time; projectiles travel, hit the dummy, and show damage numbers.
2. An ammo picker lists only compatible ammo; switching ammo changes damage and visible projectile behavior.
3. "Ammo consumed" counts up live and resets with stats.
4. A multi-shot weapon (e.g., a shotgun-type) visibly fires multiple spread projectiles per use, via spread/count params.

**P3-S5 "Magic Bolt + Mana"**
1. Equipping a magic weapon shows a mana bar; each cast deducts the weapon's mana cost; an adjustable max-mana setting changes capacity.
2. At zero mana, casting stops (with configurable regen behavior) — no free infinite casting unless the user toggles "ignore mana (test mode)", which is labeled.
3. "Mana consumed" tracks live; multi-projectile magic weapons show count/spread per params.
4. Two different magic bolts differ observably (speed, count, cost) purely from data.

**P3-S6 "Piercing/Beam + Multiple Dummies target"**
1. The Multiple Dummies target option spawns a configurable row of dummies.
2. A piercing projectile damages up to its pierce-count of dummies in one pass; hit counts per dummy are visible.
3. A channeled beam weapon damages continuously while held, with tick-rate-driven damage numbers.
4. Single-target stats and total (all-dummy) damage are reported separately.

**P3-S7 "Thrust + Returning (boomerang/flail/yoyo variants)"**
1. Shortswords/spears thrust with data-driven reach and rate; reach differences between two spears are visible.
2. A boomerang flies out, returns, and can damage on both passes; "projectile count/behavior" stat reflects it.
3. A yoyo stays deployed under cursor control until recalled (tethered variant); a flail swings/launches per its variant params.
4. All three map to the single Returning archetype with variant params — verified by equipping one of each with no archetype-specific UI breakage.

**P3-S8 "Homing Modifier Layer"**
1. A homing-flagged weapon's projectiles visibly curve toward the nearest dummy per homing-strength param.
2. The same weapon with homing disabled in test settings flies straight (proves it's a modifier layer, not bespoke code).
3. Homing works on at least one ranged and one magic weapon without new archetype code.
   > Amended (B116): these ACs stand proven on ENGINE TEST weapons only — 0 of the 149 simulable weapons home (audit pinned: the 27 homing weapons are all limitation-carded, detection by modifier + narrow keywords with an exact-27-ids tripwire). The Lab shows the homing switch DISABLED, with its reason, on homing weapons' limitation cards (UX_SPEC §3.4); the real-data toggle activates if a verified-homing weapon ever becomes simulable.

**P3-S9 "Minions + Sentries"**
1. Summoning spawns a persistent minion that autonomously attacks the dummy; summoning again respects slot count settings.
2. A sentry variant spawns stationary at the click point and attacks in range.
3. Minion damage attributes into the live stats/DPS graph like any other source.
4. De-summon/reset clears all minions and sentries instantly.

**P3-S10 "Whips + Tag Synergy"**
1. A whip swings in an arc with data-driven range and applies a visible tag marker to struck dummies.
2. With a minion active, tagged dummies take the whip's tag-damage bonus from minion hits, visible in damage numbers.
3. Whip + minion combined DPS appears in the live stats, demonstrating the summoner loop end-to-end.

**P3-S11 "Explosive/AoE + Debuff/DoT Layer + Debuff Dummy"**
1. An explosive projectile detonates with a visible blast radius damaging all dummies inside it.
2. A debuff-applying weapon shows a debuff icon on the dummy and ticking DoT numbers; "debuffs applied" stat counts them.
3. The Debuff Dummy target displays active debuffs and their remaining durations.
4. DoT damage is included in total damage and the DPS graph, labeled as DoT in the breakdown.

**P3-S12 "Dummy Roster v2: Boss-Sized, Moving, Armored"**
1. Boss-Sized Dummy has a larger hitbox; multi-hit/AoE weapons observably hit it more than the standard dummy.
2. Moving Dummy travels on a horizontal or vertical path at adjustable speed; projectile weapons can visibly miss it.
3. Armored Dummy applies an adjustable defense value using Terraria's defense formula (labeled approximation); raising defense visibly lowers damage numbers.
4. Switching target type mid-session resets cleanly via the instant-reset control.

**P3-S13 "Lab Coverage Gate: special cases + limitation cards"**
1. Every weapon in the dataset resolves to exactly one of: archetype+params (simulated), custom scenario, or explained-limitation card — a visible coverage report page shows counts per bucket and a 0 count for "unhandled".
2. At least 2 custom scenarios exist for condition-dependent weapons, each explaining its special setup in-UI.
   > Amended (B131(a), adopting the release gate's ruling): RETIRED per §10 risk 1's own cut line ("custom scenarios → limitation cards") — custom scenarios: 0, cut per §10. The requirement behind it holds: 0 unhandled and 339 typed limitation cards, each saying what the weapon does in-game and why it isn't simulated; B115 already bans inventing simulation parameters for a scenario.
3. Every limitation card states *what the weapon actually does in-game* (verified text + source link) and *why it isn't simulated*.
4. Selecting 20 random weapons in the Lab produces zero broken/blank behaviors.
   > Amended (B115, B116 — supersedes AMENDMENTS-001 A3's coverage targets for this gate): A3's aspirational ≥60%-simulable target is RETIRED — reality is 149/488 (30.5%) honestly simulable with verified parameters, the rest carrying typed refusals and limitation cards, which IS the honesty contract; the 60% figure predated the triple-verification bar and would pressure dishonest parameter invention. The P3-S13 gate is a build-failing check: (a) the simulable count may never decrease (floor 149, raise-only; lowering needs a ruling); (b) every simulable weapon has a passing golden (149 ammo-named goldens; goldens pin data as well as engine); (c) every non-simulable weapon has a typed reason (`E_LAB_UNHANDLED`; DATA_SCHEMA_SPEC §6 `E_LAB_COVERAGE`). Resolved (B122): A3's ≥80%-per-floor-archetype target is RETIRED with B115's rationale (Q1). AC1's coverage report PAGE (UX_SPEC §1 `/lab/coverage`) is RETIRED as duplicative (Q2) — the Lab's "488 · 149 simulated · 339 not" line, the per-weapon limitation cards and the typed refusals deliver AC1's substance at the point of use; the per-bucket counts (149 archetype / 0 custom scenario / 339 limitation / 0 unhandled) live in `gaps.json` and the gap report.

**P3-S14 "Equip Context: armor/accessories/buffs in Lab"** [D: armor + accessory + buff datasets with stat effects — may ship after P4 data lands]
1. Equipping armor/accessories/buffs in the Lab changes displayed damage/crit/speed per their verified stat effects.
2. Only stat-affecting effects apply; unmodeled effects are listed as "not simulated" on the equip panel.
3. Removing all equips returns stats exactly to base values.
   > Cut (B131(b)), per §10 — risk 1 lists P3-S14 among the first P3 cuts and the global cut line drops "Lab equip-context" before the floor. The Lab tests each weapon on its own stats; equipment bonuses are counted, as estimates, by the builder's profile and the readiness analysis.

### P4 — Loadout Builder + Weapon Comparison

**P4-S1 "Weapon Comparison Tool"** [D: weapons dataset only]
1. User selects 2–3 weapons (via search) and sees a side-by-side table: damage, modifiers, speed, est. DPS, range, single vs multi-target, special effects, resource costs, ease-of-use, acquisition difficulty, stage.
2. Every estimated figure carries a visible assumptions label.
3. Each weapon column lists pros/cons derived from data (e.g., piercing → multi-target pro).
4. "Send to Weapon Lab" opens the Lab with the first selected weapon equipped.
5. Comparison state is shareable/restorable via URL within the session.
   > Amended (B99, B101–B103): 2–3 weapons, COMPARE_MAX = 3, `?w=` (B99(a) — this AC wins over the looser brief). AC1 rows the data can't honestly hold (range, ease of use, reforges, single- vs multi-target beyond explosives) are named in a "Not compared here" footnote and appear if/when verified data exists (B99(c)). AC2: uniform est. figures, plus an in-cell qualifier line for weapons breaking the held-attack assumption or used up on use (B101(a), B102; SCORING_SPEC §2.2). AC3: pros/cons by fixed rules over verified fields (B99(e)). AC4: met per weapon — each column links the Lab for its own weapon (labLinks is single-weapon, B99(e)); "Open in Builder" passes no stage (B108(c)).

**P4-S2 "Loadout Builder: Inputs + Recommendation (Steps 1–2)"** [D: armor, accessory, ammo, buff/potion datasets with stage + class + acquisition fields]
1. Step 1 collects stage, class, difficulty, goal, current/next boss, available equipment — every input skippable with sensible defaults.
2. Step 2 renders a full loadout in Terraria-style inventory slots: main + alt weapon, 3 armor pieces (class-correct helmet variant), all accessory slots for the chosen difficulty, ammo, buffs, summon/support — each with a 1–2 line rationale.
3. Every recommended item is a real database entity; clicking it opens its detail page.
4. Changing stage or class regenerates a stage-legal loadout (no post-boss items for a pre-boss stage).
5. Hovering any item shows the standard Terraria-style tooltip.
   > Amended (B106, B108): the current/next boss input is a TARGET — that boss and every fight it opens stay out of the stage's assumed defeats, so their gear sits on the gated track (target group first); marked defeats still count (B106). Accessory slots honor "empty beats zero" — a 0-point accessory whose specials belong to another class never fills a slot (B108(a); SCORING_SPEC §4.4). With a world evil chosen, other-world items are out of play and counted (B108(b)). Arriving from the comparison without a stage, the builder prompts for one instead of defaulting (B108(c)). AC4: swaps that stop being stage-legal are cleared with a visible notice (B106, B108(e)).
   > Amended (B131(b)): AC3's interim exception — armor and accessory picks link their wiki articles while no armor/accessory pages exist — EXPIRES when P6-S1/S2 land; those links then go internal.

**P4-S3 "Loadout Explanation + Honesty Layer (Step 3)"**
1. A synergy explanation panel describes how the pieces work together and each item's contribution.
2. The loadout shows a damage/defense/mobility profile summary, labeled as estimates.
3. Boss-gated items are visibly badged with the gating boss; each has an "easier alternative" shown that is obtainable now.
4. No recommendation ever hides a progression dependency (verified by selecting "Early Pre-Hardmode" and confirming zero Hardmode items appear ungated).
   > Amended (B108(d), B113(a), B114): AC2's profile is four est.-labeled bars (damage, defense, mobility, survivability; class synergy runs to 100), each running to a PICK-INDEPENDENT reference — the highest figure found among gear verified obtainable at the stage, shown as a tick; a full bar must be earnable, never the default, and a bar never compares a build with itself (SCORING_SPEC §5.5; UX_SPEC §3.5).

**P4-S4 "Loadout Compare + Scoring + Save (Step 4)"**
1. Two or more loadouts render side by side with est. damage, defense, mobility, class bonuses, survivability.
2. Scoring per goal (boss DPS / exploration / defense / general) shows its math on demand ("how was this scored?"), and no UI copy claims a universal "best".
3. "Surprise Me" generates a valid random stage-legal loadout.
4. "Save Build" persists the loadout locally; saved builds survive reload and appear on the homepage.
   > Amended (B122 Q3): AC1's "two or more loadouts" is met by the draft beside one saved build (two); N-way saved-build comparison is out of v1 scope.
   > Amended (B111, B113(b), B114, B106/B107): AC2's goal scoring compares builds as ONE signed difference ("Under Survivability weights: saved +24.4 est."; ties "same"), each figure split between the builds in proportion to their values; per-build weighted sums appear only inside "How was this scored?" and the 100.0 anchor is gone (SCORING_SPEC §5.3). AC3: Surprise Me warns before replacing fixed picks, re-draws on input change and is reproducible from its `?surprise=` seed (B111 R2). AC4: the homepage rail appears once a build exists — with none it is absent, since the hero's "Build My Loadout" already invites (B111 R6). Saved builds are SavedBuild v2 (target boss, owned items, user-emptied slots; v1 reads unchanged — DATA_SCHEMA_SPEC §8a).

### P5 — Boss Progression + Feature A

**P5-S1 "Boss Node Map v1"** [D: P2-S6 boss + edge dataset]
1. The map renders as a visual node tree with arrows/branches — demonstrably not a flat list (branching visible at e.g. the mechanical-boss trio).
2. Node/edge styling distinguishes required gates, recommended next, optional, alternative routes, and early-challenge-possible — with a legend.
3. World-evil alternatives (EoW/BoC) render as an either/or branch driven by a world-type setting.
4. Clicking a node opens that boss's page; the map is pannable/usable on mobile.

**P5-S2 "Boss Pages: Pre-Hardmode (7 nodes)"** [D: boss detail data: summon, drops w/ rates, prep]
1. Each pre-Hardmode boss page shows: visual, where/when, summoning method/conditions, prep checklist, suggested per-class equipment, attack patterns + survival tips, drops with verified rates (or "Unknown"), and post-defeat next steps.
2. Every suggested item links to its real database detail page.
3. "Next nodes" links navigate back into the map at the right position.
4. All non-obvious claims (drop rates, summon conditions) carry provenance links.

**P5-S3 "Boss Pages: Hardmode (10 nodes + events/milestones)"**
Same 4 criteria as P5-S2, applied to Queen Slime, the three mechanical bosses, Plantera, Golem, Empress of Light, Duke Fishron, Lunatic Cultist, Moon Lord, and event/milestone nodes.

**P5-S4 "Defeat Tracking + Visual Unlocks"**
1. Each node can be marked defeated / not attempted / skipped-optional; state persists across reload.
   > Amended (B86(a)): "each node" = each BOSS — milestones and events are derived from their bosses, never markable (consistent with B24).
2. Marking a gate boss defeated visibly unlocks downstream branches (style change + newly "recommended" highlighting).
3. A reset-progress control exists with a confirmation step.
4. Tracking state is readable by other features (stage inference) — verified by Feature A reflecting it.

**P5-S5 "'What Should I Do Next?' Recommender"**
1. The button (homepage + map) produces a recommendation from world type + defeated bosses + selected stage.
2. Output explicitly separates "required before you can progress" from "recommended order" — with reasons.
3. Changing tracked defeats changes the recommendation correctly (e.g., defeating WoF switches recommendations to early-Hardmode).
4. With nothing tracked, it gives a sensible fresh-start recommendation instead of an error.
   > Amended (B89): recommendations follow TRACKED defeats only (the panel explains the map beside it); AC1's "selected stage" is display context, never an assumed defeat. The recommender rules are specified in UX_SPEC §3.7.

**P5-S6 "Boss Readiness Checker v1 (Feature A core)"** — see §9 for full integration ACs
1. User picks a boss, stage, difficulty, class, and assembles a loadout from real database entities via search (same components as P4 builder).
2. "Analyze My Build" produces sectioned analysis: damage suitability vs. that boss (range/style/est. output), defense/survivability, mobility vs. that boss's attack patterns, synergy, and preparation (potions/ammo/healing/arena).
3. The overall readiness summary is framed as factors ("what makes this easier/harder and why") — no win-probability or fight-outcome prediction anywhere in the copy.
4. All estimates are labeled; all referenced items/bosses link into the database.

**P5-S7 "Readiness Checker v2: Improve + Acquire"**
1. "Improve My Build" suggests only upgrades obtainable at the user's current stage/defeated-boss state; gated upgrades appear in a separate, clearly labeled "after you defeat X" list.
2. "Show Me How to Get It" jumps to the item's acquisition instructions (deep-links into Feature B's planner once P6-S5 ships).
3. Suggestions respect class choice and difficulty (Expert/Master accessory slot counts).
4. The analysis + loadout persist locally and restore on return.
   > Amended (B94(5), B97(a), B117): gated upgrades list nearest gate first within each "after you defeat X" group, the rest counted; with a world evil chosen, upgrades behind the other world's evil boss are left out and counted. AC2: "Show Me How to Get It" opens the planner (`/plan/new?item=:id`) for single items (B117, superseding B112's interim item-page anchor); armor sets link to their in-app set pages (B134, superseding B117's wiki links for sets).

### P6 — Encyclopedia, Crafting Trees, Feature B, Armor/Accessory Views, Guides

**P6-S1 "Armor Database View"** [D: armor dataset w/ set bonuses]
1. Armor sets list/filter by stage and class; each set page shows defense, set bonus, class bonuses, movement/regen/mana/summon effects, acquisition.
2. Comparing two sets compares set-bonus-aware totals — never a naive per-piece stat sum (verified with a set whose bonus changes the comparison).
3. "Comparable sets at this stage" links work.

**P6-S2 "Accessory Database View"** [D: accessory dataset w/ effects + tinkering recipes]
1. Accessories list/filter by category (mobility/defense/offense/utility) and stage; each shows exact effects and best-fit loadout notes.
2. An accessory with an upgrade path (e.g., the Ankh Shield chain) renders its full tinkering/combination tree with every node clickable.
3. All effects text is verified-with-source or marked Unknown.
   > B131(b): P6-S1 and P6-S2 are BUILT, not cut — the original owner spec promises these databases; cutting them would change the contract. Delivered in 41bbb32 (B134 as-built note below) (docs/RELEASE.md §5). B131(c): B112's "P6-S1/S2" label meant the encyclopedia foundation (the item corpus UI that delivers P6-S3), not these slices.

**P6-S3 "Item Encyclopedia Categories"** [D: full item corpus]
1. Every REQUIREMENTS §7 category browses with its items; each item page shows effect, acquisition, and progression fit.
2. All encyclopedia entities appear in global search.
3. Category pages handle large lists performantly and show designed empty/loading states.

**P6-S4 "Crafting Tree Viewer"** [D: recipes dataset w/ quantities, stations, alternatives]
1. Clicking "crafting tree" on any craftable item renders its full recursive dependency tree: materials, quantities, intermediate recipes, stations.
2. Clicking any ingredient node expands it in place or opens its item page (user choice preserved).
3. Items with alternative recipes/sources show the alternatives at the relevant node.
4. A deep chain (e.g., Zenith or Cell Phone) renders completely without UI breakage.
   > Amended (B131(b)): met by the Acquisition Planner's tree (the same recipe data, Feature B AC1) IF the plan PREVIEW shows the tree before saving — the P6 slice verifies this and adds it if missing; no separate "Crafting tree" tab, one tree renderer.

**P6-S5 "Acquisition Planner v1 (Feature B core)"** — see §9 for full integration ACs
1. User searches/selects any obtainable item; "Make My Plan" generates a step-by-step plan from their stated progression stage and owned items.
2. The plan shows: acquisition method, recipe, every ingredient + quantity, station, ingredient locations, drops with verified rates (or Unknown), and required events/biomes/bosses/NPCs/world conditions.
3. Boss prerequisites appear as explicit plan steps linking to boss pages; nothing boss-gated is presented as obtainable-now.
4. "Where Do I Find This?" surfaces location/source info for any step; "Find an Easier Route" offers an alternative method where one exists, with the tradeoff explained.
   > Amended (B117–B119): AC1's plan takes a quantity ("how many"). AC4 ships as "Compare routes" — no "easier" claims without data: every listed way shows its per-way gates (SCORING_SPEC §2.5), and the default route is "choices, not rankings" (a single source auto; craft-only = data-order "recipe 1 of N", labeled; mixed sources = the user chooses; Shimmer/circular/reversal recipes never auto-picked, always choosable with the reason shown).

**P6-S6 "Grinding Checklist + Persistence (Feature B completion)"**
1. User enters owned quantities per ingredient; remaining amounts auto-calculate and update when steps are checked off.
2. Tasks group by biome/enemy/boss/activity so a single farming trip covers multiple needs.
3. Plans and check-off progress persist locally and restore exactly on return; multiple concurrent plans are supported.
4. Completing all steps marks the plan done; un-checking reopens it correctly.
   > Amended (B117, B118, B119): AC2 groups by boss / drop source / vendor / activity — A5's biome grouping deviated honestly (biomes are free text). AC4: a step is complete when checked OR complete by cause (owned, no longer needed, boss counted); ONE "N of M complete" semantics on the plan page and the list; the completion banner is visible at the point of the final check and announced (B118(a)–(c)). Check state is per plan.

**P6-S7 "Weapon Detail v2: Guidance & Relations"**
1. Weapon pages gain: when-to-use guidance, recommended class/build, similar/upgrade weapons, synergies, and stage-peer comparison links.
2. Every related weapon link navigates correctly; every guidance claim about mechanics has a source or is labeled as editorial guidance.
3. "Compare with stage peers" opens the P4 comparison tool pre-filled.
   > Cut (B131(b)), per §10 — risk 3's cut order is "P6-S9 → P6-S7 → …" and the global cut line drops "Weapon Detail v2". Weapon pages stay v1 (stats, acquisition, provenance, Unknown markers) with Compare, Test in Weapon Lab and What Should I Grind For?.

**P6-S8 "Guides v1: Pre-Hardmode Path (5 topics)"**
1. New world, exploring safely, better equipment, armor/defense, and first-boss-prep guides exist with tips, checklists, and item links into the database.
2. Every linked item resolves to a real detail page.
3. Checklists are interactive and persist locally.

**P6-S9 "Guides v2: Hardmode Path (5 topics)"**
Same criteria for: damage classes, arena building, entering Hardmode, key resources, path to the final boss; optional advanced sections collapsible.
   > Cut (B131(b)), per §10 — risk 3 cuts P6-S9 first and the global cut line drops "Guides v2". The 5 pre-Hardmode guides (P6-S8) ship.

### P7 — Extras, Polish, Verification (each extra ships only if genuinely working)

**P7-S1 "Favorites & Collections"** — star any entity anywhere; favorites page persists locally; unfavorite updates everywhere immediately.
**P7-S2 "Build Export/Import"** — export a saved build to a readable text format; importing it on a fresh browser reproduces the build exactly; malformed input shows a friendly error.
**P7-S3 "Saved Characters (multiple local profiles)"** — switch profiles; each keeps its own stage/defeats/builds/checklists; explicitly *not* a unified playthrough tracker.
**P7-S4 "Quick Compare vs Equipped"** — from any weapon page, compare against the active loadout's weapon in one click.
**P7-S5 "Random Challenge Generator"** — generates challenges referencing only real, stage-legal items; reroll works; zero invented items.
> Cut (B131(b)), per §10 — P7 extras are the first thing the global cut line drops: **P7-S3** (also "drops first if contested", §11 — adjacent to the all-in-one-tracker exclusion), **P7-S4** (a weapon page's "Compare" opens `/compare` with that weapon; builds compare in Step 4) and **P7-S5** (also adjacent to the owner's explicit exclusions). P7-S1 and P7-S2 (+ P7-S2b, B123(a)) ship. B131(c): B127's "P7-S4" (licensing) and B128's "P7-S3" (the cross-browser sweep) are session labels, distinct from these PRD slices.
**P7-S6 "Polish & Hardening Pass"** — responsive audit of all routes at 3 breakpoints; every data view has loading/empty/error states; large-list performance verified; all estimate labels audited present.
**P7-S7 "Release Gate & Honest Final Report"** — run instructions verified from clean checkout; working-feature list matches reality (spot-audited); gap report lists every known missing/unknown datum and unimplemented item; zero dead major buttons site-wide.

## 8. Data-Dependency Callouts

| Consumer slice(s) | Blocked on | Minimal dataset needed |
|---|---|---|
| P2-S3/S4/S5, P3-S1/S2, P4-S1 | P2-S2 | Weapons: core stats, class, stage, rarity, sprite, acquisition summary, source link |
| P3-S1–S13 (per archetype) | P2-S2 + archetype params | Per-archetype behavior params only; archetype slices can ship as params land per class — full corpus not required up front |
| P3-S14, P4-S2/S3/S4, P5-S6/S7 | Armor/accessory/buff/ammo datasets | Stat effects, class/stage tags, acquisition + gating boss per item |
| P5-S1–S5 | P2-S6 | Boss records + typed progression edges; S2/S3 additionally need summon/drops/patterns detail |
| P5-S6/S7 (Feature A) | P2-S2 + P2-S6 + armor/accessory data | Boss attack-pattern tags + player loadout entities + stage-gating fields |
| P6-S1/S2/S3 | Respective category datasets | Full category corpus w/ effects + acquisition |
| P6-S4/S5/S6 (trees + Feature B) | Recipes dataset | Recipes w/ exact quantities, stations, alternative recipes; drop sources w/ verified rates; biome/event conditions |
| P6-S8/S9 (guides) | None hard | Only working links into whatever datasets exist |

**Sequencing implication:** P2-S2 (weapons) is the single critical-path dataset — it unblocks the entire MVP. Recipes and the full item corpus (heaviest datasets) are only needed by P6 and must not delay P3–P5.

## 9. Feature A + B Acceptance Criteria (integration-rule enforcement)

**Feature A — Boss Readiness Checker (binding, in addition to P5-S6/S7):**
1. **Real database links:** every item in the loadout input is selected from the live database (same search index); every item and boss named in the analysis is a working link to its detail page; no hardcoded or random stats anywhere.
2. **Honest progression gating:** analysis and "Improve My Build" never present a gated item as available; gated suggestions are separated and labeled with the exact prerequisite boss, reflecting the user's actual tracked defeats from P5-S4.
3. **Labeled estimates, no outcome claims:** every numeric output carries an "estimate" label with assumptions; copy review confirms zero instances of predicted fight outcomes, win chances, or "you will beat/lose" phrasing — only factor explanations.
4. **Local persistence:** boss choice, loadout, and last analysis survive reload and browser restart; clearing is an explicit user action.
5. **Integration, not a demo page:** reachable from boss pages, the progression map, and the loadout builder ("check readiness"); works for all classes, both world evils, and all three difficulties.
> Amended (B94–B97): AC2 — the ANALYSIS counts every item in the user's loadout whatever its derived gating (ownership is ground truth), and says the gate in an info line; "never present a gated item as available" binds the Improve suggestions, which never include one (B94(1); SCORING_SPEC §6). "Tracked defeats" are counted with the map's semantics: under "Both", a mark of either evil boss counts (B96(a), B97). AC4: a stage change keeps the analysis current (stage is context only, B97(b)). AC5: /readiness also has its own desktop nav entry (B96(b); UX_SPEC §2).

**Feature B — Item Acquisition Planner (binding, in addition to P6-S5/S6):**
1. **Real database links:** plans are generated from the live recipes/drops datasets; every ingredient, enemy, boss, station, and biome in a plan links to its database page; the recursive tree is the same data as the P6-S4 crafting tree viewer.
2. **Honest progression gating:** "obtainable now" status is computed from the user's stated stage + tracked boss defeats; boss prerequisites are explicit plan steps; no step hides a world-condition or event requirement.
3. **Labeled estimates / verified rates:** drop rates display only verified values with provenance, otherwise "Unknown"; any time/effort estimate is labeled as an estimate; alternative methods are compared with stated tradeoffs, never a bare "best".
4. **Local persistence:** plans, owned quantities, and check-off state persist across sessions; multiple plans coexist; deleting a plan requires confirmation.
5. **Integration, not a demo page:** reachable from every item detail page ("What Should I Grind For?"), from Feature A's "Show Me How to Get It", and from loadout builder gated-item badges.
> Amended (B117–B119): AC2 is applied verbatim — "obtainable now" = stated stage + tracked defeats, the builder's semantics (with no stage, tracked only); the plan states this basis and its difference from Feature A in a "based on" note (SCORING_SPEC §2.4). Per-way availability is conservative: a vendor/chest/fishing/wiki-described way among several, or an "Any X" group with divergent cheapest gates, is Unknown — never "obtainable now" (B119; SCORING_SPEC §2.5). AC3: "Compare routes" states each way's gates; no "easier" claims without data (B117). AC5: Feature A's "Show Me How to Get It" opens the planner for single items (B117). /plan has its own desktop nav entry (UX_SPEC §2).

## 10. Top 5 Scope Risks + Cut-Line Recommendation

1. **Weapon Lab fidelity explosion** (most likely killer). Mitigation: archetype+params system and the P3-S13 coverage gate with limitation cards. **Cut first within P3:** custom scenarios → limitation cards; then P3-S14, P3-S12, P3-S8. Core four archetypes + stats engine are foundation and never cut.
2. **1.4.5.x data completeness and licensing.** The update is new (Jan 2026, "Bigger & Boulder", final update); wiki coverage of new content may lag, and CC BY-NC-SA constrains asset use. Mitigation: pin exact patch at P0, verified-or-Unknown policy, gap report. **Cut:** new-1.4.5 items ship as Unknown-marked records rather than delaying the dataset; original pixel substitutes where sprites can't be used.
3. **Content-authoring volume** (17+ boss pages, 10 guides, per-weapon guidance prose). Mitigation: data-driven page templates; prose is additive. **Cut order:** P6-S9 → P6-S7 → P6-S8 → reduce P5-S3 hardmode boss pages to data-only minimal form (never remove the pages).
4. **Feature A/B correctness of gating logic.** Wrong "obtainable now" verdicts destroy trust. Mitigation: progression dependencies encoded as data and tested against wiki. **Cut:** P5-S7 and P6-S6 advanced grouping drop before the core analyzers (P5-S6, P6-S5); if an item's gating can't be verified, it's labeled Unknown rather than guessed.
5. **Loadout Builder recommendation quality.** Mitigation: transparent scoring, no "best" claims. **Cut:** P4-S4 → P4-S3 reduced to gating badges only → keep P4-S2 as the minimum.

**Global cut line (drop top-down; foundation at bottom is never cut):**
P7 extras (S1–S5) → Guides v2 → Weapon Detail v2 → Feature B checklist advanced (P6-S6 grouping/multi-plan) → Loadout Step 4 → Readiness v2 (P5-S7) → Guides v1 → Encyclopedia breadth (P6-S3 reduced to materials+potions+ammo) → Loadout Step 3 → Lab equip-context/dummy-roster-v2/homing → **[FLOOR: Homepage + search/data + Weapon Lab core + boss map/pages/tracking + Feature A v1 + Feature B v1 + comparison + builder Steps 1–2 — and if even that is too large, the §14 foundation four alone.]**

> **As cut at release (B131(a)/(b), 2026-10-15 — cuts taken from the top of this line and from the per-risk cut orders above; the FLOOR ships whole):**
> - **P7 extras:** P7-S3 saved characters, P7-S4 quick compare vs equipped, P7-S5 random challenge generator — CUT (first on the line; P7-S3 also "drops first if contested", §11; P7-S5 also adjacent to the owner's explicit exclusions). P7-S1 favorites and P7-S2 export/import (+ P7-S2b) SHIP.
> - **Guides v2:** P6-S9 — CUT (risk 3's first cut). Guides v1 (P6-S8, 5 pre-Hardmode guides) SHIP.
> - **Weapon Detail v2:** P6-S7 — CUT (risk 3's second cut). Weapon detail v1 SHIPS.
> - **Lab equip-context:** P3-S14 — CUT (risk 1). Dummy roster v2 (P3-S12) and the homing layer (P3-S8, switch disabled with its reason — B116) SHIP.
> - **Custom scenarios → limitation cards** (risk 1's first P3 cut): APPLIED — 0 custom scenarios; P3-S13 AC2 retired (B131(a)).
> - Everything else on the line SHIPS (P6-S6 advanced checklist, Loadout Steps 3–4, Readiness v2, full encyclopedia breadth). **P6-S1/S2 armor & accessory databases are BUILT, not cut** (the owner spec promises them); **P6-S4** is met by the planner's tree in the plan preview (B131(b)). docs/RELEASE.md §3 lists the cuts with what ships instead.

## 11. Assumptions (explicit)

- Game version pins to the latest stable 1.4.5.x as verified on terraria.wiki.gg at P0 freeze; user-stated 1.4.5.8 is plausible but was not independently confirmable today (sources confirm the 1.4.5 line with patches through at least 1.4.5.6 by March 2026).
- terraria.wiki.gg remains the sole provenance source; its CC BY-NC-SA licensing is compatible with a non-commercial fan tool with attribution (architect to confirm at P0).
- "Saved characters" (P7-S3) as isolated local profiles does not violate the all-in-one-playthrough-tracker exclusion; it ships only in P7 and drops first if contested.
- One "focused work session" sizing assumes the data pipeline (P2, architect-owned) delivers datasets incrementally per §8.

## 12. Open Questions (non-blocking)

1. **Exact patch pin:** confirm whether 1.4.5.8 is current at P0 freeze, and the policy if a new hotfix lands mid-build (freeze vs. track).
2. **Sprite/asset licensing decision:** wiki sprites under CC BY-NC-SA vs. original pixel substitutes — affects P1-S2, P2-S2, and P3 arena art scope.
3. **Event depth in the progression map:** full nodes with pages vs. milestone markers only. Recommendation: milestone markers in v1.

## 13. Verification Targets

Each slice's ACs are its verification checklist, plus: P3-S13 coverage report, P7-S6 audit, P7-S7 release gate. Required artifacts: this PRD, the dataset gap report (P2-S2), Lab coverage report (P3-S13), final honest report (P7-S7).
> Amended (B115, B116): the P3-S13 coverage gate runs at build time (`pipeline:build` / `pipeline:validate`, DATA_SCHEMA_SPEC §6) with the gap report's lab-coverage counts; the separate coverage-report PAGE is retired (B122 Q2), so the "Lab coverage report" artifact is the gate plus `gaps.json` / pipeline/reports/gap-report.md. The P7-S7 final honest report is [RELEASE.md](./RELEASE.md) (B132), with the review ledger as its appendix (B131(d)).


> **Amended (B134):** P6-S1/S2 shipped as built per B131(b) — set-grouped armor browse/detail with compare and stage-peers; accessory browse/detail with combination trees. P4-S2 AC3's wiki-link exception for armor/accessories has EXPIRED (links in-app). P6-S4's crafting-tree AC is satisfied by the plan preview's full read-only recursive tree (test-pinned, planPreview.test.ts).
