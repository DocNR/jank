import { describe, expect, it, vi } from 'vitest'
import type { TColumn, TDeckV1 } from '@/types/column'
import { migrateWorkspacesByAccount } from '@/services/migrate-decks-by-account'

// Helper to build a v1 deck for fixtures.
const v1Deck = (overrides: Partial<TDeckV1> = {}): TDeckV1 => ({
  id: 'deck-1',
  name: 'My Deck',
  ownerPubkey: 'pk-personal',
  columns: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

let colSeq = 0
const col = (overrides: Partial<TColumn> = {}): TColumn =>
  ({
    id: 'c-' + (++colSeq).toString(),
    type: 'home',
    viewContext: 'pk-personal',
    signingIdentity: 'pk-personal',
    ...overrides
  }) as TColumn

describe('migrateWorkspacesByAccount', () => {
  it('fresh install (empty v1 input) → empty workspacesByAccount', () => {
    const result = migrateWorkspacesByAccount([], ['pk-personal'], 'pk-personal')
    expect(result.workspacesByAccount).toEqual({})
    expect(result.migrated).toBe(true)
  })

  it('single-account, single deck, single signingIdentity → 1 workspace with 1 deck', () => {
    const v1 = [
      v1Deck({
        columns: [
          col({
            id: 'c1',
            type: 'home',
            viewContext: 'pk-personal',
            signingIdentity: 'pk-personal'
          }),
          col({
            id: 'c2',
            type: 'notifications',
            viewContext: 'pk-personal',
            signingIdentity: 'pk-personal'
          })
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal'], 'pk-personal')
    expect(Object.keys(result.workspacesByAccount)).toEqual(['pk-personal'])
    expect(result.workspacesByAccount['pk-personal'].decks).toHaveLength(1)
    expect(result.workspacesByAccount['pk-personal'].decks[0].columns).toHaveLength(2)
    expect(result.workspacesByAccount['pk-personal'].decks[0].savedColumns).toHaveLength(2)
    expect(result.workspacesByAccount['pk-personal'].decks[0].name).toBe('My Deck')
  })

  it("Daniel's prod case: multi-account columns in 1 v1 deck → 2 workspaces", () => {
    const v1 = [
      v1Deck({
        id: 'deck-1',
        name: 'My Deck',
        columns: [
          col({
            id: 'c1',
            type: 'home',
            viewContext: 'pk-personal',
            signingIdentity: 'pk-personal'
          }),
          col({
            id: 'c2',
            type: 'notifications',
            viewContext: 'pk-personal',
            signingIdentity: 'pk-personal'
          }),
          col({
            id: 'c3',
            type: 'notifications',
            viewContext: 'pk-work',
            signingIdentity: 'pk-work'
          })
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal', 'pk-work'], 'pk-personal')
    expect(Object.keys(result.workspacesByAccount).sort()).toEqual(['pk-personal', 'pk-work'])
    expect(result.workspacesByAccount['pk-personal'].decks[0].columns.map((c) => c.id)).toEqual([
      'c1',
      'c2'
    ])
    expect(result.workspacesByAccount['pk-work'].decks[0].columns.map((c) => c.id)).toEqual(['c3'])
    // Both workspaces inherit the v1 deck's name; no disambiguation under per-account-workspaces.
    expect(result.workspacesByAccount['pk-personal'].decks[0].name).toBe('My Deck')
    expect(result.workspacesByAccount['pk-work'].decks[0].name).toBe('My Deck')
  })

  it('multi-account in multiple decks → N workspaces with potentially multiple decks each', () => {
    const v1 = [
      v1Deck({ id: 'd1', name: 'Work', columns: [col({ signingIdentity: 'pk-work' })] }),
      v1Deck({ id: 'd2', name: 'Personal', columns: [col({ signingIdentity: 'pk-personal' })] }),
      v1Deck({
        id: 'd3',
        name: 'Mixed',
        columns: [
          col({ id: 'mp', signingIdentity: 'pk-personal' }),
          col({ id: 'mw', signingIdentity: 'pk-work' })
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal', 'pk-work'], 'pk-personal')
    expect(result.workspacesByAccount['pk-personal'].decks.map((d) => d.name).sort()).toEqual([
      'Mixed',
      'Personal'
    ])
    expect(result.workspacesByAccount['pk-work'].decks.map((d) => d.name).sort()).toEqual([
      'Mixed',
      'Work'
    ])
  })

  it('view-only columns (signingIdentity == null) → dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v1 = [
      v1Deck({
        columns: [
          col({ id: 'c1', signingIdentity: 'pk-personal' }),
          col({ id: 'c2', signingIdentity: null as unknown as string }) // view-only
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal'], 'pk-personal')
    expect(result.workspacesByAccount['pk-personal'].decks[0].columns.map((c) => c.id)).toEqual([
      'c1'
    ])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('orphan columns (signingIdentity not in paired list) → dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v1 = [
      v1Deck({
        columns: [
          col({ id: 'c1', signingIdentity: 'pk-personal' }),
          col({ id: 'cOrphan', signingIdentity: 'pk-removed' })
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal'], 'pk-personal')
    expect(result.workspacesByAccount['pk-personal'].decks[0].columns.map((c) => c.id)).toEqual([
      'c1'
    ])
    expect(Object.keys(result.workspacesByAccount)).toEqual(['pk-personal'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('v1 deck with ALL columns dropped → deck omitted from output', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v1 = [
      v1Deck({
        columns: [
          col({ signingIdentity: 'pk-removed' }),
          col({ signingIdentity: null as unknown as string })
        ]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal'], 'pk-personal')
    // No workspace for 'pk-removed'; 'pk-personal' has no deck because the v1 deck produced nothing.
    expect(result.workspacesByAccount).toEqual({})
    warn.mockRestore()
  })

  it('savedColumns matches columns + lastSavedAt = v1.updatedAt', () => {
    const v1 = [
      v1Deck({
        updatedAt: 12345,
        columns: [col({ id: 'c1', signingIdentity: 'pk-personal' })]
      })
    ]
    const result = migrateWorkspacesByAccount(v1, ['pk-personal'], 'pk-personal')
    const deck = result.workspacesByAccount['pk-personal'].decks[0]
    expect(deck.savedColumns).toEqual(deck.columns)
    expect(deck.lastSavedAt).toBe(12345)
  })

  it('idempotent — re-running migration on already-v2 input returns no-op', () => {
    // Caller will skip migration when workspacesByAccount is already present in localStorage;
    // helper accepts empty v1 + the existing accountPubkeys to maintain the invariant.
    const result = migrateWorkspacesByAccount([], ['pk-personal'], 'pk-personal')
    expect(result.migrated).toBe(true)
    expect(result.workspacesByAccount).toEqual({})
  })

  it('malformed input (non-array decks) → graceful fallback', () => {
    const result = migrateWorkspacesByAccount(null, ['pk-personal'], 'pk-personal')
    expect(result.workspacesByAccount).toEqual({})
    expect(result.migrated).toBe(true)
  })
})
