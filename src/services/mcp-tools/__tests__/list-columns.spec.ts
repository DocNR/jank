import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nip19 } from 'nostr-tools'
import type { TColumn } from '@/types/column'

vi.mock('../../local-storage.service', () => ({
  default: {
    getWorkspacesByAccount: vi.fn(),
    getAccounts: vi.fn()
  }
}))

import storage from '../../local-storage.service'
import { listColumnsHandler, listColumnsDef } from '../list-columns'

const owner = 'a'.repeat(64)
const sibling = 'b'.repeat(64)
const foreign = 'c'.repeat(64)

const mkColumn = (id: string, type: TColumn['type'], viewContext: string): TColumn => ({
  id,
  type,
  viewContext,
  signingIdentity: owner,
  config: {}
})

describe('list_columns', () => {
  beforeEach(() => {
    vi.mocked(storage.getWorkspacesByAccount).mockReturnValue({
      [owner]: {
        activeDeckId: 'd1',
        decks: [
          {
            id: 'd1',
            name: 'Main',
            columns: [
              mkColumn('c1', 'home', owner), // own — include
              mkColumn('c2', 'profile', foreign), // foreign user — include
              mkColumn('c3', 'notifications', sibling) // sibling — filter by default
            ],
            savedColumns: [],
            createdAt: 0,
            updatedAt: 0,
            lastSavedAt: 0
          }
        ]
      }
    } as any)
    vi.mocked(storage.getAccounts).mockReturnValue([
      { pubkey: owner, signerType: 'bunker' },
      { pubkey: sibling, signerType: 'bunker' }
    ] as any)
  })

  it('def has the correct shape', () => {
    expect(listColumnsDef.name).toBe('list_columns')
  })

  it('returns active deck columns minus sibling-viewing columns (default opsec)', async () => {
    const result = await listColumnsHandler(
      {},
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const cols = (result.structuredContent as any).columns
      expect(cols).toHaveLength(2)
      expect(cols.map((c: any) => c.id).sort()).toEqual(['c1', 'c2'])
    }
  })

  it('includes sibling-viewing columns when allowSiblingExposure is true', async () => {
    vi.mocked(storage.getWorkspacesByAccount).mockReturnValue({
      [owner]: {
        activeDeckId: 'd1',
        decks: [
          {
            id: 'd1',
            name: 'Main',
            columns: [mkColumn('c1', 'home', owner), mkColumn('c3', 'notifications', sibling)],
            savedColumns: [],
            createdAt: 0,
            updatedAt: 0,
            lastSavedAt: 0
          }
        ],
        allowSiblingExposure: true
      }
    } as any)

    const result = await listColumnsHandler(
      {},
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    if (result.ok) {
      const cols = (result.structuredContent as any).columns
      expect(cols).toHaveLength(2)
      expect(cols.find((c: any) => c.id === 'c3')).toBeTruthy()
    }
  })

  it('converts hex pubkeys to npubs at the boundary', async () => {
    const result = await listColumnsHandler(
      {},
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    if (result.ok) {
      const cols = (result.structuredContent as any).columns
      const ownColumn = cols.find((c: any) => c.id === 'c1')
      expect(ownColumn.viewContextNpub).toBe(nip19.npubEncode(owner))
    }
  })

  it('returns error when workspace not found', async () => {
    vi.mocked(storage.getWorkspacesByAccount).mockReturnValue({})
    const result = await listColumnsHandler(
      {},
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32603)
    }
  })

  it('omits config field by default; includes when includeConfig=true', async () => {
    const without = await listColumnsHandler(
      {},
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    if (without.ok) {
      const cols = (without.structuredContent as any).columns
      expect(cols[0].config).toBeUndefined()
    }

    const withConfig = await listColumnsHandler(
      { includeConfig: true },
      { workspaceOwner: owner, senderPubkey: 'agent'.repeat(13) }
    )
    if (withConfig.ok) {
      const cols = (withConfig.structuredContent as any).columns
      expect(cols[0].config).toBeDefined()
    }
  })
})
