import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import type { EventTemplate } from 'nostr-tools'
import type { VerifiedEvent } from 'nostr-tools'

export interface SessionKey {
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<VerifiedEvent>
  /** NIP-44 encrypt using the session keypair. Included to satisfy
   *  `wrapGift`'s senderSigner type (which requires `nip44Encrypt`).
   *  Session keys only ever wrap responses in 'simple' mode, so this
   *  path is not taken in production; it is available for completeness. */
  nip44Encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>
}

const cache = new Map<string, SessionKey>()

export async function getOrCreateSessionKey(workspaceOwner: string): Promise<SessionKey> {
  const existing = cache.get(workspaceOwner)
  if (existing) return existing
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const key: SessionKey = {
    pubkey,
    signEvent: async (template) => finalizeEvent(template, sk),
    nip44Encrypt: async (recipientPubkey, plaintext) => {
      const ck = nip44.utils.getConversationKey(sk, recipientPubkey)
      return nip44.encrypt(plaintext, ck)
    }
  }
  cache.set(workspaceOwner, key)
  return key
}

export function releaseSessionKey(workspaceOwner: string): void {
  cache.delete(workspaceOwner)
}

/** Test-only reset; do not call from production code. */
export function __resetSessionKeysForTests(): void {
  cache.clear()
}
