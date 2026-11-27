// src/lib/trust-score.ts
//
// Pure decision logic for the trust-score filter, ported from upstream
// Jumble's lib/trust-score (minScore semantics preserved so behavior
// matches). jank loads ranks from Relatr (relatr-trust.service) instead of
// fayan, but the 0-100 percentile scale is the same.
//
// Rank resolution is three-state (see IRelatrTrustService.getFilterRank):
// - number    → Relatr rank 0-100
// - null      → definitively unranked — counts as rank 0, so it fails every
//               threshold > 0 (upstream Jumble reads an unknown percentile
//               as 0; this is what catches fresh throwaway spam accounts)
// - undefined → lookup failed (Relatr unreachable) — fail open, show

/**
 * Whether an author passes a trust-score threshold of `minScore` (0-100).
 *
 * - `minScore` 0 (Off) passes everyone.
 * - The owner (the signed-in account whose perspective the view has) and
 *   anyone in the 2-hop WoT set always pass, at every threshold.
 * - Otherwise the author's filter rank decides: definitively unranked
 *   authors (null) count as rank 0 and fail every threshold > 0; a lookup
 *   failure (undefined) fails open; ranked authors pass when
 *   rank >= minScore. Score 100 therefore means WoT-only (plus ranked
 *   100-percentile authors).
 */
export async function meetsTrustScore(
  pubkey: string,
  ownerPubkey: string | null,
  minScore: number,
  trusted: ReadonlySet<string>,
  loadRank: (pubkey: string) => Promise<number | null | undefined>
): Promise<boolean> {
  if (minScore <= 0 || pubkey === ownerPubkey || trusted.has(pubkey)) return true
  const rank = await loadRank(pubkey)
  if (rank === undefined) return true
  return (rank ?? 0) >= minScore
}
