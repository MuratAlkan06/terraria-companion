/**
 * The readiness checker's import link (AMENDMENTS-016 B106 queue: the loadout → readiness direction;
 * UX_SPEC §3.5 Step 4 "Check Readiness", §3.8 "import saved build"). Dependency-free, so the builder links
 * here without the checker's code: `/readiness?build=<buildId>` loads that saved build's slots, class,
 * difficulty and stage into the setup — the checker keeps its own rules (tracked defeats only).
 */
export const READINESS_PATH = '/readiness'
export const BUILD_PARAM = 'build'

export const readinessBuildHref = (buildId: string): string => `${READINESS_PATH}?${BUILD_PARAM}=${encodeURIComponent(buildId)}`
