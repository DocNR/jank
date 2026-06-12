/**
 * Pure presentational helpers for the AgentDrawer. Extracted so the alignment
 * and input-disabled logic is unit-testable without a DOM component harness
 * (the repo's vitest setup has no @testing-library/react; see PR notes).
 */

/**
 * Logical alignment for a message bubble. The owner's own messages sit at the
 * `end` (right in LTR, flips under RTL); the agent's at the `start` (left).
 * Returned as logical edges so callers can map to `self-end` / `self-start`
 * Tailwind classes that respect `dir`.
 */
export function bubbleAlignment(
  fromPubkey: string,
  ownerPubkey: string
): 'start' | 'end' {
  return fromPubkey === ownerPubkey ? 'end' : 'start'
}

/** The chat input is disabled when the column is view-only or has no signer. */
export function isChatInputDisabled(opts: { viewOnly: boolean; hasSigner: boolean }): boolean {
  return opts.viewOnly || !opts.hasSigner
}

/**
 * Whether the active account is view-only (cannot sign/encrypt DMs). A
 * watch-only `npub` account still has an NpubSigner registered, so a bare
 * "is a signer registered?" check reports a false positive — its
 * `nip04Encrypt`/`signEvent` throw. Anything other than a real signing type
 * (or an absent type) is treated as view-only.
 */
export function isViewOnlyAccount(signerType: string | undefined): boolean {
  const signingTypes = ['nsec', 'browser-nsec', 'nip-07', 'bunker', 'ncryptsec']
  return !signerType || !signingTypes.includes(signerType)
}
