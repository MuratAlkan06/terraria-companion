import { FlaskConical } from 'lucide-react'
import { Link } from 'react-router'
import { hasRoute, pathFor } from '../app/routes'
import type { Weapon } from '../data-access/types'
import { labWeaponSearch, offersLab } from '../lab/labLinks'
import { buttonClass } from './buttonStyles'

/**
 * SendToLabButton (UX_SPEC §3.1, §3.3 ActionRow; flow (b) "Test in Weapon Lab"): opens
 * `/lab?weapon=:id` with the weapon equipped. Present only once the Lab route ships AND the Lab can
 * equip this weapon (data-driven, src/lab/labLinks.ts) — otherwise absent, never a disabled or
 * dead button; the detail page's Lab note says why it isn't simulated.
 *
 * Imports no sim, schema runtime, PixiJS or Lab UI, so pages outside the Lab stay light (ADR D7).
 */
export function SendToLabButton({ weapon, className }: { weapon: Weapon; className?: string }) {
  if (!hasRoute('lab') || !offersLab(weapon)) return null
  return (
    <Link to={`${pathFor('lab')}${labWeaponSearch(weapon.id)}`} className={buttonClass('primary', className)} data-send-to-lab="">
      <FlaskConical aria-hidden="true" className="size-5" />
      Test in Weapon Lab
    </Link>
  )
}
