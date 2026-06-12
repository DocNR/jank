import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nip19 } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import type { TColumn } from '@/types/column'
import type { Event } from 'nostr-tools'

vi.mock('../../local-storage.service', () => ({
  default: {
    getWorkspacesByAccount: vi.fn(),
    getAccounts: vi.fn()
  }
}))

vi.mock('../../indexed-db.service', () => ({
  default: {
    getEvents: vi.fn(),
    getReplaceableEvent: vi.fn()
  }
}))

vi.mock('../../client.service', () => ({
  default: {
    query: vi.fn()
  }
}))

vi.mock('../../fetchers/relay-list.service', () => ({
  default: {
    fetchRelayList: vi.fn()
  }
}))

vi.mock('../../profile-fetcher.service', () => ({
  default: {
    fetchProfile: vi.fn()
  }
}))

import storage from '../../local-storage.service'
import indexedDb from '../../indexed-db.service'
import client from '../../client.service'
import relayListService from '../../fetchers/relay-list.service'
import profileFetcher from '../../profile-fetcher.service'
import { listNotesInColumnHandler, listNotesInColumnDef } from '../list-notes-in-column'

const owner = 'a'.repeat(64)
const sibling = 'b'.repeat(64)
const foreign = 'c'.repeat(64)
const author1 = 'd'.repeat(64)
const author2 = 'e'.repeat(64)

const ctx = { workspaceOwner: owner, senderPubkey: 'f'.repeat(64) }

const mkColumn = (
  id: string,
  type: TColumn['type'],
  viewContext: string,
  config: TColumn['config'] = {}
): TColumn => ({
  id,
  type,
  viewContext,
  signingIdentity: owner,
  config
})

const mkEvent = (overrides: Partial<Event>): { event: Event; relays: string[] } => ({
  event: {
    id: 'id'.repeat(32),
    pubkey: author1,
    kind: 1,
    content: 'hello',
    created_at: 1000,
    tags: [],
    sig: 'sig',
    ...overrides
  } as Event,
  relays: ['wss://relay.example']
})

function setWorkspace(columns: TColumn[], extra: Record<string, unknown> = {}) {
  vi.mocked(storage.getWorkspacesByAccount).mockReturnValue({
    [owner]: {
      activeDeckId: 'd1',
      decks: [
        {
          id: 'd1',
          name: 'Main',
          columns,
          savedColumns: [],
          createdAt: 0,
          updatedAt: 0,
          lastSavedAt: 0
        }
      ],
      ...extra
    }
  } as any)
}

describe('list_notes_in_column', () => {
  beforeEach(() => {
    vi.mocked(storage.getWorkspacesByAccount).mockReset()
    vi.mocked(storage.getAccounts).mockReset()
    vi.mocked(indexedDb.getEvents).mockReset()
    vi.mocked(indexedDb.getReplaceableEvent).mockReset()
    vi.mocked(client.query).mockReset()
    vi.mocked(relayListService.fetchRelayList).mockReset()
    vi.mocked(profileFetcher.fetchProfile).mockReset()
    vi.mocked(storage.getAccounts).mockReturnValue([
      { pubkey: owner, signerType: 'bunker' },
      { pubkey: sibling, signerType: 'bunker' }
    ] as any)
    // Defaults: live-fetch resolves to no relay results and no profile names, so
    // tests that don't opt into live behavior behave as cache-only.
    vi.mocked(client.query).mockResolvedValue([])
    vi.mocked(relayListService.fetchRelayList).mockResolvedValue({
      read: ['wss://read.example/'],
      write: ['wss://write.example/'],
      originalRelays: []
    } as any)
    vi.mocked(profileFetcher.fetchProfile).mockResolvedValue(null)
  })

  it('def has the correct shape', () => {
    expect(listNotesInColumnDef.name).toBe('list_notes_in_column')
    expect((listNotesInColumnDef.inputSchema as any).type).toBe('object')
    expect((listNotesInColumnDef.inputSchema as any).required).toContain('columnId')
    expect((listNotesInColumnDef.inputSchema as any).additionalProperties).toBe(false)
  })

  it('returns notes for a hashtag column, newest-first', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    vi.mocked(indexedDb.getEvents).mockResolvedValue([
      mkEvent({ id: 'n2'.repeat(16) as any, created_at: 2000, pubkey: author2 }),
      mkEvent({ id: 'n1'.repeat(16) as any, created_at: 1000, pubkey: author1 })
    ])

    const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const notes = (result.structuredContent as any).notes
      expect(notes).toHaveLength(2)
      // newest-first
      expect(notes[0].created_at).toBe(2000)
      expect(notes[1].created_at).toBe(1000)
      // shape
      expect(notes[0]).toHaveProperty('id')
      expect(notes[0]).toHaveProperty('pubkey')
      expect(notes[0]).toHaveProperty('kind')
      expect(notes[0]).toHaveProperty('content')
      expect(notes[0]).toHaveProperty('created_at')
      expect(notes[0]).toHaveProperty('tags')
    }
    // hashtag filter passed to the cache read
    const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
    expect(filterArg.kinds).toEqual([1])
    expect((filterArg as any)['#t']).toEqual(['nostr'])
  })

  it('derives a profile column filter from viewContext', async () => {
    setWorkspace([mkColumn('cp', 'profile', foreign)])
    vi.mocked(indexedDb.getEvents).mockResolvedValue([])
    await listNotesInColumnHandler({ columnId: 'cp' }, ctx)
    const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
    expect(filterArg.kinds).toEqual([1])
    expect((filterArg as any).authors).toEqual([foreign])
  })

  it('derives a relay column filter (kind 1, no relay-url enforcement at cache layer)', async () => {
    setWorkspace([mkColumn('cr', 'relay', owner, { relayUrl: 'wss://relay.example' })])
    vi.mocked(indexedDb.getEvents).mockResolvedValue([])
    await listNotesInColumnHandler({ columnId: 'cr' }, ctx)
    const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
    expect(filterArg.kinds).toEqual([1])
  })

  it('derives a home column filter from the cached follow list (viewContext + follows)', async () => {
    setWorkspace([mkColumn('ch', 'home', owner)])
    vi.mocked(indexedDb.getReplaceableEvent).mockResolvedValue({
      kind: kinds.Contacts,
      pubkey: owner,
      tags: [
        ['p', author1],
        ['p', author2]
      ]
    } as any)
    vi.mocked(indexedDb.getEvents).mockResolvedValue([])
    await listNotesInColumnHandler({ columnId: 'ch' }, ctx)
    expect(indexedDb.getReplaceableEvent).toHaveBeenCalledWith(owner, kinds.Contacts)
    const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
    expect(filterArg.kinds).toEqual([1, 6])
    // owner is always included alongside follows
    expect((filterArg as any).authors).toContain(owner)
    expect((filterArg as any).authors).toContain(author1)
    expect((filterArg as any).authors).toContain(author2)
  })

  it('home column with no cached follow list still queries (just the viewContext)', async () => {
    setWorkspace([mkColumn('ch', 'home', owner)])
    vi.mocked(indexedDb.getReplaceableEvent).mockResolvedValue(undefined)
    vi.mocked(indexedDb.getEvents).mockResolvedValue([])
    const result = await listNotesInColumnHandler({ columnId: 'ch' }, ctx)
    expect(result.ok).toBe(true)
    const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
    expect((filterArg as any).authors).toEqual([owner])
  })

  it('applies the since floor (created_at > since)', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    vi.mocked(indexedDb.getEvents).mockResolvedValue([
      mkEvent({ id: 'n3'.repeat(16) as any, created_at: 3000 }),
      mkEvent({ id: 'n2'.repeat(16) as any, created_at: 2000 }),
      mkEvent({ id: 'n1'.repeat(16) as any, created_at: 1000 })
    ])
    const result = await listNotesInColumnHandler({ columnId: 'c1', since: 2000 }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const notes = (result.structuredContent as any).notes
      // strictly greater-than: 3000 only
      expect(notes).toHaveLength(1)
      expect(notes[0].created_at).toBe(3000)
    }
  })

  it('caps results at limit', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    const many = Array.from({ length: 10 }, (_, i) =>
      mkEvent({ id: `n${i}`.padStart(2, '0').repeat(16) as any, created_at: 1000 + i })
    )
    vi.mocked(indexedDb.getEvents).mockResolvedValue(many.reverse())
    const result = await listNotesInColumnHandler({ columnId: 'c1', limit: 3 }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.structuredContent as any).notes).toHaveLength(3)
    }
  })

  it('clamps a limit above the max so at most 200 notes are returned', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    // 250 cached events, all distinct ids/created_at; ask for 9999.
    const many = Array.from({ length: 250 }, (_, i) =>
      mkEvent({ id: String(i).padStart(64, '0') as any, created_at: 1000 + i })
    ).reverse()
    vi.mocked(indexedDb.getEvents).mockResolvedValue(many)
    const result = await listNotesInColumnHandler({ columnId: 'c1', limit: 9999 }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.structuredContent as any).notes.length).toBeLessThanOrEqual(200)
      expect((result.structuredContent as any).notes.length).toBe(200)
    }
  })

  it('returns -32602 for an unknown columnId', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    const result = await listNotesInColumnHandler({ columnId: 'nope' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
      expect(result.error.message).toContain('unknown columnId')
    }
    expect(indexedDb.getEvents).not.toHaveBeenCalled()
  })

  it('returns -32602 when columnId is missing', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    const result = await listNotesInColumnHandler({}, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
    }
  })

  it('respects the sibling-account opsec boundary (refuses a sibling-viewing column)', async () => {
    setWorkspace([mkColumn('cs', 'profile', sibling)])
    const result = await listNotesInColumnHandler({ columnId: 'cs' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // treated as not-visible → same as unknown column
      expect(result.error.code).toBe(-32602)
    }
    expect(indexedDb.getEvents).not.toHaveBeenCalled()
  })

  it('allows a sibling-viewing column when allowSiblingExposure is true', async () => {
    setWorkspace([mkColumn('cs', 'profile', sibling)], { allowSiblingExposure: true })
    vi.mocked(indexedDb.getEvents).mockResolvedValue([])
    const result = await listNotesInColumnHandler({ columnId: 'cs' }, ctx)
    expect(result.ok).toBe(true)
  })

  it('gates out a search column with -32602 (NIP-50 not evaluable client-side)', async () => {
    setWorkspace([mkColumn('cq', 'search', owner, { query: 'bitcoin' })])
    const result = await listNotesInColumnHandler({ columnId: 'cq' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
      expect(result.error.message).toContain('unsupported column type')
    }
    expect(indexedDb.getEvents).not.toHaveBeenCalled()
  })

  it('gates out a bookmarks column with -32602', async () => {
    setWorkspace([mkColumn('cb', 'bookmarks', owner)])
    const result = await listNotesInColumnHandler({ columnId: 'cb' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
      expect(result.error.message).toContain('unsupported column type')
    }
  })

  it('returns -32603 when workspace is not found', async () => {
    vi.mocked(storage.getWorkspacesByAccount).mockReturnValue({})
    const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32603)
    }
  })

  it('returns -32603 when the cache read throws', async () => {
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    vi.mocked(indexedDb.getEvents).mockRejectedValue(new Error('idb down'))
    const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32603)
    }
  })

  it('returns notes via structuredContent with no shadowing content block', async () => {
    // A count-only `content` block would be surfaced by MCP clients INSTEAD of
    // structuredContent, hiding the note text from the agent. Mirror the
    // get_account / list_columns tools: structuredContent only.
    setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
    vi.mocked(indexedDb.getEvents).mockResolvedValue([mkEvent({ created_at: 1000 })])
    const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
    if (result.ok) {
      expect(result.content).toBeUndefined()
      const notes = (result.structuredContent as any).notes
      expect(notes[0]).toHaveProperty('content')
    }
  })

  describe('live-fetch', () => {
    // client.query returns bare NEvents (not the {event,relays} cache wrapper).
    const mkLive = (overrides: Partial<Event>): Event =>
      ({
        id: 'id'.repeat(32),
        pubkey: author1,
        kind: 1,
        content: 'live',
        created_at: 1000,
        tags: [],
        sig: 'sig',
        ...overrides
      }) as Event

    it('merges relay results with cache, dedupes by id, sorts newest-first', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      // cache has c1@1000 and shared@1500
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'shared'.padEnd(64, '0') as any, created_at: 1500 }),
        mkEvent({ id: 'cacheonly'.padEnd(64, '0') as any, created_at: 1000 })
      ])
      // live has a fresh event @3000 plus the SAME shared id @1500 (dupe)
      vi.mocked(client.query).mockResolvedValue([
        mkLive({ id: 'live'.padEnd(64, '0') as any, created_at: 3000 }),
        mkLive({ id: 'shared'.padEnd(64, '0') as any, created_at: 1500 })
      ])

      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        // 3 distinct ids (shared deduped), newest-first
        expect(notes).toHaveLength(3)
        expect(notes.map((n: any) => n.created_at)).toEqual([3000, 1500, 1000])
        const ids = notes.map((n: any) => n.id)
        expect(new Set(ids).size).toBe(3)
      }
      expect(client.query).toHaveBeenCalledTimes(1)
    })

    it('respects limit/since across the merged cache+live pool', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'c2'.repeat(32) as any, created_at: 2000 }),
        mkEvent({ id: 'c1'.repeat(32) as any, created_at: 1000 })
      ])
      vi.mocked(client.query).mockResolvedValue([
        mkLive({ id: 'l4'.repeat(32) as any, created_at: 4000 }),
        mkLive({ id: 'l3'.repeat(32) as any, created_at: 3000 })
      ])
      // since=1500 drops the 1000 event; limit=2 keeps the two newest of {4000,3000,2000}
      const result = await listNotesInColumnHandler({ columnId: 'c1', since: 1500, limit: 2 }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        expect(notes.map((n: any) => n.created_at)).toEqual([4000, 3000])
      }
    })

    it('queries the relay-column URL directly (no relay-list lookup)', async () => {
      setWorkspace([mkColumn('cr', 'relay', owner, { relayUrl: 'wss://relay.example/' })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([])
      await listNotesInColumnHandler({ columnId: 'cr' }, ctx)
      expect(client.query).toHaveBeenCalledTimes(1)
      const [urls] = vi.mocked(client.query).mock.calls[0]
      expect(urls).toEqual(['wss://relay.example/'])
      // relay columns are self-scoping: no owner relay-list lookup
      expect(relayListService.fetchRelayList).not.toHaveBeenCalled()
    })

    it('uses owner read relays + big-relay fallback for home/hashtag/profile', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([])
      await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(relayListService.fetchRelayList).toHaveBeenCalledWith(owner)
      const [urls] = vi.mocked(client.query).mock.calls[0]
      expect(urls).toContain('wss://read.example/')
      // big-relay fallback appended
      expect((urls as string[]).length).toBeGreaterThan(1)
    })

    it('cachedOnly:true skips the relay query', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([mkEvent({ created_at: 1000 })])
      const result = await listNotesInColumnHandler({ columnId: 'c1', cachedOnly: true }, ctx)
      expect(result.ok).toBe(true)
      expect(client.query).not.toHaveBeenCalled()
      expect(relayListService.fetchRelayList).not.toHaveBeenCalled()
    })

    it('falls back to cache when the relay query errors (does not throw)', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([mkEvent({ created_at: 1000 })])
      vi.mocked(client.query).mockRejectedValue(new Error('relay down'))
      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.structuredContent as any).notes).toHaveLength(1)
      }
    })

    it('falls back to cache when the live query times out', async () => {
      vi.useFakeTimers()
      try {
        setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
        vi.mocked(indexedDb.getEvents).mockResolvedValue([mkEvent({ created_at: 1000 })])
        // a query that never EOSEs
        vi.mocked(client.query).mockReturnValue(new Promise<Event[]>(() => {}))
        const promise = listNotesInColumnHandler({ columnId: 'c1' }, ctx)
        // advance past the 6s live-fetch timeout (and the enrichment timeout)
        await vi.advanceTimersByTimeAsync(9000)
        const result = await promise
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect((result.structuredContent as any).notes).toHaveLength(1)
        }
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('author-name enrichment', () => {
    it('populates author_name from resolved profiles', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'n1'.repeat(32) as any, created_at: 2000, pubkey: author1 }),
        mkEvent({ id: 'n2'.repeat(32) as any, created_at: 1000, pubkey: author2 })
      ])
      vi.mocked(profileFetcher.fetchProfile).mockImplementation(async (pk: string) => {
        if (pk === author1) return { pubkey: author1, npub: 'npub1', username: 'Alice' } as any
        return null // author2 unresolved
      })

      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        const a1 = notes.find((n: any) => n.pubkey === author1)
        const a2 = notes.find((n: any) => n.pubkey === author2)
        expect(a1.author_name).toBe('Alice')
        // unresolved author: author_name omitted entirely
        expect(a2).not.toHaveProperty('author_name')
      }
    })

    it('tolerates profile resolution throwing (no author_name, no failure)', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([mkEvent({ created_at: 1000 })])
      vi.mocked(profileFetcher.fetchProfile).mockRejectedValue(new Error('boom'))
      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.structuredContent as any).notes[0]).not.toHaveProperty('author_name')
      }
    })

    it('def output schema documents the optional author_name', () => {
      const itemProps = (listNotesInColumnDef.outputSchema as any).properties.notes.items.properties
      expect(itemProps).toHaveProperty('author_name')
    })
  })

  describe('time window (until) + pagination', () => {
    it('bounds the ceiling with `until` (only created_at < until)', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'new'.padEnd(64, '0') as any, created_at: 3000 }),
        mkEvent({ id: 'mid'.padEnd(64, '0') as any, created_at: 2000 }),
        mkEvent({ id: 'old'.padEnd(64, '0') as any, created_at: 1000 })
      ])
      const result = await listNotesInColumnHandler({ columnId: 'c1', until: 2500 }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        // 3000 excluded (>= until), 2000 + 1000 kept
        expect(notes.map((n: any) => n.created_at)).toEqual([2000, 1000])
      }
      // until is pushed into the cache/query filter
      const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
      expect((filterArg as any).until).toBe(2500)
    })

    it('excludes a note exactly at `until` (exclusive ceiling)', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'at'.padEnd(64, '0') as any, created_at: 2000 }),
        mkEvent({ id: 'below'.padEnd(64, '0') as any, created_at: 1999 })
      ])
      const result = await listNotesInColumnHandler({ columnId: 'c1', until: 2000 }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        expect(notes.map((n: any) => n.created_at)).toEqual([1999])
      }
    })

    it('windows correctly with since + until together (strictly since < created_at < until)', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: 'after'.padEnd(64, '0') as any, created_at: 2500 }),
        mkEvent({ id: 'ceiling'.padEnd(64, '0') as any, created_at: 2000 }),
        mkEvent({ id: 'inside'.padEnd(64, '0') as any, created_at: 1500 }),
        mkEvent({ id: 'floor'.padEnd(64, '0') as any, created_at: 1000 }),
        mkEvent({ id: 'before'.padEnd(64, '0') as any, created_at: 500 })
      ])
      const result = await listNotesInColumnHandler(
        { columnId: 'c1', since: 1000, until: 2000 },
        ctx
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        const notes = (result.structuredContent as any).notes
        // floor (==since) and ceiling (==until) both excluded; only 1500 survives
        expect(notes.map((n: any) => n.created_at)).toEqual([1500])
      }
      const filterArg = vi.mocked(indexedDb.getEvents).mock.calls[0][0]
      expect((filterArg as any).since).toBe(1000)
      expect((filterArg as any).until).toBe(2000)
    })

    it('pages backward: a second call with until returns the older slice', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      const all = [
        mkEvent({ id: 'n4'.repeat(32) as any, created_at: 4000 }),
        mkEvent({ id: 'n3'.repeat(32) as any, created_at: 3000 }),
        mkEvent({ id: 'c2'.repeat(32) as any, created_at: 2000 }),
        mkEvent({ id: '11'.repeat(32) as any, created_at: 1000 })
      ]
      vi.mocked(indexedDb.getEvents).mockResolvedValue(all)

      // First page: newest two
      const page1 = await listNotesInColumnHandler({ columnId: 'c1', limit: 2 }, ctx)
      expect(page1.ok).toBe(true)
      if (!page1.ok) return
      const notes1 = (page1.structuredContent as any).notes
      expect(notes1.map((n: any) => n.created_at)).toEqual([4000, 3000])

      // Page backward using the oldest created_at seen
      const oldest = notes1[notes1.length - 1].created_at
      expect(oldest).toBe(3000)
      const page2 = await listNotesInColumnHandler(
        { columnId: 'c1', limit: 2, until: oldest },
        ctx
      )
      expect(page2.ok).toBe(true)
      if (!page2.ok) return
      const notes2 = (page2.structuredContent as any).notes
      expect(notes2.map((n: any) => n.created_at)).toEqual([2000, 1000])
    })

    it('attaches an njump url that decodes back to the note id', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      const validId = 'a'.repeat(64)
      vi.mocked(indexedDb.getEvents).mockResolvedValue([
        mkEvent({ id: validId as any, pubkey: author1, created_at: 1000 })
      ])
      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const url = (result.structuredContent as any).notes[0].url as string
        expect(url).toMatch(/^https:\/\/njump\.me\/nevent1/)
        const decoded = nip19.decode(url.replace('https://njump.me/', ''))
        expect(decoded.type).toBe('nevent')
        expect((decoded.data as any).id).toBe(validId)
      }
    })

    it('defaults to a limit of 100', async () => {
      setWorkspace([mkColumn('c1', 'hashtag', owner, { hashtags: ['nostr'] })])
      const many = Array.from({ length: 150 }, (_, i) =>
        mkEvent({ id: String(i).padStart(64, '0') as any, created_at: 1000 + i })
      ).reverse()
      vi.mocked(indexedDb.getEvents).mockResolvedValue(many)
      const result = await listNotesInColumnHandler({ columnId: 'c1' }, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.structuredContent as any).notes.length).toBe(100)
      }
    })

    it('def input schema documents until; output schema documents url', () => {
      const inputProps = (listNotesInColumnDef.inputSchema as any).properties
      expect(inputProps).toHaveProperty('until')
      const itemProps = (listNotesInColumnDef.outputSchema as any).properties.notes.items.properties
      expect(itemProps).toHaveProperty('url')
    })
  })
})
