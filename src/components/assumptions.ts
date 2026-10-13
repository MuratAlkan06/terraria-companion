/**
 * The data behind an EstimateLabel's AssumptionsTip (UX_SPEC §8). Kept apart from the components
 * so non-UI code (the Lab session, tests) can build and check assumption lists.
 */
export interface Assumption {
  id: string
  title: string
  detail: string
  sourceUrl?: string
}

/** Non-empty by type: every EstimateLabel resolves to a populated AssumptionsTip. */
export type Assumptions = readonly [Assumption, ...Assumption[]]

export function hasAssumptions(list: readonly Assumption[]): list is Assumptions {
  return list.length > 0
}
