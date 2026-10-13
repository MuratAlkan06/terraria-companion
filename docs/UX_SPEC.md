# UX FLOW SPECIFICATION — Terraria Companion Website

> **AMENDED BY [AMENDMENTS-001.md](./AMENDMENTS-001.md) (binding — read together).**

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
| `/lab` | Weapon Lab. Query: `?weapon=:id`, `?target=`, `?test=10\|30` | P3-S1…S14 | `chunk-lab` (PixiJS inside) |
| `/lab/coverage` | Lab coverage report: simulated/custom/limitation counts, unhandled=0 | P3-S13 | `chunk-lab-coverage` (no PixiJS) |
| `/compare` | 2–3 weapon comparison. URL state: `?w=4956,757,1308` | P4-S1 | `chunk-compare` |
| `/loadout` | 4-step wizard. `?step=1..4`; `?build=:localId` to edit | P4-S2…S4 | `chunk-loadout` |
| `/builds` | Saved builds list, export/import | P4-S4 → P7-S2 | `chunk-loadout` |
| `/bosses` | Boss node map + legend. `?recommend=1` opens recommender panel | P5-S1, P5-S5 | `chunk-bosses` |
| `/bosses/:id` | Boss page | P5-S2/S3 | `chunk-bosses` |
| `/readiness` | Feature A. `?boss=:id&class=&difficulty=` prefill | P5-S6/S7 | `chunk-readiness` |
| `/armor`, `/armor/:id` | Armor sets + set-bonus-aware compare | P6-S1 | `chunk-db` |
| `/accessories`, `/accessories/:id` | Accessories + tinkering trees | P6-S2 | `chunk-db` |
| `/items` | Encyclopedia hub (category tiles) | P6-S3 | `chunk-db` |
| `/items/:id` | Item page; "Crafting tree" tab; "What Should I Grind For?" CTA | P6-S3/S4 | `chunk-db` |
| `/plan` | Feature B: plan list (multiple concurrent) | P6-S5/S6 | `chunk-plan` |
| `/plan/new?item=:id` | Plan generation entry ("Make My Plan") | P6-S5 | `chunk-plan` |
| `/plan/:planId` | Plan detail: tree + checklist + owned quantities | P6-S5/S6 | `chunk-plan` |
| `/guides`, `/guides/:slug` | Guide index + pages with interactive checklists | P6-S8/S9 | `chunk-guides` |
| `/favorites` | Starred entities | P7-S1 | `chunk-db` |
| `/about/licensing` | CC BY-NC-SA attribution, Re-Logic notice, provenance (ADR D3) | P1-S1 | `chunk-about` |
| `*` | Styled 404: PixelPanel, "lost in the caverns" art, link home + omnibox | P1-S1 | eager (tiny) |

**Nav visibility rule (P1-S1 AC2):** nav config is data-driven; a route appears only after its slice ships. No disabled nav items, ever.

## 2. App Shell

### Header (desktop ≥1024)
- Left: pixel logo mark + "Terraria Companion" wordmark (Press Start 2P, warm gold). Links `/`.
- Center: **OmniSearch** — Radix combobox over MiniSearch `autoSuggest`. Always mounted in shell (P2-S4 AC4). Placeholder: "Search weapons, bosses, items…". Results grouped by entity type with type badge, rarity-colored names, sprite thumbnails.
- Right: data-driven nav: Weapons · Lab · Loadout · Bosses · Items · Guides. Active link = 2px warm-gold underline (zero-radius).
- `StageSelectorCompact` far right: current stage as a small PixelPanel chip; click opens 5-stage Radix dropdown. Persisted to `tc.v1.settings`.

### Footer (all pages)
- Version pin: "Data: Terraria **1.4.5.8** (Desktop) · generated {meta.generatedAt}" — read from `meta.json` (ADR D1).
- Attribution (ADR D3, verbatim): "Data from the Official Terraria Wiki, CC BY-NC-SA 4.0 — Terraria content © Re-Logic" → links `/about/licensing`.
- Secondary links: Licensing · Lab Coverage Report · Favorites. Non-commercial statement, takedown contact.

### Mobile nav — **bottom tab bar** (not hamburger)
`BottomTabBar`, 5 items (icon + label, Lucide, never emoji): **Home · Weapons · Lab · Bosses · More**.
Rationale: one-handed thumb reach while the other hand is on the game; persistent tabs support rapid Home↔Lab↔Bosses ping-ponging; hamburger hides the most-hit destinations. "More" opens a bottom sheet: Loadout, Compare, Readiness, Plans, Items, Guides, Builds, Favorites, About.
- Mobile header: logo mark · OmniSearch trigger (full-width overlay) · StageSelectorCompact.
- In `/lab`, a **fullscreen toggle** in the HUD hides shell chrome; Esc/back restores. Safe-area insets respected.

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
| `QuarantineNotice` | ADR D6 corrupted-storage banner (§5.6) |
| `StepWizard` | Numbered steps, back/next, skip, progress |
| `LoadoutSlots` | InventoryGrid+ItemSlot laid out like in-game equip screen |
| `ScoreBreakdown` | "How was this scored?" disclosure w/ explained math |
| `DpsGraph` / `StatReadout` | Rolling graph; labeled live stat tile (tabular numerals) |
| `NodeMap` / `BossNode` / `NodeMapLegend` | Boss progression graph |
| `ReadinessFactorCard` | One analysis factor: title, explanation, evidence links |
| `CraftTreeNode` | Recursive tree node; expand-in-place or open-page (choice persisted) |
| `PlanStepRow` / `OwnedQtyInput` / `ChecklistItem` | Feature B units |
| `SendToLabButton` | Navigates `/lab?weapon=:id`; hidden until P3-S1 ships |
| `BuildExportDialog` / `BuildImportDialog` | Readable text + `#code:` line (ADR D6) |
| `FavoriteStar` | Toggle on any EntityCard/detail header (P7-S1) |

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
└─ SavedBuildsRail (LoadoutSlots mini-previews; EmptyState → "Build My Loadout")
```

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

### 3.5 Loadout Builder `/loadout` (StepWizard: 1 Inputs · 2 Loadout · 3 Why it works · 4 Compare & Save)
- Step1 InputsForm: stage (default from settings) · class · difficulty · goal · current/next boss (search) · owned equipment (OmniSearch multi-add into InventoryGrid). Every field has "Skip — use default"; CTA always enabled.
- Step2 RecommendationView: LoadoutSlots — each ItemSlot: TerrariaTooltip, 1–2 line rationale, click→detail; GateBadge where applicable. RegenerateBar: changing stage/class re-rolls stage-legal loadout in place.
- Step3 ExplanationView: SynergyPanel · per-item contributions · profile summary (damage/defense/mobility bars + EstimateLabel) · GatedSection w/ easier-alternative ItemSlots.
- Step4 CompareView: side-by-side columns · ScoreBreakdown per goal · "Surprise Me" · "Save Build" · "Check Readiness" → /readiness prefilled.

### 3.6 Comparison `/compare`
PickerRow (2–3 OmniSearch slots, URL-synced) → CompareTable (est. rows carry EstimateLabel+AssumptionsTip; UnknownValue where unverified) → ProsConsRow per column (data-derived) → ActionRow: SendToLabButton · "Open in Builder". Mobile: snap-scroll cards + sticky stat-label rail.

### 3.7 Boss map `/bosses` + `/bosses/:id`
```
BossMapPage
├─ MapToolbar: world-evil toggle · NodeMapLegend (collapsible) · "What Should I Do Next?" · ResetProgress (overflow)
├─ NodeMap (pan/zoom): BossNode = sprite, name, defeat-state ring; edge styling by type (required-gate solid gold / recommended dashed green / optional gray / alternative split / early-challenge icon) — line style AND icon, not color alone
├─ RecommendPanel (side drawer, ?recommend=1): "Required before progress" vs "Recommended order" with reasons + node links
└─ BossPage: header (art, name, stage chip, defeat-state toggle) · SummonSection (ProvenanceLink) · LocationSection · PrepChecklist (interactive, persisted) · ArenaTips · PerClassGear (4 class tabs → LoadoutSlots) · AttackPatterns · DropsTable (verified rate or UnknownValue + ProvenanceLink per row) · "Check Readiness" CTA · NextNodes (links back into map, centered)
```

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

### 3.9 Acquisition Planner `/plan/:planId` (Feature B)
```
PlanPage
├─ PlanHeader: target item · obtainable-now chip · "Find an Easier Route" · delete (ConfirmDialog)
├─ TwoPane (desktop) / Tabs (mobile): Tree | Checklist
│  ├─ TreePane: CraftTreeNode recursion (same data as crafting tree viewer); boss-prereq nodes = GateBadge nodes → boss pages; alternative recipes show "or" branches
│  └─ ChecklistPane: GroupHeader by biome/enemy/boss/activity → PlanStepRow (ChecklistItem + OwnedQtyInput + remaining auto-calc + "Where Do I Find This?" popover w/ ProvenanceLink) → PlanProgressBar; completion banner
└─ Persistence: every check/qty edit saves to tc.v1.plans immediately (no save button)
```

### 3.10 Encyclopedia + Guides
ItemsHubPage: category tile grid (PixelPanels) → category list (FilterBar + VirtualList) → ItemPage (effect, acquisition, progression fit, "Crafting tree" tab, grind CTA).
GuidesPage: index cards (topic, stage band) → GuidePage (prose, interactive persisted checklists, ItemSlot inline links, collapsible "Advanced").

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

## 5. Loading / Empty / Error / Success States

### 5.1 Loading
Lists: SkeletonList — 8 shimmer rows matching EntityCard dims (CLS <0.1); shown only if >300ms. Details: SkeletonPanel mirroring geometry. Lab chunk: full-region pixel loading screen; shell interactive. Search: inline spinner after 150ms; no row shifting. Plan/readiness generation: skeleton cards; buttons loading-disabled w/ spinner.

### 5.2 Empty
Filter-to-zero: pixel "empty chest" + message + removable filter chips + "Clear all". No search results: in-combobox designed state. Recent/SavedBuilds/Favorites/Plans empty: one-line invitation + single CTA.

### 5.3 "Unknown" convention (§13)
`UnknownValue` renders literal **"Unknown"** in stone-gray italic Inter with dotted underline; hover/tap tooltip: "Not yet verified against the Terraria Wiki for 1.4.5.8" + ProvenanceLink. Never blank, never 0, never a dash. Table cells add a subtle diagonal-hatch background (pattern + text, not color-only). Records with any unverified field show a "partially verified" badge next to ProvenanceLink.

### 5.4 Error
Route-level: ErrorState in content area (cause + Retry), shell intact. Component-level (e.g., DpsGraph): local tile, rest unaffected. 404 styled.

### 5.5 Lab honesty states
SimDisclaimerBar: permanent, non-dismissible: "Browser simulation — values are approximations, not Terraria engine output." Visible at every breakpoint and in fullscreen (P3-S1 AC1). LimitationCard per §8. Custom-scenario banner: amber-gold PixelPanel above canvas (P3-S13 AC2).

### 5.6 Quarantined storage (ADR D6)
QuarantineNotice banner: "Some saved data couldn't be read and was set aside (not deleted)." Actions: View details · Try restore · Discard permanently (ConfirmDialog, destructive). Never silent.

### 5.7 Success / warning
Inline state change is the confirmation (button morphs "Saved ✓"); toasts only when the result isn't visible in place (export copied, import succeeded); 4s auto-dismiss, `aria-live="polite"`, never steal focus. Config locked during timed test = lock badge on disabled panels; "ignore mana" active = persistent amber chip in StatReadout cluster.

## 6. Review / Edit Behavior
- **Edit saved build:** `/loadout?build=:id&step=2` prefilled; changes mark "Unsaved changes"; Save overwrites, "Save as copy" forks; leaving with unsaved changes → ConfirmDialog. Inline rename on card.
- **Re-run analysis:** editing inputs keeps stale analysis visible with "Out of date" dimmed scrim + sticky ReRunBar; old analysis never silently replaced; re-run swaps atomically.
- **Plan quantities:** OwnedQtyInput always editable (stepper, `inputmode="numeric"`); edits recalc live and propagate up the tree. Un-checking reopens the plan (P6-S6 AC4). Plan deletion: ConfirmDialog naming the plan.
- **Reset boss progress (P5-S4 AC3):** overflow menu → ConfirmDialog ("This clears defeat tracking for N bosses. Saved builds and plans are not affected."), destructive button, cancel default-focused; post-reset toast offers 6s one-shot Undo.
- **Lab reset:** single ResetButton — stats, dummy, minions, config unlock — instant, no confirmation.

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
- **Lab timed-test finish (multi-variant candidate):** countdown completes → readouts freeze → ResultsSummary slides up 260ms; final est. DPS counts up 300ms (tabular numerals, no shift). No confetti.
- **Floating damage numbers:** BitmapText pool, rise-and-fade 600ms; crits larger w/ outline; DoT smaller cadence; reduced-motion = fade in place.
- **Stage selection:** 0ms snap (a setting, not a celebration); dependent UI updates reactively.
- **Press feedback:** scale(0.97) 120ms; exits faster than entries (sheets in 260ms, out ~180ms).
- **Never animated:** keyboard omnibox open, Lab reset, filter application, tab switches.

**Resolved design flags:** recommender kept as a panel on `/bosses` (anchored to the map it explains); readiness re-analysis never silently replaces results (scrim + ReRunBar); timed-test config lock shows WHY panels are disabled (lock badge).
