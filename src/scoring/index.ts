/**
 * src/scoring barrel (SCORING_SPEC §7): pure TypeScript scoring modules, no React / DOM / sim / lab
 * (§8.3 boundary, src/scoring/progress.test.ts). P5-S6/S7 (Feature A) ships constants, proxies,
 * candidates, readiness and improve; P4-S2 (the loadout builder) adds recommend.ts (recommendLoadout,
 * slotOptions) and goals.ts (scoreBuild — §5.1 components for one build). Its wording lives in
 * builderCopy.ts (imported as a namespace by its consumers). compareLoadouts arrives with P4-S4.
 */
export * from './constants'
export * from './progress'
export * from './proxies'
export * from './candidates'
export * from './readinessCopy'
export * from './readiness'
export * from './improve'
export * from './goals'
export * from './recommend'
