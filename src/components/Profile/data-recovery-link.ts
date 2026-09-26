/**
 * Whether a profile shows the link to data recovery. Recovery scans and
 * restores the active account, so the link only shows on your own profile in
 * a column that signs as that account. In a column for another paired account
 * it would open recovery for a different account than the one on screen.
 */
export function showsDataRecoveryLink({
  profilePubkey,
  signingPubkey,
  activePubkey
}: {
  profilePubkey: string | undefined
  signingPubkey: string | null | undefined
  activePubkey: string | null | undefined
}): boolean {
  return !!signingPubkey && signingPubkey === profilePubkey && signingPubkey === activePubkey
}
