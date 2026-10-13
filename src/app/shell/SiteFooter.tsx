import { Link, NavLink } from 'react-router'
import { formatGeneratedDate, meta } from '../../data/meta'
import { navItemsFor } from '../nav'
import { pathFor } from '../routes'
import { SITE } from '../site'

/**
 * Footer on every route (UX_SPEC §2, §10.10; ADR D1/D3; AMENDMENTS-001 A8).
 * - Version pin read from src/data/meta.json (never hard-coded here).
 * - Verbatim ADR D3 attribution linking /about/licensing.
 * - Secondary links come from the route registry ("footer" surface).
 */
export function SiteFooter() {
  const links = navItemsFor('footer')

  return (
    // Bottom padding clears the fixed mobile tab bar (+ safe area); none from lg up.
    <footer className="mt-12 bg-surface-sunken pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px))] text-sm text-fg-muted lg:pb-0">
      {/* Decorative pixel ground strip: grass over dirt. */}
      <div
        aria-hidden="true"
        className="h-2 bg-[repeating-linear-gradient(90deg,var(--color-forest-500)_0_8px,var(--color-forest-400)_8px_16px)]"
      />
      <div
        aria-hidden="true"
        className="h-2 bg-[repeating-linear-gradient(90deg,var(--color-earth-600)_0_6px,var(--color-earth-700)_6px_14px)]"
      />
      <div className="mx-auto max-w-7xl space-y-3 px-4 py-6 md:px-6">
        <p>
          Data: Terraria <strong className="font-semibold text-fg tabular-nums">{meta.gameVersion}</strong> (
          {SITE.platformLabel}) · generated{' '}
          <time dateTime={meta.generatedAt} className="whitespace-nowrap tabular-nums">
            {formatGeneratedDate(meta.generatedAt)}
          </time>
          {meta.stub ? ' (placeholder)' : null}
        </p>
        <p>
          <Link
            to={pathFor('licensing')}
            className="inline-flex min-h-tap items-center text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
          >
            {SITE.attribution}
          </Link>
        </p>
        <p>
          Free, non-commercial fan project — no ads, no monetization. Not affiliated with or endorsed by{' '}
          <span className="whitespace-nowrap">Re-Logic</span> or the Terraria Wiki. Rights holders: takedown contact on
          the Licensing page.
        </p>
        {links.length > 0 ? (
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6">
              {links.map((link) => (
                <li key={link.id}>
                  <NavLink
                    to={link.to}
                    end={link.to === '/'}
                    className="inline-flex min-h-tap items-center font-semibold text-fg underline-offset-4 hover:text-accent hover:underline aria-[current=page]:text-accent"
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  )
}
