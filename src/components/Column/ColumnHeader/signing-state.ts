// src/components/Column/ColumnHeader/signing-state.ts

/**
 * The three signing-clarity states a column header can be in, derived from the
 * column's (viewContext, signingIdentity) pair. Drives <SigningIndicator>.
 */
export type TSigningState = 'quiet' | 'loud' | 'view-only'

/**
 * - `view-only`: no paired signing account on this device (`signingIdentity === null`).
 * - `quiet`: the column signs as its baseline account (default baseline is
 *   `viewContext` — "signs as the account whose feed it shows"). Callers that
 *   need a different baseline (e.g. profile columns, where `viewContext` is the
 *   subject and the right baseline is the viewer's active account) pass
 *   `baselinePubkey` explicitly.
 * - `loud`: the column signs as a *different* account — the mis-sign safety case.
 */
export function signingState(
  viewContext: string,
  signingIdentity: string | null,
  baselinePubkey?: string
): TSigningState {
  if (signingIdentity === null) return 'view-only'
  const baseline = baselinePubkey ?? viewContext
  if (signingIdentity === baseline) return 'quiet'
  return 'loud'
}
