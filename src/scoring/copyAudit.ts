/**
 * Readiness / scoring copy audit patterns (SCORING_SPEC §8.4; PRD §9 Feature A AC3; UX_SPEC §10.3;
 * AMENDMENTS-013 forward-promise purge). One source for the engine tests and the UI tests; not
 * imported by app code (tree-shaken from every bundle).
 *
 * Banned: "best"; win / lose and their forms; odds; probability; outcome-chance collocations ("chance
 * to win / of beating"); you will / won't / can / can't beat | defeat | kill | survive | die | win |
 * lose; time-to-kill / time to defeat / TTK; guarantee; readiness verdicts and percentages ("you're
 * ready", "80% ready", "readiness score"); victory / success rate. Legal (§8.4): "crit chance" /
 * "critical strike chance", "drop chance", the "After you defeat {X}" template, defeat-tracking terms
 * ("marked defeated"), and the easier / harder factor tones (§6).
 */
export const BANNED_OUTCOME =
  /\bbest\b|\b(?:win|wins|winning|lose|loses|losing)\b|\bodds\b|\bprobab\w*|\bguarantee\w*|\bchances? (?:to|of) (?:win|beat|defeat|survive|kill|winning|beating|defeating|surviving|success)\b|\byou(?:'|’)?(?:ll| will| won(?:'|’)t| can(?:'|’)t| cannot| can)\s+(?:beat|defeat|kill|survive|die|win|lose)\b|\btime.to.(?:kill|defeat|beat)\b|\bTTK\b|\b(?:you(?:'|’)re|you are|not) ready\b|\bready to (?:fight|beat|take on|face)\b|\b\d+\s?%\s?(?:ready|readiness)\b|\breadiness (?:score|percentage|rating|grade)\b|\bvictory\b|\bsuccess rate\b/i

export const FORWARD_PROMISE = /\b(?:yet|coming soon|so far|soon|in a future|future update|will be added)\b/i

/** The first banned phrase in `text`, or undefined. */
export function auditCopy(text: string): string | undefined {
  return BANNED_OUTCOME.exec(text)?.[0] ?? FORWARD_PROMISE.exec(text)?.[0]
}
