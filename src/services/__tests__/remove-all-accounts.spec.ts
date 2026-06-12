import { beforeEach, describe, expect, it } from 'vitest'
import storage from '@/services/local-storage.service'
import type { TAccount } from '@/types'
import type { TDeck } from '@/types/column'

const mkAccount = (pubkey: string): TAccount => ({ pubkey, signerType: 'nip-07' }) as TAccount
const mkDeck = (id: string): TDeck => ({
  id,
  name: 'Deck',
  columns: [],
  savedColumns: [],
  createdAt: 1,
  updatedAt: 1,
  lastSavedAt: 1
})

describe('LocalStorageService.removeAllAccounts()', () => {
  beforeEach(() => {
    window.localStorage.clear()
    storage.init()
  })

  it('clears all accounts and the active pubkey but preserves deck workspaces', () => {
    storage.addAccount(mkAccount('pk1'))
    storage.addAccount(mkAccount('pk2'))
    storage.setActiveAccountPubkey('pk1')
    storage.ensureWorkspaceForAccount('pk1', [mkDeck('d1')])
    storage.ensureWorkspaceForAccount('pk2', [mkDeck('d2')])

    storage.removeAllAccounts()

    expect(storage.getAccounts()).toEqual([])
    expect(storage.getActiveAccountPubkey()).toBeNull()
    // Sign-out-only: workspaces stay dormant so a re-pair re-hydrates each deck.
    expect(storage.getActiveWorkspace('pk1')).not.toBeNull()
    expect(storage.getActiveWorkspace('pk2')).not.toBeNull()
  })

  it('clears cached secrets so a removed account leaves nothing behind', () => {
    storage.addAccount({ pubkey: 'pk1', signerType: 'nsec', nsec: 'nsec1xxx' } as TAccount)
    storage.removeAllAccounts()
    expect(storage.getAccountNsec('pk1')).toBeUndefined()
  })
})
