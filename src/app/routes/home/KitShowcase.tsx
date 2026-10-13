import { useState } from 'react'
import { InventoryGrid } from '../../../components/InventoryGrid'
import { ItemSlot } from '../../../components/ItemSlot'
import { PixelPanel } from '../../../components/PixelPanel'
import { TerrariaTooltip } from '../../../components/TerrariaTooltip'
import { SAMPLE_ITEMS } from './sampleItems'

/**
 * Interface-kit preview (PRD P1-S1 AC4): InventoryGrid + ItemSlot + TerrariaTooltip
 * rendered with mock props. Hover/focus a slot for the floating tooltip; select a
 * slot to pin its tooltip in the inspector (works on touch, too).
 */
const SLOT_COUNT = 10

export function KitShowcase() {
  const [selected, setSelected] = useState(0)
  const selectedItem = SAMPLE_ITEMS[selected]

  return (
    <PixelPanel as="section" tone="stone" aria-labelledby="kit-title">
      <h2 id="kit-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel">
        Interface kit
      </h2>
      <p className="mt-2 max-w-prose text-sm text-fg-muted">
        The inventory slots and item tooltips used across the site. These are sample items with made-up values — not
        game data. Hover or focus a slot for its tooltip; select one to pin it below.
      </p>

      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
        <div className="border-2 border-night-600 bg-night-900/60 p-2 md:w-fit">
          <InventoryGrid label="Sample inventory" columns={5}>
            {Array.from({ length: SLOT_COUNT }, (_, index) => {
              const item = SAMPLE_ITEMS[index]
              return item ? (
                <ItemSlot
                  key={item.name}
                  item={item}
                  tooltip={item.tooltip}
                  selected={index === selected}
                  onSelect={() => setSelected(index)}
                />
              ) : (
                <ItemSlot key={`empty-${index}`} />
              )
            })}
          </InventoryGrid>
        </div>

        <div className="min-w-0">
          <p id="kit-inspector-label" className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Selected item
          </p>
          <div aria-labelledby="kit-inspector-label" role="region" aria-live="polite">
            <TerrariaTooltip {...selectedItem.tooltip} className="max-w-full" />
          </div>
        </div>
      </div>
    </PixelPanel>
  )
}
