/**
 * Pure presentational helpers for chat components. Extracted so the alignment
 * and input-disabled logic is unit-testable without a DOM component harness.
 */

/**
 * Logical alignment for a message bubble. The owner's own messages sit at the
 * `end` (right in LTR, flips under RTL); the other party's at the `start` (left).
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
