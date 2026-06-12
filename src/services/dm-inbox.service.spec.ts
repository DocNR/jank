import { describe, expect, it } from 'vitest'
import dmInboxServices, {
  BACKFILL_WRAP_CAP,
  BACKFILL_DAYS,
  decryptConcurrencyFor,
  DmInboxServiceInstance
} from './dm-inbox.service'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { createGiftWraps } from '@/services/nip17/gift-wrap'

function signerFor(sk: Uint8Array) {
  const pk = getPublicKey(sk)
  return {
    type: 'nsec' as const,
    pubkey: pk,
    signer: {
      getPublicKey: async () => pk,
      signEvent: async (d: any) =>
        (await import('nostr-tools')).finalizeEvent(d, sk),
      nip44Encrypt: async (p: string, t: string) =>
        nip44.encrypt(t, nip44.utils.getConversationKey(sk, p)),
      nip44Decrypt: async (p: string, c: string) =>
        nip44.decrypt(c, nip44.utils.getConversationKey(sk, p))
    }
  }
}

describe('dm-inbox registry + tuning', () => {
  it('exposes the agreed defaults', () => {
    expect(BACKFILL_WRAP_CAP).toBe(500)
    expect(BACKFILL_DAYS).toBe(30)
  })

  it('uses lower concurrency for remote signers, higher for local', () => {
    expect(decryptConcurrencyFor('bunker')).toBeLessThanOrEqual(6)
    expect(decryptConcurrencyFor('nsec')).toBeGreaterThan(decryptConcurrencyFor('bunker'))
  })

  it('refcounts instances: same pubkey shares one, releases dispose', () => {
    const owner1 = Symbol('o1')
    const owner2 = Symbol('o2')
    const a = dmInboxServices.get('pk', owner1)
    const b = dmInboxServices.get('pk', owner2)
    expect(a).toBe(b)
    dmInboxServices.release('pk', owner1)
    const c = dmInboxServices.get('pk', owner2)
    expect(c).toBe(a) // still alive (owner2 holds it)
    dmInboxServices.release('pk', owner2)
    const d = dmInboxServices.get('pk', owner1) // new instance after full release
    expect(d).not.toBe(a)
    dmInboxServices.release('pk', owner1)
  })
})

describe('DmInboxServiceInstance.ingestWraps', () => {
  it('decrypts inbound wraps, records both processed + failed ids, never re-decrypts', async () => {
    const aliceSk = generateSecretKey()
    const alice = getPublicKey(aliceSk)
    const bob = signerFor(generateSecretKey())

    const { counterpartyWrap } = await createGiftWraps({
      senderPubkey: alice,
      recipientPubkey: bob.pubkey,
      content: 'yo',
      signer: signerFor(aliceSk).signer,
      now: 1000
    })
    const junk = { ...counterpartyWrap, id: 'deadbeef'.repeat(8), content: 'garbage' } as any

    const svc = new DmInboxServiceInstance(bob.pubkey)
    let decrypts = 0
    const countingSigner = {
      ...bob.signer,
      nip44Decrypt: async (p: string, c: string) => {
        decrypts++
        return bob.signer.nip44Decrypt(p, c)
      }
    }
    await svc.ingestWraps([counterpartyWrap, junk], bob.pubkey, countingSigner, 5, false)
    expect(svc.getThread(alice).map((m) => m.content)).toEqual(['yo'])

    const before = decrypts
    await svc.ingestWraps([counterpartyWrap, junk], bob.pubkey, countingSigner, 5, false)
    expect(decrypts).toBe(before) // both already processed → zero new decrypts
  })
})

describe('DmInboxServiceInstance.send', () => {
  it('throws RecipientNotReady when the recipient has no 10050', async () => {
    const me = getPublicKey(generateSecretKey())
    const svc = new DmInboxServiceInstance(me)
    svc._test_setResolveRecipientRelays(async () => [])
    await expect(
      svc.send('bobpk', 'hi', { getPublicKey: async () => me } as any, 'nsec')
    ).rejects.toMatchObject({ code: 'recipient-not-ready' })
  })

  it('optimistically inserts the sent message into the thread', async () => {
    const meSk = generateSecretKey()
    const me = getPublicKey(meSk)
    const bob = getPublicKey(generateSecretKey())
    const svc = new DmInboxServiceInstance(me)
    svc._test_setResolveRecipientRelays(async () => ['wss://r'])
    svc._test_setPublish(async () => {})
    svc._test_setResolveOwnRelays(async () => ['wss://me'])
    const signer = {
      getPublicKey: async () => me,
      signEvent: async (d: any) => (await import('nostr-tools')).finalizeEvent(d, meSk),
      nip44Encrypt: async (p: string, t: string) => nip44.encrypt(t, nip44.utils.getConversationKey(meSk, p)),
      nip44Decrypt: async (p: string, c: string) => nip44.decrypt(c, nip44.utils.getConversationKey(meSk, p))
    }
    await svc.send(bob, 'hey bob', signer, 'nsec')
    expect(svc.getThread(bob).map((m) => m.content)).toContain('hey bob')
  })
})
