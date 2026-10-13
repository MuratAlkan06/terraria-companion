import { LogoMark } from '../../components/art/LogoMark'
import { PixelPanel } from '../../components/PixelPanel'
import { meta } from '../../data/meta'
import { useSelectedStage } from '../settingsStore'
import { SITE } from '../site'
import { getStageInfo } from '../stages'
import { useDocumentTitle } from '../useDocumentTitle'
import { KitShowcase } from './home/KitShowcase'

/**
 * P1-S1 home view: identity, a working stage readout, and the interface-kit
 * preview. The full homepage (hero art, stage chips, primary actions) is P1-S2.
 */
export default function HomePage() {
  useDocumentTitle()
  const stage = useSelectedStage()

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-10">
      <PixelPanel as="section" aria-labelledby="home-title" className="flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
        <LogoMark className="size-16 shrink-0 md:size-24" />
        <div className="min-w-0">
          <h1 id="home-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">
            {SITE.name}
          </h1>
          <p className="mt-3 max-w-prose text-fg-muted">
            A free, fan-made companion for vanilla Terraria {meta.gameVersion} ({SITE.platformLabel}), built on data
            from the Official Terraria Wiki. Anything that can't be verified is marked Unknown — never guessed.
          </p>
          <p className="mt-4 text-sm">
            <span className="text-fg-muted">Your game stage: </span>
            {stage ? (
              <strong className="font-semibold text-accent">{getStageInfo(stage).label}</strong>
            ) : (
              <span className="text-fg">not set — pick one from the stage menu at the top of the page.</span>
            )}
          </p>
        </div>
      </PixelPanel>

      <KitShowcase />
    </div>
  )
}
