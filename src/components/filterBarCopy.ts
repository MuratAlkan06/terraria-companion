/**
 * FilterBar's count wording (AMENDMENTS-016 B136): the sheet's button agrees in number — "Show 1 set", "Show 14 sets".
 * Callers pass a regular plural noun ("weapons", "accessories", "sets", "items"); its singular drops the "s" ("-ies" → "-y").
 */
export const singularNoun = (plural: string): string => (/ies$/.test(plural) ? plural.replace(/ies$/, 'y') : plural.replace(/s$/, ''))

export const showResults = (count: number, plural: string): string => `Show ${count.toLocaleString('en-US')} ${count === 1 ? singularNoun(plural) : plural}`
