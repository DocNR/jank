/**
 * NIP-78 deck-sync encrypt/decrypt with NIP-44 v3 + fallback to v2.
 *
 * jank stores per-account workspace state as a kind-30078 event with
 * d-tag "spectr_decks", content NIP-44-self-encrypted (A == B). v3 adds
 * authenticated context binding kind + scope into the MAC, so signers with
 * cross-context grant restrictions can authorize this specific kind/scope
 * rather than granting "any nip44_encrypt".
 *
 * Strategy: prefer v3 when the signer reports support; otherwise fall back
 * to v2. On decrypt, sniff the wire's version byte (0x03 vs 0x02) so existing
 * v2-encrypted remotes still decrypt after a client upgrade.
 */

import { base64 } from '@scure/base'
import type { ISigner } from '@/types'

export const DECK_SYNC_KIND = 30078
export const DECK_SYNC_SCOPE = 'spectr_decks'

/**
 * Returns the NIP-44 wire version byte (typically 2 or 3) of a base64-encoded
 * ciphertext, or `null` if the input is empty, invalid base64, or starts with
 * the `#` future-format sentinel.
 */
export function detectNip44Version(wire: string): number | null {
  if (wire.length === 0) return null
  if (wire.charCodeAt(0) === 0x23) return null
  try {
    const raw = base64.decode(wire)
    if (raw.length === 0) return null
    return raw[0]
  } catch {
    return null
  }
}

export async function encryptWorkspaceContent(signer: ISigner, pubkey: string, plain: string): Promise<string> {
  if (signer.supportsNip44v3?.() && signer.nip44v3Encrypt) {
    return signer.nip44v3Encrypt(pubkey, plain, DECK_SYNC_KIND, DECK_SYNC_SCOPE)
  }
  return signer.nip44Encrypt(pubkey, plain)
}

export async function decryptWorkspaceContent(signer: ISigner, pubkey: string, wire: string): Promise<string> {
  const version = detectNip44Version(wire)
  if (version === 3) {
    if (!signer.nip44v3Decrypt) {
      // fetchWorkspace() catches this and turns it into null, so without
      // a log line the user sees their workspace silently disappear when
      // logging in with a v2-only signer against a v3-encrypted remote.
      // Surface the cause to the dev console so diagnosis doesn't require
      // adding logging from scratch.
      console.warn(
        '[deck-sync] Remote workspace is NIP-44 v3 but the current signer (' +
          (signer.constructor?.name ?? 'unknown') +
          ') does not expose nip44v3Decrypt — workspace will appear absent. ' +
          'Re-login with a v3-capable signer (e.g. a v3-supporting bunker) ' +
          'or re-save the workspace from a v3-capable client to re-encrypt as v2.',
      )
      throw new Error('Wire is NIP-44 v3 but signer does not support it')
    }
    return signer.nip44v3Decrypt(pubkey, wire, DECK_SYNC_KIND, DECK_SYNC_SCOPE)
  }
  if (version === 2) {
    return signer.nip44Decrypt(pubkey, wire)
  }
  throw new Error(`Unsupported NIP-44 wire version: ${version}`)
}
