# Terraria Companion
[![CI](https://github.com/MuratAlkan06/terraria-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/MuratAlkan06/terraria-companion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A free, non-commercial, unofficial companion site for Terraria (desktop): weapon, item and boss data built
from the Official Terraria Wiki, plus planning tools. A static single-page app (Vite + React); the design
documents live in [`docs/`](docs/).

## Run it

Needs Node.js 22.12+ and npm. Full run instructions — the data pipeline, the optional sprite download and what
is and isn't in this release — are in [`docs/RELEASE.md`](docs/RELEASE.md).

```sh
npm ci           # install the locked dependencies
npm run dev      # development server
npm test         # test suite (Vitest)
npm run build    # production build into dist/ — a static site
npm run preview  # serve the built dist/ locally
```

The game data in `src/data/` is committed, so the site runs without the data pipeline. The sprite images are
not (see Legal): a fresh checkout shows the placeholder art until `npm run pipeline:sprites` downloads them
locally.

## Legal

Full details: [`NOTICE`](NOTICE), [`LICENSES/`](LICENSES/) and the site's `/about/licensing` page.

- **Wiki data — CC BY-NC-SA 4.0.** Game data is derived from the
  [Official Terraria Wiki](https://terraria.wiki.gg/) (text by its contributors,
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). The derived data files are shared
  under the same license (ShareAlike): files, changes made and terms in
  [`LICENSES/DATA-NOTICE.md`](LICENSES/DATA-NOTICE.md); license text in
  [`LICENSES/CC-BY-NC-SA-4.0.txt`](LICENSES/CC-BY-NC-SA-4.0.txt).
- **Re-Logic content.** Terraria and all related names, artwork, sprites and audio are © Re-Logic; Terraria
  and Re-Logic are trademarks of Re-Logic. This is an unofficial fan project, not affiliated with or endorsed
  by Re-Logic or the Terraria Wiki. Sprites are not covered by the wiki's license; the image files are
  gitignored (only their provenance manifest is committed) and takedown requests are honored — see the
  runbook below.
- **Non-commercial, permanently.** No ads, no paid features, no affiliate links — a condition of the data
  license.
- **Fonts — SIL OFL 1.1.** Press Start 2P and Inter, self-hosted from Fontsource packages; license text with
  both copyright notices in [`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt) (also served with the site at
  `/licenses/OFL-1.1.txt`).
- **Libraries.** Open-source libraries under their own licenses. The libraries the site uses are listed in
  [`NOTICE`](NOTICE) (MIT, ISC); with the packages they include, the bundled code is under MIT, ISC,
  BSD-3-Clause and 0BSD licenses (the two font packages are SIL OFL 1.1, above). `npm run build` generates the
  full license text of every bundled package at `dist/licenses/third-party-software.txt`, served at
  `/licenses/third-party-software.txt`; the few indirect packages that ship no license file are named there
  without a text.
- **Code license — MIT.** The application source code is under the MIT License: [`LICENSE`](LICENSE). It does
  not cover the third-party material above, which keeps its own licenses.
- **Takedown contact:** this project's
  [GitHub Issues page](https://github.com/MuratAlkan06/terraria-companion/issues). An email address chosen by the
  owner later can replace it (see below).

## Takedown runbook (sprites)

The takedown lever is the `fallbackMode` flag (ADR-001 D3; AMENDMENTS-016 B112(b)). When it is `true`, every
page draws the original placeholder silhouette instead of a Re-Logic sprite and loads no sprite files.

**Flip point: `public/sprites/manifest.index.json`.** It is the sprite file the app reads first, and the only
one it reads in fallback mode — fetched at runtime from `/sprites/manifest.index.json`, not bundled — so the
hand-edit target is this file
(in `public/` for a rebuild, or in an existing `dist/` for an emergency redeploy without one).
`public/sprites/manifest.json` carries a copy of the flag as the committed provenance record.

1. **Flip.** In `public/sprites/manifest.index.json` change `"fallbackMode":false` to `"fallbackMode":true`,
   and make the same change in `public/sprites/manifest.json` so the record agrees. In the same commit,
   update the pin in `pipeline/validate/emitted.test.ts` that expects the committed manifest's flag to be
   `false` (the test that the index matches the record stays as is).
2. **Remove the images.** The flag stops the app drawing sprites, but deployed image files stay reachable by
   URL. Delete the downloaded binaries and keep the manifests:
   `find public/sprites -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +`
   (for an emergency redeploy, run the same on `dist/sprites` and apply step 1 to
   `dist/sprites/manifest.index.json`).
3. **Build and deploy.** `npm run build`, check that `dist/sprites/` holds only `manifest*.json`, deploy
   `dist/`, then purge the host's cache for `/sprites/*`.
4. **Verify on the live site.** A weapon or item page shows the stone placeholder;
   `curl -sI https://<site>/sprites/items/<id>.png` no longer answers `content-type: image/png` (the SPA
   fallback serves `index.html` instead).
5. **Keep it flipped.** `npm run pipeline:build` rewrites both manifests with `"fallbackMode":false`, and
   `npm run pipeline:sprites` downloads the images again — re-apply steps 1–2 after either.
6. **Close the loop.** Reply to the requester from the takedown contact and record the request (date, scope,
   what was removed) in the amendments chain (`docs/AMENDMENTS-*.md`).

Takedown contact: this project's
[GitHub Issues page](https://github.com/MuratAlkan06/terraria-companion/issues).

### Before any public deployment

The owner inputs are in place: the code license is MIT ([`LICENSE`](LICENSE)) and the takedown contact is the
Issues page above. What remains is the deployment itself — see [`docs/RELEASE.md`](docs/RELEASE.md) §6.

**Changing the takedown contact.** An email address chosen by the owner later can replace the Issues page: set
`takedownContact` in `src/app/site.ts` (the licensing page shows it) and update the "Takedown contact" lines in
this file and in `NOTICE` in the same commit — a test requires all three to agree.
