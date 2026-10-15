# Terraria Companion

A free, non-commercial, unofficial companion site for Terraria (desktop): weapon, item and boss data built
from the Official Terraria Wiki, plus planning tools. A static single-page app (Vite + React); the design
documents live in [`docs/`](docs/).

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
- **Libraries.** Open-source libraries under their own licenses (MIT, ISC) — listed in [`NOTICE`](NOTICE).
- **Code license: not yet chosen by the owner.** There is no `LICENSE` file for the source code.
- **Takedown contact:** [contact pending — see below]

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

Takedown contact: [contact pending — see below]

### Before any public deployment

Owner inputs still open:

- **Takedown / contact address.** Set `takedownContact` in `src/app/site.ts` (the licensing page then shows
  it in place of its placeholder) and replace the `[contact pending — see below]` placeholders in this file
  and in `NOTICE`.
- **Code license.** Choose one and add a `LICENSE` file (ADR-001 D3 planned MIT; not confirmed by the owner),
  then update `NOTICE`, this section and, if wanted, the licensing page (it says the data license does not
  cover the source code).
