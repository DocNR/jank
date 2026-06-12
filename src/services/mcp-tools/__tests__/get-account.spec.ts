import { describe, it, expect, vi } from 'vitest'
import { nip19 } from 'nostr-tools'

vi.mock('../../profile-fetcher.service', () => ({
  default: {
    fetchProfile: vi.fn(async () => ({ username: 'Test User', avatar: 'https://avatar' }))
  }
}))
vi.mock('../../local-storage.service', () => ({
  default: {
    getAccounts: vi.fn(() => [{ pubkey: 'a'.repeat(64), signerType: 'bunker' }])
  }
}))

import { getAccountHandler, getAccountDef } from '../get-account'

describe('get_account', () => {
  it('def has the correct shape', () => {
    expect(getAccountDef.name).toBe('get_account')
    expect((getAccountDef.inputSchema as any).type).toBe('object')
    expect((getAccountDef.outputSchema as any).required).toContain('account')
  })

  it('returns the paired account npub', async () => {
    const ownerHex = 'a'.repeat(64)
    const ownerNpub = nip19.npubEncode(ownerHex)

    const result = await getAccountHandler(
      {},
      {
        workspaceOwner: ownerHex,
        senderPubkey: 'b'.repeat(64)
      }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.structuredContent as any).account.npub).toBe(ownerNpub)
    }
  })

  it('does not return an accounts array (opsec)', async () => {
    const result = await getAccountHandler(
      {},
      {
        workspaceOwner: 'a'.repeat(64),
        senderPubkey: 'b'.repeat(64)
      }
    )
    if (result.ok) {
      expect((result.structuredContent as any).accounts).toBeUndefined()
    }
  })

  it('exposes signerType from the registry', async () => {
    const result = await getAccountHandler(
      {},
      {
        workspaceOwner: 'a'.repeat(64),
        senderPubkey: 'b'.repeat(64)
      }
    )
    if (result.ok) {
      const account = (result.structuredContent as any).account
      expect(['nsec', 'browser-nsec', 'nip-07', 'bunker', 'ncryptsec', 'npub']).toContain(
        account.signerType
      )
      expect(account.signerType).toBe('bunker')
    }
  })
})
