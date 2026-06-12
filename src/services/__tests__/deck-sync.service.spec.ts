import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { base64 } from '@scure/base'
import type { TAccountWorkspace } from '@/types/column'
import { StorageKey } from '@/constants'
import { encodeWorkspace } from '@/services/deck-sync-codec'
import client from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import storage from '@/services/local-storage.service'

vi.mock('@/services/client.service', () => ({
  default: { getSignerFor: vi.fn(), publishAs: vi.fn(), query: vi.fn() }
}))
vi.mock('@/services/fetchers/relay-list.service', () => ({
  default: { fetchRelayList: vi.fn() }
}))

// Build a minimal v2-shaped wire so detectNip44Version() sees byte 0x02 and
// routes through the v2 fallback path. The body is just the plaintext bytes —
// good enough for fake encrypt/decrypt round-tripping in this suite.
const fakeV2Wire = (plain: string): string => {
  const txt = new TextEncoder().encode(plain)
  const raw = new Uint8Array(1 + txt.length)
  raw[0] = 0x02
  raw.set(txt, 1)
  return base64.encode(raw)
}

const unpackFakeV2Wire = (ct: string): string => {
  const raw = base64.decode(ct)
  if (raw[0] !== 0x02) throw new Error('not v2')
  return new TextDecoder().decode(raw.subarray(1))
}

// Identity-ish v2-only signer. supportsNip44v3 returns false so the deck-sync
// crypto helper takes the v2 fallback path; tests then assert against the
// canonical v2 wire shape.
const fakeSigner = {
  getPublicKey: vi.fn(),
  signEvent: vi.fn(),
  nip04Encrypt: vi.fn(),
  nip04Decrypt: vi.fn(),
  nip44Encrypt: vi.fn(async (_pk: string, txt: string) => fakeV2Wire(txt)),
  nip44Decrypt: vi.fn(async (_pk: string, ct: string) => unpackFakeV2Wire(ct)),
  supportsNip44v3: () => false
}

const workspace = (over: Partial<TAccountWorkspace> = {}): TAccountWorkspace => ({
  activeDeckId: 'd1',
  decks: [
    {
      id: 'd1',
      name: 'My Deck',
      columns: [{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      savedColumns: [{ id: 'c1', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
  ],
  ...over
})

import deckSyncService, { shouldCheckRemoteNow } from '@/services/deck-sync.service'

describe('deckSyncService', () => {
  beforeEach(() => {
    window.localStorage.clear()
    storage.init()
    vi.clearAllMocks()
    deckSyncService.setConflictHandler(null)
    ;(client.getSignerFor as Mock).mockReturnValue(fakeSigner)
    ;(relayListService.fetchRelayList as Mock).mockResolvedValue({
      write: ['wss://w/'],
      read: ['wss://r/'],
      originalRelays: []
    })
    ;(client.publishAs as Mock).mockImplementation(async (pubkey: string, _urls: string[], draft) => ({
      ...draft,
      id: 'evt',
      pubkey,
      sig: 'sig'
    }))
  })

  it('publishWorkspace encrypts the workspace and publishes to write relays, then marks applied', async () => {
    storage.setWorkspacesByAccount({ pk1: workspace() })
    await deckSyncService.publishWorkspace('pk1')

    expect(client.publishAs).toHaveBeenCalledTimes(1)
    const [pubkey, urls, draft] = (client.publishAs as Mock).mock.calls[0]
    expect(pubkey).toBe('pk1')
    expect(urls).toEqual(['wss://w/'])
    expect(draft.content).toBe(fakeV2Wire(encodeWorkspace(workspace())))
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBe(draft.created_at)
  })

  it('fetchWorkspace queries by #d, decrypts, and decodes', async () => {
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(workspace())), created_at: 1234 }
    ])
    const result = await deckSyncService.fetchWorkspace('pk1')
    expect(result).not.toBeNull()
    expect(result!.createdAt).toBe(1234)
    expect(result!.workspace.decks[0].columns[0].id).toBe('c1')
    const filter = (client.query as Mock).mock.calls[0][1]
    expect(filter['#d']).toEqual(['spectr_decks'])
  })

  it('fetchWorkspace returns null when no event exists', async () => {
    ;(client.query as Mock).mockResolvedValue([])
    expect(await deckSyncService.fetchWorkspace('pk1')).toBeNull()
  })

  it('checkRemote: up-to-date when remote <= applied', async () => {
    storage.setDeckSyncAppliedCreatedAt('pk1', 200)
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(workspace())), created_at: 150 }
    ])
    expect((await deckSyncService.checkRemote('pk1')).status).toBe('up-to-date')
  })

  it('checkRemote: remote-newer when remote > applied', async () => {
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(workspace())), created_at: 300 }
    ])
    expect((await deckSyncService.checkRemote('pk1')).status).toBe('remote-newer')
  })

  it('publishWorkspace with a newer cached remote and no handler defaults to overwrite', async () => {
    storage.setWorkspacesByAccount({ pk1: workspace() })
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(workspace())), created_at: 300 }
    ])
    await deckSyncService.checkRemote('pk1') // populates the known-remote cache
    await deckSyncService.publishWorkspace('pk1')
    expect(client.publishAs).toHaveBeenCalledTimes(1)
  })

  it('publishWorkspace respects a "cancel" conflict choice (does not publish)', async () => {
    storage.setWorkspacesByAccount({ pk1: workspace() })
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(workspace())), created_at: 300 }
    ])
    deckSyncService.setConflictHandler(async () => 'cancel')
    await deckSyncService.checkRemote('pk1')
    await deckSyncService.publishWorkspace('pk1')
    expect(client.publishAs).not.toHaveBeenCalled()
  })

  it('publishWorkspace falls back to default relays when the account has no write relays', async () => {
    storage.setWorkspacesByAccount({ pk1: workspace() })
    window.localStorage.setItem(StorageKey.DEFAULT_RELAY_URLS, JSON.stringify(['wss://default/']))
    storage.init()
    ;(relayListService.fetchRelayList as Mock).mockResolvedValue({ write: [], read: [], originalRelays: [] })
    await deckSyncService.publishWorkspace('pk1')
    expect(client.publishAs).toHaveBeenCalledTimes(1)
    const urls = (client.publishAs as Mock).mock.calls[0][1]
    expect(urls.length).toBeGreaterThan(0)
  })

  it('publishWorkspace resolves without throwing when publish fails', async () => {
    storage.setWorkspacesByAccount({ pk1: workspace() })
    ;(client.publishAs as Mock).mockRejectedValue(new Error('relays down'))
    await expect(deckSyncService.publishWorkspace('pk1')).resolves.toBeUndefined()
  })

  it('fetchWorkspace returns null when the query throws', async () => {
    ;(client.query as Mock).mockRejectedValue(new Error('relays down'))
    expect(await deckSyncService.fetchWorkspace('pk1')).toBeNull()
  })

  it('applyRemoteMerge: updates untouched, keeps dirty (conflict), adds new — and does NOT advance lastApplied while a conflict is held', () => {
    const dirtyB: TAccountWorkspace['decks'][number] = {
      id: 'b',
      name: 'b-local',
      columns: [{ id: 'x', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      savedColumns: [],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
    storage.setWorkspacesByAccount({
      pk1: {
        activeDeckId: 'a',
        decks: [
          { id: 'a', name: 'a-old', columns: [], savedColumns: [], createdAt: 1, updatedAt: 1, lastSavedAt: 1 },
          dirtyB
        ]
      }
    })
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    const remote: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [
        { id: 'a', name: 'a-new', columns: [], savedColumns: [], createdAt: 1, updatedAt: 9, lastSavedAt: 9 },
        { id: 'b', name: 'b-remote', columns: [], savedColumns: [], createdAt: 1, updatedAt: 9, lastSavedAt: 9 },
        { id: 'c', name: 'c', columns: [], savedColumns: [], createdAt: 1, updatedAt: 1, lastSavedAt: 1 }
      ]
    }
    const conflicts = deckSyncService.applyRemoteMerge('pk1', remote, 777)
    const byId = Object.fromEntries(storage.getWorkspacesByAccount()['pk1'].decks.map((d) => [d.id, d]))
    expect(byId['a'].name).toBe('a-new') // untouched local, remote newer → updated
    expect(byId['b'].name).toBe('b-local') // dirty local → kept
    expect(byId['c']).toBeTruthy() // new remotely → added
    expect(conflicts.map((d) => d.id)).toEqual(['b'])
    // A held conflict means local does NOT fully correspond to the remote at 777,
    // so lastApplied must stay behind (100). Otherwise the save-time staleness
    // guard never fires and the next Save silently overwrites the peer's edit.
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBe(100)
  })

  it('applyRemoteMerge: advances lastApplied to the remote createdAt when there are NO conflicts', () => {
    storage.setWorkspacesByAccount({
      pk1: {
        activeDeckId: 'a',
        decks: [
          { id: 'a', name: 'a-old', columns: [], savedColumns: [], createdAt: 1, updatedAt: 1, lastSavedAt: 1 }
        ]
      }
    })
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    const remote: TAccountWorkspace = {
      activeDeckId: 'a',
      decks: [
        { id: 'a', name: 'a-new', columns: [], savedColumns: [], createdAt: 1, updatedAt: 9, lastSavedAt: 9 }
      ]
    }
    const conflicts = deckSyncService.applyRemoteMerge('pk1', remote, 777)
    expect(conflicts).toEqual([])
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBe(777)
  })

  it('after a conflict merge, the next publishWorkspace surfaces the conflict modal instead of silently overwriting', async () => {
    const dirtyB: TAccountWorkspace['decks'][number] = {
      id: 'b',
      name: 'b-local',
      columns: [{ id: 'x', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
      savedColumns: [],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
    storage.setWorkspacesByAccount({ pk1: { activeDeckId: 'b', decks: [dirtyB] } })
    storage.setDeckSyncAppliedCreatedAt('pk1', 100)
    const remote: TAccountWorkspace = {
      activeDeckId: 'b',
      decks: [
        { id: 'b', name: 'b-remote', columns: [], savedColumns: [], createdAt: 1, updatedAt: 9, lastSavedAt: 9 }
      ]
    }
    // Focus-merge keeps the dirty local deck and records the newer remote (777).
    deckSyncService.applyRemoteMerge('pk1', remote, 777)

    const handler = vi.fn(async () => 'cancel' as const)
    deckSyncService.setConflictHandler(handler)
    await deckSyncService.publishWorkspace('pk1')

    expect(handler).toHaveBeenCalledTimes(1) // modal fired — user gets to choose
    expect(client.publishAs).not.toHaveBeenCalled() // 'cancel' → no silent overwrite
  })
})

describe('deckSyncService.hydrateNewlyPairedAccount', () => {
  const remoteWorkspace = (): TAccountWorkspace => ({
    activeDeckId: 'remote-d',
    decks: [
      {
        id: 'remote-d',
        name: 'Remote Deck',
        columns: [{ id: 'rc', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
        savedColumns: [{ id: 'rc', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' }],
        createdAt: 9,
        updatedAt: 9,
        lastSavedAt: 9
      }
    ]
  })

  beforeEach(() => {
    window.localStorage.clear()
    storage.init()
    vi.clearAllMocks()
    deckSyncService.setConflictHandler(null)
    ;(client.getSignerFor as Mock).mockReturnValue(fakeSigner)
    ;(relayListService.fetchRelayList as Mock).mockResolvedValue({
      write: ['wss://w/'],
      read: ['wss://r/'],
      originalRelays: []
    })
  })

  it('replaces a pristine seeded default with the remote workspace', async () => {
    const seeded = { id: 'seed-d', name: 'My Deck', columns: [], savedColumns: [], createdAt: 1, updatedAt: 1, lastSavedAt: 1 }
    storage.ensureWorkspaceForAccount('pk1', [seeded])
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(remoteWorkspace())), created_at: 555 }
    ])
    const applied = await deckSyncService.hydrateNewlyPairedAccount('pk1', 'seed-d')
    expect(applied).toBe(true)
    expect(storage.getWorkspacesByAccount()['pk1'].decks[0].id).toBe('remote-d')
    expect(storage.getDeckSyncAppliedCreatedAt('pk1')).toBe(555)
  })

  it('does NOT replace when the local deck is dirty', async () => {
    const dirty = {
      id: 'seed-d',
      name: 'My Deck',
      columns: [{ id: 'x', viewContext: 'pk1', signingIdentity: 'pk1', type: 'home' as const }],
      savedColumns: [],
      createdAt: 1,
      updatedAt: 1,
      lastSavedAt: 1
    }
    storage.ensureWorkspaceForAccount('pk1', [dirty])
    ;(client.query as Mock).mockResolvedValue([
      { content: fakeV2Wire(encodeWorkspace(remoteWorkspace())), created_at: 555 }
    ])
    const applied = await deckSyncService.hydrateNewlyPairedAccount('pk1', 'seed-d')
    expect(applied).toBe(false)
    expect(storage.getWorkspacesByAccount()['pk1'].decks[0].id).toBe('seed-d')
  })

  it('returns false when there is no remote', async () => {
    storage.ensureWorkspaceForAccount('pk1', [{ id: 'seed-d', name: 'My Deck', columns: [], savedColumns: [], createdAt: 1, updatedAt: 1, lastSavedAt: 1 }])
    ;(client.query as Mock).mockResolvedValue([])
    expect(await deckSyncService.hydrateNewlyPairedAccount('pk1', 'seed-d')).toBe(false)
  })
})

describe('shouldCheckRemoteNow', () => {
  it('returns true when never checked', () => {
    expect(shouldCheckRemoteNow(null, 1000, 30000)).toBe(true)
  })
  it('returns false within the interval', () => {
    expect(shouldCheckRemoteNow(1000, 1000 + 5000, 30000)).toBe(false)
  })
  it('returns true after the interval', () => {
    expect(shouldCheckRemoteNow(1000, 1000 + 30001, 30000)).toBe(true)
  })
})
