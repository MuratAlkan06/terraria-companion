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
   * Takedown contact (ADR D3): the repository's GitHub Issues page, set by the owner for the
   * deploy-prep commit. Swappable (e.g. for a mailto: address): change it together with the
   * "Takedown contact" lines in NOTICE and README.md — licensing.test.ts requires all three to agree.
   * While null, the licensing page renders a visible placeholder and a pending note instead.
   */
  takedownContact: {
    label: 'this project’s GitHub Issues',
    href: 'https://github.com/MuratAlkan06/terraria-companion/issues',
  } as { label: string; href: string } | null,
} as const
