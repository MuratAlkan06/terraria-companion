/**
 * Site-wide constants: identity, licensing copy and external references (ADR D3).
 * The game version is NOT here — it comes from src/data/meta.json (ADR D1).
 */
export const SITE = {
  name: 'Terraria Companion',
  /** ADR D3 attribution, verbatim. Rendered in the footer on every route. */
  attribution: 'Data from the Official Terraria Wiki, CC BY-NC-SA 4.0 — Terraria content © Re-Logic',
  /** Platform the dataset is pinned to (ADR D1: Desktop). */
  platformLabel: 'Desktop',
  wikiUrl: 'https://terraria.wiki.gg/',
  wikiCopyrightsUrl: 'https://terraria.wiki.gg/wiki/Terraria_Wiki:Copyrights',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  licenseName: 'CC BY-NC-SA 4.0',
  /**
   * Takedown contact (ADR D3). PLACEHOLDER: no address has been published yet.
   * Set `href` (mailto: or URL) and `label` before public deployment; the
   * licensing page renders a visible "placeholder" notice while this is null.
   */
  takedownContact: null as { label: string; href: string } | null,
} as const
