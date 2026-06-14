import { withSignerApproval } from '@/lib/signer-approval'
import { ISigner, TDraftEvent } from '@/types'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { base64 } from '@scure/base'
import { generateSecretKey } from 'nostr-tools'
import { BunkerSigner as NBunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'

export class BunkerSigner implements ISigner {
  signer: NBunkerSigner | null = null
  private clientSecretKey: Uint8Array
  private pubkey: string | null = null
  /**
   * Tri-state v3 capability: `null` = not yet probed (or describe failed
   * silently), `true` = remote reports `nip44v3_encrypt`, `false` = remote
   * does not. Probed lazily on first describe call after connect — done at
   * login time so the deck-sync flow has a definitive answer before its
   * first encrypt.
   */
  private v3Supported: boolean | null = null

  constructor(clientSecretKey?: string) {
    this.clientSecretKey = clientSecretKey ? hexToBytes(clientSecretKey) : generateSecretKey()
  }

  async login(bunker: string, isInitialConnection = true): Promise<string> {
    const bunkerPointer = await parseBunkerInput(bunker)
    if (!bunkerPointer) {
      throw new Error('Invalid bunker')
    }

    this.signer = NBunkerSigner.fromBunker(this.clientSecretKey, bunkerPointer, {
      onauth: (url) => {
        window.open(url, '_blank')
      }
    })
    if (isInitialConnection) {
      await this.signer.connect()
      // Initial connection (interactive pairing): block on the probe with a
      // timeout so the deck-sync flow has a definitive v3 answer before its
      // first encrypt. This path isn't latency-sensitive (one-time pairing).
      await this.probeNip44v3WithTimeout(3000)
      return await this.getPublicKey()
    }
    // Reconnection (account switch / per-column AccountScope build): the pubkey
    // is already known, so don't block the switch on a `describe` round-trip —
    // awaiting it here regressed account switching from instant to a full relay
    // round-trip (up to the 3s timeout when the remote signer is slow/offline).
    // Warm the v3 capability in the background instead; deck-sync falls back to
    // v2 transparently (wire-version sniff) in the brief window before it lands.
    // probeNip44v3WithTimeout never rejects, so voiding it is safe.
    this.pubkey = bunkerPointer.pubkey
    void this.probeNip44v3WithTimeout(3000)
    return this.pubkey
  }

  private async probeNip44v3(): Promise<void> {
    if (!this.signer) return
    try {
      const result = await this.signer.sendRequest('describe', [])
      // sendRequest returns the raw `result` field from the NIP-46 response.
      // Per spec it's a JSON-encoded array of method names; some bunkers may
      // return the array already parsed. Handle both shapes defensively.
      let methods: unknown
      if (typeof result === 'string') {
        methods = JSON.parse(result)
      } else {
        methods = result
      }
      // Both methods are required: supportsNip44v3() gates both encrypt and
      // decrypt paths through a single flag, so a bunker that advertises only
      // nip44v3_encrypt would let deck-sync encrypt a workspace then fail on
      // decrypt at next login. Demand both before claiming v3 capability.
      this.v3Supported =
        Array.isArray(methods) &&
        methods.includes('nip44v3_encrypt') &&
        methods.includes('nip44v3_decrypt')
    } catch {
      // Bunkers that don't implement describe should fall back to v2 silently.
      this.v3Supported = false
    }
  }

  /**
   * Probe with a timeout. Guarantees `v3Supported` has a definitive boolean
   * value by the time it returns, even if the bunker hangs on the describe
   * RPC. Without this, a slow bunker could leave v3Supported = null and the
   * next encrypt would race against the probe completing.
   */
  private async probeNip44v3WithTimeout(ms: number): Promise<void> {
    await Promise.race([
      this.probeNip44v3().catch(() => {
        this.v3Supported = false
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (this.v3Supported === null) this.v3Supported = false
          resolve()
        }, ms),
      ),
    ])
  }

  async getPublicKey(timeout = 10_000) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    if (!this.pubkey) {
      this.pubkey = await Promise.race([
        this.signer.getPublicKey(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bunker getPublicKey timeout')), timeout)
        )
      ])
    }
    return this.pubkey
  }

  async signEvent(draftEvent: TDraftEvent) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return withSignerApproval(this.signer.signEvent(draftEvent))
  }

  async nip04Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip04Encrypt(pubkey, plainText)
  }

  async nip04Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip04Decrypt(pubkey, cipherText)
  }

  async nip44Encrypt(pubkey: string, plainText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip44Encrypt(pubkey, plainText)
  }

  async nip44Decrypt(pubkey: string, cipherText: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    return await this.signer.nip44Decrypt(pubkey, cipherText)
  }

  supportsNip44v3(): boolean {
    return this.v3Supported === true
  }

  async nip44v3Encrypt(pubkey: string, plainText: string, kind: number, scope: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    if (this.v3Supported !== true) {
      throw new Error('Bunker does not support nip44 v3')
    }
    // Per extensions/nip46.md: plaintext goes in base64-encoded; ciphertext
    // returns as the canonical base64 wire string.
    const plainB64 = base64.encode(new TextEncoder().encode(plainText))
    return await this.signer.sendRequest('nip44v3_encrypt', [pubkey, String(kind), scope, plainB64])
  }

  async nip44v3Decrypt(pubkey: string, cipherText: string, kind: number, scope: string) {
    if (!this.signer) {
      throw new Error('Not logged in')
    }
    if (this.v3Supported !== true) {
      throw new Error('Bunker does not support nip44 v3')
    }
    const plainB64 = await this.signer.sendRequest('nip44v3_decrypt', [pubkey, String(kind), scope, cipherText])
    return new TextDecoder().decode(base64.decode(plainB64))
  }

  /**
   * NIP-46 session teardown (nips#2373 / Amber #460): tell the remote signer to
   * drop this client's session so it stops forwarding for us. Best-effort and
   * timeout-bounded — never throws and resolves promptly so the caller can tear
   * down the local connection regardless of whether the signer acks. No-op if
   * not connected. `logout` is a courtesy hint, not a guarantee.
   */
  async logout(): Promise<void> {
    if (!this.signer) return
    try {
      await Promise.race([
        this.signer.sendRequest('logout', []),
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ])
    } catch {
      // Signer offline / doesn't implement logout — ignore; the client tears
      // down its local session either way.
    }
  }

  getClientSecretKey() {
    return bytesToHex(this.clientSecretKey)
  }
}
