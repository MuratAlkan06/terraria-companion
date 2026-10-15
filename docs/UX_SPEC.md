# UX FLOW SPECIFICATION — Terraria Companion Website

> **AMENDED BY [AMENDMENTS-001.md](./AMENDMENTS-001.md) (binding — read together).**
> **B58 parity sweep (AMENDMENTS-016 B121, 2026-10-15):** rulings from AMENDMENTS-015 (B85+) and AMENDMENTS-016 are consolidated inline with B-numbers and an "Amendment history" line per changed section. The amendments chain stays binding and wins on any conflict. Export/import as built (P7-S2 backup, P7-S2b per-build text — AMENDMENTS-016 B123): §1, §2, §3.1, §4(f), §5.6.

Status: Draft for P0 freeze · 2026-10-12 · Authored by ux-ui-flow agent.
Sources: docs/REQUIREMENTS.md (§11 binding), docs/PRD.md, docs/ADR-001.md.

Reconciliation note: brand values follow REQUIREMENTS §11 (forest green / deep blue / earth brown / stone gray / warm gold) and ADR D4 fonts (Press Start 2P accents, Inter body). Adopted structural/quality tokens: semantic role names (--color-destructive, --color-border, --color-ring), funnel/progressive-disclosure, zero-radius sharp-edge geometry (suits pixel art), WCAG targets, breakpoints 375/768/1024/1440, anti-patterns (no emoji icons; cursor-pointer; 150–300ms transitions; reduced-motion).

---

## 1. Route Map

SPA routes under React Router v7. **Eager bundle:** shell + `/` only. **Every other top-level section is a `React.lazy` chunk** (ADR D7). The Lab chunk contains PixiJS (≤500 KB gz) and must never be imported outside `/lab`.

| Path | Purpose | Ships in | Lazy chunk |
|---|---|---|---|
| `/` | Homepage: hero, omnibox, stage selector, featured, recents, saved builds | P1-S2 → P2-S5 | eager (shell) |
| `/weapons` | Virtualized weapon list + FilterBar (class/stage/rarity) | P2-S3 | `chunk-db` |
| `/weapons/:id` | Weapon detail v1 → v2 | P2-S3 → P6-S7 | `chunk-db` |
| `/lab` | Weapon Lab. Query: `?weapon=:id`, `?target=` (queued — not shipped yet; not S12-gated, B100), `?test=10\|30` | P3-S1…S14 | `chunk-lab` (PixiJS inside) |
| `/lab/coverage` | Lab coverage report: simulated/custom/limitation counts, unhandled=0. **Not shipped:** P3-S13 closed as a build-time gate (B115/B116); neither ruling addresses this page — open question in B121 | P3-S13 | `chunk-lab-coverage` (no PixiJS) |
| `/compare` | 2–3 weapon comparison (COMPARE_MAX 3, B99(a)). URL state: `?w=4956,757,1308`; invalid ids dropped after a one-time notice (B101(d)) | P4-S1 | `chunk-compare` |
| `/loadout` | 4-step wizard. `?step=1..4`; `?build=:localId` to edit. The draft lives in the URL: inputs (`stage`, `class`, `difficulty`, `goal`, `boss`, `owned`), slot pins, `surprise=<seed>` (B111 R2), `vs=<buildId>` (Step 4 comparison), `view=builds` (saved-builds list) | P4-S2…S4 | `chunk-loadout` |
| `/builds` | Saved builds list, export/import. Ships as a redirect to `/loadout?view=builds` (the list is a builder sub-view; B111 R5). As built (B123(a)): every saved build has Export (its readable text + `#code:` line); the list has "Import a build" (paste → preview → saved as a new build); Step 4 exports the loadout as it stands | P4-S4 → P7-S2b | eager redirect → `chunk-loadout` |
| `/bosses` | Boss node map + legend. `?recommend=1` opens recommender panel | P5-S1, P5-S5 | `chunk-bosses` |
| `/bosses/:id` | Boss page | P5-S2/S3 | `chunk-bosses` |
| `/readiness` | Feature A. `?boss=:id&class=&difficulty=` prefill | P5-S6/S7 | `chunk-readiness` |
| `/armor`, `/armor/:id` | Armor sets + set-bonus-aware compare | P6-S1 | `chunk-db` |
| `/accessories`, `/accessories/:id` | Accessories + tinkering trees | P6-S2 | `chunk-db` |
| `/items` | Encyclopedia hub (category tiles) + every Item record, filterable `?category=&stage=&q=` (B112) | P6-S3 | `chunk-db` |
| `/items/:id` | Item page; "Crafting tree" tab; "What Should I Grind For?" CTA. Hash anchors (e.g. `#acq-title`) scroll + focus once their async section mounts (B113(c)); a weapon/armor/accessory id is a styled 404 linking `/weapons/:id` where it applies (B113(e) M5) | P6-S3/S4 | `chunk-db` |
| `/plan` | Feature B: plan list (multiple concurrent) | P6-S5/S6 | `chunk-plan` |
| `/plan/new?item=:id` | Plan generation entry ("Make My Plan") | P6-S5 | `chunk-plan` |
| `/plan/:planId` | Plan detail: tree + checklist + owned quantities | P6-S5/S6 | `chunk-plan` |
| `/guides`, `/guides/:slug` | Guide index + pages with interactive checklists | P6-S8/S9 | `chunk-guides` |
| `/favorites` | Starred entities | P7-S1 | `chunk-db` |
| `/settings/data` | "Your data": back up (one JSON file), restore from a backup (preview, then merge / replace / skip per part), each part's contents and size, Clear, and every set-aside copy with its actions. Entry points: the More sheet and the footer — no desktop header entry, the footer serves desktop (B123(g)) | P7-S2 | own lazy chunk (`DataPage`) |
| `/about/licensing` | CC BY-NC-SA attribution, Re-Logic notice, provenance (ADR D3) | P1-S1 | `chunk-about` |
| `*` | Styled 404: PixelPanel, "lost in the caverns" art, link home + omnibox | P1-S1 | eager (tiny) |

**Nav visibility rule (P1-S1 AC2):** nav config is data-driven; a route appears only after its slice ships. No disabled nav items, ever.

_Amendment history (B121 sweep): B99(a), B100 (`?target=` queued), B101(d), B111 R2/R5, B112, B113(c)/(e); `/lab/coverage` status recorded (B115/B116 — question open). B123(a)/(g): `/builds` export/import as built; `/settings/data` added._

## 2. App Shell

### Header (desktop ≥1024)
- Left: pixel logo mark + "Terraria Companion" wordmark (Press Start 2P, warm gold). Links `/`.
- Center: **OmniSearch** — Radix combobox over MiniSearch `autoSuggest`. Always mounted in shell (P2-S4 AC4). Placeholder: "Search weapons, bosses, items…". Results grouped by entity type with type badge, rarity-colored names, sprite thumbnails.
- Right: data-driven nav: Weapons · Lab · Loadout · Bosses · Items · Guides. Active link = 2px warm-gold underline (zero-radius).
  As built (route registry, src/app/routes.tsx; B123(h)): Home is NOT among the header links — the logo links home — and the first three links sit inline, matching the tab bar: **Weapons · Lab · Bosses** (resolves the B113 "Bosses in More at 1440" nit). The rest go into the header **"More" menu** at every desktop width (B29/B34): Loadout · Compare · Readiness · Plans · Items · Guides · Builds; the trigger carries the active underline while one of its sections is open. Headline features get their own desktop entry, no detour: **Readiness** (B96(b), B97), **Compare** (B99(b), B101(d)), **Plans** (B96(b)/B99(b) precedent), **Items** (B112), **Builds** (B117 — in the desktop More menu as built). "Your data" has no header entry — the footer serves desktop (B123(g)). Width floor: at 1024 the search keeps 373px beside the widest stage chip (≥ 240px, B29), 348px at 1440 with the wordmark back (measured in Chromium, P7-S2b). Every addition updates the nav.test.ts / siteHeader.test.ts pins.
- `StageSelectorCompact` far right: current stage as a small PixelPanel chip; click opens 5-stage Radix dropdown. Persisted to `tc.v1.settings`.

### Footer (all pages)
- Version pin: "Data: Terraria **1.4.5.8** (Desktop) · generated {meta.generatedAt}" — read from `meta.json` (ADR D1).
- Attribution (ADR D3, verbatim): "Data from the Official Terraria Wiki, CC BY-NC-SA 4.0 — Terraria content © Re-Logic" → links `/about/licensing`.
- Secondary links: Licensing · Lab Coverage Report · Favorites. Non-commercial statement, takedown contact.
  As built (A8 data-driven): Favorites · Your data (`/settings/data`, B123(g)) · Licensing; the coverage report page is retired (B122 Q2).

### Mobile nav — **bottom tab bar** (not hamburger)
`BottomTabBar`, 5 items (icon + label, Lucide, never emoji): **Home · Weapons · Lab · Bosses · More**.
Rationale: one-handed thumb reach while the other hand is on the game; persistent tabs support rapid Home↔Lab↔Bosses ping-ponging; hamburger hides the most-hit destinations. "More" opens a bottom sheet: Loadout, Compare, Readiness, Plans, Items, Guides, Builds, Favorites, About. (As built — "Builds" opens the builder's saved-builds list, B111 R5; "Your data" sits before "About" (P7-S2, B123(g)); "About" is the Licensing page.)
- Mobile header: logo mark · OmniSearch trigger (full-width overlay) · StageSelectorCompact.
- In `/lab`, a **fullscreen toggle** in the HUD hides shell chrome; Esc/back restores. Safe-area insets respected.

_Amendment history (B121 sweep): nav parity — B96(b)/B97 Readiness, B99(b) Compare, B112 Items, B117 Builds (ruled, pending), B113 Bosses-in-More nit. B123(g)/(h): Home out of the header links, Weapons · Lab · Bosses inline, Builds' desktop entry recorded as shipped, Your data in the More sheet + footer._

## 3. Component Hierarchy

### 3.1 Shared lexicon (named once, reused everywhere)

**From ADR D4 kit:** `ItemSlot`, `InventoryGrid`, `TerrariaTooltip`, `PixelPanel`.

**New shared components:**

| Component | Contract |
|---|---|
| `OmniSearch` | Shell-level combobox; grouped typeahead; designed no-results state |
| `StageSelector` / `StageSelectorCompact` | 5-stage picker; writes `tc.v1.settings` |
| `EntityCard` | Sprite + rarity-colored name + type/class badges + stage chip |
| `VirtualList` | Virtualized wrapper (~30 live rows, lazy sprites) |
| `FilterBar` | Combinable facets + active chips + "clear all" |
| `RarityText` | Rarity-tinted name; rarity label in tooltip (color-not-only) |
| `SpriteImg` | `image-rendering: pixelated`, fixed aspect box (no CLS), fallback art |
| `ProvenanceLink` | "Source: terraria.wiki.gg ↗" — required on every data-driven view |
| `UnknownValue` | Renders "Unknown" per §13 (see §5.3) |
| `EstimateLabel` / `AssumptionsTip` / `GateBadge` / `GatedSection` / `LimitationCard` | Honesty affordances (§8) |
| `SimDisclaimerBar` | Permanent Lab disclaimer (§5.5) |
| `SkeletonList` / `SkeletonPanel` | Loading, shimmer, reserved space (CLS <0.1) |
| `EmptyState` / `ErrorState` | Designed empty + error-with-retry; never blank |
| `ConfirmDialog` | Radix; destructive button uses `--color-destructive` (#DC2626) |
| `QuarantineNotice` | ADR D6 corrupted-storage banner (§5.6). As built (P7-S2, B123(c)/(d)): ONE implementation for page notices, the shell's app-wide notice and the data page's — View details · Try restore · Discard permanently |
| `StepWizard` | Numbered steps, back/next, skip, progress |
| `LoadoutSlots` | InventoryGrid+ItemSlot laid out like in-game equip screen |
| `ScoreBreakdown` | "How was this scored?" disclosure w/ explained math |
| `DpsGraph` / `StatReadout` | Rolling graph; labeled live stat tile (tabular numerals) |
| `NodeMap` / `BossNode` / `NodeMapLegend` | Boss progression graph |
| `ReadinessFactorCard` | One analysis factor: title, explanation, evidence links |
| `CraftTreeNode` | Recursive tree node; expand-in-place or open-page (choice persisted) |
| `PlanStepRow` / `OwnedQtyInput` / `ChecklistItem` | Feature B units |
| `SendToLabButton` | Navigates `/lab?weapon=:id`; hidden until P3-S1 ships |
| `BuildExportDialog` / `BuildImportDialog` | Readable text + `#code:` line (ADR D6). As built (P7-S2b, B123(a)): `BuildExportDialog` — read-only text + Copy ("Copied ✓" 2s + a status line; where the browser won't copy, the text is selected and the line says how); the import is an inline "Import a build" panel on the saved-builds list (`BuildImport`), not a dialog |
| `FavoriteStar` | Toggle on any EntityCard/detail header (P7-S1) |

_Amendment history: B123(a)/(c)/(d) — `QuarantineNotice` and `BuildExportDialog` / the build import as built (§3.1 parity rides P7-S2b per B58)._

### 3.2 Homepage `/`
```
HomePage
├─ HeroSection (original pixel-art bg: forest/mountains/crystals/night sky)
│  ├─ Wordmark + tagline
│  ├─ OmniSearch (large hero instance, autofocus desktop only)
│  └─ PrimaryActions: "Build My Loadout" → /loadout · "Test Weapons" → /lab · "What Should I Do Next?" → /bosses?recommend=1
│     (each button exists only once its target ships — absent, not disabled)
├─ StageSelector (full 5-chip row, selected chip gold-bordered; persists)
├─ FeaturedRow: FeaturedWeaponCard + FeaturedBossCard (rotating, real links)
├─ RecentRail (EntityCards; EmptyState: "Nothing viewed yet — try searching Zenith")
└─ SavedBuildsRail (LoadoutSlots mini-previews) — ABSENT when there are no saved builds (B111 R6)
```
**SavedBuildsRail (B111 R6/R7):** with no saved builds the rail is absent, not an EmptyState — the hero's "Build My Loadout" already carries the invite and an empty rail would duplicate it. With builds: newest first, each card's name opens the build in the builder, with its inputs and a preview; ammo/potions are counted in text (the 123 KB gz item list is too heavy for the eager bundle); "All builds" → `/builds`; a quarantined builds key is said in the rail, never silent.

_Amendment history (B121 sweep): B111 R6 rail-absent ruling ("UX §3.2 amended accordingly per B58"); B111 R7 preview._

### 3.3 Weapons `/weapons` + `/weapons/:id`
```
WeaponsListPage: FilterBar + result count → VirtualList of EntityCard → EmptyState / SkeletonList
WeaponDetailPage
├─ DetailHeader: SpriteImg · RarityText · FavoriteStar · class badges
│  └─ ActionRow: SendToLabButton · "Compare" · "What Should I Grind For?" → /plan/new?item=:id
├─ StatsPanel (PixelPanel): damage, crit, use time, knockback, ammo/mana — value or UnknownValue; ProvenanceLink
├─ BehaviorSection: attack/projectile behavior, verified mechanics (each claim sourced)
├─ AcquisitionSection: method, materials (ItemSlots), station, verified drop rate or Unknown; GateBadge; "Crafting tree" link
└─ [P6-S7] GuidanceSection: when-to-use, similar/upgrades, "Compare with stage peers" prefilled
```

### 3.4 Weapon Lab `/lab`
Two strict layers per ADR D5: PixiJS canvas + HTML HUD.

**Desktop (≥1024): three-column stage.**
```
LabPage
├─ SimDisclaimerBar (permanent, top, never dismissible)
├─ LabLayout
│  ├─ LabBrowserPanel (left, 300px, collapsible): search + FilterBar → VirtualList; simulatable vs limitation-flagged rows marked (badge, not color-only)
│  ├─ ArenaRegion (center)
│  │  ├─ PixiCanvas (arena, dummies, projectiles, floating damage numbers)
│  │  └─ HudOverlay (HTML):
│  │     EquippedBar (top-left: sprite, name, base stats — always visible)
│  │     StatReadout cluster (top-right: per-hit, total, hits, atk/s, est. DPS w/ EstimateLabel)
│  │     DpsGraph (bottom strip, toggleable) · ManaBar/AmmoCounter (contextual)
│  │     TimedTestControl (10s/30s, countdown, locks config) · ResetButton (one action: test+target+settings) · FullscreenToggle
│  └─ TargetSettingsPanel (right, 280px, collapsible): target picker (Infinite/Boss-Sized/Moving/Multiple/Armored w/ defense slider/Debuff) · test settings (max mana, labeled "ignore mana (test mode)" toggle, homing on/off, [P3-S14] equip context + not-simulated list)
└─ LimitationCard (replaces interaction area for non-simulated weapons)
```
**Mobile (<768):** canvas full-width (~55vh) top; condensed HUD at canvas corners; DpsGraph behind "Graph" chip; browser + target panels = bottom sheets from a persistent two-button dock ("Weapons", "Target & Settings"); SimDisclaimerBar = one-line sticky strip (still permanent). Attack = touch-and-hold.

**Dummy roster v2 (P3-S12 — B100, B101):** one target at a time (no combined targets in v1 — not PRD-promised). Every value is a player-chosen TEST value, framed as such: Boss-Sized 2/3/4× the dummy (whole multiples keep the pixel art crisp; starts at 3×); Moving 1–16 tiles/s (starts at 4), horizontal 8 tiles away-and-back or vertical 5 tiles up-and-back, motion tick-derived (no accumulation drift — frame-rate-proof); Armored defense 0–100 (starts at 20) — a boss name appears only while the value is that boss's verified first-form defense, with its wiki link (the bosses data loads in parallel; no panel loading state). Armored's tip: "each hit is reduced by half the dummy defense" (B101(c)). Switching target resets the per-target settings (explicit v1 choice, B101(e)); the missed-shots stat counts summon projectiles (honest totals).
**Homing placement (P3-S8 — B116):** no simulable weapon homes (audit pinned: all 27 homing weapons are limitation-carded), so TargetSettingsPanel shows NO homing switch; a homing weapon's LimitationCard shows the switch DISABLED with its reason (the what-if "homing disabled" needs the Lab to simulate that weapon). The live toggle activates if a verified-homing weapon ever becomes simulable.

_Amendment history (B121 sweep): B100/B101 roster test values; B116 homing switch placement (supersedes "homing on/off" in TargetSettingsPanel above)._

### 3.5 Loadout Builder `/loadout` (StepWizard: 1 Inputs · 2 Loadout · 3 Why it works · 4 Compare & Save)
- Step1 InputsForm: stage (default from settings) · class · difficulty · goal · current/next boss (search) · owned equipment (OmniSearch multi-add into InventoryGrid). Every field has "Skip — use default"; CTA always enabled. Exception (B108(c), B109): arriving from the comparison's "Open in Builder" (no stage passed) opens Step 1 with the weapon pinned and the stage AWAITING a choice (prompt copy) — never silently defaulted; the pin survives difficulty/goal/boss changes, a class change drops it with a warning. The target boss's gear (and that of every fight it opens) goes to the gated track, its group first (B106, B108(e) M1).
- Step2 RecommendationView: LoadoutSlots — each ItemSlot: TerrariaTooltip, 1–2 line rationale, click→detail; GateBadge where applicable. RegenerateBar: changing stage/class re-rolls stage-legal loadout in place. As built: an input change that clears swaps shows a visible rebuild notice, warned in advance where a swap exists (B108(e) H1); a pinned pick scoring below alternatives reads "kept over higher-scoring alternatives" (H2); counts split honestly ("40 verified obtainable + 1 owned (unverified)", H3); a 0-point pick says it isn't scored (B108(a), B110); an ammo weapon without verified ammo shows "scored without ammo" in its row (M9); every profile figure carries "est." (B108(d)).
- Step3 ExplanationView: SynergyPanel · per-item contributions · profile summary (damage/defense/mobility bars + EstimateLabel) · GatedSection w/ easier-alternative ItemSlots. As built (B113(a), B114; SCORING_SPEC §5.5): four bars — damage, defense, mobility, survivability — each running to a PICK-INDEPENDENT reference: the highest figure the builder finds among gear verified obtainable at the user's stage, class and difficulty ("highest found", never "best"), drawn as a TICK with its own est. label and AssumptionsTip (how it was found, the gear that reaches it, its numbers). A full bar means the loadout reaches the tick — earnable, never the default; a bar never compares a build with itself; no reference ⇒ no fill. Class synergy runs to 100. Step 3 also lists every 0-point pick (B108(a)).
- Step4 CompareView ("Compare & Save"; P4-S2 shipped it as "Save", B106): side-by-side columns · ScoreBreakdown per goal · "Surprise Me" · "Save Build" · "Check Readiness" → /readiness prefilled. As built (B111 R4, B113(b), B114): the draft beside ONE saved build (`?vs=`), the saved build shown as saved (Open may refill it per B107 — intentionally different, both honest); five profile figures with est. chips, each pair of bars running to the pair's stated maximum, differences in "Draft − saved" grammar; the goal fit is ONE signed difference ("Under Survivability weights: saved +24.4 est.", ties "same") — per-build weighted sums only inside "How was this scored?" (SCORING_SPEC §5.3); slot by slot, "Emptied by you" told apart from "Left empty by the recommendation" (B106). Surprise Me warns before replacing fixed picks ("Drawing replaces your N fixed picks…") and its banner says a slot swapped after the draw keeps the pick (B111 R2, B113(e) M3).

_Amendment history (B121 sweep): B106, B108(a)/(c)/(d)/(e), B109, B110, B111 R2/R4, B113(a)/(b)/(e), B114 — bar/tick parity and the signed difference._

### 3.6 Comparison `/compare`
PickerRow (2–3 OmniSearch slots, URL-synced) → CompareTable (est. rows carry EstimateLabel+AssumptionsTip; UnknownValue where unverified) → ProsConsRow per column (data-derived) → ActionRow: SendToLabButton · "Open in Builder". Mobile: snap-scroll cards + sticky stat-label rail.

As built (B99, B101–B103, B108(c)):
- At most COMPARE_MAX = 3 weapons, restorable via `?w=` (PRD AC1/UX §1 win over the looser brief — B99(a)); invalid ids leave the URL after a one-time notice (replaceState, B101(d)/B102); the picker MARKS, not hides, weapons already compared (B99(e)).
- Estimate row: the ammo assumption reads "No ammo is chosen here, so only the weapon's own damage counts…" (B99(d)); a weapon breaking the held-attack assumption or used up on use gets the IN-CELL qualifier line ("One click per throw · uses 1.5/s · blast and fuse not counted") with matching tips (B101(a), B102; SCORING_SPEC §2.2). Crit row: hidden only when no column can crit; otherwise "Not applicable" (with its reason) where a column can't (B103).
- "Not compared here" footnote for PRD-listed rows the data can't honestly hold — range, ease of use, reforge modifiers, single- vs multi-target beyond explosives; rows appear if/when verified data exists (B99(c), the B78 honest-absence pattern).
- Pros/cons by fixed derivation rules over verified fields only (auto-reuse, mana, ammo, consumable, classless, explosive, unobtainable tags), each weapon on its own; a page-level Unknown-heavy notice at ≥3 Unknown cells (B99(e)).
- Per-weapon "Test in Weapon Lab" links (labLinks is single-weapon) in place of one SendToLabButton (B99(e)); "Open in Builder" passes NO stage — the builder prompts for it (B108(c)).
- Desktop: the table fills its frame at 1–2 weapons (B101(b)); from 1024 columns share the full width (768 unchanged — B102).

_Amendment history (B121 sweep): B99(a)/(c)/(d)/(e), B101(a)/(b)/(d), B102, B103, B108(c)._

### 3.7 Boss map `/bosses` + `/bosses/:id`
```
BossMapPage
├─ MapToolbar: world-evil toggle · NodeMapLegend (collapsible) · "What Should I Do Next?" · ResetProgress (overflow)
├─ NodeMap (pan/zoom): BossNode = sprite, name, defeat-state ring; edge styling by type (required-gate solid gold / recommended dashed green / optional gray / alternative split / early-challenge icon) — line style AND icon, not color alone
├─ RecommendPanel (side drawer, ?recommend=1): "Required before progress" vs "Recommended order" with reasons + node links
└─ BossPage: header (art, name, stage chip, defeat-state toggle) · SummonSection (ProvenanceLink) · LocationSection · PrepChecklist (interactive, persisted) · ArenaTips · PerClassGear (4 class tabs → LoadoutSlots) · AttackPatterns · DropsTable (verified rate or UnknownValue + ProvenanceLink per row) · "Check Readiness" CTA · NextNodes (links back into map, centered)
```
**Tracking (B86(a)/(b)):** only bosses are markable — milestones and events are DERIVED (PRD P5-S4 AC1's "each node" = each boss); a node is "open" when its direct required gates are satisfied (milestones resolve through their bosses). Under "Both", a mark of either evil boss counts app-wide (B96(a), B97).
**RecommendPanel rules (P5-S5 — B89; src/app/routes/bosses/recommend.ts):**
- Progress is TRACKED-only — the panel explains the map beside it, so both agree on what is done and open; the selected stage is context only (a stage note when it falls outside the span from the progress stage to the next main-path step).
- "Required before you can progress": the unsatisfied required-gate bosses on the way to the next milestone not yet reached (past the last, the final node), in flow order. "Recommended order": open, unmarked bosses in play placed by a recommended-next (or bare required-gate) link from something done, then optional fights no later than the next main-path step's stage; a past step the player has evidently moved beyond is dropped.
- Events and milestones are never listed (unmarkable); early-challenge edges never drive a recommendation (those fights arrive through their later, optional links).
- World evil: only the chosen world's boss; under "Both" the pair is ONE either/or row, settled once either is marked.
- Every item carries a written reason (templated where wiki sentences explain poorly) and the wiki sentence behind its link as evidence (quotes deduped per list; wiki difficulty wording excluded from the copy audit like boss-page quotes).
- Phone toggle label "What next?"; the legend auto-collapses at 1024–1439; with no `?node=`, the map opens framed on the progress frontier (B86(d)).

_Amendment history (B121 sweep): B86(a)/(b)/(d); B89 recommender rules ("spec-parity for the recommender rules rides this entry per B58"); B96(a)/B97._

### 3.8 Readiness Checker `/readiness` (Feature A)
```
ReadinessPage (2-pane funnel)
├─ SetupPane: boss picker (query-prefilled) · stage · difficulty · class · LoadoutSlots input (OmniSearch fill; "import saved build") → CTA "Analyze My Build"
└─ AnalysisPane (persisted)
   ├─ SummaryCard: "What makes this easier / harder" two-column; zero outcome language
   ├─ ReadinessFactorCard × 5: Damage fit · Defense/survivability · Mobility vs patterns · Synergy · Preparation
   ├─ ImprovePanel: obtainable-now ItemSlots; GatedSection ("After you defeat X") separate; per-item "Show Me How to Get It" → /plan/new?item=:id
   └─ ReRunBar: sticky "Re-analyze" when inputs change after an analysis
```
As built (B94–B97, B117):
- SetupPane counts and names the user's ACTUAL marks; any remaining "Both" world-evil nuance is a separate sentence, never a silent filter (B96(a)). The stage is context only — a setup-pane note, not part of the analysis header — and changing it never puts an analysis out of date (B94(6), B96(c), B97(b)).
- Lines: prose names (and links) the bosses; gate chips cluster AFTER the line, never inside sentence flow, with and/or stated in text (B96(c), B97). Owned gated items are counted with an info line (SCORING_SPEC §6, B94(1)); plural boss names agree ("The Twins charge").
- ImprovePanel: gated groups nearest gate first, cut at 3 per group, the rest counted in one "Not shown" line (one clause per reason — B94(5), B95, B96(d), B97(a)); "Show Me How to Get It" opens the planner for single items, armor sets keep wiki links (B117).
- Layout: stacked panes on phones (B94(6)); two panes from 768 with a sticky summary/analyze affordance and no dead columns (the "follow-the-longer" sticky layout — B96(c), B97).

_Amendment history (B121 sweep): B94(1)/(5)/(6), B95, B96(a)/(c)/(d), B97(a)/(b), B117._

### 3.9 Acquisition Planner `/plan/:planId` (Feature B)
```
PlanPage
├─ PlanHeader: target item · obtainable-now chip · "Compare routes" (was "Find an Easier Route" — B117) · delete (ConfirmDialog)
├─ TwoPane (desktop) / Tabs (mobile): Tree | Checklist
│  ├─ TreePane: CraftTreeNode recursion (same data as crafting tree viewer); boss-prereq nodes = GateBadge nodes → boss pages; alternative recipes show "or" branches
│  └─ ChecklistPane: progress strip (bar + "N of M steps complete" + completion banner, pinned under the site header — B118(b)) → GroupHeader by boss / drop source / vendor / activity (B117) → PlanStepRow (ChecklistItem + OwnedQtyInput + remaining auto-calc + "Where Do I Find This?" popover w/ ProvenanceLink)
└─ Persistence: every check/qty edit saves to tc.v1.plans immediately (no save button)
```
As built (B117–B119; SCORING_SPEC §2.4/§2.5):
- **Basis:** "obtainable now" = selected stage + tracked defeats (PRD Feature B AC2 verbatim; the builder's semantics), stated in a "What 'obtainable now' is based on" note that also explains the difference from Feature A (B117).
- **Default route — choices, not rankings (B117):** a single source is used automatically; a craft-only item takes the first recipe in data order, labeled "recipe 1 of N" (skipped reversals noted inline); mixed sources stay open for the user to choose; Shimmer, circular and reversal recipes are never auto-picked but always choosable, with the reason shown. "Decide later" returns an item to its listed way.
- **"Compare routes" (B117, B118(f), B119):** no "easier" claims without data; every way shows its per-way gates (SCORING_SPEC §2.5) with boss/station names linked, and its counts agree with the tree's.
- **Grouping (B117):** by boss / drop source / vendor / activity — bosses to defeat, ways still to choose, each drop source or vendor, chests, fishing, other ways, crafting in order, where the plan stops, no known source. A5's biome grouping deviated honestly: biomes are free text. Check state is per plan (the checklists domain is untouched).
- **Progress (B118(a)):** ONE semantics everywhere — "N of M steps complete" includes owned-covered, no-longer-needed and boss-counted steps; the plans list never shows "Done" beside a partial count and refreshes stored status when it recomputes (B119).
- **Completion (B118(b)):** the strip keeps the bar and the completion banner on screen at the point of the final check (375 and desktop); a polite live region announces completion, reopen, route switch, update and delete, and focus is placed deliberately after an item pick and after an update (B118(g)).
- **Complete by cause (B118(c), B119):** a step complete because of something else (owned, covered, boss counted) is NOT a checkbox — a check-circle glyph, "Complete:" for screen readers and the cause in words; its state changes where the cause lives (role-switch pattern, documented in PlanChecklist.tsx).
- Derived boss-gate steps say which plan items need them (B118(e)); covered subtrees collapse under one summary note (B118(h)); a circular reason names the needed item (B118(d)).

_Amendment history (B121 sweep): §3.9 parity per B119 — B117, B118(a)–(h), B119._

### 3.10 Encyclopedia + Guides
ItemsHubPage: category tile grid (PixelPanels) → category list (FilterBar + VirtualList) → ItemPage (effect, acquisition, progression fit, "Crafting tree" tab, grind CTA).
As built (B112–B114): the hub filters every Item record by category / stage / name (`?category=&stage=&q=`); in-app item links replace "Wiki ↗" rows everywhere a record exists (search rows, boss-page drops — B112); hash anchors on async-mounted sections scroll + focus once on mount (shared `useHashTarget`, items and weapons — B113(c), B114); ALL fallback art is the muted stone silhouette that never passes for real art, and a missing sprite (incl. a listed-but-failed load) is noted visibly on the page, not only inside the collapsed sources (B113(d) M1, B114); drop quantities derived under B105 carry a visible "derived" label.
GuidesPage: index cards (topic, stage band) → GuidePage (prose, interactive persisted checklists, ItemSlot inline links, collapsible "Advanced").

_Amendment history (B121 sweep): B112 encyclopedia + Items nav; B113(c)/(d), B114; B105 derived label._

## 4. Key User Flows

### (a) First visit → stage → search → detail
Land `/` [no state; rails show EmptyStates] → tap stage chip [gold border; writes settings; header chip updates — selected state IS the confirmation] → type "zen" [≤150ms grouped suggestions; keyboard ↑↓ Enter] → Enter on Zenith → `/weapons/4956` [skeleton only if >300ms] → visit recorded to `tc.v1.recent`.
Alt: garbage query → in-combobox no-results + browse link. Failure: chunk fetch fails → ErrorState with Retry; shell alive.

### (b) Weapon → Lab → 30s test
Detail "Test in Weapon Lab" → `/lab?weapon=4956` [lab chunk loads: pixel loading screen] → arena + Infinite Dummy, weapon equipped [EquippedBar, SimDisclaimerBar, stats zeroed] → hold attack [floating numbers, live StatReadouts, DpsGraph, distinct crits] → "30s test" [`config-locked`: panels disabled w/ lock badge; countdown ring; reset aborts] → test ends [`results`: panel slides in — est. DPS (EstimateLabel), hits, totals, DoT breakdown; "Run again" · "Reset" · "Compare"].
Alt: non-simulated weapon → LimitationCard; equip never breaks. Alt: special-condition weapon → custom-scenario banner before enabling attack. Failure: no WebGL → ErrorState in ArenaRegion + link to data page.

### (c) Builder 1–4 with skips
`?step=1` [defaults from settings; boss inferred from defeats] → skip any/all → CTA [step 2 with defaults; skips noted in Step 3 assumptions] → Step 2 [`recommended`; stage/class change → `regenerating` shimmer in place → new stage-legal set] → Step 3 [GatedSection + alternatives] → Step 4 [ScoreBreakdown on demand; "Save Build" → named inline, appears in /builds + homepage; button "Saved ✓" 2s → "Save as copy"; "Surprise Me" → random valid seed].
Alt: skip-everything yields a complete default loadout — zero required fields. Failure: no stage-legal item for a slot (data gap) → "No verified option yet" designed state, never an invented item.

### (d) Map → defeat → next
`/bosses` [map pans to frontier: deepest defeated + 1; legend first-visit] → tap WoF → focus card → mark defeated [gold ring; downstream locked→recommended staggered 50ms; persists] → "What Should I Do Next?" [required vs recommended with reasons; reflects new defeat instantly].
Alt: nothing tracked → fresh-start recommendation. Alt: world-evil toggle flips EoW/BoC; defeat state preserved per node.

### (e) Readiness → improve → acquire → check off
Boss page CTA → `/readiness?boss=plantera` [prefilled] → assemble/import loadout → Analyze [`analyzing` skeleton → `analyzed`, persisted] → five factor cards [EstimateLabels] → "Improve My Build" [obtainable-now; GatedSection separate] → "Show Me How to Get It" → `/plan/new?item=:id` [`generating` → `plan-ready`; boss prereqs explicit gated steps] → enter owned qty [remaining recalcs live]; check step [done styling; group progress; persisted] → return `/readiness` [analysis restored; ReRunBar if inputs changed].
Failure: no verified acquisition route → UnknownValue steps + provenance note; never a guessed route.

### (f) Export / import
`/builds` → Export [readable header + `#code:` base64url; Copy w/ copied feedback] → fresh browser Import [textarea] → paste [`parsing` → preview (LoadoutSlots) + "Add to my builds"; OR partial: explicit "unknown item" rows; OR malformed → friendly inline field error, focus moved to it].
As built (P7-S2b, B123(a)): Export on every saved build and in Step 4 ("Export as text" — the loadout as it stands, under the name field's value); "Import a build" on the list → "Read the build" → preview (inputs, slot grid, item and owned counts, every id the data doesn't know listed by id with where it sits, a missing target boss, a different game-data version, an identical saved build) → "Add to my builds" saves a NEW build, says so (polite status) and focuses its card. Only the `#code:` line is read; refusals name their cause (not a build code / several codes / damaged / newer version / fails the checks). Verified at 375 and 1440 (Chromium): export → wipe → paste → add — record and slots identical. Whole-data backups: `/settings/data` (P7-S2).

## 5. Loading / Empty / Error / Success States

### 5.1 Loading
Lists: SkeletonList — 8 shimmer rows matching EntityCard dims (CLS <0.1); shown only if >300ms. Details: SkeletonPanel mirroring geometry. Lab chunk: full-region pixel loading screen; shell interactive. Search: inline spinner after 150ms; no row shifting. Plan/readiness generation: skeleton cards; buttons loading-disabled w/ spinner.

### 5.2 Empty
Filter-to-zero: pixel "empty chest" + message + removable filter chips + "Clear all". No search results: in-combobox designed state. Recent/SavedBuilds/Favorites/Plans empty: one-line invitation + single CTA — except the homepage SavedBuildsRail, which is absent with no builds (B111 R6, §3.2); the builder's saved-builds list keeps its empty state.

### 5.3 "Unknown" convention (§13)
`UnknownValue` renders literal **"Unknown"** in stone-gray italic Inter with dotted underline; hover/tap tooltip: "Not yet verified against the Terraria Wiki for 1.4.5.8" + ProvenanceLink. Never blank, never 0, never a dash. Table cells add a subtle diagonal-hatch background (pattern + text, not color-only). Records with any unverified field show a "partially verified" badge next to ProvenanceLink.

### 5.4 Error
Route-level: ErrorState in content area (cause + Retry), shell intact. Component-level (e.g., DpsGraph): local tile, rest unaffected. 404 styled.

### 5.5 Lab honesty states
SimDisclaimerBar: permanent, non-dismissible: "Browser simulation — values are approximations, not Terraria engine output." Visible at every breakpoint and in fullscreen (P3-S1 AC1). LimitationCard per §8. Custom-scenario banner: amber-gold PixelPanel above canvas (P3-S13 AC2).

### 5.6 Quarantined storage (ADR D6)
QuarantineNotice banner: "Some saved data couldn't be read and was set aside (not deleted)." Actions: View details · Try restore · Discard permanently (ConfirmDialog, destructive). Never silent.
As built: quarantine is per storage key (ADR D6) — when any record in a domain fails, the WHOLE saved set for that key is set aside, valid records included, and the copy must say so (B118(i) M7). The planner's notice: "Your saved plans couldn't be read, so the whole saved set was set aside (not deleted) — including any plans in it that were fine. Plans you make now are saved as usual." The View details / Try restore / Discard actions queued by B108(e)/B109 are built in P7-S2 (B123(b)–(f)): View details (what, when, why — re-checked now — size, the saved text) · Try restore (re-read with the load path's decoder; into a domain holding newer data it asks merge or replace — local wins on conflict, replace confirms; a conflicted merge keeps the set-aside copy) · Discard permanently (ConfirmDialog, destructive). Copies persist across reloads until restored or discarded; the shell carries one notice for the app-wide domains that had none (settings, progress, recently viewed — it steps aside on `/settings/data`, which lists every copy); an unreadable part of an imported backup is always set aside, never dropped.

_Amendment history (B121 sweep): §5.6 parity per B119 — B118(i) whole-set copy; B108(e)/B109 actions gap (queued P7). B123(b)–(f): the actions as built in P7-S2 (§5.6 parity rides P7-S2b per B58)._

### 5.7 Success / warning
Inline state change is the confirmation (button morphs "Saved ✓"); toasts only when the result isn't visible in place (export copied, import succeeded); 4s auto-dismiss, `aria-live="polite"`, never steal focus. Config locked during timed test = lock badge on disabled panels; "ignore mana" active = persistent amber chip in StatReadout cluster.

## 6. Review / Edit Behavior
- **Edit saved build:** `/loadout?build=:id&step=2` prefilled; changes mark "Unsaved changes"; Save overwrites, "Save as copy" forks; leaving with unsaved changes → ConfirmDialog (in-app navigation blocked + beforeunload; focus returns to the trigger or the step heading — B108(e) H5, B110). Inline rename on card. Reopening (B107, B108(e) M3): not-filled slots reopen unpinned, so new progress may fill them and surface "Unsaved changes"; a v1 build reopens with every empty slot kept empty; rationales are recomputed (recommendation-equal picks say so) and "you own this" chips restored.
- **Re-run analysis:** editing inputs keeps stale analysis visible, marked "Out of date" + sticky ReRunBar; old analysis never silently replaced; re-run swaps atomically. As built (B96(c), B97): the stale state is a dashed frame — all text stays at full opacity (dimming via background/border, never text opacity; ≥4.5:1, measured 5.84:1). Edits to boss, difficulty, class, loadout or tracked defeats make it out of date; a stage change does not (B97(b)).
- **Plan quantities:** OwnedQtyInput always editable (stepper, `inputmode="numeric"`); edits recalc live and propagate up the tree. Un-checking reopens the plan (P6-S6 AC4). Plan deletion: ConfirmDialog naming the plan.
- **Reset boss progress (P5-S4 AC3):** overflow menu → ConfirmDialog ("This clears defeat tracking for N bosses. Saved builds and plans are not affected."), destructive button, cancel default-focused; post-reset toast offers 6s one-shot Undo.
- **Lab reset:** single ResetButton — stats, dummy, minions, config unlock — instant, no confirmation.

_Amendment history (B121 sweep): B107, B108(e) H5/M3, B110 leave-dialog focus; B96(c)/B97 stale treatment; B97(b) stage rule._

## 7. Responsive Strategy (375 / 768 / 1024 / 1440)

| Page | <768 | 768–1023 | ≥1024 |
|---|---|---|---|
| Home | Single column; actions full-width; rails snap-scroll | 2-col featured | Full |
| Weapon list | FilterBar → "Filters" bottom sheet; chips inline | Inline FilterBar | FilterBar + wide rows |
| Weapon detail | Stacked; ActionRow sticky above tab bar | 2-col | 2-col + relations rail |
| Lab | Canvas ~55vh top; corner HUD; graph behind chip; panels = bottom sheets from dock; fullscreen hides shell | Canvas center; one side panel at a time | Three-column |
| Builder | One step/screen; sticky wizard header; slots 5-wide grid | Slots + rationale side by side | Full |
| Compare | Snap-scroll cards + sticky label rail | 2 cols | 3 cols |
| Boss map | One-finger pan; pinch + on-screen +/− zoom; double-tap = focus card; auto-center frontier; "fit all"; node targets ≥44px | Legend docked | Legend + side drawer |
| Boss page | Gear tabs horizontal scroll; sticky checklist progress | 2-col | 2-col + next-nodes rail |
| Readiness | Sequential screens; sticky ReRunBar | 2-pane | 2-pane |
| Plan | Tree/Checklist tabs; rows ≥44px | 2-pane narrow | 2-pane |
| Encyclopedia/Guides | 2-col tiles | 3-col | 4-col |

Global: zero horizontal scroll at 375px; `min-h-dvh`; safe-area padding; fixed bars never cover content.

## 8. Honesty-Affordance Patterns (binding, PRD §9)

**`EstimateLabel`** — warm-gold outlined chip "est." immediately after the number it qualifies (never floating, never once-per-page). Required on: Lab derived stats, comparison estimates, loadout profile bars, readiness numbers, plan effort figures. Tap → paired AssumptionsTip.
**`AssumptionsTip`** — tooltip listing exact assumptions ("assumes point-blank range, no modifiers, 60Hz sim, defense 0"). Rule: every EstimateLabel resolves to a populated AssumptionsTip; CI copy-audit enforces.
**`GateBadge`** — lock glyph (Lucide SVG) + gating boss name on any gated ItemSlot/EntityCard/tree node; top-right of slots, inline-after name in lists. Click → boss page. Reflects actual tracked defeats; disappears reactively site-wide once defeated.
**`GatedSection`** — separated container "After you defeat {Boss}" (linked). Rule: gated items may ONLY appear inside a GatedSection or carrying a GateBadge — never unlabeled among obtainable items. Used in builder Step 3, readiness ImprovePanel, plan steps, boss-page gear.
**`LimitationCard`** (Lab) — fixed anatomy: (1) weapon identity; (2) "What it does in-game" — verified text + ProvenanceLink; (3) "Why it isn't simulated" — plain language; (4) actions: "Open weapon page" + "Back to browser". Arena stays rendered behind at reduced emphasis — the Lab never looks broken.

Copy rule enforced structurally: ReadinessFactorCard and ScoreBreakdown accept only factor/explanation slots — no prop exists for a verdict/probability string.

## 9. Accessibility
- Text contrast ≥4.5:1 on dark background; RarityText uses lightened dark-mode variants; rarity never color-only.
- Visible 2px focus rectangles (zero-radius); focus to main on route change; import error focuses the invalid field.
- OmniSearch keyboard-operable; `/` shortcut opens with 0ms animation; NodeMap nodes tabbable in progression order w/ arrow-key edge traversal; Lab attack has Space-hold alternative; timed tests run without pointer.
- PixiJS canvas `aria-hidden`; all meaningful output in HTML HUD; test completion announced `aria-live="polite"`.
- Touch targets ≥44×44px everywhere; sheets dismissible by button, not gesture-only.
- `prefers-reduced-motion`: disables unlock stagger, slide-ins, damage-number drift (fade in place); DpsGraph still updates.
- Color-not-only: map edges = line style + icon; Unknown = hatch + text; crits = size/outline.
- Lucide SVG only; cursor-pointer on clickables. Body 16px Inter; Press Start 2P display-only ≥14px; data values use tabular-numeral Inter.

## 10. UX-Layer Acceptance Criteria (supplements PRD slice ACs)
1. At 375px every route renders with zero horizontal scroll; all touch targets ≥44px.
2. SimDisclaimerBar visible on `/lab` at all 4 breakpoints, in fullscreen, and during timed tests — screenshot audit.
3. Copy audit: zero win/lose/probability phrasing in readiness/scoring components; every rendered estimate has an adjacent EstimateLabel with non-empty AssumptionsTip.
4. 20 random Lab weapons yield simulation, custom-scenario banner, or LimitationCard — never blank/broken.
5. Marking a gate boss defeated removes every corresponding GateBadge site-wide without reload (shared Zustand store); GatedSections re-flow.
6. All destructive actions route through ConfirmDialog (destructive styling, cancel default focus); reset-progress offers 6s undo.
7. Every data view implements loading (skeleton, CLS <0.1), empty (designed, with action), error (with retry); UnknownValue is the only permitted rendering for unverified fields.
8. Keyboard-only traversal completes flows (a), (c), (d), (f); focus rings visible; route changes move focus to main.
9. Transitions 150–300ms ease-out, transform/opacity only; reduced-motion removes movement; keyboard-triggered UI animates 0ms.
10. Footer shows "1.4.5.8" from `meta.json` + exact ADR D3 attribution on every route → `/about/licensing`.
11. Deep links restore state: `/lab?weapon=`, `/compare?w=`, `/readiness?boss=`, `/plan/new?item=`, `/bosses?recommend=1`.
12. Bottom tab bar ≤5 items; nav renders only shipped routes; zero disabled/dead nav entries at any slice boundary.

## 11. Design-System Deltas
**New tokens (extend Tailwind v4 `@theme` beyond §11 palette):** `--color-destructive: #DC2626`; `--color-estimate` (warm-gold derivative); `--color-gate`; `--color-unknown` (stone-gray) + hatch utility; rarity scale `--rarity-0 … --rarity-10+` (dark-bg-adjusted); edge tokens `--edge-required/--edge-recommended/--edge-optional/--edge-alt`; motion `--ease-out-strong: cubic-bezier(0.23,1,0.32,1)`, `--dur-press:120ms`, `--dur-ui:200ms`, `--dur-panel:260ms`; z-scale `--z-hud:10`, `--z-sheet:40`, `--z-dialog:100`, `--z-toast:1000`.
**Rejected (binding-doc conflicts):** Roboto; slate/monochrome palette + #2563EB accent; light mode; paper-noise texture. **Adopted:** funnel pattern, zero-radius geometry, semantic role naming, a11y checklist tokens, "no muted colors/low energy" (gold stays vivid).

## 12. Signature Moments & Motion
- **Boss-branch unlock (brand-defining; multi-variant candidate):** defeated node ring fills gold → downstream edges/nodes transition locked→recommended, 50ms stagger along graph direction (ease-out-strong 200ms; opacity-only under reduced motion).
  Ratified constants (B87; src/components/nodeMap/progressView.ts + cascadeCamera.ts): **frame-then-play** — the camera first brings the cascade's region (changed nodes + both ends of every line that lights) into the uncovered map, a 200ms pan (`--dur-ui`) then a 50ms beat = **250ms lead** (CASCADE_LEAD_MS); no camera move when the region is already in view. When the region can't fit beside the focus card at the 44px tap floor (the fit check needs zoom ≥ 0.579 ≈ the floor; the 1440 borderline stands as designed), the card closes and the region is framed in the whole map. Siblings within one step ripple **25ms** apart, the whole cascade capped at **700ms** (UNLOCK_RIPPLE_MS / UNLOCK_MAX_TOTAL_MS). Satisfied gate edges swap the padlock for a check glyph (legend row added); a chosen either/or option shows one check glyph (per-option icons removed — two checks were ambiguous). Reduced motion: no pan, stagger or ripple; the unlock stays a single opacity fade — the `[data-unlock]` exception to the global reduced-motion rule (B86(c)). The 375 placement of the reset-progress Undo toast is ratified as built (B87).
- **Lab timed-test finish (multi-variant candidate):** countdown completes → readouts freeze → ResultsSummary slides up 260ms; final est. DPS counts up 300ms (tabular numerals, no shift). No confetti.
- **Floating damage numbers:** BitmapText pool, rise-and-fade 600ms; crits larger w/ outline; DoT smaller cadence; reduced-motion = fade in place.
- **Stage selection:** 0ms snap (a setting, not a celebration); dependent UI updates reactively.
- **Press feedback:** scale(0.97) 120ms; exits faster than entries (sheets in 260ms, out ~180ms).
- **Never animated:** keyboard omnibox open, Lab reset, filter application, tab switches.

**Resolved design flags:** recommender kept as a panel on `/bosses` (anchored to the map it explains); readiness re-analysis never silently replaces results (scrim + ReRunBar — the scrim is now a dashed frame, §6, B97); timed-test config lock shows WHY panels are disabled (lock badge).

_Amendment history (B121 sweep): B87 cascade constants ("spec-parity for the new constants rides this amendments entry per B58 practice"); B86(c); B97 stale-frame note._
