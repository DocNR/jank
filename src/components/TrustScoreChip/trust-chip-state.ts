export type TTrustChipState = 'score' | 'calculate' | 'none'

/**
 * Decide what a UserItem trust chip should render.
 * - `number`    → 'score'     (Relatr has a rank)
 * - `null`      → 'calculate' (asked Relatr, no rank: offer on-demand compute
 *                              for anyone — follow or stranger. A stranger with
 *                              no path still gets a useful "no trust path" reply.)
 * - `undefined` → 'none'      (not asked yet / cache expired)
 */
export function trustChipState(rank: number | null | undefined): TTrustChipState {
  if (typeof rank === 'number') return 'score'
  if (rank === null) return 'calculate'
  return 'none'
}
