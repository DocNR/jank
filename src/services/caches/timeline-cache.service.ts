import {
  compareEvents,
  getReplaceableCoordinateFromEvent,
  isReplaceableEvent
} from '@/lib/event'
import { mergeTimelines } from '@/lib/timeline'
import { TSubRequestFilter } from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import dayjs from 'dayjs'
import { Filter, Event as NEvent } from 'nostr-tools'
import client from '../client.service'
import indexedDb from '../indexed-db.service'
import eventCache from './event-cache.service'
import seenOn from './seen-on.service'

type TTimelineRef = [string, number]

class TimelineCacheService {
  private cacheMap: Record<
    string,
    | {
        refs: TTimelineRef[]
        filter: TSubRequestFilter
        urls: string[]
      }
    | string[]
    | undefined
  > = {}

  async getEventsFromIndexed(filter: Filter) {
    const items = await indexedDb.getEvents(filter)
    const storedEvents: NEvent[] = []
    // Dedupe replaceable events by coordinate (pubkey:kind:d-tag). The
    // events store keys on event id, so an edited article appears as
    // multiple rows; per Nostr semantics, only the latest version is
    // canonical. indexedDb.getEvents iterates the createdAtIndex desc,
    // so the first occurrence of a coordinate is the newest version —
    // skip subsequent (older) versions.
    const seenCoordinates = new Set<string>()
    items.forEach((item) => {
      if (isReplaceableEvent(item.event.kind)) {
        const coord = getReplaceableCoordinateFromEvent(item.event)
        if (seenCoordinates.has(coord)) return
        seenCoordinates.add(coord)
      }
      storedEvents.push(item.event)
      seenOn.trackEventExternalSeenOn(item.event.id, item.relays)
      eventCache.addToCache(item.event)
    })
    return storedEvents
  }

  async subscribeTimeline(
    subRequests: { urls: string[]; filter: TSubRequestFilter }[],
    {
      onEvents,
      onNew,
      onClose
    }: {
      onEvents: (events: NEvent[], eosed: boolean) => void
      onNew: (evt: NEvent) => void
      onClose?: (url: string, reason: string) => void
    },
    {
      startLogin,
      needSort = true,
      needSaveToDb = false,
      authPubkey
    }: {
      startLogin?: () => void
      needSort?: boolean
      needSaveToDb?: boolean
      /**
       * Pubkey to authenticate as when a relay returns `auth-required`.
       * Threaded through to `client.subscribe`. Typically a column's
       * `signingIdentity` from `useAccountScopeOptional()`. See the
       * KNOWN LIMITATION note on `client.subscribe`'s `authPubkey`
       * (per-WebSocket-connection AUTH; pool shares one connection per relay).
       */
      authPubkey?: string
    } = {}
  ) {
    const newEventIdSet = new Set<string>()
    const requestCount = subRequests.length
    const threshold = Math.floor(requestCount / 2)
    const timelines: NEvent[][] = new Array(requestCount).fill(0).map(() => [])
    let eosedCount = 0

    const subs = await Promise.all(
      subRequests.map(({ urls, filter }, i) => {
        return this._subscribeTimeline(
          urls,
          filter,
          {
            onEvents: (_events, _eosed) => {
              if (_eosed) {
                eosedCount++
              }

              timelines[i] = _events
              if (eosedCount >= threshold) {
                const events = mergeTimelines(timelines, filter.limit)
                onEvents(events, eosedCount >= requestCount)
              }
            },
            onNew: (evt) => {
              if (newEventIdSet.has(evt.id)) return
              newEventIdSet.add(evt.id)
              onNew(evt)
            },
            onClose
          },
          { startLogin, needSort, needSaveToDb, authPubkey }
        )
      })
    )

    const key = this.generateMultipleTimelinesKey(subRequests)
    this.cacheMap[key] = subs.map((sub) => sub.timelineKey)

    return {
      closer: () => {
        onEvents = () => {}
        onNew = () => {}
        subs.forEach((sub) => {
          sub.closer()
        })
      },
      timelineKey: key
    }
  }

  async loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.cacheMap[key]
    if (!timeline) return []

    if (!Array.isArray(timeline)) {
      return this._loadMoreTimeline(key, until, limit)
    }
    const timelines = await Promise.all(
      timeline.map((key) => this._loadMoreTimeline(key, until, limit))
    )

    const eventIdSet = new Set<string>()
    const events: NEvent[] = []
    timelines.forEach((timeline) => {
      timeline.forEach((evt) => {
        if (eventIdSet.has(evt.id)) return
        eventIdSet.add(evt.id)
        events.push(evt)
      })
    })
    return events.sort((a, b) => compareEvents(b, a)).slice(0, limit)
  }

  private generateTimelineKey(urls: string[], filter: Filter) {
    const stableFilter: any = {}
    Object.entries(filter)
      .sort()
      .forEach(([key, value]) => {
        if (key === 'limit') return
        if (Array.isArray(value)) {
          stableFilter[key] = [...value].sort()
        }
        stableFilter[key] = value
      })
    const paramsStr = JSON.stringify({
      urls: [...urls].sort(),
      filter: stableFilter
    })
    const encoder = new TextEncoder()
    const data = encoder.encode(paramsStr)
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private generateMultipleTimelinesKey(subRequests: { urls: string[]; filter: Filter }[]) {
    const keys = subRequests.map(({ urls, filter }) => this.generateTimelineKey(urls, filter))
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(keys.sort()))
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private async _subscribeTimeline(
    urls: string[],
    filter: TSubRequestFilter,
    {
      onEvents,
      onNew,
      onClose
    }: {
      onEvents: (events: NEvent[], eosed: boolean) => void
      onNew: (evt: NEvent) => void
      onClose?: (url: string, reason: string) => void
    },
    {
      startLogin,
      needSort = true,
      needSaveToDb = false,
      authPubkey
    }: {
      startLogin?: () => void
      needSort?: boolean
      needSaveToDb?: boolean
      authPubkey?: string
    } = {}
  ) {
    const relays = Array.from(new Set(urls))
    const key = this.generateTimelineKey(relays, filter)
    const timeline = this.cacheMap[key]
    let cachedEvents: NEvent[] = []
    let since: number | undefined
    if (timeline && !Array.isArray(timeline) && timeline.refs.length && needSort) {
      cachedEvents = await eventCache.loadEventsByIds(timeline.refs.map(([id]) => id))
      if (cachedEvents.length) {
        onEvents([...cachedEvents], false)
        // Clamp to now: a single future-dated event in the cache must not
        // push `since` past real time, or the REQ excludes every genuinely
        // new note until the wall clock catches up (and the overlap it
        // re-fetches is deduped below).
        since = Math.min(cachedEvents[0].created_at + 1, dayjs().unix())
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    let events: NEvent[] = []
    let eosedAt: number | null = null
    const subCloser = client.subscribe(relays, since ? { ...filter, since } : filter, {
      startLogin,
      authPubkey,
      onevent: (evt: NEvent) => {
        eventCache.addToCache(evt)
        // not eosed yet, push to events
        if (!eosedAt) {
          return events.push(evt)
        }
        // Post-EOSE. Whether the event is new is decided by identity against
        // the cached timeline, never by comparing created_at to the EOSE wall
        // clock: genuinely new events routinely arrive with older timestamps
        // (slow cross-relay propagation, offline notes published late) and
        // must still reach the UI.
        const timeline = that.cacheMap[key]
        if (timeline && !Array.isArray(timeline) && timeline.refs.length) {
          // find the right position to insert
          let idx = 0
          for (const ref of timeline.refs) {
            if (evt.created_at > ref[1] || (evt.created_at === ref[1] && evt.id < ref[0])) {
              break
            }
            // already cached — a re-delivery, not a new event
            if (evt.created_at === ref[1] && evt.id === ref[0]) {
              return
            }
            idx++
          }
          // older than the whole cached window; pagination owns it
          if (idx >= timeline.refs.length) return

          // insert the event to the right position
          timeline.refs.splice(idx, 0, [evt.id, evt.created_at])
        }

        onNew(evt)
        if (needSaveToDb) {
          indexedDb.putEvents([{ event: evt, relays: seenOn.getEventHints(evt.id) }])
        }
      },
      oneose: (eosed) => {
        if (eosed && !eosedAt) {
          eosedAt = dayjs().unix()
        }
        // (algo feeds) no need to sort and cache
        if (!needSort) {
          return onEvents([...events], !!eosedAt)
        }
        if (!eosed) {
          events = events.sort((a, b) => compareEvents(b, a)).slice(0, filter.limit)
          // mergeTimelines (not concat): the clamped `since` can re-fetch
          // events already present in cachedEvents
          return onEvents(mergeTimelines([events, cachedEvents], filter.limit), false)
        }

        events = events.sort((a, b) => compareEvents(b, a)).slice(0, filter.limit)
        if (needSaveToDb) {
          indexedDb.putEvents(
            events.map((evt) => ({ event: evt, relays: seenOn.getEventHints(evt.id) }))
          )
        }
        const timeline = that.cacheMap[key]
        // no cache yet
        if (!timeline || Array.isArray(timeline) || !timeline.refs.length) {
          that.cacheMap[key] = {
            refs: events.map((evt) => [evt.id, evt.created_at]),
            filter,
            urls
          }
          return onEvents([...events], true)
        }

        // Prevent concurrent requests from duplicating the same event
        const firstRefCreatedAt = timeline.refs[0][1]
        const newRefs = events
          .filter((evt) => evt.created_at > firstRefCreatedAt)
          .map((evt) => [evt.id, evt.created_at] as TTimelineRef)

        if (events.length >= filter.limit) {
          // if new refs are more than limit, means old refs are too old, replace them
          timeline.refs = newRefs
          onEvents([...events], true)
        } else {
          // merge new refs with old refs
          timeline.refs = newRefs.concat(timeline.refs)
          onEvents(mergeTimelines([events, cachedEvents], filter.limit), true)
        }
      },
      onclose: onClose
    })

    return {
      timelineKey: key,
      closer: () => {
        onEvents = () => {}
        onNew = () => {}
        subCloser.close()
      }
    }
  }

  private async _loadMoreTimeline(key: string, until: number, limit: number) {
    const timeline = this.cacheMap[key]
    if (!timeline || Array.isArray(timeline)) return []

    const { filter, urls, refs } = timeline
    const startIdx = refs.findIndex(([, createdAt]) => createdAt <= until)
    const cachedEvents =
      startIdx >= 0
        ? await eventCache.loadEventsByIds(refs.slice(startIdx, startIdx + limit).map(([id]) => id))
        : []
    if (cachedEvents.length >= limit) {
      return cachedEvents
    }

    until = cachedEvents.length ? cachedEvents[cachedEvents.length - 1].created_at - 1 : until
    limit = limit - cachedEvents.length
    let events = await client.query(urls, { ...filter, until, limit })
    events.forEach((evt) => {
      eventCache.addToCache(evt)
    })
    events = events.sort((a, b) => compareEvents(b, a)).slice(0, limit)

    // Prevent concurrent requests from duplicating the same event
    const lastRefCreatedAt = refs.length > 0 ? refs[refs.length - 1][1] : dayjs().unix()
    timeline.refs.push(
      ...events
        .filter((evt) => evt.created_at < lastRefCreatedAt)
        .map((evt) => [evt.id, evt.created_at] as TTimelineRef)
    )
    return [...cachedEvents, ...events]
  }
}

const instance = new TimelineCacheService()
export default instance
