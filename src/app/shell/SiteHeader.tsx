import { Link, NavLink } from 'react-router'
import { LogoMark } from '../../components/art/LogoMark'
import { cx } from '../../components/cx'
import { StageSelectorCompact } from '../../components/StageSelectorCompact'
import { navItemsFor } from '../nav'
import { SITE } from '../site'

/**
 * Header (UX_SPEC §2; AMENDMENTS-001 A8: no OmniSearch until P2-S4).
 * Logo mark + wordmark (wordmark from md up), data-driven primary nav (lg up;
 * the bottom tab bar covers smaller screens), StageSelectorCompact far right.
 */
export function SiteHeader() {
  const items = navItemsFor('header')

  return (
    // Fully opaque so scrolled content never ghosts through the sticky bar (design review N4).
    <header className="sticky top-0 z-(--z-nav) border-b-2 border-panel-border bg-surface shadow-pixel-drop">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 md:px-6">
        <Link to="/" className="flex min-h-tap min-w-tap shrink-0 items-center gap-3 pr-1">
          <LogoMark className="size-9" />
          <span className="sr-only md:not-sr-only md:font-display md:text-base md:text-accent md:text-shadow-pixel">
            {SITE.name}
          </span>
        </Link>

        {items.length > 0 ? (
          <nav aria-label="Primary" className="ml-4 hidden lg:block">
            <ul className="flex items-center gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'relative flex min-h-tap items-center px-3 text-sm font-semibold transition-colors duration-(--dur-ui)',
                        'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5',
                        isActive ? 'text-accent after:bg-accent' : 'text-fg-muted hover:text-fg',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="ml-auto">
          <StageSelectorCompact />
        </div>
      </div>
    </header>
  )
}
