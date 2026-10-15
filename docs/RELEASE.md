# RELEASE — Terraria Companion v1: final report (P7-S7)

Status: release candidate, NOT released · 2026-10-15 · branch `feat/p1-app-shell` (public: https://github.com/MuratAlkan06/terraria-companion) ·
data: Terraria 1.4.5.8 (Desktop), `src/data/meta.json` generated 2026-10-15T18:21:41Z.

- **Gate state:** the release gate returned REVISE (AMENDMENTS-016 B131). Both halves of that REVISE are closed.
  The docs half is this report, its review ledger (Appendix A) and the doc-parity closeout (§7) — B131(d)/(e),
  recorded as B132 (docs commit 7aaff89). The P6 half (§5) is delivered in 41bbb32 (B134 → B138, APPROVED). This
  report describes the product as of 41bbb32. Corrections to this report's own text are recorded in B143 and B145.
- **Supersedes** `docs/HANDOFF.md` (B131(e)). The amendments chain (`AMENDMENTS-001` … `016`) stays binding and
  wins on any conflict; this report cites it inline by B-number.
- **Sources:** the amendments chain, the route registry (`src/app/routes.tsx`), `package.json`, and the emitted
  data (`src/data/meta.json`, `src/data/gaps.json`, gap report `pipeline/reports/gap-report.md`). Every count
  below was recomputed from those files for this report.

## 1. Run instructions

**Requirements:** Node.js 22.12+ and npm. Vite 8 needs Node 20.19+ or 22.12+; Vitest 5 declares
`^22.12.0 || ^24.0.0 || >=26.0.0`, so use an LTS line (22 or 24). (This session ran Node 23.11.0 / npm 11.6.2 —
outside Vitest's declared range, working, not recommended.)

```sh
npm ci               # install exactly what package-lock.json pins
npm run dev          # Vite dev server (http://localhost:5173)
npm test             # vitest run — app, pipeline and config tests
npm run typecheck    # tsc -b
npm run lint         # oxlint
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve dist/ locally
```

- **No pipeline needed to run the site.** The emitted datasets in `src/data/` are committed (CC BY-NC-SA 4.0 —
  `src/data/LICENSE.md`).
- **Build output.** `dist/` is a static site (ADR-001 D8): `_redirects` (`/* /index.html 200`) is the SPA fallback
  for Cloudflare Pages. The build also writes `dist/licenses/third-party-software.txt` — the license texts of
  every bundled package (Vite `build.license`, B127/B130), served at `/licenses/third-party-software.txt`; it
  exists only in `dist/` (a dev-server 404 is accepted, B130).

**Data pipeline** (ADR-001 D2). Every command below exists in `package.json`; the network ones were not run for
this report.

| Command | What it does | Network |
|---|---|---|
| `npm run pipeline:fetch` | Pulls `Module:Iteminfo/data`, the other wiki modules, the Cargo tables, articles and image info into `pipeline/raw/` (gitignored). Resumable; `npm run pipeline:fetch -- --refresh` refetches everything. A clean checkout has no raw cache, so it must fetch before it can rebuild data. | Yes — serial, ≤ 1 req/s, `maxlag=5`, backoff (D2 etiquette) |
| `npm run pipeline:build` | parse → merge → cross-check → validate → emit: `src/data/*.json`, `pipeline/reports/gap-report.md`, `public/sprites/manifest*.json`. Writes nothing unless validation, the 300 KB gz data budgets and the P3-S13 coverage gate pass (B115/B116). Deterministic for a given cache + overlays — two runs byte-identical is the standard proof. It rewrites both sprite manifests with `"fallbackMode":false` (see the takedown runbook in README). | None — a cache miss is `E_FETCH` |
| `npm run pipeline:validate` | Re-validates `src/data/` and the P2-S1 sample; the committed `meta.json`/`gaps.json` must equal what it recomputes. Exit 0 pass / 1 fail / 2 usage. | None |
| `npm run pipeline:spotcheck` | Prints emitted records beside the matching wiki article parts for `pipeline/spotcheck/cases.json` — a human side-by-side aid (PRD P2-S2 AC2). | Yes (cached) |
| `npm run pipeline:sprites` | LOCAL ONLY, never CI (A10). Downloads sprite binaries into `public/sprites/<type>/` (gitignored): every weapon, armor piece, accessory and boss, plus the core items (ammo, potions, boss-referenced), and writes thumbnails for files over 100 KB. Resumable; each file verified by the wiki's SHA-1 or the CDN's recorded size. | Yes — ≥ 1.1 s apart |

The Lab golden re-pin tool has no package script yet (queued, B116): `npx tsx pipeline/validate/pinLabGoldens.ts`
— run it only for an intended engine or data change, with a `src/sim/README.md` changelog entry (B38, B116).

**Optional corpus sprites, and the placeholder behavior.**
- `npm run pipeline:sprites -- --corpus` adds every other item the manifest lists — about 4,700 more files, roughly
  86–90 minutes at the D2 pace (authorized by B112(c); resumable). On the development machine the run completed:
  6,131 of 6,131 manifest targets present and verified (`pipeline/raw/sprites-record.json`, local only).
- Sprites are Re-Logic IP and are never committed: `.gitignore` keeps only `public/sprites/manifest.json` and
  `manifest.*.json` (A10, B104). On a fresh checkout every sprite box therefore draws the original stone
  placeholder silhouette — it never passes for real art — and detail pages say visibly that the sprite is missing
  (B113(d), B114). Nothing else changes. 28 records have no sprite at all (`gaps.json` `missing-sprite`).
- The takedown lever is `fallbackMode` in `public/sprites/manifest.index.json`: README → "Takedown runbook
  (sprites)" (B112(b), B127).

## 2. Working features (as shipped at 41bbb32 / B142)

Counts: 488 weapons, 256 armor pieces, 69 armor sets, 352 accessories, 5,045 items, 3,934 recipes, 3,250 drop
records, 334 enemies, 18 bosses, 28 progression nodes, 35 edges, 78 buffs, 54 conditions (`meta.json`).

**Foundation (PRD §4) — complete.**
- **Homepage** (P1-S2, P2-S5): original pixel-art hero; hero search; five-stage selector, persisted; rotating
  featured weapon and boss (real links); recently viewed, persisted; hero actions "Build My Loadout" · "Test
  Weapons" · "What Should I Do Next?" (each present because its target ships); the saved-builds rail appears once
  a build exists and is absent with none (B111 R6).
- **Search** (P2-S4): one omnibox on every page — grouped typeahead over weapons, armor, accessories, items,
  bosses, sets, buffs and enemies; designed no-results state; exact whole-name boost; rows draw the record's own
  sprite and link in-app wherever a page exists (B112).
- **Weapons database** (P2-S2, P2-S3): 488 weapons (count reconciled in the gap report); virtualized list with
  class / stage / rarity filters; detail pages with stats, acquisition, gate badges, provenance links and "Unknown"
  on exactly the unverified fields; actions Compare · Test in Weapon Lab · What Should I Grind For?; hash anchors
  land once async sections mount (B113(c)).
- **Weapon Lab** (P3-S1 … S13): permanent simulation disclaimer; 149 of 488 weapons simulated with
  verified parameters and 339 with limitation cards (what it does in-game + why it isn't simulated), 0 unhandled —
  the browser shows "488 · 149 simulated · 339 not" (B115, B122 Q2). Swing, thrust, returning (boomerang / flail /
  yoyo), bow/gun with ammo, magic with mana, piercing projectiles, minions, whips with tag damage, explosives with
  blast radius, DoT/debuffs (B85). Targets: Infinite, Multiple, Debuff, Boss-Sized, Moving and Armored dummies
  (B100, B101). Live stats, DPS graph, 10 s / 30 s timed tests. The engine also runs sentries, channeled beams and
  homing, verified on engine test weapons only — no weapon in the data is honestly parameterizable for them yet
  (B73, B77, B116); homing weapons' cards show the homing switch disabled with its reason. A build-failing
  coverage gate guards all of it: raise-only floor 149, a golden per simulable weapon, a typed reason per
  refusal (B115, B116).
- **Boss progression** (P5-S1 … S5): node map — required / recommended / optional / alternative /
  early-challenge edges by line style and icon, world-evil either/or; 18 boss pages (7 pre-Hardmode + 11 Hardmode,
  B83(c)) with summon, location, persisted prep checklist, per-class gear (quote-backed and gating-checked, or a
  per-class Unknown with its reason — B83, B90), attack patterns, drops with verified rates or Unknown and
  world-condition labels (B82, B83(d)); defeat tracking of bosses (milestones and events derived, B86(a)),
  persisted, with the unlock cascade (B87) and reset with a 6 s undo; "What Should I Do Next?" — tracked defeats
  only, required vs recommended with written reasons and wiki evidence (B89); "done" means counts-in-world
  everywhere (B96(a), B97, B128, B129).

**Extensions.**
- **Weapon comparison** (P4-S1): 2–3 weapons, restorable via `?w=` (B99(a)); est. rows with assumptions and in-cell
  qualifiers for weapons breaking the held-attack assumption (B101(a), B102); pros/cons by fixed rules (B99(e));
  "Not compared here" footnote for rows the data can't hold (B99(c)); per-weapon Lab links; "Open in Builder"
  passes no stage (B108(c)).
- **Loadout builder** (P4-S2 … S4): Step 1 inputs, all skippable, with a target boss (B106); Step 2 a full
  stage-legal loadout in inventory slots with rationale and gate badges — empty beats zero for accessories
  (B108(a)), other-world items out of play (B108(b)), visible rebuild notices (B108(e)); Step 3 synergy and four
  est. profile bars against pick-independent references drawn as ticks (B113(a), B114); Step 4 the draft beside
  one saved build with one signed goal-fit difference (B113(b), B114, B122 Q3), Surprise Me with a reproducible
  `?surprise=` seed (B111 R2), Save / Save as copy, an unsaved-changes guard (B108(e) H5); saved builds (`/builds`,
  SavedBuild v2 — B106, B107).
- **Boss Readiness Checker — Feature A** (P5-S6/S7): boss, stage, difficulty, class and a loadout from the database
  (or a saved build); five est.-labeled factor cards with no outcome language; owned items always counted, with an
  info line when gated (B94(1)); Improve lists obtainable-now upgrades, then "after you defeat X" groups nearest
  gate first, other-world items left out and counted (B94(5), B97(a)); the analysis persists and goes "Out of
  date" in a dashed frame (B96(c), B97); "Show Me How to Get It" opens the planner (B117). Reachable from boss
  pages, the map, the builder and its own desktop entry (B96(b)).
- **Armor database** (P6-S1 — built, not cut, B131(b); delivered in 41bbb32, B134 → B138 APPROVED): `/armor` browses
  the 69 sets by class / stage / name, plus the 14 pieces that belong to no set recorded in this dataset (256 pieces
  in all). Set composition follows B135: Beetle armor has two chests, and the Wizard set is a hat plus eight robes
  with no legs. Set pages show the quoted set bonuses and full-set totals for each helmet. Compare is
  set-bonus-aware — never a naive per-piece sum — and words the cases where a bonus flips the result (B134). Stage
  peers are listed only where the stage is verified: 19 of the 69 sets. The rest say their stage is Unknown and list
  no peers. (B134's "19/67" predates the two sets B135 added; both have unverified stages.) A piece id redirects to
  its set page, anchored and focused, and replaces the history entry (B134).
- **Accessory database** (P6-S2 — built, not cut, B131(b); delivered in 41bbb32, B134 → B138 APPROVED):
  `/accessories` lists the 352 accessories, filterable by category / stage / name; the four with an unverified
  category are under "Unknown". Detail pages show stats, quoted effects and class scoping by the builder's registry
  (B108(a), B134). The combination tree follows real recipes, alternatives included, and every node links in-app.
  Shimmer transmutations are not combinations and are left out (B134). With both pages live, P4-S2 AC3's wiki-link
  exception has expired: armor and accessory names link in-app, the builder's included (B131(b), B134).
- **Item encyclopedia** (P6-S3 — built as B112's "P6-S1/S2" encyclopedia foundation, B131(c)): `/items` hub and
  5,045 item records in 19 categories, filterable by category / stage / name (B112, B115); item pages with
  effect, how to obtain, used in, gate badges, and drop quantities derived under B105 labeled "derived" (B112);
  lazy shards with a styled 404 (B112).
- **Acquisition Planner — Feature B** (P6-S5/S6): any item and quantity → a plan from stage + tracked defeats,
  stated in a "based on" note (B117); tree + checklist with ingredients, stations, drops and bosses linked; boss
  gates as explicit steps; "Compare routes" with per-way gates — choices, not rankings (B117, B119); owned
  quantities with live remaining amounts; grouping by boss / drop source / vendor / activity; one progress
  semantics, completion banner and announcements (B118); several plans at once, delete confirmed. Reachable from
  item and weapon pages, Feature A and the builder's gated track.
- **Guides v1** (P6-S8): 5 pre-Hardmode guides (new world, exploring safely, better equipment, armor and defense,
  first-boss prep) with item links and persisted checklists (B81).
- **Favorites** (P7-S1): star weapons and bosses; `/favorites` persists.
- **Your data** (P7-S2): `/settings/data` — one-file JSON backup; restore with a per-part preview and merge /
  replace / skip (local wins on conflict); clear a part; every set-aside copy with View details · Try restore ·
  Discard, its origin shown (this browser vs a backup file — B125(b), B126); headlines count only parts that
  changed (B125(a)); one shell-level notice for previously silent domains (B123).
- **Build export / import as text** (P7-S2b): Export on every saved build and in Step 4 — a readable block plus one
  `#code:` line with an FNV-1a check, so a damaged code is refused, never misread (B124); "Import a build" →
  preview → saved as a new build; only the code line is read (B124 retires name resolution).
- **Licensing and legal** (B127's "P7-S4" licensing slice, B131(c)): `/about/licensing` in six sections; root
  `NOTICE` and `LICENSES/`; `src/data/LICENSE.md` (B130); the generated third-party license file (B130); the
  takedown runbook in README (B112(b), B127); tests tie the credits to `package.json`, the fonts to `main.tsx` and
  the contact placeholders to `src/app/site.ts` (B127).
- **Polish and cross-browser sweep** (PRD P7-S6's work, run as B128's "P7-S3" sweep, B131(c)): the Safari focus fix,
  Retry focus kept across a document reload (`tc.retryFocus`, UX_SPEC §5.4), Unknown hatch contrast ≥ 4.5:1, the
  header spacing token, the counts-in-world status fixes (B128, B129), and real breakpoints only, guarded by a test
  (B127, B130).
- **Data pipeline**: offline, deterministic rebuilds; Zod schemas shared by app and pipeline; build-failing gates
  for referential integrity and crafting-tree closure (0 unresolved of 15,906 references, B104), boss curation
  (`E_BOSS_CURATION`), suggestion gating, Lab coverage (B115) and size budgets; a human-readable gap report.

## 3. Honestly absent

### 3.1 Cut per PRD §10 (B131(b))

| Slice | What it would have added | Why cut | What ships instead |
|---|---|---|---|
| P3-S14 Lab equip context | Armor / accessory / buff stat effects inside the Lab | §10 risk 1 names it among the first P3 cuts; the global line drops "Lab equip-context" | The Lab tests each weapon on its own stats; the builder's profile and the readiness analysis count equipment bonuses as estimates |
| P6-S7 Weapon detail v2 | When-to-use guidance, related weapons, stage-peer compare | §10 risk 3 cut order "P6-S9 → P6-S7"; the global line drops "Weapon Detail v2" | Weapon detail v1 with Compare, Lab and planner actions |
| P6-S9 Guides v2 | 5 Hardmode guides | §10 risk 3's first cut; the global line drops "Guides v2" | The 5 pre-Hardmode guides; the 11 Hardmode boss pages' prep and tips |
| P7-S3 Saved characters | Several local profiles | P7 extras top the global cut line; PRD §11: "drops first if contested" (next to the all-in-one-tracker exclusion) | One local profile; backup / restore moves it between browsers (P7-S2) |
| P7-S4 Quick compare vs equipped | One-click compare against the active loadout's weapon | P7 extras top the global cut line | A weapon page's "Compare" opens `/compare` with that weapon; builds compare in Step 4 |
| P7-S5 Random challenge generator | Random stage-legal challenges | P7 extras top the global cut line; also adjacent to the owner's explicit exclusions | Nothing equivalent. The nearest feature is the builder's Surprise Me — a random stage-legal loadout (B111 R2) |

**Not cut:** P6-S1 armor and P6-S2 accessory databases are delivered in 41bbb32 (§2, §5). P6-S4 crafting trees are met
by the planner's tree, which the plan preview shows before saving (pinned, B134; B131(b)).

### 3.2 Retired by ruling (not omissions)
- **Custom scenarios: 0, cut per §10** (risk 1: "custom scenarios → limitation cards") — PRD P3-S13 AC2 retired
  (B131(a)). 0 unhandled weapons and 339 typed limitation cards cover the requirement behind it; B115 already bans
  inventing simulation parameters.
- **`/lab/coverage` page:** retired as duplicative (B122 Q2). The Lab's count line, the limitation cards and the
  typed refusals carry it at the point of use; the per-bucket counts are in `gaps.json` and the gap report.
- **A3's simulable targets:** ≥ 60 % overall (B115) and ≥ 80 % per floor archetype (B122 Q1) are retired. The
  enforced contract is the floor, the goldens and the typed reasons. Reality: 149 / 488 = 30.5 %.
- **N-way saved-build comparison:** out of v1 scope; the draft beside one saved build meets P4-S4 AC1 (B122 Q3).
- **Name-resolution import fallback** (ADR D6): retired — build import reads the `#code:` line only (B124).

### 3.3 Unknown data
Every unverified field renders "Unknown" — never a guess, blank or zero. From `src/data/gaps.json` (14,261
entries) and `meta.json`; the full list is `pipeline/reports/gap-report.md`.
- **5,258 of 13,979 records are not fully verified** (`verified: false`): items 3,738 of 5,045 · weapons 337 of 488
  · enemies 334 of 334 · drops 283 of 3,250 · accessories 278 of 352 · armor 188 of 256 · armor sets 50 of 69 ·
  buffs 29 of 78 · bosses 18 of 18 (curated fields with declared per-class gaps) · recipe groups 3 of 38. Recipes,
  nodes, edges and conditions are fully verified.
- **1,003 of 5,045 item records have no known source** (empty acquisition, shown as Unknown) — accepted in B104.
  Likewise 17 weapons, 4 armor pieces and 27 accessories.
- **Gating not derivable for 4,439 records** (`gating-underived`): those items are never shown as "obtainable
  now" (DATA_SCHEMA_SPEC §2.2).
- **Pet, hook and mount stats are Unknown** — not extracted (64 mount and 27 hook entries listed; pets have no stat
  fields) — accepted in B104. Extending B105's derived quantity of 1 to hooks is ruled but not yet applied
  (B112(a)).
- **Drops:** 347 per-difficulty drop rates unverified; 52 drop records keep an Unknown stack quantity (coins and
  consumables are never defaulted — B105, B112).
- **Lab:** 339 of 488 weapons are not simulated, each with a typed reason; the 27 homing weapons are among them
  (B116).
- **Sources:** `Module:Iteminfo/data` is synced to 1.4.5.7 while the site pins 1.4.5.8 (ADR D1 caveat; rev
  1023241); 45 source mismatches and 324 count-reconciliation notes are recorded.

### 3.4 Queued, not built (non-blocking)
Recorded as queued in the chain and not closed there; not re-audited against the code for this report.
- Lab `?target=` deep link (B100 — confirmed absent).
- B44 swing-label registry migration and the AC5 crit tie-break fragility (B100; "confirmed non-trivial", B116).
- A package script for the golden re-pin tool and a validate status line (B116 — script confirmed absent).
- Planner data quality: mining / natural routes for ores and natural blocks; Hallowed Bar's gate carrying all
  three mechanical bosses; Soul of Light sources beyond the Divine Crate (B117).
- Grenade impact-with-fallback-fuse schema and the category-less grenade family (B85(c)); B66 schema candidates
  (yoyo spin, max-out counts, whip tag duration, explosive ammo linkage).
- Readiness analysis staleness across reload as a stored snapshot (B94(4)).
- Per-surface UI nits queued to each surface's next touch: B88, B98, B101(d), B102, B103, B110, B113.

### 3.5 Accepted documentation debt
None. Every B131(e) item is delivered (§7), including the whole pre-B85 list.

## 4. Browser and assistive-technology coverage
- **Chromium:** every slice's verification and design review, through the MCP browser and scripted headless
  Chromium, at 375 / 768 / 1024 / 1440.
- **Safari:** WebKit-simulated only — Playwright's WebKit build stood in for Safari in the cross-browser sweep
  (B128). No real Safari or iOS device was run.
- **Firefox:** untested.
- **Screen readers:** none run, VoiceOver included. Accessible names, live regions and focus order were checked
  through accessibility trees and tests only (B119, B124). Clipboard export: mocked tests plus Chromium's success
  signal (B124).

## 5. Delivered — the P6 slice (B131(b)/(d)/(e); commit 41bbb32)
- **P6-S1 armor and P6-S2 accessory database pages** (`/armor`, `/accessories` — UX_SPEC §1; §2 above): delivered in
  41bbb32. Design review: REVISE (B134) → fix rounds (B135–B137) → closing re-check APPROVED (B138). P4-S2 AC3's
  wiki-link exception for armor and accessories has expired; those links are in-app (B131(b), B134).
- **P6-S4:** the plan preview shows the full recursive tree before saving. It uses the planner's own tree renderer,
  read-only, with no separate tab, and is pinned by `src/app/routes/plan/planPreview.test.ts` (B134).
- **Initial-JS budget:** enforced by `vite.config.test.ts` — the 200 KB gz initial-route limit (ADR D7; 200,000 bytes),
  measured on an in-memory production build. The entry graph measured 196.1–196.3 KB gz of 200 (B134).
- **Visual check of the B127-items micro-fix** (B130: the `sm:` → `md:` surfaces and the rest): ran inside the P6
  pages design review; every surface passed at its sampled widths. Transcribed in B143(2), with the 1024 note firmed
  in B145 (B131(d)).

## 6. Awaiting the owner
1. **Takedown / contact address** (B127, owner input 1) — **resolved in the deploy-prep commit.** `takedownContact`
   in `src/app/site.ts` is the repository's GitHub Issues page
   (https://github.com/MuratAlkan06/terraria-companion/issues); `NOTICE`, `README.md` and the Licensing page carry
   it, and a test requires all three to agree. An email address chosen by the owner later can replace it.
2. **Code license** (B127, owner input 2) — **resolved in the deploy-prep commit.** The owner confirmed MIT (ADR-001
   D3's plan): the root `LICENSE` holds the MIT License text (Copyright (c) 2026 Murat Alkan), and `NOTICE` and
   `README.md` name it — a test follows the file.
3. **Remote and CI** — **resolved.** The repository is public at https://github.com/MuratAlkan06/terraria-companion.
   `.github/workflows/ci.yml` (landing with the deploy-prep commit) runs lint, typecheck, the test suite and the
   build on Node 22 for pushes to `main` and for pull requests.
4. **Deployment** — **open; the only remaining item:** static `dist/` to Cloudflare Pages (GitHub Pages as the
   alternate, ADR D8); see README "Before any public deployment".

Nothing in the P6 slice awaits the owner: the armor and accessory pages are delivered in 41bbb32 (§2, §5), not cut.

## 7. Doc-parity closeout (B131(e))
- [x] **B126 set-aside origin** → DATA_SCHEMA_SPEC §4b (the wrapper format), UX_SPEC §5.6 (origin display, B125(d)
  replace wording).
- [x] **B128 `tc.retryFocus`** → already in UX_SPEC §5.4 (checked; B128's other parity — hatch §5.3, header token
  §11, B120 copy §3.9 — also present). ADR D6's as-built key note names it as a non-domain.
- [x] **B129 "done means satisfied"** → already in UX_SPEC §3.7 (checked).
- [x] **B130 README "(MIT, ISC)"** → README "Libraries" broadened to the generated file's reality (MIT, ISC,
  BSD-3-Clause, 0BSD; OFL fonts; packages named without a text).
- [x] **B130 ADR D3 data pointer** → ADR-001 D3 "As built" note (also the code-license status and the license file).
- [x] **Stale `/lab/coverage` and P3-S13 rows** → UX_SPEC §1 row retired (B122 Q2); PRD P3-S13 note resolved (B122
  Q1/Q2) and §13; AMENDMENTS-001 A3 pointer (B122 Q1, B131(a)).
- [x] **PRD AC2 Amended note** → PRD P3-S13 AC2 (B131(a)); DATA_SCHEMA_SPEC §2.4/§5 and UX_SPEC §4(b), §5.5, §10.4
  mark custom scenarios retired.
- [x] **PRD §10 cut-line annotations** → §10 "As cut at release" block, plus "Cut (B131(b))" notes on P3-S14, P6-S7,
  P6-S9 and P7-S3/S4/S5, and "built, not cut" / "met by the planner" notes on P6-S1/S2 and P6-S4. UX_SPEC §1,
  §3.3 and §3.4 mark the cut surfaces.
- [x] **Pre-B85 list (B121/B122), all closed as spec notes:**
  - B58 remainder → DATA_SCHEMA_SPEC §2.4 `reuseDelayTicks` (B48(a)) and `damageMultiplierPct` (B48(b)).
  - B74(c) → UX_SPEC §11 `--edge-early`; B74(d) → ADR-001 D6 as-built key list.
  - B75 → UX_SPEC §3.4 (Lab) and §3.7 (map) supplements.
  - B83(a)/(b) with B90(a)/(b) and `E_BOSS_CURATION` → DATA_SCHEMA_SPEC §6.
  - B8/B40 → DATA_SCHEMA_SPEC §2.1 SourceKind (`wiki-module`, `wiki-article`).
  - B6 → DATA_SCHEMA_SPEC §6 `E_DERIVED_MISMATCH`.
  - A7 → DATA_SCHEMA_SPEC §4b DomainKey `checklists`.
- [x] **Also closed on the way:** B122 Q3 → PRD P4-S4 note; B131(b)'s P4-S2 AC3 expiry → PRD P4-S2 note; B131(c)
  slice labels → UX_SPEC §1 and §3.9 wording; B74(a)/(b) → UX_SPEC §3.7.
- [x] **Not docs — rode the P6 slice:** the initial-JS budget test → `vite.config.test.ts` (200 KB gz enforced;
  196.1–196.3 KB measured, B134), committed in 41bbb32 (§5).
- [x] **HANDOFF.md** is superseded by this report (above). Its file belongs to the concurrent slice and was not
  edited here.

---

## Appendix A — Review ledger (B85 → B132)

Transcribed from the amendments chain (B131(d)). How to read it:

- **Design** — the design-reviewer verdicts the chain records. "Stated plainly" marks an APPROVE the chain implies
  but never labels; its entry is named.
- **Verification** — the chain transcribes no verification-lead verdict for any slice in this range. Under the
  session protocol (implementation → design review → verification → workflow gate → commit), verification came
  before every commit, but the verdict texts live in the session records, not here. Where the chain records how
  something was verified, the Notes column says so.
- **Workflow gate / commit** — the chain transcribes no workflow-gate verdict either. At the start of this report
  the working tree was clean apart from `docs/AMENDMENTS-016.md`, so every code slice below is committed. Commit
  hashes are named where the session-start log shows them (its five most recent commits); older hashes are not in
  the chain.

| # | Slice | Rulings | Design | Verification | Workflow gate / commit | Notes |
|---|---|---|---|---|---|---|
| 1 | P3-S11 Explosives / AoE + DoT + Debuff Dummy | B85 | Final review APPROVED, nits queued — stated plainly: B88 "Post-approval nits (P5-S4/P3-S11 final review)" | Not in chain | Committed (hash not in chain) | In flight at the previous pause (HANDOFF) |
| 2 | P5-S4 Defeat tracking + unlock cascade | B86, B87 | Fix pass after review (B87 ratifies it) → final review APPROVED — stated plainly: B88 | Not in chain | Committed (hash not in chain) | |
| 3 | P5-S5 "What Should I Do Next?" | B89, B91, B92 | Fix round ratified with two items open (B92) → narrow re-check APPROVED, see B93 ((i) accepted as built; (ii) display fix rode that batch) | Not in chain | Committed (hash not in chain) | Absorbed the B70 reconciliation (B91) |
| 4 | B70 P4-prep pipeline (potions, `classes[]`, ammo / base-material / shop / chest gating, StatKinds) | B90, B91 | Pipeline slice — no design review of its own; its UI effects were reviewed in row 3's fix round (B91, B92) | Not in chain | Committed (hash not in chain) | |
| 5 | P5-S6/S7 Boss Readiness Checker (Feature A) | B94, B95, B96, B97 | REVISE (B96: one High + M7 + fix scope) → fix round ratified (B97) → APPROVED with nits — stated plainly: B98 "Feature A approval nits" | Not in chain | Committed (hash not in chain) | |
| 6 | P4-S1 Weapon comparison | B99, B101, B102 | REVISE (B101: H1, H2, M1, nits) → fix round ratified (B102) → "Re-check APPROVED P4-S1+P3-S12" (B103 — labeled) | Not in chain | Committed (hash not in chain) | |
| 7 | P3-S12 Dummy roster v2 | B100, B101(e) | Reviewed with row 6 (B101(e): 375 zoom APPROVED, the rest nits) → re-check APPROVED (B103 — labeled) | Not in chain | Committed (hash not in chain) | |
| 8 | P6-S0 Item corpus (pipeline) | B104, B105 | Pipeline slice — no design review | Not in chain | Committed (hash not in chain) | Two expected failing pins staged for the surfaces' next owners (B104) |
| 9 | P4-S2 Builder Steps 1–2 | B106–B110 | REVISE (B108: H1–H5, M1–M11) → fix round ratified (B109) → micro-fix ratified, one nit queued (B110) — accepted; the chain has no APPROVE label | Not in chain | Committed (hash not in chain) | |
| 10 | P4-S3/S4 Builder Steps 3–4 (profile, scoring, Surprise Me, save, rail) | B111, B113, B114 | REVISE (B113: H1 bars, H2 goal fit) → fix round ratified (B114), with "CHECK AT RE-REVIEW: Lab arena placeholder texture" — **re-review verdict not in the chain**, and B131(d) doesn't list this batch among the untranscribed APPROVEs | Not in chain | Committed (hash not in chain) | B111: test baseline 2,326 confirmed |
| 11 | Encyclopedia foundation (PRD P6-S3; B112's "P6-S1/S2", B131(c)) | B112, B113, B114 | Same review batch as row 10 — same status | Not in chain | Committed (hash not in chain) | Corpus sprite download authorized and run (B112(c)) |
| 12 | P3 close-out: P3-S13 coverage gate + P3-S8 homing | B115, B116 | Ratified (B116); **no design verdict in the chain** for the S8 UI (the disabled homing switch on limitation cards) | Not in chain | Committed (hash not in chain) | |
| 13 | P6-S5/S6 Acquisition Planner (Feature B) | B117, B118, B119 | REVISE (B118: H1, H2, M1–M7) → fix round ratified (B119) → APPROVED with nits — stated plainly: B120 "Feature B approval nits" | Not in chain | Committed (hash not in chain) | B119: Chromium-verified only (Safari / VoiceOver left to the sweep) |
| 14 | B58 parity sweep (docs) | B121, B122 | Docs only — no design review; ratified (B122: "Also ratified: the sweep's §9.1/B87 reading choices") | Not in chain | `f481159` docs: spec parity sweep and amendment rulings B121-B126 | |
| 15 | P7-S2 backup / restore / set-aside + P7-S2b build text | B123–B126 | REVISE (B125: H1, M1–M4) → fix round ratified (B126) → narrow re-check APPROVED (session record; transcribed here per B131(d)) | Not in chain | `202cdca` feat: add data backup, restore, quarantine, and build codes | B124: clipboard verified by mocked tests + Chromium's success signal |
| 16 | Licensing (B127's "P7-S4", B131(c)) | B127 | Ratified (B127) → final-batch APPROVE (session record; transcribed here per B131(d)) | Not in chain | `c61de3d` feat: add licensing page, legal notices, and takedown runbook; docs `51c2fc2` (B127–B130) | |
| 17 | Cross-browser sweep (B128's "P7-S3", B131(c); PRD P7-S6 work) | B128, B129 | Ratified (B128) → micro-fix ratified (B129) → final-batch APPROVE (session record; transcribed here per B131(d)) | Not in chain | `f7aab06` feat: add cross-browser fixes, consistency sweeps, and ui polish | WebKit installed for the Safari stand-in (B128) |
| 18 | B127-items micro-fix (`sm:` → `md:`, the third-party license file, `src/data/LICENSE.md`, UX lines) | B130 | Landed after the final-batch APPROVE — **visual check DELIVERED inside the P6 pages design review (B131d transcription in B143): weapon/item headers side-by-side at 768/1440, the compare add-box, Step-4 slot rows at 768, licensing list first-line links at 375 — all PASS** (B131(d)) | Not in chain | Committed — in `c61de3d` or `f7aab06` (the chain doesn't record which); docs `51c2fc2` | |
| 19 | Release gate (P7-S7) | B131 | Gate verdict REVISE (B131(a)–(e)) | — | — | |
| 20 | P6 slice: armor / accessory pages, P6-S4 preview check, initial-JS budget test, row 18's visual check | B131(b)/(d)/(e), B134–B142 | REVISE (B134 Blocker: false set claims) → fix rounds (B135–B137) → closing re-check APPROVED (B138) | PASS — the B140–B142 batch verification (27-row matrix; continuation below) | committed: 41bbb32 (feat) / 7aaff89 (docs) | Detail: the continuation table below |
| 21 | Release docs (this report, the ledger, the B131(e) closeout) | B132, B143, B145 | Docs only — no design review | — | `7aaff89` docs: deliver release report and spec parity sweep; `f04e921` docs: close release-gate revise items with as-shipped record (ungated, B144; partly applied, B145) | B145's corrections ride the next gated commit |

### Appendix A continuation — B133 → B145 (final-closure batch)
| Entry | Slice | Design | Verification | Gate |
|---|---|---|---|---|
| B133 | Ledger corrections | — (docs) | transcribed session verdicts: all B85–B131 slices carried verification PASS + workflow APPROVE; B113/B114 re-review APPROVED; P3-S8 verified twice | — |
| B134 | Armor/accessory pages (P6-S1/S2) | REVISE (Blocker: false set claims) | — | — |
| B135 | Set-schema extension + 69 sets | fix round | — | — |
| B136–B137 | Readiness unknown set-state + Improve guard | fix round (B136) → closing re-check **APPROVED** (B138) | — | — |
| B138–B139 | I-am-error ruling (premise disproven by the implementer; revised) | — | — | — |
| B140–B142 | Drop-conditions split, option-A deriver semantics, Flinx knock-on | within the approved batch; conditions verified in-browser by the implementing round | **PASS** (this batch's verification: 27-row matrix, 2 docs-only failures → corrected under this continuation) | committed: 41bbb32 / 7aaff89 |
| B143 | Second gate-REVISE closure (this report as shipped; B131(d) visual-check transcription; PRD/UX drift) | — (docs) | — | committed `f04e921` **without the github-workflow pre-commit gate** (B144). Most of its RELEASE.md edits did not land: the §2 list, the §5 rewrite and the §7 tick (B145) |
| B144 | Process deviation self-report: f04e921 skipped the workflow gate | — (docs) | — | not yet committed; rides the next gated commit. Its "verbatim prescription" claim is corrected by B145 |
| B145 | Corrections: B143(1) and B144 overstatements; RELEASE §2/§5/§7, gate state and ledger rows 20–21 made true | — (docs) | — | the next gated commit |
_Corrections carried by this continuation: B133 supersedes the main table's "Not in chain" verification cells (every B85–B131 slice carried a verification PASS and a workflow APPROVE) and row 18's commit cell (split per B133(4)); row 20's design verdict is **APPROVED** (closing re-check, B138)._
