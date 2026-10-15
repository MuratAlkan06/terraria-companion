import { ArrowLeft, FileText, Info } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelPanel } from '../../../components/PixelPanel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { behaviorSourceUrl, homesInGame, inGameDescription, notSimulatedReason, UNASSIGNED_LIMITATION_PLAIN, type LabNotice } from '../../../lab/labWeapons'
import { getField } from '../../../schemas/getField'
import { weaponHref } from '../db/weapons/weaponNav'
import { HOMING_SETTING_LABEL, homingUnavailableNote } from './settingsCopy'
import { HOMING_SETTING_ID, SettingSwitch } from './TargetSettingsPanel'

/**
 * LimitationCard (UX_SPEC §8, fixed anatomy): (1) weapon identity, (2) "What it does in-game" —
 * verified text + ProvenanceLink, (3) "Why it isn't simulated" in plain language, (4) actions
 * "Open weapon page" + "Back to weapons". Shown over the arena (reduced emphasis behind it) when a
 * `?weapon=` link names a weapon the Lab can't equip; the fallback sword is already equipped, so
 * the Lab never looks broken. A not-found id gets a short notice instead.
 *
 * PRD P3-S8: when the weapon's data says it homes (src/lab/labWeapons.ts `homesInGame`), the card also
 * shows the homing switch DISABLED with the reason — the what-if (homing disabled) needs the weapon
 * simulated. It shows the weapon's real behavior (on), never a working control.
 */
export const LIMITATION_TITLE_ID = 'lab-limitation-title'

export interface LimitationCardProps {
  notice: LabNotice
  /** The weapon equipped instead. */
  fallback: Weapon
  sprites: SpriteIndex | null
  /** Dismiss and return to choosing a weapon. */
  onBack: () => void
}

export function LimitationCard({ notice, fallback, sprites, onBack }: LimitationCardProps) {
  if (notice.kind === 'not-found') {
    return (
      <PixelPanel as="section" aria-labelledby={LIMITATION_TITLE_ID} className="w-full max-w-md space-y-3">
        <h2 id={LIMITATION_TITLE_ID} tabIndex={-1} className="flex items-center gap-2 font-semibold focus:outline-none">
          <Info aria-hidden="true" className="size-5 shrink-0 text-accent" />
          No weapon with that ID
        </h2>
        <p className="text-sm text-fg-muted">
          The link asked for weapon “<span className="break-all text-fg">{notice.requested}</span>”, which isn’t in the
          Terraria dataset. {fallback.name} is equipped instead.
        </p>
        <button type="button" onClick={onBack} className={buttonClass('primary')}>
          <ArrowLeft aria-hidden="true" className="size-5" />
          Back to weapons
        </button>
      </PixelPanel>
    )
  }

  const { weapon, status } = notice
  const rarityView = getField(weapon, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const description = inGameDescription(weapon)
  const reason = notSimulatedReason(status)
  // The weapon's own limitation reason (not the default sentence) says what it does that the Lab
  // doesn't model — so with no separate description, point at it rather than contradict it.
  const reasonDescribes = status.kind === 'not-simulable' && status.refusal.reason === 'limitation' && reason !== UNASSIGNED_LIMITATION_PLAIN

  return (
    <PixelPanel as="section" aria-labelledby={LIMITATION_TITLE_ID} className="w-full max-w-lg space-y-4" data-limitation-card="">
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center border-2 border-slot-border bg-slot">
          <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={48} maxScale={3} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Not simulated in the Lab</p>
          <h2 id={LIMITATION_TITLE_ID} tabIndex={-1} className="text-lg leading-snug font-semibold focus:outline-none">
            <RarityText rarity={rarity}>{weapon.name}</RarityText>
          </h2>
        </div>
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-fg">What it does in-game</h3>
        {/* A15: wiki-derived text renders as plain text. No verified text: say so (never filler); the source link follows. */}
        <p className="text-sm whitespace-pre-line text-fg-muted" data-limitation-description={description ? 'verified' : 'none'}>
          {description ?? (reasonDescribes ? 'No separate description verified — see below.' : 'No verified description yet.')}
        </p>
        <ProvenanceLink href={behaviorSourceUrl(weapon)} label="How it behaves, on the wiki" srContext={`(${weapon.name})`} />
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-fg">Why it isn’t simulated</h3>
        <p className="text-sm text-fg-muted">{reason}</p>
      </div>

      {homesInGame(weapon) ? (
        <div className="space-y-1" data-lab-setting="homing" data-homing-toggle="unavailable">
          <h3 className="text-sm font-semibold text-fg">Test settings</h3>
          <SettingSwitch id={HOMING_SETTING_ID} label={HOMING_SETTING_LABEL} checked disabled stateText="Unavailable" onChange={() => {}} />
          <p id={`${HOMING_SETTING_ID}-help`} className="text-xs text-fg-muted">
            {homingUnavailableNote(weapon.name)}
          </p>
        </div>
      ) : null}

      <p className="text-sm">
        <span className="font-semibold">{fallback.name}</span> is equipped instead, so you can keep testing.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link to={weaponHref(weapon.id)} className={buttonClass('secondary')}>
          <FileText aria-hidden="true" className="size-5" />
          Open weapon page
        </Link>
        <button type="button" onClick={onBack} className={buttonClass('primary')}>
          <ArrowLeft aria-hidden="true" className="size-5" />
          Back to weapons
        </button>
      </div>
    </PixelPanel>
  )
}
