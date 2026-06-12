import { ISigner, TDraftEvent } from '@/types'
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, getPublicKey as nGetPublicKey, nip04, nip19 } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import * as nip44v3 from '@/lib/nip44v3'

export class NsecSigner implements ISigner {
  private privkey: Uint8Array | null = null
  private pubkey: string | null = null

  login(nsecOrPrivkey: string | Uint8Array) {
    let privkey
    if (typeof nsecOrPrivkey === 'string') {
      const { type, data } = nip19.decode(nsecOrPrivkey)
      if (type !== 'nsec') {
        throw new Error('invalid nsec')
      }
      privkey = data
    } else {
      privkey = nsecOrPrivkey
    }

    this.privkey = privkey
    this.pubkey = nGetPublicKey(privkey)
    return this.pubkey
  }

  async getPublicKey() {
    if (!this.pubkey) {
      throw new Error('Not logged in')
    }
    return this.pubkey
  }

  async signEvent(draftEvent: TDraftEvent) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }

    return finalizeEvent(draftEvent, this.privkey)
  }

  async nip04Encrypt(pubkey: string, plainText: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    return nip04.encrypt(this.privkey, pubkey, plainText)
  }

  async nip04Decrypt(pubkey: string, cipherText: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    return nip04.decrypt(this.privkey, pubkey, cipherText)
  }

  async nip44Encrypt(pubkey: string, plainText: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    const conversationKey = nip44.utils.getConversationKey(this.privkey, pubkey)
    return nip44.encrypt(plainText, conversationKey)
  }

  async nip44Decrypt(pubkey: string, cipherText: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    const conversationKey = nip44.utils.getConversationKey(this.privkey, pubkey)
    return nip44.decrypt(cipherText, conversationKey)
  }

  supportsNip44v3(): boolean {
    return true
  }

  async nip44v3Encrypt(pubkey: string, plainText: string, kind: number, scope: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    const ctx = nip44v3.makeContext(kind, new TextEncoder().encode(scope))
    const plainBytes = new TextEncoder().encode(plainText)
    return nip44v3.encrypt(this.privkey, hexToBytes(pubkey), ctx, plainBytes)
  }

  async nip44v3Decrypt(pubkey: string, cipherText: string, kind: number, scope: string) {
    if (!this.privkey) {
      throw new Error('Not logged in')
    }
    const ctx = nip44v3.makeContext(kind, new TextEncoder().encode(scope))
    const plain = nip44v3.decrypt(this.privkey, hexToBytes(pubkey), ctx, cipherText)
    return new TextDecoder().decode(plain)
  }
}
