import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Event as NEvent } from 'nostr-tools'

vi.mock('@/services/client.service', () => ({ default: { getSignerFor: vi.fn() } }))
vi.mock('@/services/indexed-db.service', () => ({
  default: { getDecryptedContent: vi.fn(async () => undefined), putDecryptedContent: vi.fn() }
}))

import client from '@/services/client.service'
import privateTags from '@/services/caches/private-tags-cache.service'

const fakeSigner = {
  getPublicKey: vi.fn(),
  signEvent: vi.fn(),
  nip04Encrypt: vi.fn(),
  nip04Decrypt: vi.fn(),
  nip44Encrypt: vi.fn(async (_pk: string, t: string) => `enc:${t}`),
  nip44Decrypt: vi.fn(async (_pk: string, c: string) => c.replace(/^enc:/, ''))
}
const muteEv = (pubkey: string, content: string): NEvent =>
  ({ id: 'm', kind: 10000, pubkey, created_at: 1, tags: [], content, sig: 's' }) as NEvent

describe('privateTagsCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('decrypts + caches when a signer for the author is registered', async () => {
    ;(client.getSignerFor as Mock).mockReturnValue(fakeSigner)
    const tags = [['p', 'enemy']]
    await privateTags.loadFor(muteEv('pk1', `enc:${JSON.stringify(tags)}`))
    expect(privateTags.getSnapshot('10000:pk1:')).toEqual(tags)
  })

  it('returns empty for a foreign author (no signer) and does not call decrypt', async () => {
    ;(client.getSignerFor as Mock).mockReturnValue(undefined)
    await privateTags.loadFor(muteEv('foreign', 'enc:[["p","x"]]'))
    expect(privateTags.getSnapshot('10000:foreign:')).toEqual([])
    expect(fakeSigner.nip44Decrypt).not.toHaveBeenCalled()
  })

  it('setOptimistic + clear notify subscribers', () => {
    const cb = vi.fn()
    privateTags.subscribe('10000:pk1:', cb)
    privateTags.setOptimistic('10000:pk1:', [['p', 'opt']])
    expect(privateTags.getSnapshot('10000:pk1:')).toEqual([['p', 'opt']])
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
