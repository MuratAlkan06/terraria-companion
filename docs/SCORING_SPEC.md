# SCORING_SPEC.md — Loadout Recommendation, Goal Scoring, Readiness Factors

Status: ACCEPTED (AMENDMENTS-014 resolves its open questions) · Satisfies AMENDMENTS-001 A9 · Game version 1.4.5.8 · Dataset evidence: `src/data` generated 2026-10-13 · Authored by database-api-designer agent.

Consumers: P4-S2/S3/S4 (Loadout Builder Steps 2–4), P5-S6/S7 (Feature A), P5-S5 (shares EffectiveProgress). Binding inputs: PRD §7 + §9, UX_SPEC §3.5/§3.8/§8, DATA_SCHEMA_SPEC §2/§4a/§8a, AMENDMENTS-004 B14/B17, AMENDMENTS-010 B48, AMENDMENTS-011 B50/B52/B54, AMENDMENTS-013 B63/B64, AMENDMENTS-014 B68–B71 (rulings).

## 1. Design principles (binding)

1. **Transparent and decomposable.** Every rendered score decomposes into named components, each with its exact formula string, raw inputs, unit, weight, and weighted contribution, rendered by ScoreBreakdown. No number appears whose derivation cannot be shown in one disclosure.
2. **Data-driven, sim-independent.** All scoring reads verified record fields through getField. Scoring NEVER consumes the Lab engine or its outputs (est. DPS exists for only 96/488 weapons; mixing it in would punish unsimulated weapons). One uniform proxy (§2.2) ranks all weapons. Lab figures may be linked as evidence, never summed into a score (B69/Q7).
3. **Unknown is excluded and disclosed — never defaulted.** An unverified/absent required input removes that input (or component, or candidate) and increments a visible disclosure ("scored from 4 of 6 factors — 2 unknown"), unknowns named per UX §5.3. Never 0, never an average, never a substituted difficulty.
4. **Unknown gating is never obtainable.** isObtainableNow "unknown" NEVER counts as obtainable. Today dominant: gating derivable for 47/488 weapons, 23/352 accessories, 6/256 armor pieces (2/67 sets), 2/79 ammo — 1,097 gating-underived gaps. Algorithms under-recommend honestly (designed empty slots with counts), never leak.
5. **No cross-goal composite, no universal "best".** Scores exist per goal; composites only in ≥2-build comparisons, normalized relative to the compared set. Copy audit (§8.4) bans "best" and outcome words.
6. **No fight-outcome predictions.** Readiness output is factor explanations only; ReadinessFactorCard/ScoreBreakdown structurally lack verdict/probability props; no factor-level grades — factors emit tagged lines (easier | harder | info | unknown); the SummaryCard's two columns are exactly the easier/harder unions.
7. **Editorial weights are versioned constants** in `src/scoring/constants.ts`, frozen `as const`, under SCORING_CONSTANTS_VERSION; changes bump the version, re-pin goldens, add a changelog entry (B38 discipline).
8. **Deterministic.** Same inputs (+seed for Surprise Me) ⇒ identical output; all tie-breaks end in a total order (§4.6).

## 2. Shared primitives

### 2.1 Entities consumed (no new emitted entities)
Weapon (488; gatedBy on 47) · ArmorSet.variants→ArmorPiece (set-bonus-aware only, never naive piece sums) · Accessory (352; wingStats optional) · Item ammo (79) · Item potion + Buff (NOT yet emitted — B70 gap) · Boss (18; statsByDifficulty, attackPatternTags editorial; contactDamage verified ~1 boss) · ProgressionNode/Edge (28/35; required-gate DAG) · tc.v1.* persistence (null = deliberate empty slot).

### 2.2 Damage-potential proxy DPP(weapon, ammo?) — the sim-free ranking stat
Required (via getField; any one unverified ⇒ weapon not scoreable): damageClass, damage, useTimeTicks, useAnimationTicks, plus critPct for melee/ranged/magic (NOT required for summon per B17/B64; "other" crit Unknown ⇒ crit factor excluded + disclosed). Optional (absent = default, unverified = blocks): autoReuse (false), reuseDelayTicks (0), ammoClass.

```
cadenceTicks      = useAnimationTicks − (1 if melee && autoReuse) + (reuseDelayTicks ?? 0)   // B14 + autoswing + B48(a)
activationsPerUse = ceil(useAnimationTicks / useTimeTicks)  if ranged/magic and useTimeTicks < useAnimationTicks, else 1
hitsPerSec        = activationsPerUse × 60 / cadenceTicks
perHit            = damage + (ammo.ammoStats.damage if ammoClass and ammo in context, else 0)
critFactor        = 1 + (4 + critPct)/100    // BASE_CRIT_PCT = 4 labeled (B17); = 1 for summon and "other"
DPP               = perHit × hitsPerSec × critFactor   // unrounded, labeled "est."
```
Assumptions string (verbatim in every DPP-derived AssumptionsTip): "Single target, point-blank, target defense 0, no damage variance, no reforge modifiers, one hit per melee swing, projectile/DoT side effects not counted, held-attack rate." When ammoClass present but no ammo in context: append "scored without ammo — no ammo with verified availability". DoT, projectile multipliers, pierce, kind:"special" are NOT in DPP v1; real uncounted effects are named in the rationale. Scoring never reads labBehavior.

### 2.3 StatEffect point conversions (STAT_POINTS, editorial constants v1)
Scope rule: an effect counts for class C iff scope absent or scope===C. Mana kinds = magic-scoped; melee-speed-pct = melee-scoped; minion/sentry/whip kinds = summon-scoped. B17: crit-pct contributes 0 for summon.

| StatKind | Off | Def | Mob | Surv | Rationale |
|---|---|---|---|---|---|
| damage-pct | 1/% | | | | anchor |
| damage-flat | 2/pt | | | | strong at low base |
| crit-pct | 1/% | | | | ≈1% expected dmg per 1% |
| melee-/attack-speed-pct | 1/% | | | | ranking only; EDO applies multiplicatively (no double count) |
| defense-flat | | 1/pt | | 1/pt | anchor |
| damage-reduction-pct | | 2/% | | 2/% | multiplicative w/ defense |
| move-speed-pct | | | 1/% | | anchor |
| jump-boost | | | 0 excluded | | units unverified (B69/Q8) |
| flight-time-ticks (max of effect & wingStats, disclosed) | | | 0.1/tick | | 1s ≈ 6 pts |
| life-regen | | | | 2/pt | |
| max-life-flat | | | | 0.25/pt | base HP untracked |
| max-mana-flat (magic) | 0.1/pt | | | | |
| mana-cost-pct (magic) | 1/% reduction | | | | |
| mana-regen (magic) | 1/pt | | | | |
| minion-slots (summon) | 20/slot | | | | |
| whip-range-pct (summon) | 0.5/% | | | | |
| sentry-slots (summon) | 10/slot | | | | |
| mining-speed-pct, aggro-flat, knockback | 0 (listed uncounted) | | | | v1 abstains |
| kind:"special" | 0; hasSpecial=true feeds ranking; text always listed | | | | real, unmodeled |

B54's 11 pre-approved kinds get rows when first emitted (e.g. ammo-save-pct → Off 0.5/% ranged; armor-penetration-flat → Off 1/pt), bumping the constants version.

### 2.4 EffectiveProgress and gating evaluation
```
EffectiveProgress(progress, stage, worldEvil) = trackedDefeated ∪ VirtualDefeats(stage, worldEvil)
VirtualDefeats(S, evil) = { n | STAGE_ORDER[n.stage] < STAGE_ORDER[S] ∧ n is a required-gate ancestor of ≥1 node with stage ≥ S }
```
Required-gate DAG only. Optional bosses are never ancestors ⇒ never assumed defeated by stage (under-recommend). World evil: EoW/BoC satisfied only by tracked defeat of the node matching worldEvil (null ⇒ neither; conservative — B69/Q6). Milestone/event gate slugs satisfied iff all required-gate predecessors satisfied (recursive, memoized).
**Scope split (binding):** Builder uses tracked ∪ virtual (stage = user hypothesis, P4-S2 AC4). Feature A improvement gating uses tracked defeats ONLY (Feature A AC2) — intentional divergence (B69/Q9).
**Non-node conditions** (biome/event/time, no satisfiedByNode): never flip status to "gated"; ALWAYS returned in missing.conditions and rendered as requirement chips ("requires: Blood Moon") — never silently satisfied (B69/Q4).

## 3. Candidate filtering (shared: recommendation, Surprise Me, improvements)
An item enters a slot pool iff ALL:
1. **Availability:** status "yes". "gated" ⇒ GatedSection track (§4.7) with exact missing bosses. "unknown" ⇒ excluded, counted. Owned items: unknown→eligible with "you marked this owned" rationale; gated is NOT upgraded (B69/Q2).
2. **Class eligibility:** weapons damageClass===C (any for hybrid); summon-slot pool = summon weapons tagged minion-summon-items; for C=summon the main pool = whips. Armor variant eligible iff C ∈ (variant.classes ?? [variant.class]); ['other'] eligible for all; hybrid matches every variant (B52 adapter).
3. **Scoreability:** every required proxy field reads verified; failures excluded + counted.
4. **Difficulty legality:** SLOT_COUNT = {classic 5, expert 6, master 7}; demonHeartSlotIndex = {classic none, expert 5, master 6}; that slot labeled "Demon Heart slot" with the assumption chip + WoF GateBadge when wall-of-flesh ∉ EP (B69/Q3; toggle deferred).
**Pool disclosure (always rendered):** per slot: pool size, excluded-unknown, gated, excluded-unverified counts.

## 4. Loadout recommendation (P4-S2)
Inputs `{stage, class C, difficulty D, goal G, targetBossId?, owned[], progress, settings, seed?}` — all optional with defaults (stage from settings else early-prehm; C melee; D classic; G balanced).

4.1 **Main weapon:** rank class pool by DPP desc (ammo weapons scored with best recommendable ammo; none ⇒ weapon-only + disclosure). Rationale: "Highest estimated damage output of the N {class} weapons verified obtainable at your progress (est.)". Empty pool ⇒ designed empty slot with counts.
4.2 **Alt weapon:** next-ranked with different tags[0], else plain next, else empty with reason; hybrid alt must differ in damageClass.
4.3 **Armor (set-bonus-aware):** candidate = (set, class-eligible variant) where helmet+chest+legs all pass §3. ArmorScore = W_def·Σdefense + W_off·offensePts + W_mob·mobilityPts + W_surv·survivabilityPts using the goal's GOAL_WEIGHTS values. Set-bonus specials score 0 but are named. Rendered helmet = the class-eligible variant's.
4.4 **Accessories:** CATEGORY_TEMPLATE(G) quota list truncated/extended to SLOT_COUNT[D]:
boss: off,off,mob,def,off (+off) · max-damage: off×4,mob (+off) · exploration: mob,mob,util,def,off (+mob) · survivability: def,def,mob,off,def (+def) · mobility: mob×3,util,def (+mob) · balanced: off,def,mob,util,off (rotate).
Within category rank by (componentPts desc, hasSpecial desc, gatedBy.bosses.length asc, rarityRank asc, id asc). **Qualification rule:** needs ≥1 class-relevant point OR ≥1 special — zero-benefit items lose to honest empty slots. Constraints: no dupes; ≤1 wings; never co-equip direct combinedFrom/upgradesTo pairs (B53 direct links). Unfillable quota → top any-category candidate (disclosed) → empty with disclosure.
4.5 **Ammo:** pool = ammoStats.ammoClass match passing §3, rank by damage desc then id (today usually empty — honest; B68 derivation obligation). **Buffs:** potion corpus pending (B70) — dataset-gap empty state; when it lands: rank by summed class-relevant points of granted buffs, fill ≤3. **Summon:** top minion staff by damage desc (NOT DPP — cast time ≠ minion rate); rationale notes "attack rate varies by minion AI — not estimated".
4.6 **Tie-break total order:** score desc → gatedBy.bosses.length asc → rarityRank asc (special tiers pinned after 11) → id asc.
4.7 **Gated track + easier alternative (P4-S3 AC3):** gated items that would outrank the pick (top 3/slot) group under "After you defeat {Boss}" with GateBadges; easier alternative = the top status-"yes" candidate of that slot ("Obtainable now: {item}"), else "No verified obtainable alternative at this stage". Never invented.
4.8 **Surprise Me:** seeded mulberry32; uniform draw per slot from the FULL legal pool honoring every constraint; randomness never relaxes legality; deterministic per seed; labeled "randomized from items verified obtainable at your progress".

## 5. Goal scoring (P4-S4)
5.1 **Components:** (1) estDamage: EDO = (perHit × (1+ΣdamagePct(C)/100) + ΣdamageFlat(C)) × hitsPerSec × speedFactor × critFactorTotal, where speedFactor = 1 + (Σattack-speed + Σmelee-speed·[C=melee])/100; critFactorTotal = 1 + (4 + weapon.critPct + Σcrit-pct(C))/100 (summon ⇒ 1). Target-agnostic (defense 0). (2) defense: Σpiece.defense + Σdefense-flat; DR% separate labeled figure, never merged. (3) mobility: points + named uncounted specials. (4) survivability: defense-flat + 2·DR% + 2·life-regen + 0.25·max-life + named specials. (5) classSynergy (absolute 0–100): matched/(matched+mismatched)×100 over numeric points; breakdown itemizes every mismatch; flags: set bonus active, weapon class match, classless note.
5.2 **GOAL_WEIGHTS v1 (rows sum 1.0):** boss .45/.10/.15/.20/.10 · max-damage .70/.05/.05/.10/.10 · exploration .20/.10/.40/.20/.10 · survivability .10/.35/.10/.35/.10 · mobility .10/.10/.55/.15/.10 · balanced .25/.20/.20/.20/.15 (order: estDamage/defense/mobility/survivability/classSynergy).
5.3 **Normalization:** composites only for ≥2 builds; norm_k(b) = 100·raw_k(b)/max over compared (max 0 ⇒ all 0, flagged); classSynergy used absolutely (exempt, documented). Symmetric exclusion: a component uncomputable for ANY build drops for ALL (disclosed). GoalFit = Σ included w·norm / Σ included w; rendered "Goal fit (est.) — relative to the compared builds only". Single build ⇒ components-only.
5.4 **ScoreBreakdown props:** { goal, constantsVersion, composite?{value, basis:"relative-to-compared"}, components[{id,label,raw,unit,normalized?,basis,weight,contribution,formulaText,uncounted[],unknownInputs[]}], exclusions[], assumptions[] } — structurally no verdict slot; every numeric has EstimateLabel + populated AssumptionsTip; footer "weights v{N} — editorial constants".

## 6. Readiness factors (P5-S6/S7)
Loadout possession is asserted (gating never blocks analysis, only suggestions). All boss reads use statsByDifficulty[selected] — no cross-difficulty substitution ever; missing values remove the comparison + disclose. Factor shape: { id, title, lines[{tone: easier|harder|info|unknown, text, evidence: TypedRef[]}], computedFrom{used,total,unknownInputs[]} }. SummaryCard columns = union of easier/harder lines. No totals, grades, or outcome sentences.
**F1 Damage fit:** effPerHit = max(1, ⌊perHitWithPct − bossDefense/2⌋), then crit (variance not applied, disclosed); estDps = effPerHit × hitsPerSec × speedFactor × critFactorTotal. Template: "Your {weapon} is estimated at {estDps}/s (est.) after {boss}'s {def} defense. Sustained for a full minute that totals ~{60×estDps}; {boss} has {hp} HP on {difficulty}." — juxtaposition only; "time to defeat" banned. Unknown defense ⇒ computed at 0 + disclosed; unknown hp ⇒ line omitted. Uncounted real effects listed as info w/ provenance.
**F2 Defense/survivability:** equipment-only disclosure ("your max life isn't tracked"); blocked = defenseTotal × PLAYER_DEFENSE_FACTOR{classic .5, expert .75, master 1.0} (TO-VERIFY vs wiki Defense page at implementation). Unknown contact damage (the norm) ⇒ "isn't verified for 1.4.5.8 yet — this factor uses your defense inputs only."
**F3 Mobility vs patterns:** TAG_NEEDS editorial map (each line cites the boss page; all lines carry the editorial label): charges|dashes→burst-dodge (dash or move ≥ MOVE_SPEED_HELPS_PCT 10); flies→flight ≥ FLIGHT_HELPS_TICKS 100; projectile-spam|homing→repositioning; ground-bound→platform info; burrows→open-ground; teleports→reaction; despawn-leash→positioning; enrage-mechanic→generic sourced line (specifics only from verified strategies); multi-phase→endurance; summons-adds→crowd (xref F1); inflicts-debuffs→xref F5; high-contact-damage→xref F2. One line per present tag, toned by whether the loadout meets the need.
**F4 Synergy:** mismatched-scope waste (harder); set bonus active/inactive with missing piece named; weapon-class match; interacting specials named uncounted; upgradesTo mentions only.
**F5 Preparation:** ammo compatibility (harder if missing); buff items (today: "potion data isn't in the dataset yet"); summon slot; boss summon requirements w/ provenance; prepChecklist if verified else Unknown. Disclosure counts inputs used/total.
**Improve My Build (P5-S7):** pools per §3 with EP = tracked only. A suggestion must strictly improve its targeted component vs the item replaced. Partition: obtainable-now; GatedSection by exact missing boss. **Target-boss cap:** items gated by the target boss or any required-gate descendant are omitted entirely (mirrors E_SUGGESTION_GATING). Every suggestion links detail + "Show Me How to Get It".

## 7. Module contracts (src/scoring/ — pure TS, boundary-tested)
constants.ts (all editorial constants as const + version) · progress.ts (effectiveProgress, isNodeSatisfied) · proxies.ts (damagePotential, componentPoints) · candidates.ts (buildPools + PoolDisclosure) · recommend.ts (recommendLoadout, surpriseLoadout) · goals.ts (scoreLoadout, compareLoadouts) · readiness.ts (analyzeReadiness, improveSuggestions) · index.ts barrel.
Shapes: RecommendationResult { slots{ [slot]: Recommended|EmptySlot }, gated: GatedGroup[], disclosures, assumptions[], seed? }; Recommended { itemId, score, rationale, formulaText, uncounted[], requirementChips[] }; EmptySlot { reason, counts{gated,unknown,unverified} }; GoalComparison { goal, constantsVersion, perBuild: ScoreBreakdownProps[], droppedComponents[] }; ReadinessAnalysis { factors[5], summary{easier,harder}, computedFrom }.
Errors (degrade, never throw on data): empty pool ⇒ EmptySlot; invalid ctx refs ⇒ InvalidContextError (dev); persisted id absent from dataset ⇒ per-slot {status:"missing-from-dataset", ref}; <2 builds ⇒ components-only; no boss ⇒ {error:"no-boss"}; missing difficulty stats ⇒ per-factor disclosure; no tracked defeats ⇒ possibly-empty obtainable list + explicit explanation + tracking nudge; ChunkLoadError/NotFoundError propagate to route ErrorState.
Runtime indexes (extend getIndexes, never emitted): weaponsByClass, accessoriesByCategory, setsByVariantClass, ammoByClass, requiredGateAncestors, satisfiedNodeCache.
Lifecycle: readiness fresh → out-of-date (any input edit; stale visible + dimmed per UX §6) → re-analyzed (atomic). No new storage domains, no schema changes. Constants v{N}→v{N+1} only with changelog + golden re-pin.

## 8. Versioning, tests, copy audit
1. **Golden tests** pin the §9 worked examples end-to-end against checked-in fixtures (records copied from src/data; data slices update fixtures deliberately per the count-pin pattern).
2. **Property tests:** recommended/suggested items always status "yes" (fuzzed); gated only in correctly-keyed GatedSections; determinism; GOAL_WEIGHTS rows sum 1.0; every component has formulaText + assumptions; VirtualDefeats graph property; accessory constraints hold.
3. **Boundary test:** src/scoring imports nothing from src/sim, src/lab, React, or DOM.
4. **Copy audit (CI):** scoring/readiness strings in copy modules (no inline user-visible literals); banned patterns over modules AND rendered golden output: \bbest\b, win/lose/odds/probability, outcome-chance collocations, "you will/won't beat|defeat|kill|survive|die", time-to-kill/TTK, guarantee. Exemptions: the PRD "After you defeat {X}" template + defeat-tracking UI terms. "crit chance"/"drop chance" remain legal.
5. **Constants discipline:** SCORING_CONSTANTS_VERSION = 1; changes bump + re-pin + changelog (B38).

## 9. Worked examples (values verified from src/data, snapshot 2026-10-13)

### 9.1 Early-Hardmode ranged recommendation (expert, goal boss; tracked: wall-of-flesh, queen-slime)
EP = {wall-of-flesh, hardmode, queen-slime}. **Main: Clockwork Assault Rifle (434)** — only status-"yes" ranged weapon. Cadence 12+14=26; activations ⌈12/4⌉=3; hits/s 6.92; DPP = 17 × 6.92 × 1.04 = **122.4 (est., scored without ammo)**. **Alt:** empty (honest). **Armor: Crystal Assassin set** (classless variant; def 36; +10% dmg +10% crit stats; dash special named uncounted). Hallowed NOT recommendable (gating unknown); Ninja ⇒ gated track. **Accessories (6 slots):** "yes" pool = 5/352; qualification admits Ranger Emblem (15 offense pts) + Volatile Gelatin (special); other emblems excluded (zero relevant verified benefit); slots 3–6 honest empty with counts. **Ammo:** empty (all compatible ammo gating-unknown — B68). **Buffs:** empty (B70). **Summon: Blade Staff** ("attack rate varies by minion AI — not estimated"). Components: estDamage = 17×1.30×6.92×1.19 = **182.1/s (est.)**; defense **36**; mobility **20 pts** + dash uncounted; survivability **36**; classSynergy 65/(65+20) = **76/100** with both mismatches itemized.

### 9.2 Readiness — melee vs Plantera (expert, mid-hm; tracked: WoF + 3 mechs)
Loadout: Death Sickle, Hallowed Mask/Plate/Greaves, Warrior Emblem, Lightning Boots, Leaf Wings. Plantera expert **42000 hp / 36 def**, contactDamage unverified all difficulties; tags enrage-mechanic, inflicts-debuffs, multi-phase, projectile-spam (editorial).
F1 (5/5 inputs): cadence 24, hits/s 2.5 → 2.75 w/ +10% melee speed; dmg% +32; crit ×1.21; effPerHit ⌊57×1.32−18⌋ = 57; estDps **189.7/s (est.)**; info lines incl. "~11,380 per minute; Plantera has 42,000 HP on Expert" and the uncounted verified sickle projectile. F2 (1/2): defense 50; contact-damage unknown line; "blocks an estimated 38 per hit on Expert (50 × 0.75)". F3: projectile-spam → easier (move +16%, 2.7s flight); multi-phase → info; enrage → harder generic sourced; inflicts-debuffs → xref F5. F4: Hallowed set bonus active (named, not scored); synergy 100/100. F5 (2/5): no buffs (harder); potions dataset gap; summon requirements rendered w/ provenance; prepChecklist Unknown. Improve (tracked-only): thin obtainable-now honestly; gated groups Queen Slime / Duke Fishron; Plantera- and Golem-gated items omitted entirely (target-boss cap).

## 10. Rulings
Resolved by AMENDMENTS-014 (B68–B71). Remaining implementation flags: PLAYER_DEFENSE_FACTOR wiki verification; B52 classes[] must land before P4-S2 (B70 slice); rarityRank pinned order.

## 11. Migration risks
B52 landing changes 10 hybrid sets' eligibility/synergy ⇒ golden re-pin. B54 StatKinds landing flips specials→stats ⇒ constants bump + re-pin. Gating-coverage growth changes pools ⇒ fixture updates via the count-pin pattern; empty-slot paths stay first-class. Potion corpus fills buffs + F5 with no schema change. No persistence migrations. Determinism hazard: special-rarity rank must be pinned.
