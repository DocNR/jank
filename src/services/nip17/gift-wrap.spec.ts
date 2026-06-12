import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  buildRumor,
  createGiftWraps,
  randomTimeUpTo2DaysInPast,
  sealRumor,
  unwrapGiftWrap,
  wrapSeal,
  type Nip17Signer
} from './gift-wrap'

const TWO_DAYS = 2 * 24 * 60 * 60

// A real signer backed by a secret key — lets verifyEvent pass on seals.
function makeSigner(sk: Uint8Array): Nip17Signer {
  const pk = getPublicKey(sk)
  return {
    getPublicKey: async () => pk,
    signEvent: async (draft) => {
      const { finalizeEvent } = await import('nostr-tools')
      return finalizeEvent(draft as any, sk)
    },
    nip44Encrypt: async (pubkey, plaintext) =>
      nip44.encrypt(plaintext, nip44.utils.getConversationKey(sk, pubkey)),
    nip44Decrypt: async (pubkey, ciphertext) =>
      nip44.decrypt(ciphertext, nip44.utils.getConversationKey(sk, pubkey))
  }
}

describe('buildRumor', () => {
  it('builds an unsigned kind-14 with a stable id and a p-tag', () => {
    const alice = getPublicKey(generateSecretKey())
    const bob = getPublicKey(generateSecretKey())
    const rumor = buildRumor({
      senderPubkey: alice,
      recipientPubkey: bob,
      content: 'hi',
      createdAt: 1000
    })
    expect(rumor.kind).toBe(14)
    expect(rumor.pubkey).toBe(alice)
    expect(rumor.content).toBe('hi')
    expect(rumor.created_at).toBe(1000)
    expect(rumor.tags).toContainEqual(['p', bob])
    expect(rumor.id).toMatch(/^[0-9a-f]{64}$/)
    expect((rumor as { sig?: string }).sig).toBeUndefined()
  })

  it('adds an e-tag when replyToId is given', () => {
    const alice = getPublicKey(generateSecretKey())
    const bob = getPublicKey(generateSecretKey())
    const rumor = buildRumor({
      senderPubkey: alice,
      recipientPubkey: bob,
      content: 'hi',
      createdAt: 1000,
      replyToId: 'f'.repeat(64)
    })
    expect(rumor.tags).toContainEqual(['e', 'f'.repeat(64)])
  })
})

describe('randomTimeUpTo2DaysInPast', () => {
  it('returns a time in the past within 2 days', () => {
    const now = 1_000_000
    for (let i = 0; i < 50; i++) {
      const t = randomTimeUpTo2DaysInPast(now)
      expect(t).toBeLessThanOrEqual(now)
      expect(t).toBeGreaterThanOrEqual(now - TWO_DAYS)
    }
  })
})

describe('sealRumor + wrapSeal', () => {
  it('seal is kind-13, signed by sender, empty tags, content decrypts to the rumor', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const bob = getPublicKey(generateSecretKey())
    const signer = makeSigner(aliceSk)
    const rumor = buildRumor({ senderPubkey: alice, recipientPubkey: bob, content: 'hi', createdAt: 1000 })

    const seal = await sealRumor(rumor, bob, signer, 1_000_000)

    expect(seal.kind).toBe(13)
    expect(seal.pubkey).toBe(alice)
    expect(seal.tags).toEqual([])
    expect(verifyEvent(seal)).toBe(true)
    expect(seal.created_at).toBeLessThanOrEqual(1_000_000)
  })

  it('wrap is kind-1059 with a random pubkey, p-tagged to recipient, verifies', () => {
    const bob = getPublicKey(generateSecretKey())
    const fakeSeal = {
      id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 13,
      tags: [], content: 'x', sig: 'c'.repeat(128)
    } as unknown as import('nostr-tools').Event

    const wrap = wrapSeal(fakeSeal, bob, 1_000_000)

    expect(wrap.kind).toBe(1059)
    expect(wrap.tags).toContainEqual(['p', bob])
    expect(wrap.pubkey).not.toBe(bob)
    expect(verifyEvent(wrap)).toBe(true)
    expect(wrap.created_at).toBeLessThanOrEqual(1_000_000)
  })
})

describe('unwrapGiftWrap', () => {
  it('round-trips: alice→bob wrap unwraps to the rumor, direction in, counterparty alice', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const bobSk = generateSecretKey()
    const bob = getPublicKey(bobSk)
    const aliceSigner = makeSigner(aliceSk)
    const bobSigner = makeSigner(bobSk)

    const rumor = buildRumor({ senderPubkey: alice, recipientPubkey: bob, content: 'hello bob', createdAt: 1000 })
    const seal = await sealRumor(rumor, bob, aliceSigner, 1_000_000)
    const wrap = wrapSeal(seal, bob, 1_000_000)

    const res = await unwrapGiftWrap(wrap, bob, bobSigner)
    expect(res).not.toBeNull()
    expect(res!.rumor.content).toBe('hello bob')
    expect(res!.counterparty).toBe(alice)
    expect(res!.direction).toBe('in')
  })

  it('self-wrap (alice→alice copy) unwraps with direction out, counterparty bob', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const bob = getPublicKey(generateSecretKey())
    const aliceSigner = makeSigner(aliceSk)

    const rumor = buildRumor({ senderPubkey: alice, recipientPubkey: bob, content: 'to bob', createdAt: 1000 })
    const seal = await sealRumor(rumor, alice, aliceSigner, 1_000_000) // sealed to SELF
    const wrap = wrapSeal(seal, alice, 1_000_000)

    const res = await unwrapGiftWrap(wrap, alice, aliceSigner)
    expect(res!.direction).toBe('out')
    expect(res!.counterparty).toBe(bob)
  })

  it('rejects when seal.pubkey !== rumor.pubkey (impersonation)', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const malSk = generateSecretKey()
    const bobSk = generateSecretKey()
    const bob = getPublicKey(bobSk)
    const malSigner = makeSigner(malSk) // mallory seals
    const bobSigner = makeSigner(bobSk)

    // rumor claims to be from alice, but mallory seals+signs it
    const rumor = buildRumor({ senderPubkey: alice, recipientPubkey: bob, content: 'fake', createdAt: 1000 })
    const seal = await sealRumor(rumor, bob, malSigner, 1_000_000)
    const wrap = wrapSeal(seal, bob, 1_000_000)

    const res = await unwrapGiftWrap(wrap, bob, bobSigner)
    expect(res).toBeNull()
  })

  it('returns null on garbage / undecryptable content', async () => {
    const bobSk = generateSecretKey()
    const bob = getPublicKey(bobSk)
    const junk = wrapSeal(
      { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 13, tags: [], content: 'not-encrypted', sig: 'c'.repeat(128) } as unknown as import('nostr-tools').Event,
      bob,
      1_000_000
    )
    const res = await unwrapGiftWrap(junk, bob, makeSigner(bobSk))
    expect(res).toBeNull()
  })
})

describe('createGiftWraps', () => {
  it('produces a counterparty wrap and a self wrap from one rumor', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const bobSk = generateSecretKey()
    const bob = getPublicKey(bobSk)
    const aliceSigner = makeSigner(aliceSk)

    const { rumor, counterpartyWrap, selfWrap } = await createGiftWraps({
      senderPubkey: alice,
      recipientPubkey: bob,
      content: 'hi bob',
      signer: aliceSigner,
      now: 1_000_000
    })

    // bob can read the counterparty wrap
    const asBob = await unwrapGiftWrap(counterpartyWrap, bob, makeSigner(bobSk))
    expect(asBob!.rumor.content).toBe('hi bob')
    expect(asBob!.direction).toBe('in')
    // alice can read her own self wrap, direction out
    const asAlice = await unwrapGiftWrap(selfWrap, alice, aliceSigner)
    expect(asAlice!.direction).toBe('out')
    expect(asAlice!.counterparty).toBe(bob)
    expect(rumor.content).toBe('hi bob')
  })
})
