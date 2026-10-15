import type { PartiallyVerifiedItem } from './PartiallyVerifiedBadge'

/**
 * One line of the "Partially verified" list: its label, and how many of the counted values it stands
 * for when that is more than one, so the lines add up to the count above them (design review nit:
 * "5 values" over three lines).
 */
export const unknownItemLine = (item: PartiallyVerifiedItem): string => ((item.count ?? 1) > 1 ? `${item.label} (${item.count} values)` : item.label)
