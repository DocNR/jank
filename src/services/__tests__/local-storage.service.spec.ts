import { beforeEach, describe, expect, it } from 'vitest'
import { StorageKey } from '@/constants'
import storage, { migrateColumns } from '@/services/local-storage.service'
import type { TDeck } from '@/types/column'

/**
 * Decks v1.1 cleanup: init() should drop the legacy `columns` localStorage
 * key in the deprecated-data cleanup block at the end of the method. The
 * COLUMNS read at the top of init() is kept as a defensive migration path
 * for users who jump from v0 directly to v1.1.
 *
 * These tests exercise the singleton's `init()` method directly, mutating
 * `window.localStorage` to set up each starting state and re-running init.
 */
describe('LocalStorageService.init() — legacy COLUMNS cleanup', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('removes the legacy COLUMNS key when DECKS is already present (post-v1 state)', () => {
    const legacyColumns = [
      { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }
    ]
    const decks = [
      {
        id: 'd1',
        name: 'My Deck',
        ownerPubkey: 'pk1',
        columns: legacyColumns,
        createdAt: 1000,
        updatedAt: 1000
      }
    ]
    window.localStorage.setItem(StorageKey.COLUMNS, JSON.stringify(legacyColumns))
    window.localStorage.setItem(StorageKey.DECKS, JSON.stringify(decks))
    window.localStorage.setItem(StorageKey.ACTIVE_DECK_ID, 'd1')

    storage.init()

    expect(window.localStorage.getItem(StorageKey.COLUMNS)).toBeNull()
    // DECKS untouched — cleanup is one-directional.
    expect(window.localStorage.getItem(StorageKey.DECKS)).not.toBeNull()
    expect(window.localStorage.getItem(StorageKey.ACTIVE_DECK_ID)).toBe('d1')
  })

  it('migrates COLUMNS into a fresh DECK and then removes COLUMNS (v0 → v1.1 jump)', () => {
    const legacyColumns = [
      { id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' },
      { id: 'c2', viewContext: 'pk1', signingIdentity: 'pk1', type: 'notifications' }
    ]
    window.localStorage.setItem(StorageKey.COLUMNS, JSON.stringify(legacyColumns))
    // DECKS deliberately absent — this user is jumping from a pre-v1 build.

    storage.init()

    // COLUMNS removed after wrapping.
    expect(window.localStorage.getItem(StorageKey.COLUMNS)).toBeNull()

    // DECKS persisted with the migrated columns.
    const decksStr = window.localStorage.getItem(StorageKey.DECKS)
    expect(decksStr).not.toBeNull()
    const decks = JSON.parse(decksStr!)
    expect(Array.isArray(decks)).toBe(true)
    expect(decks).toHaveLength(1)
    expect(decks[0].columns).toHaveLength(2)
    expect(decks[0].columns[0].id).toBe('c1')
    expect(decks[0].columns[1].id).toBe('c2')

    // ACTIVE_DECK_ID set to the new deck.
    expect(window.localStorage.getItem(StorageKey.ACTIVE_DECK_ID)).toBe(decks[0].id)
  })
})

/**
 * Decks v2 — per-account-workspaces accessors. Builds on top of the v1 wrappers
 * above. Each test resets localStorage and re-runs `init()` so the singleton's
 * private state is consistent with the storage state being asserted.
 */
describe('LocalStorageService — workspace accessors (Decks v2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const makeDeck = (id: string): TDeck => ({
    id,
    name: 'My Deck',
    columns: [],
    savedColumns: [],
    createdAt: 1000,
    updatedAt: 1000,
    lastSavedAt: 1000
  })

  it('ensureWorkspaceForAccount creates a workspace with the provided initial decks', () => {
    storage.init()
    const deck = makeDeck('d1')
    storage.ensureWorkspaceForAccount('pk1', [deck])
    const workspace = storage.getActiveWorkspace('pk1')
    expect(workspace).not.toBeNull()
    expect(workspace!.decks).toHaveLength(1)
    expect(workspace!.activeDeckId).toBe('d1')
  })

  it('ensureWorkspaceForAccount is idempotent (does not replace an existing workspace)', () => {
    storage.init()
    storage.ensureWorkspaceForAccount('pk1', [makeDeck('d1')])
    storage.ensureWorkspaceForAccount('pk1', [makeDeck('d2')])
    expect(storage.getActiveWorkspace('pk1')!.decks).toHaveLength(1)
    expect(storage.getActiveWorkspace('pk1')!.decks[0].id).toBe('d1')
  })

  it('removeWorkspaceForAccount drops the workspace', () => {
    storage.init()
    storage.ensureWorkspaceForAccount('pk1', [makeDeck('d1')])
    storage.removeWorkspaceForAccount('pk1')
    expect(storage.getActiveWorkspace('pk1')).toBeNull()
  })

  it('getActiveAccountPubkey + setActiveAccountPubkey round-trip', () => {
    storage.init()
    storage.setActiveAccountPubkey('pk-personal')
    expect(storage.getActiveAccountPubkey()).toBe('pk-personal')
    storage.setActiveAccountPubkey(null)
    expect(storage.getActiveAccountPubkey()).toBeNull()
  })

  it('setActiveDeckIdForAccount validates membership + persists', () => {
    storage.init()
    storage.ensureWorkspaceForAccount('pk1', [makeDeck('d1'), makeDeck('d2')])
    storage.setActiveDeckIdForAccount('pk1', 'd2')
    expect(storage.getActiveWorkspace('pk1')!.activeDeckId).toBe('d2')
    // Stale id is rejected.
    storage.setActiveDeckIdForAccount('pk1', 'ghost')
    expect(storage.getActiveWorkspace('pk1')!.activeDeckId).toBe('d2')
  })

  it('migrates v1 decks to per-account-workspaces on init when WORKSPACES_BY_ACCOUNT absent', () => {
    // Simulate post-v1 prod state: DECKS present, WORKSPACES_BY_ACCOUNT absent.
    const v1Decks = [
      {
        id: 'd1',
        name: 'My Deck',
        ownerPubkey: 'pk1',
        columns: [{ id: 'c1', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' }],
        createdAt: 1000,
        updatedAt: 1000
      }
    ]
    window.localStorage.setItem(StorageKey.DECKS, JSON.stringify(v1Decks))
    window.localStorage.setItem(StorageKey.ACTIVE_DECK_ID, 'd1')
    // Need a paired account so the migration recognizes pk1's signingIdentity.
    window.localStorage.setItem(
      StorageKey.ACCOUNTS,
      JSON.stringify([{ pubkey: 'pk1', signerType: 'nsec' }])
    )

    storage.init()

    expect(storage.getActiveWorkspace('pk1')).not.toBeNull()
    expect(storage.getActiveWorkspace('pk1')!.decks).toHaveLength(1)
    expect(storage.getActiveWorkspace('pk1')!.decks[0].columns).toHaveLength(1)
    expect(window.localStorage.getItem(StorageKey.WORKSPACES_BY_ACCOUNT)).not.toBeNull()
  })
})

/**
 * Decks v2 — per-deck mutations + dirty-state predicates. Tests exercise the
 * service directly (not via React).
 */
describe('LocalStorageService — per-deck mutations (Decks v2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const setupWorkspace = () => {
    storage.init()
    const deck: TDeck = {
      id: 'd1',
      name: 'My Deck',
      columns: [{ id: 'c1', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' }],
      savedColumns: [{ id: 'c1', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' }],
      createdAt: 1000,
      updatedAt: 1000,
      lastSavedAt: 1000
    }
    storage.ensureWorkspaceForAccount('pk1', [deck])
    storage.setActiveAccountPubkey('pk1')
  }

  it('saveActiveDeck copies columns to savedColumns', () => {
    setupWorkspace()
    storage.setActiveDeckColumns([
      { id: 'c1', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' },
      { id: 'c2', type: 'notifications', viewContext: 'pk1', signingIdentity: 'pk1' }
    ])
    expect(storage.isActiveDeckDirty()).toBe(true)
    storage.saveActiveDeck()
    expect(storage.isActiveDeckDirty()).toBe(false)
    expect(storage.getActiveDeck()!.savedColumns).toHaveLength(2)
  })

  it('discardActiveDeckChanges reverts columns to savedColumns', () => {
    setupWorkspace()
    storage.setActiveDeckColumns([
      { id: 'c1', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' },
      { id: 'c2', type: 'notifications', viewContext: 'pk1', signingIdentity: 'pk1' }
    ])
    storage.discardActiveDeckChanges()
    expect(storage.getActiveDeck()!.columns).toHaveLength(1)
    expect(storage.isActiveDeckDirty()).toBe(false)
  })

  it('saveActiveDeckAs creates new deck in same workspace + switches active', () => {
    setupWorkspace()
    storage.saveActiveDeckAs({ name: 'Forked' })
    const workspace = storage.getActiveWorkspace()!
    expect(workspace.decks).toHaveLength(2)
    expect(workspace.decks[1].name).toBe('Forked')
    expect(workspace.activeDeckId).toBe(workspace.decks[1].id)
  })

  it('addEmptyDeck adds empty deck + switches active', () => {
    setupWorkspace()
    storage.addEmptyDeck({ name: 'Fresh' })
    const workspace = storage.getActiveWorkspace()!
    expect(workspace.decks).toHaveLength(2)
    expect(workspace.decks[1].columns).toHaveLength(0)
    expect(workspace.activeDeckId).toBe(workspace.decks[1].id)
  })

  it('renameDeck updates name + bumps updatedAt', () => {
    setupWorkspace()
    const beforeUpdatedAt = storage.getActiveDeck()!.updatedAt
    storage.renameDeck('d1', 'Renamed')
    const deck = storage.getActiveDeck()!
    expect(deck.name).toBe('Renamed')
    expect(deck.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt)
  })

  it('duplicateDeck clones savedColumns + names with (copy) suffix; does NOT switch active', () => {
    setupWorkspace()
    storage.duplicateDeck('d1')
    const workspace = storage.getActiveWorkspace()!
    expect(workspace.decks).toHaveLength(2)
    expect(workspace.decks[1].name).toBe('My Deck (copy)')
    // Active NOT switched.
    expect(workspace.activeDeckId).toBe('d1')
  })

  it('deleteDeck removes deck + picks surviving as active when deleted deck was active', () => {
    setupWorkspace()
    storage.addEmptyDeck({ name: 'Second' })
    // Active is now 'Second'; switch back to d1 then delete it.
    storage.setActiveDeckIdForAccount('pk1', 'd1')
    storage.deleteDeck('d1')
    const workspace = storage.getActiveWorkspace()!
    expect(workspace.decks).toHaveLength(1)
    expect(workspace.decks[0].name).toBe('Second')
    expect(workspace.activeDeckId).toBe(workspace.decks[0].id)
  })

  it('deleteDeck on last deck creates Untitled (last-deck guard)', () => {
    setupWorkspace()
    storage.deleteDeck('d1')
    const workspace = storage.getActiveWorkspace()!
    expect(workspace.decks).toHaveLength(1)
    expect(workspace.decks[0].name).toBe('Untitled deck')
    expect(workspace.decks[0].columns).toHaveLength(0)
    expect(workspace.activeDeckId).toBe(workspace.decks[0].id)
  })

  it('isAnyWorkspaceDirty returns true if any workspace has dirty active deck', () => {
    setupWorkspace()
    expect(storage.isAnyWorkspaceDirty()).toBe(false)
    storage.setActiveDeckColumns([
      { id: 'c2', type: 'home', viewContext: 'pk1', signingIdentity: 'pk1' }
    ])
    expect(storage.isAnyWorkspaceDirty()).toBe(true)
  })

  it('transient columns excluded from dirty computation', () => {
    setupWorkspace()
    storage.setActiveDeckColumns([
      ...storage.getActiveDeck()!.columns,
      {
        id: 'transient',
        type: 'detail',
        viewContext: 'pk1',
        signingIdentity: 'pk1',
        transient: true
      }
    ])
    expect(storage.isActiveDeckDirty()).toBe(false)
  })
})

describe('LocalStorageService — deck-sync meta + isDeckDirtyById', () => {
  beforeEach(() => {
    window.localStorage.clear()
    storage.init()
  })

  it('getDeckSyncAppliedCreatedAt returns null when unset', () => {
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBeNull()
  })

  it('set then get round-trips and persists to localStorage', () => {
    storage.setDeckSyncAppliedCreatedAt('pk1', 1700000000)
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBe(1700000000)
    const raw = window.localStorage.getItem(StorageKey.DECK_SYNC_META)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({ pk1: { lastAppliedCreatedAt: 1700000000 } })
  })

  it('isDeckDirtyById is false when live columns match saved', () => {
    const clean: TDeck = {
      id: 'd1',
      name: 'My Deck',
      columns: [{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      savedColumns: [{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
    storage.ensureWorkspaceForAccount('pk1', [clean])
    expect(storage.isDeckDirtyById('pk1', 'd1')).toBe(false)
  })

  it('isDeckDirtyById is true when live columns differ from saved', () => {
    const dirty: TDeck = {
      id: 'd1',
      name: 'My Deck',
      columns: [{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      savedColumns: [],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
    storage.ensureWorkspaceForAccount('pk1', [dirty])
    expect(storage.isDeckDirtyById('pk1', 'd1')).toBe(true)
  })
})

describe('migrateColumns', () => {
  it('keeps a messages column', () => {
    const out = migrateColumns([{ id: 'x', type: 'messages', viewContext: 'pk', signingIdentity: 'pk' }])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('messages')
  })
})

describe('read-notifications storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips ids per pubkey', () => {
    storage.setReadNotifications('pk1', ['a', 'b'])
    expect(storage.getReadNotifications('pk1')).toEqual(['a', 'b'])
  })
  it('returns [] for an unknown pubkey', () => {
    expect(storage.getReadNotifications('nope')).toEqual([])
  })
  it('isolates pubkeys', () => {
    storage.setReadNotifications('pk1', ['a'])
    storage.setReadNotifications('pk2', ['x', 'y'])
    expect(storage.getReadNotifications('pk1')).toEqual(['a'])
    expect(storage.getReadNotifications('pk2')).toEqual(['x', 'y'])
  })
})

describe('LocalStorageService.deleteDeck — tombstones', () => {
  beforeEach(() => window.localStorage.clear())

  const mkDeck = (id: string): TDeck => ({
    id,
    name: id,
    columns: [],
    savedColumns: [],
    createdAt: 1,
    updatedAt: 1,
    lastSavedAt: 1
  })

  it('writes a tombstone and preserves other workspace fields on delete', () => {
    storage.setWorkspacesByAccount({
      pk: {
        activeDeckId: 'a',
        decks: [mkDeck('a'), mkDeck('b')],
        pairedAgents: [{ pubkey: 'h', npub: 'npub1x', scope: 'read-only', pairedAt: 1 }],
        allowSiblingExposure: true
      }
    })
    storage.setActiveAccountPubkey('pk')
    const before = Date.now()
    storage.deleteDeck('b')

    const ws = storage.getWorkspacesByAccount()['pk']
    expect(ws.decks.map((d) => d.id)).toEqual(['a'])
    expect(ws.deletedDecks?.['b']).toBeGreaterThanOrEqual(before)
    expect(ws.pairedAgents).toHaveLength(1) // regression: optional fields not dropped
    expect(ws.allowSiblingExposure).toBe(true)
  })

  it('tombstones the deleted deck even when the last-deck guard fires', () => {
    storage.setWorkspacesByAccount({ pk: { activeDeckId: 'only', decks: [mkDeck('only')] } })
    storage.setActiveAccountPubkey('pk')
    storage.deleteDeck('only')

    const ws = storage.getWorkspacesByAccount()['pk']
    expect(ws.deletedDecks?.['only']).toBeTypeOf('number')
    expect(ws.decks).toHaveLength(1)
    expect(ws.decks[0].name).toBe('Untitled deck')
  })

  it('accumulates tombstones across sequential deletes', () => {
    storage.setWorkspacesByAccount({
      pk: { activeDeckId: 'a', decks: [mkDeck('a'), mkDeck('b'), mkDeck('c')] }
    })
    storage.setActiveAccountPubkey('pk')
    storage.deleteDeck('b')
    storage.deleteDeck('c')

    const ws = storage.getWorkspacesByAccount()['pk']
    expect(ws.deletedDecks?.['b']).toBeTypeOf('number')
    expect(ws.deletedDecks?.['c']).toBeTypeOf('number')
    expect(ws.decks.map((d) => d.id)).toEqual(['a'])
  })
})
