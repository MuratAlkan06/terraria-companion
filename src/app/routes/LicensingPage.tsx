import type { ReactNode } from 'react'
import { PixelPanel } from '../../components/PixelPanel'
import { meta } from '../../data/meta'
import { SITE } from '../site'
import { useDocumentTitle } from '../useDocumentTitle'

/**
 * /about/licensing (ADR D3, AMENDMENTS-001 A8 AC5): CC BY-NC-SA 4.0 attribution,
 * Re-Logic notice, non-commercial statement and takedown contact. Lazy chunk.
 */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <PixelPanel as="section" aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-base leading-relaxed text-accent text-shadow-pixel">
        {title}
      </h2>
      {children}
    </PixelPanel>
  )
}

export default function LicensingPage() {
  useDocumentTitle('Licensing')
  const takedown = SITE.takedownContact

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:py-10">
      <header className="space-y-3">
        <h1 className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">
          Licensing &amp; attribution
        </h1>
        <p className="text-fg-muted">
          How {SITE.name} uses Terraria data and artwork, and how to reach us about it.
        </p>
      </header>

      <Section id="lic-data" title="Game data">
        <p className="border-l-4 border-gold-500 bg-night-900 px-4 py-3 font-semibold text-fg">{SITE.attribution}</p>
        <p>
          Item, weapon, boss and recipe data is derived from the{' '}
          <ExternalLink href={SITE.wikiUrl}>Official Terraria Wiki</ExternalLink> (terraria.wiki.gg), whose text is
          licensed under <ExternalLink href={SITE.licenseUrl}>{SITE.licenseName}</ExternalLink> (see the wiki&rsquo;s{' '}
          <ExternalLink href={SITE.wikiCopyrightsUrl}>copyright policy</ExternalLink>).
        </p>
        <p>
          Under the same share-alike terms, the datasets this site derives from the wiki are published under{' '}
          {SITE.licenseName}. The application&rsquo;s source code is licensed separately from the data.
        </p>
        <p>
          All data is pinned to Terraria <strong className="text-fg tabular-nums">{meta.gameVersion}</strong> (
          {SITE.platformLabel}). Every data-driven page links to its source page on the wiki; values that could not be
          verified are shown as &ldquo;Unknown&rdquo;, never guessed.
        </p>
      </Section>

      <Section id="lic-relogic" title="Re-Logic notice">
        <p>
          Terraria and all related names, artwork, sprites and audio are &copy; Re-Logic. Item and character sprites
          are Re-Logic&rsquo;s property and are <strong className="text-fg">not</strong> covered by the wiki&rsquo;s
          Creative Commons license; where shown, they are used for non-commercial, informational purposes with
          attribution to Re-Logic and the wiki file they came from.
        </p>
        <p>
          {SITE.name} is an unofficial fan project. It is not affiliated with, endorsed by or sponsored by Re-Logic or
          the Terraria Wiki. Site decoration — backgrounds, logo and interface art — is original pixel art.
        </p>
      </Section>

      <Section id="lic-noncommercial" title="Non-commercial">
        <p>
          {SITE.name} is free and non-commercial, permanently: no ads, no paid features, no affiliate links and no
          monetization of any kind. This is a condition of the {SITE.licenseName} license the data is used under.
        </p>
      </Section>

      <Section id="lic-takedown" title="Takedown requests">
        <p>
          If you are a rights holder and want content removed or changed, please contact us and we will act
          promptly.
        </p>
        {takedown ? (
          <p>
            Contact: <ExternalLink href={takedown.href}>{takedown.label}</ExternalLink>
          </p>
        ) : (
          <p className="border-2 border-dashed border-border-strong px-4 py-3 text-fg-muted">
            <strong className="text-fg">Contact: placeholder.</strong> A takedown contact address has not been
            published yet; it will be listed here before the site is publicly deployed.
          </p>
        )}
      </Section>
    </div>
  )
}
