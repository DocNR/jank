import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nip19, type Event as NEvent } from 'nostr-tools'

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    getEventById: vi.fn(async () => undefined),
    putEvents: vi.fn(),
    getReplaceableEventByCoordinate: vi.fn(async () => undefined)
  }
}))
vi.mock('@/services/client.service', () => ({ default: { query: vi.fn(async () => []) } }))
vi.mock('@/services/big-relay-fetcher.service', () => ({
  default: { fetchEvent: vi.fn(async () => undefined) }
}))
vi.mock('@/services/fetchers/relay-list.service', () => ({
  default: { fetchRelayList: vi.fn(async () => ({ write: [], read: [], originalRelays: [] })) }
}))
vi.mock('@/services/caches/replaceable-event-cache.service', () => ({
  default: { addToCache: vi.fn(), getFromCache: vi.fn(() => undefined), primeCache: vi.fn() }
}))
vi.mock('@/services/caches/seen-on.service', () => ({
  default: { trackEventExternalSeenOn: vi.fn(), getEventHints: vi.fn(() => []) }
}))

import eventCache from '@/services/caches/event-cache.service'

const ev = (id: string, over: Partial<NEvent> = {}): NEvent =>
  ({
    id,
    kind: 1,
    pubkey: 'b'.repeat(64),
    created_at: 100,
    tags: [],
    content: 'hi',
    sig: 's',
    ...over
  }) as NEvent

describe('eventCache.getCachedEvent (synchronous resolved peek)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns undefined for an id that has not been cached', () => {
    expect(eventCache.getCachedEvent('c'.repeat(64))).toBeUndefined()
  })

  it('returns the event synchronously by hex id after addToCache', () => {
    const id = 'a'.repeat(64)
    const e = ev(id)
    eventCache.addToCache(e)
    expect(eventCache.getCachedEvent(id)).toBe(e)
  })

  it('resolves an nevent encoding to the same cached event', () => {
    const id = 'd'.repeat(64)
    const e = ev(id)
    eventCache.addToCache(e)
    expect(eventCache.getCachedEvent(nip19.neventEncode({ id }))).toBe(e)
  })

  it('resolves a note encoding to the same cached event', () => {
    const id = 'e'.repeat(64)
    const e = ev(id)
    eventCache.addToCache(e)
    expect(eventCache.getCachedEvent(nip19.noteEncode(id))).toBe(e)
  })

  it('returns undefined for a malformed id without throwing', () => {
    expect(() => eventCache.getCachedEvent('not-a-valid-id')).not.toThrow()
    expect(eventCache.getCachedEvent('not-a-valid-id')).toBeUndefined()
  })
})
