// src/lib/trust-score.ts
//
// Pure decision logic for the trust-score filter, ported from upstream
// Jumble's lib/trust-score (minScore semantics preserved so behavior
// matches). jank loads ranks from Relatr (relatr-trust.service) instead of
// fayan, but the 0-100 percentile scale and fail-open semantics are the same.

/**
 * Whether an author passes a trust-score threshold of `minScore` (0-100).
 *
 * - `minScore` 0 (Off) passes everyone.
 * - The owner (the signed-in account whose perspective the view has) and
 *   anyone in the 2-hop WoT set always pass, at every threshold.
 * - Otherwise the author's Relatr rank is consulted: unranked authors pass
 *   (fail-open, same as relatr-trust.service's consumer contract); ranked
 *   authors pass when rank >= minScore. Score 100 therefore means WoT-only:
 *   a non-WoT author needs a perfect 100 rank to pass.
 */
export async function meetsTrustScore(
  pubkey: string,
  ownerPubkey: string | null,
  minScore: number,
  trusted: ReadonlySet<string>,
  loadRank: (pubkey: string) => Promise<number | null>
): Promise<boolean> {
  if (minScore <= 0 || pubkey === ownerPubkey || trusted.has(pubkey)) return true
  const rank = await loadRank(pubkey)
  return rank === null || rank >= minScore
}
