import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  encodeMcpRequest,
  encodeMcpResponse,
  parseMcpRequest,
  parseMcpResponse,
  wrapGift,
  unwrapGift
} from './contextvm-wire'
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND, JSONRPC_VERSION } from './contextvm'

describe('encodeMcpRequest', () => {
  it('produces a JSON-RPC envelope with method=tools/call and the given params', () => {
    const out = encodeMcpRequest('id-1', 'tools/call', {
      name: 'stats',
      arguments: {}
    })
    expect(out).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 'id-1',
      method: 'tools/call',
      params: { name: 'stats', arguments: {} }
    })
  })
})

describe('parseMcpResponse', () => {
  it('returns ok:true with structuredContent on a success response', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 'id-1',
      result: {
        content: [],
        structuredContent: { foo: 'bar' }
      }
    })
    const out = parseMcpResponse(raw, 'id-1')
    expect(out).toEqual({
      matched: true,
      result: { ok: true, content: [], structuredContent: { foo: 'bar' } }
    })
  })

  it('returns ok:false with the error on an error response', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 'id-1',
      error: { code: -32603, message: 'Internal error' }
    })
    const out = parseMcpResponse(raw, 'id-1')
    expect(out).toEqual({
      matched: true,
      result: { ok: false, error: { code: -32603, message: 'Internal error' } }
    })
  })

  it('returns matched:false when the id does not match', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 'other-id',
      result: { structuredContent: {} }
    })
    const out = parseMcpResponse(raw, 'id-1')
    expect(out).toEqual({ matched: false })
  })

  it('returns matched:false on malformed JSON', () => {
    expect(parseMcpResponse('not json', 'id-1')).toEqual({ matched: false })
  })
})

describe('wrapGift + unwrapGift round-trip', () => {
  // Both sides sign + encrypt for real. unwrapGift now verifies the Schnorr
  // signature of the event that establishes senderPubkey (the seal in nip59
  // mode, the inner event in simple mode), so a mocked signer with a fake
  // `sig` would be rejected — the round-trip must use real keys end to end.
  // Real curve-valid pubkeys are required anyway because the outer layer runs
  // nip44.utils.getConversationKey on the ephemeral/recipient pair.
  function makeSenderSigner(sk: Uint8Array) {
    const pubkey = getPublicKey(sk)
    return {
      getPublicKey: async () => pubkey,
      signEvent: async (draft: any) => finalizeEvent(draft, sk),
      nip44Encrypt: async (other: string, plain: string) =>
        nip44.encrypt(plain, nip44.utils.getConversationKey(sk, other)),
      nip44Decrypt: async (other: string, cipher: string) =>
        nip44.decrypt(cipher, nip44.utils.getConversationKey(sk, other))
    }
  }

  function makeRecipientSigner(recipientSk: Uint8Array) {
    return {
      nip44Decrypt: async (otherPubkey: string, cipher: string) =>
        nip44.decrypt(cipher, nip44.utils.getConversationKey(recipientSk, otherPubkey))
    }
  }

  it('round-trips a payload through wrap → unwrap', async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const senderSigner = makeSenderSigner(senderSk)
    const recipientSigner = makeRecipientSigner(recipientSk)

    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'x', result: { ok: true } })
    const wrapped = await wrapGift({
      senderSigner,
      recipientPubkey,
      innerKind: 25910,
      innerContent: payload
    })

    expect(wrapped.kind).toBe(1059)
    expect(wrapped.tags).toContainEqual(['p', recipientPubkey])

    const unwrapped = await unwrapGift({
      gift: wrapped,
      recipientSigner,
      recipientPubkey
    })

    expect(unwrapped).toMatchObject({ innerKind: 25910, innerContent: payload, senderPubkey })
    expect(unwrapped.innerEventId).toEqual(expect.any(String))
  })
})

describe('parseMcpRequest', () => {
  it('returns null for malformed JSON', () => {
    expect(parseMcpRequest('not json')).toBeNull()
    expect(parseMcpRequest('')).toBeNull()
  })

  it('returns null for non-object payloads', () => {
    expect(parseMcpRequest('null')).toBeNull()
    expect(parseMcpRequest('"string"')).toBeNull()
    expect(parseMcpRequest('42')).toBeNull()
  })

  it('returns null when jsonrpc version is wrong', () => {
    expect(parseMcpRequest(JSON.stringify({ jsonrpc: '1.0', method: 'initialize' }))).toBeNull()
  })

  it('returns null when method is missing or non-string', () => {
    expect(parseMcpRequest(JSON.stringify({ jsonrpc: '2.0', id: '1' }))).toBeNull()
    expect(parseMcpRequest(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 42 }))).toBeNull()
  })

  it('accepts a well-formed request with id', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 'abc',
      method: 'tools/call',
      params: { name: 'foo', arguments: {} }
    })
    const parsed = parseMcpRequest(raw)
    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 'abc',
      method: 'tools/call',
      params: { name: 'foo', arguments: {} }
    })
  })

  it('accepts a notification (no id)', () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const parsed = parseMcpRequest(raw)
    expect(parsed?.method).toBe('notifications/initialized')
  })
})

describe('encodeMcpResponse', () => {
  it('encodes a result body', () => {
    const r = encodeMcpResponse('id-1', { result: { foo: 'bar' } })
    expect(r).toEqual({ jsonrpc: '2.0', id: 'id-1', result: { foo: 'bar' } })
  })

  it('encodes an error body', () => {
    const r = encodeMcpResponse('id-2', { error: { code: -32000, message: 'fail' } })
    expect(r).toEqual({
      jsonrpc: '2.0',
      id: 'id-2',
      error: { code: -32000, message: 'fail' }
    })
  })

  it('preserves numeric ids', () => {
    const r = encodeMcpResponse(42, { result: {} })
    expect(r).toEqual({ jsonrpc: '2.0', id: 42, result: {} })
  })
})

describe('wrapGift outerKind', () => {
  function makeMockSigner(pubkey: string = 'b'.repeat(64)) {
    return {
      getPublicKey: vi.fn(async () => pubkey),
      signEvent: vi.fn(async (draft: any) => ({
        ...draft,
        id: 'mock-id-' + draft.kind,
        pubkey,
        sig: 'mock-sig'
      })),
      nip44Encrypt: vi.fn(async (_other: string, plain: string) => 'enc:' + plain),
      nip44Decrypt: vi.fn(async (_other: string, cipher: string) => cipher.replace('enc:', ''))
    }
  }

  it('defaults to GIFT_WRAP_KIND (1059)', async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const signer = makeMockSigner(senderPubkey)
    const wrapped = await wrapGift({
      senderSigner: signer,
      recipientPubkey,
      innerKind: 25910,
      innerContent: '{}'
    })
    expect(wrapped.kind).toBe(GIFT_WRAP_KIND)
  })

  it('accepts EPHEMERAL_GIFT_WRAP_KIND (21059) override', async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const signer = makeMockSigner(senderPubkey)
    const wrapped = await wrapGift({
      senderSigner: signer,
      recipientPubkey,
      innerKind: 25910,
      innerContent: '{}',
      outerKind: EPHEMERAL_GIFT_WRAP_KIND
    })
    expect(wrapped.kind).toBe(EPHEMERAL_GIFT_WRAP_KIND)
  })
})

describe('wrapGift mode option', () => {
  // Real recipient signer (not mocked) so we can actually decrypt the outer
  // wrap layer and inspect what's INSIDE — the structural difference between
  // the two modes is what's inside that envelope:
  //   - simple (2-layer):  inside = the signed inner event JSON (no seal)
  //   - nip59  (3-layer):  inside = a signed seal event (kind 13), whose
  //                        content is ANOTHER nip44 ciphertext.
  // The @contextvm/sdk server transport only ever decrypts ONE layer before
  // JSON.parse-ing the result as the inner event (see ContextVM/sdk
  // src/transport/nostr-server/event-pipeline.ts: `decryptedJson` →
  // `JSON.parse(...)` → `verifyEvent(currentEvent)`). So a nip59 wrap
  // delivers a kind-13 seal to a server expecting a kind-25910 RPC envelope,
  // which then drops it as "malformed JSON" downstream. Verified empirically
  // against the live Relatr server 2026-05-25.
  function realSenderSigner(sk: Uint8Array, pubkey: string) {
    return {
      getPublicKey: async () => pubkey,
      signEvent: async (draft: any) => {
        const { finalizeEvent } = await import('nostr-tools/pure')
        return finalizeEvent(draft, sk)
      },
      nip44Encrypt: async (otherPubkey: string, plain: string) => {
        const key = nip44.utils.getConversationKey(sk, otherPubkey)
        return nip44.encrypt(plain, key)
      },
      nip44Decrypt: async (otherPubkey: string, cipher: string) => {
        const key = nip44.utils.getConversationKey(sk, otherPubkey)
        return nip44.decrypt(cipher, key)
      }
    }
  }

  async function decryptOuterWrap(gift: any, recipientSk: Uint8Array) {
    const key = nip44.utils.getConversationKey(recipientSk, gift.pubkey)
    return JSON.parse(nip44.decrypt(gift.content, key))
  }

  it("mode: 'simple' puts the signed inner event DIRECTLY inside the wrap (no seal)", async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const senderSigner = realSenderSigner(senderSk, senderPubkey)
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'tools/list' })

    const wrapped = await wrapGift({
      senderSigner,
      recipientPubkey,
      innerKind: 25910,
      innerContent: payload,
      mode: 'simple'
    })

    const inside = await decryptOuterWrap(wrapped, recipientSk)
    // The thing inside the wrap is the INNER event itself — kind 25910,
    // content === payload, signed by sender. NOT a kind-13 seal.
    expect(inside.kind).toBe(25910)
    expect(inside.content).toBe(payload)
    expect(inside.pubkey).toBe(senderPubkey)
    expect(verifyEvent(inside)).toBe(true)
  })

  it("mode: 'nip59' (default) puts a signed SEAL event (kind 13) inside the wrap", async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const senderSigner = realSenderSigner(senderSk, senderPubkey)
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'tools/list' })

    const wrapped = await wrapGift({
      senderSigner,
      recipientPubkey,
      innerKind: 25910,
      innerContent: payload
      // mode omitted → default 'nip59'
    })

    const inside = await decryptOuterWrap(wrapped, recipientSk)
    // The thing inside the wrap is a kind-13 SEAL, not the inner event.
    // Its content is still a nip44 ciphertext (the seal layer), so a server
    // that JSON.parse-d it expecting an RPC envelope would never see kind 25910.
    expect(inside.kind).toBe(13)
    expect(inside.pubkey).toBe(senderPubkey) // seals are signed by sender
    expect(verifyEvent(inside)).toBe(true)
    // Seal content is still encrypted ciphertext (not the JSON payload).
    expect(inside.content).not.toBe(payload)
    expect(inside.content).not.toContain('tools/list')
  })
})

describe('unwrapGift — against captured SDK trace', () => {
  const tracePath = join(
    __dirname,
    '../../docs/superpowers/plans/contextvm-traces/relatr-stats-inbound.json'
  )

  it.runIf(existsSync(tracePath))('captured trace is a valid wrap envelope', async () => {
    // NOTE: this test requires the recipient's PRIVATE key, which only the
    // spike script has. Since the trace was captured with an ephemeral spike
    // key that doesn't persist, this test is structural-only: assert the file
    // is a valid 1059 OR 21059 envelope with the expected tags / content shape.
    // Inbound traces are kind 21059 (ephemeral gift wrap — Relatr's chosen
    // response kind); outbound traces are kind 1059 (persistent gift wrap).
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'))
    expect([1059, 21059]).toContain(trace.kind)
    expect(trace.tags.some((t: string[]) => t[0] === 'p')).toBe(true)
    expect(typeof trace.content).toBe('string')
    expect(trace.content.length).toBeGreaterThan(20) // ciphertext, not empty

    // Format assertions — hex-shape, 32-byte ids/pubkeys + 64-byte sig.
    expect(typeof trace.pubkey).toBe('string')
    expect(trace.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(trace.id).toMatch(/^[0-9a-f]{64}$/)
    expect(trace.sig).toMatch(/^[0-9a-f]{128}$/)

    // Real signature verification — turns this into a "valid wrap envelope" check.
    expect(verifyEvent(trace)).toBe(true)
  })
})

describe('unwrapGift — sender signature verification (anti-spoofing)', () => {
  // The inner/seal event is NIP-44-encrypted on the wire, so relays only ever
  // validated the EPHEMERAL outer gift-wrap signature — never the inner event
  // that establishes senderPubkey. Without an explicit Schnorr check here,
  // anyone who can deliver a gift wrap to the recipient (no secret needed —
  // they just encrypt to a public key) could embed an inner event claiming
  // `pubkey = <a paired agent>` with a garbage signature and be authorized as
  // that agent by the server's pairedAgents gate. unwrapGift must reject a bad
  // inner/seal signature before returning senderPubkey.

  function realSenderSigner(sk: Uint8Array, pubkey: string) {
    return {
      getPublicKey: async () => pubkey,
      signEvent: async (draft: any) => finalizeEvent(draft, sk),
      nip44Encrypt: async (other: string, plain: string) =>
        nip44.encrypt(plain, nip44.utils.getConversationKey(sk, other)),
      nip44Decrypt: async (other: string, cipher: string) =>
        nip44.decrypt(cipher, nip44.utils.getConversationKey(sk, other))
    }
  }

  function realRecipientSigner(recipientSk: Uint8Array) {
    return {
      nip44Decrypt: async (otherPubkey: string, cipher: string) =>
        nip44.decrypt(cipher, nip44.utils.getConversationKey(recipientSk, otherPubkey))
    }
  }

  /** Hand-build a gift wrap (NOT via wrapGift, which always signs correctly)
   *  whose decrypted content is `innerEvent`. The outer wrap is encrypted to
   *  `recipientPubkey` with a fresh ephemeral key — exactly what an attacker
   *  with no secrets can produce. */
  function maliciousWrap(innerEvent: object, recipientPubkey: string) {
    const ephemeralSk = generateSecretKey()
    const conversationKey = nip44.utils.getConversationKey(ephemeralSk, recipientPubkey)
    const wrapContent = nip44.encrypt(JSON.stringify(innerEvent), conversationKey)
    return finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        created_at: 1700000000,
        tags: [['p', recipientPubkey]],
        content: wrapContent
      },
      ephemeralSk
    )
  }

  it("rejects a 'simple'-mode inner event with a forged pubkey + invalid sig", async () => {
    const victimSk = generateSecretKey()
    const victimPubkey = getPublicKey(victimSk) // the paired agent being impersonated
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)

    // Inner event CLAIMS to be the victim but carries a garbage signature the
    // attacker can't forge (they don't have the victim's secret key).
    const forgedInner = {
      kind: 25910,
      created_at: 1700000000,
      tags: [['p', recipientPubkey]],
      content: JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'tools/call' }),
      pubkey: victimPubkey,
      id: 'f'.repeat(64),
      sig: '0'.repeat(128)
    }
    const gift = maliciousWrap(forgedInner, recipientPubkey)

    await expect(
      unwrapGift({ gift, recipientSigner: realRecipientSigner(recipientSk), recipientPubkey })
    ).rejects.toThrow()
  })

  it("rejects a 'nip59'-mode seal with a forged pubkey + invalid sig", async () => {
    const victimSk = generateSecretKey()
    const victimPubkey = getPublicKey(victimSk) // the paired agent being impersonated
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)

    // Seal (kind 13) CLAIMS to be the victim with a garbage signature. The
    // seal's pubkey is what unwrapGift returns as senderPubkey in nip59 mode,
    // so the signature must be verified before that pubkey is trusted.
    //
    // The seal content here is DELIBERATELY decryptable: we encrypt the inner
    // event under conversationKey(recipient, victim) — which the recipient
    // reconstructs as nip44Decrypt(seal.pubkey=victim, …). Without the explicit
    // signature check, unwrapGift would sail past the decrypt step and return
    // senderPubkey = victim. This isolates the verifyEvent guard as the sole
    // protective mechanism (an attacker can't actually craft this in the wild
    // without a recipient/victim secret, but the server must not depend on
    // that incidental barrier).
    const innerJson = JSON.stringify({
      kind: 25910,
      created_at: 1700000000,
      tags: [['p', recipientPubkey]],
      content: JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'tools/call' }),
      pubkey: victimPubkey,
      id: 'a'.repeat(64),
      sig: '0'.repeat(128)
    })
    const sealCk = nip44.utils.getConversationKey(recipientSk, victimPubkey)
    const forgedSeal = {
      kind: 13,
      created_at: 1700000000,
      tags: [],
      content: nip44.encrypt(innerJson, sealCk),
      pubkey: victimPubkey,
      id: 'e'.repeat(64),
      sig: '0'.repeat(128)
    }
    const gift = maliciousWrap(forgedSeal, recipientPubkey)

    await expect(
      unwrapGift({ gift, recipientSigner: realRecipientSigner(recipientSk), recipientPubkey })
    ).rejects.toThrow()
  })

  it("accepts a validly-signed 'simple'-mode inner event and returns its true pubkey", async () => {
    const senderSk = generateSecretKey()
    const senderPubkey = getPublicKey(senderSk)
    const recipientSk = generateSecretKey()
    const recipientPubkey = getPublicKey(recipientSk)
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'ok', method: 'tools/list' })

    const gift = await wrapGift({
      senderSigner: realSenderSigner(senderSk, senderPubkey),
      recipientPubkey,
      innerKind: 25910,
      innerContent: payload,
      mode: 'simple'
    })

    const unwrapped = await unwrapGift({
      gift,
      recipientSigner: realRecipientSigner(recipientSk),
      recipientPubkey
    })
    expect(unwrapped.senderPubkey).toBe(senderPubkey)
    expect(unwrapped.innerContent).toBe(payload)
  })
})
