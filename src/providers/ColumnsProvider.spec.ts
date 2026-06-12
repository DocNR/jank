import { describe, expect, it } from 'vitest'
import type { TColumn } from '@/types/column'
import { findExistingStandingColumn, mergePersistedWithLiveTransients } from './ColumnsProvider'

// Trimmed-down fixtures — only the fields the helper inspects matter.
const COLUMNS: TColumn[] = [
  { id: 'c1', type: 'home', viewContext: 'aaa', signingIdentity: 'aaa' },
  { id: 'c2', type: 'notifications', viewContext: 'aaa', signingIdentity: 'aaa' },
  // Foreign-profile (view-as) column — viewContext is the foreign pubkey,
  // signed by the user's own paired account.
  { id: 'c3', type: 'profile', viewContext: 'bbb', signingIdentity: 'aaa' },
  // Own-profile column — view + sign are both the user's own pubkey.
  { id: 'c4', type: 'profile', viewContext: 'aaa', signingIdentity: 'aaa' },
  // Pinned bookmarks column for foreign user (illegal in practice, but the
  // helper shouldn't care about transient vs pinned).
  { id: 'c5', type: 'bookmarks', viewContext: 'aaa', signingIdentity: 'aaa' }
]

describe('findExistingStandingColumn — dedup', () => {
  it('finds the Notifications column for the active pubkey', () => {
    const found = findExistingStandingColumn(COLUMNS, 'notifications', 'aaa')
    expect(found?.id).toBe('c2')
  })

  it('finds the matching foreign Profile column', () => {
    const found = findExistingStandingColumn(COLUMNS, 'profile', 'bbb')
    expect(found?.id).toBe('c3')
  })

  it('finds the matching own Profile column when viewContext is the active pubkey', () => {
    const found = findExistingStandingColumn(COLUMNS, 'profile', 'aaa')
    expect(found?.id).toBe('c4')
  })

  it('finds the Bookmarks column for the active pubkey', () => {
    const found = findExistingStandingColumn(COLUMNS, 'bookmarks', 'aaa')
    expect(found?.id).toBe('c5')
  })

  it('returns null when no column of that type+viewContext exists', () => {
    expect(findExistingStandingColumn(COLUMNS, 'search', 'aaa')).toBeNull()
    expect(findExistingStandingColumn(COLUMNS, 'notifications', 'zzz')).toBeNull()
  })

  it('refuses dedup for non-standing types (hashtag stays under its broader rules)', () => {
    expect(findExistingStandingColumn(COLUMNS, 'hashtag', 'aaa')).toBeNull()
  })

  it('refuses dedup for the generic detail type', () => {
    expect(findExistingStandingColumn(COLUMNS, 'detail', 'aaa')).toBeNull()
  })

  it('refuses dedup for the home type (handled by focusOrCreateColumn, not deep-link dispatch)', () => {
    expect(findExistingStandingColumn(COLUMNS, 'home', 'aaa')).toBeNull()
  })

  it('refuses dedup for the relay type (relays key on config.relayUrl, not viewContext)', () => {
    expect(findExistingStandingColumn(COLUMNS, 'relay', 'aaa')).toBeNull()
  })
})

describe('mergePersistedWithLiveTransients — same-account workspace-sync', () => {
  const home: TColumn = { id: 'home', type: 'home', viewContext: 'aaa', signingIdentity: 'aaa' }
  const t = (id: string, parentColumnId?: string): TColumn => ({
    id,
    type: 'detail',
    viewContext: 'aaa',
    signingIdentity: 'aaa',
    transient: true,
    ...(parentColumnId ? { parentColumnId } : {})
  })

  it('preserves sibling transients when one is closed (the close-cascade bug)', () => {
    // Live deck after closing transient `c`: [home, b]. Storage only ever
    // holds the non-transient Home column, so a naive resync would wipe `b`.
    const prev = [home, t('b', 'home')]
    const persisted = [home]
    const merged = mergePersistedWithLiveTransients(prev, persisted)
    expect(merged.map((c) => c.id)).toEqual(['home', 'b'])
  })

  it('keeps a chain of transients intact (append mode)', () => {
    const prev = [home, t('b', 'home'), t('c', 'b')]
    const persisted = [home]
    expect(mergePersistedWithLiveTransients(prev, persisted).map((c) => c.id)).toEqual([
      'home',
      'b',
      'c'
    ])
  })

  it('keeps transients in their position between persisted columns', () => {
    const pinned: TColumn = {
      id: 'pinned',
      type: 'profile',
      viewContext: 'bbb',
      signingIdentity: 'aaa'
    }
    const prev = [home, t('b', 'home'), pinned]
    const persisted = [home, pinned]
    expect(mergePersistedWithLiveTransients(prev, persisted).map((c) => c.id)).toEqual([
      'home',
      'b',
      'pinned'
    ])
  })

  it('refreshes non-transient columns from the persisted set (picks up edits)', () => {
    const stale: TColumn = {
      id: 'home',
      type: 'home',
      viewContext: 'aaa',
      signingIdentity: 'aaa',
      config: { listStyle: 'compact' }
    }
    const fresh: TColumn = { ...stale, config: { listStyle: 'detailed' } }
    const merged = mergePersistedWithLiveTransients([stale, t('b')], [fresh])
    expect(merged[0]).toBe(fresh)
    expect(merged.map((c) => c.id)).toEqual(['home', 'b'])
  })

  it('drops a non-transient column that is gone from storage (e.g. removed/unpinned)', () => {
    const pinned: TColumn = {
      id: 'pinned',
      type: 'profile',
      viewContext: 'bbb',
      signingIdentity: 'aaa'
    }
    const prev = [home, pinned, t('b')]
    const persisted = [home]
    expect(mergePersistedWithLiveTransients(prev, persisted).map((c) => c.id)).toEqual([
      'home',
      'b'
    ])
  })

  it('appends persisted columns not present locally (e.g. arrived via deck sync)', () => {
    const synced: TColumn = {
      id: 'synced',
      type: 'relay',
      viewContext: 'aaa',
      signingIdentity: 'aaa'
    }
    const prev = [home, t('b')]
    const persisted = [home, synced]
    expect(mergePersistedWithLiveTransients(prev, persisted).map((c) => c.id)).toEqual([
      'home',
      'b',
      'synced'
    ])
  })

  it('keeps a lone transient when storage has no persisted columns', () => {
    expect(mergePersistedWithLiveTransients([t('b')], []).map((c) => c.id)).toEqual(['b'])
  })
})
