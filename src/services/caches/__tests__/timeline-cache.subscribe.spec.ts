import dayjs from 'dayjs'
import type { Event as NEvent, Filter } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type SubHandlers = {
  onevent: (evt: NEvent) => void
  oneose: (eosed: boolean) => void
}

const subscribeCalls: { urls: string[]; filter: Filter; handlers: SubHandlers }[] = []

vi.mock('@/services/client.service', () => ({
  default: {
    subscribe: vi.fn((urls: string[], filter: Filter, handlers: SubHandlers) => {
      subscribeCalls.push({ urls, filter, handlers })
      return { close: vi.fn() }
    })
  }
}))
vi.mock('@/services/indexed-db.service', () => ({
  default: { putEvents: vi.fn(async () => {}), getEvents: vi.fn(async () => []) }
}))
vi.mock('@/services/caches/seen-on.service', () => ({
  default: { getEventHints: vi.fn(() => []), trackEventExternalSeenOn: vi.fn() }
}))

const eventStore = new Map<string, NEvent>()
vi.mock('@/services/caches/event-cache.service', () => ({
  default: {
    addToCache: vi.fn((evt: NEvent) => {
      eventStore.set(evt.id, evt)
    }),
    loadEventsByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => eventStore.get(id)).filter(Boolean)
    )
  }
}))

import timelineCache from '@/services/caches/timeline-cache.service'

let counter = 0
function makeEvent(createdAt: number): NEvent {
  counter++
  return {
    id: `event-${counter}`.padEnd(64, '0'),
    pubkey: 'pk'.padEnd(64, '0'),
    created_at: createdAt,
    kind: 1,
    tags: [],
    content: `note ${counter}`,
    sig: 'sig'
  }
}

async function openTimeline(relay: string) {
  const onEvents = vi.fn()
  const onNew = vi.fn()
  const { closer } = await timelineCache.subscribeTimeline(
    [{ urls: [relay], filter: { kinds: [1], limit: 50 } }],
    { onEvents, onNew }
  )
  const sub = subscribeCalls[subscribeCalls.length - 1]
  return { onEvents, onNew, closer, sub }
}

beforeEach(() => {
  subscribeCalls.length = 0
  eventStore.clear()
})

describe('timelineCache.subscribeTimeline live-event delivery', () => {
  it('forwards a post-EOSE event whose created_at predates EOSE (late propagation)', async () => {
    const now = dayjs().unix()
    const { onNew, sub } = await openTimeline('wss://late-propagation.test')

    const newer = makeEvent(now - 100)
    const older = makeEvent(now - 200)
    sub.handlers.onevent(newer)
    sub.handlers.onevent(older)
    sub.handlers.oneose(true)

    // Created before EOSE, delivered after it — e.g. slow cross-relay
    // propagation or an offline note republished later. Must still surface.
    const late = makeEvent(now - 150)
    sub.handlers.onevent(late)
    expect(onNew).toHaveBeenCalledWith(late)
  })

  it('does not re-notify for a duplicate post-EOSE delivery', async () => {
    const now = dayjs().unix()
    const { onNew, sub } = await openTimeline('wss://duplicate-delivery.test')

    const evt = makeEvent(now - 100)
    sub.handlers.onevent(evt)
    sub.handlers.oneose(true)

    sub.handlers.onevent(evt)
    expect(onNew).not.toHaveBeenCalled()
  })

  it('ignores a post-EOSE event older than the whole cached window', async () => {
    const now = dayjs().unix()
    const { onNew, sub } = await openTimeline('wss://too-old.test')

    sub.handlers.onevent(makeEvent(now - 100))
    sub.handlers.onevent(makeEvent(now - 200))
    sub.handlers.oneose(true)

    sub.handlers.onevent(makeEvent(now - 300))
    expect(onNew).not.toHaveBeenCalled()
  })

  it('clamps the re-subscribe REQ since to now when the cache holds a future-dated event', async () => {
    const now = dayjs().unix()
    const relay = 'wss://future-poison.test'
    const first = await openTimeline(relay)

    const future = makeEvent(now + 3600)
    first.sub.handlers.onevent(future)
    first.sub.handlers.oneose(true)
    first.closer()

    const second = await openTimeline(relay)
    expect(second.sub.filter.since).toBeDefined()
    expect(second.sub.filter.since!).toBeLessThanOrEqual(dayjs().unix())
  })

  it('does not duplicate an event present in both the cache and the catch-up batch', async () => {
    const now = dayjs().unix()
    const relay = 'wss://overlap-dedup.test'
    const first = await openTimeline(relay)

    const future = makeEvent(now + 3600)
    first.sub.handlers.onevent(future)
    first.sub.handlers.oneose(true)
    first.closer()

    // With since clamped to now, the relay legitimately re-sends the
    // future-dated event in the stored batch of the new subscription.
    const second = await openTimeline(relay)
    second.sub.handlers.onevent(future)
    second.sub.handlers.oneose(true)

    const lastBatch: NEvent[] = second.onEvents.mock.calls.at(-1)![0]
    const ids = lastBatch.map((evt) => evt.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
