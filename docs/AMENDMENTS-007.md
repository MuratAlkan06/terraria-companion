# AMENDMENTS-007 — Rulings from the P2-S4/S5 design review

Status: BINDING · 2026-10-13 · Orchestrator rulings.

## B28 — Hero search instance: REQUIRED (confirming UX_SPEC §3.2)
The homepage hero ships the large OmniSearch instance (autofocus desktop only). Not dropped. Fixed in the current pass.

## B29 — Header at 1024–1279: nav collapses beyond 3 items into a "More" menu
Same pattern as the mobile More sheet. Search keeps ≥240px. With all six planned nav items at 1024 there must be zero horizontal scroll. Applied now so P3-S1's "Lab" nav item cannot break the header.

## B30 — Sprite thumbnails for heavy GIFs: PIPELINE DEBT → P2-S7
Pipeline generates static PNG thumbnails (first frame, max ~128px) for any sprite file >100 KB; search rows and cards use the thumbnail, full GIF only on detail/boss pages. Blocks P5 boss pages.

## B31 — Per-entity wikiUrl in list/search data: PIPELINE DEBT → P2-S7
weapons.list.json (and search docs if cheap) gain `wikiUrl` so cards/rows can link exact provenance. Until then the featured weapon's source link sits under the weapon card and is labeled as the weapons category, not implied per-item provenance.

## B32 — Generic placeholder art must not resemble a specific in-game creature
The enemy/boss placeholder is redrawn as an obviously-generic silhouette (honesty rule §8). Applied now.

## B33 — "editorial guidance" display copy
User-facing label becomes plain wording (e.g. "curated" with a tooltip explaining it's hand-maintained from the wiki, not extracted data). The internal field names stay.

## B34 — B29 extension: APPROVED (2026-10-13)
Measurements show six inline nav links can't coexist with a ≥240px search at ANY current desktop width. Ruling: 3-inline + "More" collapse applies at all desktop widths; wordmark hidden 1024–1439 (logo mark + SR name remain). Revisit only if the header design changes.
