import type { ISigner } from '@/types'

// legacy wire namespace — do NOT rename; paired agents match on this string, renaming breaks existing handshakes
export const ATTESTATION_NAMESPACE = 'io.spectr/session-attestation'

/** Versioned format; bump major if wire shape changes. */
export const ATTESTATION_VERSION = 1

export interface Attestation {
  v: number
  workspaceOwner: string
  sessionPubkey: string
  validUntil: number
  sig: string
}

/** Sign the attestation by piggybacking on the workspace owner's signer.
 *  Creates a Nostr-shaped event (kind 27235 — internal jank kind, never published)
 *  so the signer's signEvent path can produce a verifiable signature. The kind
 *  number is excluded from the relay subscription set; the attestation is
 *  delivered inline in MCP initialize responses, not on relays. */
export async function signAttestation(args: {
  workspaceOwner: string
  sessionPubkey: string
  validUntil: number
  signer: ISigner
}): Promise<Attestation> {
  const { workspaceOwner, sessionPubkey, validUntil, signer } = args
  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['v', String(ATTESTATION_VERSION)],
      ['session', sessionPubkey],
      ['exp', String(validUntil)]
    ],
    content: ''
  }
  const signed = await signer.signEvent(unsigned)
  return {
    v: ATTESTATION_VERSION,
    workspaceOwner,
    sessionPubkey,
    validUntil,
    sig: signed.sig
  }
}

/**
 * Structural + expiry validation only. Verifies version, validUntil > now, and
 * a minimum sig length sentinel. Does NOT cryptographically verify the Schnorr
 * signature against `workspaceOwner` — that check is the agent's responsibility
 * (Phase 6 reference agent does it at initialize-handshake time).
 */
export function verifyAttestation(att: Attestation): boolean {
  if (att.v !== ATTESTATION_VERSION) return false
  if (att.validUntil < Math.floor(Date.now() / 1000)) return false
  if (!att.sig || att.sig.length < 16) return false
  return true
}
