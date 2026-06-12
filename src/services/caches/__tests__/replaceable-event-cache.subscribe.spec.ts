import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Event as NEvent } from 'nostr-tools'
import { getReplaceableCoordinate } from '@/lib/event'

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    putReplaceableEvent: vi.fn(async (e: NEvent) => e),
    getReplaceableEvent: vi.fn(async () => undefined),
    putNullReplaceableEvent: vi.fn()
  }
}))
vi.mock('@/services/client.service', () => ({ default: { query: vi.fn(async () => []) } }))
vi.mock('@/services/fetchers/relay-list.service', () => ({
  default: { fetchRelayList: vi.fn(async () => ({ write: [], read: [], originalRelays: [] })) }
}))

import cache from '@/services/caches/replaceable-event-cache.service'

const ev = (over: Partial<NEvent> = {}): NEvent =>
  ({ id: 'a', kind: 3, pubkey: 'pk1', created_at: 100, tags: [], content: '', sig: 's', ...over }) as NEvent

const COORD = getReplaceableCoordinate(3, 'pk1')

describe('replaceableEventCache subscribability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies subscribers when addToCache installs a newer event', () => {
    const cb = vi.fn()
    const unsub = cache.subscribe(COORD, cb)
    cache.addToCache(ev({ id: 'a', created_at: 100 }))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cache.getSnapshot(COORD)?.id).toBe('a')
    unsub()
  })

  it('getSnapshot returns a stable reference until the value changes', () => {
    cache.addToCache(ev({ id: 'a', created_at: 100 }))
    const first = cache.getSnapshot(COORD)
    expect(cache.getSnapshot(COORD)).toBe(first)
  })

  it('ignores a stale older event (newer-wins gate) and does not notify', () => {
    cache.addToCache(ev({ id: 'a', created_at: 200 }))
    const cb = vi.fn()
    cache.subscribe(COORD, cb)
    cache.addToCache(ev({ id: 'b', created_at: 100 }))
    expect(cb).not.toHaveBeenCalled()
    expect(cache.getSnapshot(COORD)?.created_at).toBe(200)
  })

  it('unsubscribe stops delivery', () => {
    const cb = vi.fn()
    const unsub = cache.subscribe(COORD, cb)
    unsub()
    cache.addToCache(ev({ id: 'c', created_at: 999 }))
    expect(cb).not.toHaveBeenCalled()
  })

  it('updateCache installs + notifies', async () => {
    const cb = vi.fn()
    cache.subscribe(COORD, cb)
    await cache.updateCache(ev({ id: 'd', created_at: 1000 }))
    expect(cb).toHaveBeenCalled()
    expect(cache.getSnapshot(COORD)?.id).toBe('d')
  })
})
