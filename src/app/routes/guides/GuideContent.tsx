import { ChevronDown, Lightbulb } from 'lucide-react'
import { InventoryGrid } from '../../../components/InventoryGrid'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import type { GuideData } from './guideData'
import { RichText, SlotCell } from './GuideLinks'
import { citedPages, wikiTitle, wikiUrl, type Block, type Guide } from './guideModel'

/**
 * A guide's prose (UX_SPEC §3.10): intro, sections of paragraphs / tips / linked ItemSlot rows, the
 * optional "Advanced" part as a native disclosure (collapsed by default, keyboard-operable, no
 * animation to reduce), and the wiki articles the guide cites.
 */
const SECTION_TITLE = 'font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base'

export function GuideContent({ guide, data }: { guide: Guide; data: GuideData }) {
  return (
    <div className="space-y-8">
      <div className="space-y-3 text-lg leading-relaxed">
        {guide.intro.map((rich, index) => (
          <p key={index}>
            <RichText rich={rich} data={data} />
          </p>
        ))}
      </div>

      {guide.sections.map((section) => (
        <section key={section.id} aria-labelledby={`guide-sec-${section.id}`} className="space-y-4">
          <h2 id={`guide-sec-${section.id}`} className={SECTION_TITLE}>
            {section.title}
          </h2>
          <Blocks blocks={section.blocks} data={data} />
        </section>
      ))}

      {guide.advanced ? (
        <details className="group border-2 border-panel-border bg-panel shadow-pixel">
          <summary className="flex min-h-tap items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-xs font-semibold tracking-wide text-fg-muted uppercase">Advanced</span>
              <span className="block font-semibold text-fg">{guide.advanced.title}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-fg-muted transition-transform duration-(--dur-ui) ease-out-strong group-open:rotate-180"
            />
          </summary>
          <div className="space-y-4 border-t-2 border-panel-border px-4 py-4">
            <Blocks blocks={guide.advanced.blocks} data={data} />
          </div>
        </details>
      ) : null}

      <Sources guide={guide} />
    </div>
  )
}

function Blocks({ blocks, data }: { blocks: readonly Block[]; data: GuideData }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'p':
            return (
              <p key={index} className="leading-relaxed">
                <RichText rich={block.text} data={data} />
              </p>
            )
          case 'tips':
            return (
              <aside key={index} aria-label="Tips" className="border-2 border-forest-700 bg-forest-900 p-3 shadow-pixel md:p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-forest-200">
                  <Lightbulb aria-hidden="true" className="size-4 shrink-0" />
                  Tips
                </p>
                <ul className="mt-2 list-[square] space-y-1.5 pl-5 leading-relaxed marker:text-forest-300">
                  {block.items.map((rich, i) => (
                    <li key={i}>
                      <RichText rich={rich} data={data} />
                    </li>
                  ))}
                </ul>
              </aside>
            )
          case 'list':
            return (
              <ul key={index} className="list-[square] space-y-1.5 pl-5 leading-relaxed marker:text-fg-muted">
                {block.items.map((rich, i) => (
                  <li key={i}>
                    <RichText rich={rich} data={data} />
                  </li>
                ))}
              </ul>
            )
          case 'slots':
            return (
              <div key={index} className="space-y-2">
                <p className="text-sm font-semibold text-fg-muted">{block.label}</p>
                <InventoryGrid label={block.label} cellMinWidth="10rem">
                  {block.items.map((item, i) => (
                    <SlotCell key={i} mention={item} data={data} />
                  ))}
                </InventoryGrid>
              </div>
            )
        }
      })}
    </>
  )
}

/** The wiki articles this guide cites (each fact names its source inline; this is the full list). */
function Sources({ guide }: { guide: Guide }) {
  const pages = citedPages(guide)
  if (pages.length === 0) return null
  return (
    <section aria-labelledby="guide-sources-title" className="space-y-2 border-t-2 border-panel-border pt-6">
      <h2 id="guide-sources-title" className={SECTION_TITLE}>
        Sources
      </h2>
      <p className="text-sm text-fg-muted">
        Item names link to their page on this site, or to their wiki article where this site has none. These Terraria
        Wiki articles back the rest:
      </p>
      <ul className="flex flex-wrap gap-x-4">
        {pages.map((page) => (
          <li key={page}>
            <ProvenanceLink href={wikiUrl(page)} label={wikiTitle(page)} srContext="on terraria.wiki.gg" />
          </li>
        ))}
      </ul>
    </section>
  )
}
