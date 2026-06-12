import { getReplaceableCoordinate } from '@/lib/event'
import { filterOutBigRelays, getDefaultRelayUrls } from '@/lib/relay'
import DataLoader from 'dataloader'
import { Filter, Event as NEvent, nip19 } from 'nostr-tools'
import bigRelayFetcher from '../big-relay-fetcher.service'
import client from '../client.service'
import relayListService from '../fetchers/relay-list.service'
import indexedDb from '../indexed-db.service'
import replaceableEventCache from './replaceable-event-cache.service'
import seenOn from './seen-on.service'

class EventCacheService {
  private cacheMap = new Map<string, Promise<NEvent | undefined>>()
  // Resolved (not promised) events by hex id. The dataloader cacheMap above holds
  // Promises, so even a hit only resolves a tick later — too late to seed a
  // component's first render. This synchronous mirror lets consumers paint real
  // content immediately on (re)mount. See getCachedEvent.
  private resolvedById = new Map<string, NEvent>()

  private dataloader = new DataLoader<string, NEvent | undefined>(
    (ids) => Promise.all(ids.map((id) => this._fetchEvent(id))),
    { cacheMap: this.cacheMap }
  )

  /** Prime the dataloader cache with `event` and cross-coalesce into the replaceable map. */
  addToCache(event: NEvent) {
    this.dataloader.prime(event.id, Promise.resolve(event))
    this.resolvedById.set(event.id, event)
    replaceableEventCache.addToCache(event)
  }

  /**
   * Synchronous peek at an already-resolved event by hex id, note, nevent, or naddr.
   * Returns undefined on a miss — callers should fall back to the async fetchEvent.
   *
   * This is what lets a remounting consumer (e.g. EmbeddedNote on a virtualizer
   * scroll-back) render the real card on its first render instead of flashing a
   * shorter loading skeleton and then jumping to full height, which re-measures the
   * row and lurches the whole feed.
   */
  getCachedEvent(id: string): NEvent | undefined {
    if (/^[0-9a-f]{64}$/.test(id)) {
      return this.resolvedById.get(id)
    }
    try {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          return this.resolvedById.get(data)
        case 'nevent':
          return this.resolvedById.get(data.id)
        case 'naddr':
          return replaceableEventCache.getFromCache(
            getReplaceableCoordinate(data.kind, data.pubkey, data.identifier)
          )
      }
    } catch {
      return undefined
    }
    return undefined
  }

  /** Read-through cache for events by hex id, note id, nevent, or naddr. */
  async fetchEvent(id: string): Promise<NEvent | undefined> {
    if (!/^[0-9a-f]{64}$/.test(id)) {
      let eventId: string | undefined
      let coordinate: string | undefined
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          eventId = data
          break
        case 'nevent':
          eventId = data.id
          break
        case 'naddr':
          coordinate = getReplaceableCoordinate(data.kind, data.pubkey, data.identifier)
          break
      }
      if (coordinate) {
        const cache = replaceableEventCache.getFromCache(coordinate)
        if (cache) {
          return cache
        }
        const indexedDbCache = await indexedDb.getReplaceableEventByCoordinate(coordinate)
        if (indexedDbCache) {
          replaceableEventCache.primeCache(coordinate, indexedDbCache)
          return indexedDbCache
        }
      } else if (eventId) {
        const cache = this.cacheMap.get(eventId)
        if (cache) {
          return cache
        }

        const cacheFromIndexedDb = await indexedDb.getEventById(eventId)
        if (cacheFromIndexedDb) {
          seenOn.trackEventExternalSeenOn(eventId, cacheFromIndexedDb.relays)
          this.resolvedById.set(eventId, cacheFromIndexedDb.event)
          return cacheFromIndexedDb.event
        }
      }
    }
    return this.dataloader.load(id)
  }

  async fetchEvents(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      cache = false
    }: {
      onevent?: (evt: NEvent) => void
      cache?: boolean
    } = {}
  ) {
    const relays = Array.from(new Set(urls))
    const events = await client.query(
      relays.length > 0 ? relays : getDefaultRelayUrls(),
      filter,
      onevent
    )

    // Dedup events from multiple relays
    const seen = new Set<string>()
    let deduped = events.filter((evt) => {
      if (seen.has(evt.id)) return false
      seen.add(evt.id)
      return true
    })

    // Sort desc by created_at and trim to limit
    const limit = Array.isArray(filter) ? undefined : filter.limit
    if (limit) {
      deduped.sort((a, b) => b.created_at - a.created_at)
      deduped = deduped.slice(0, limit)
    }

    if (cache) {
      deduped.forEach((evt) => {
        this.addToCache(evt)
      })
    }
    return deduped
  }

  /** Used by timeline-cache to batch-load cached events by id. */
  async loadEventsByIds(ids: string[]): Promise<NEvent[]> {
    const results = await this.dataloader.loadMany(ids)
    return results.filter((r) => !!r && !(r instanceof Error)) as NEvent[]
  }

  // TODO: typo'd name preserved for compat with one external caller
  // (lib/draft-event.ts). Rename to getReplaceableFromCache in a follow-up.
  getReplaeableEventFromCache(coordinate: string): NEvent | undefined {
    return replaceableEventCache.getFromCache(coordinate)
  }

  private async fetchEventById(relayUrls: string[], id: string): Promise<NEvent | undefined> {
    const event = await bigRelayFetcher.fetchEvent(id)
    if (event) {
      return event
    }

    return this.fetchEventFromRelays(filterOutBigRelays(relayUrls), { ids: [id], limit: 1 })
  }

  private async _fetchEvent(id: string): Promise<NEvent | undefined> {
    let filter: Filter | undefined
    let relays: string[] = []
    let author: string | undefined
    if (/^[0-9a-f]{64}$/.test(id)) {
      filter = { ids: [id] }
    } else {
      const { type, data } = nip19.decode(id)
      switch (type) {
        case 'note':
          filter = { ids: [data] }
          break
        case 'nevent':
          filter = { ids: [data.id] }
          if (data.relays) relays = data.relays
          if (data.author) author = data.author
          break
        case 'naddr':
          filter = {
            authors: [data.pubkey],
            kinds: [data.kind],
            limit: 1
          }
          author = data.pubkey
          if (data.identifier) {
            filter['#d'] = [data.identifier]
          }
          if (data.relays) relays = data.relays
      }
    }
    if (!filter) {
      throw new Error('Invalid id')
    }

    let event: NEvent | undefined
    if (filter.ids?.length) {
      event = await this.fetchEventById(relays, filter.ids[0])
    }

    if (!event && author) {
      if (!relays.length) {
        const relayList = await relayListService.fetchRelayList(author)
        relays = relayList.write.slice(0, 5)
      }
      event = await this.fetchEventFromRelays(relays, filter)
    }

    if (event && event.id !== id) {
      this.addToCache(event)
    }

    if (event) {
      // Defer routing to indexedDb.putEvents: it stores non-replaceable
      // events plus replaceable kinds WITHOUT a dedicated per-kind store
      // (e.g. kind:30023 LongFormArticle, kind:30311 LiveEvent). Replaceable
      // kinds WITH a dedicated store (Profile, Mutelist, BookmarkList,
      // PinnedUsers, etc.) are skipped there and saved via
      // putReplaceableEvent elsewhere. See indexed-db.service.ts:528.
      //
      // Prior to 2026-05-27 this guard short-circuited on any replaceable
      // kind, which meant per-event fetches via useFetchEvent (Bookmarks,
      // profile-card clicks, deep-link landings) silently skipped caching
      // for kind:30023 etc. PR #86 patched the lower putEvents layer but
      // missed this upstream guard.
      indexedDb.putEvents([{ event, relays: seenOn.getEventHints(event.id) }])
    }

    if (event) {
      this.resolvedById.set(event.id, event)
    }

    return event
  }

  private async fetchEventFromRelays(relayUrls: string[], filter: Filter) {
    if (!relayUrls.length) return

    const events = await client.query(relayUrls, filter)
    return events.sort((a, b) => b.created_at - a.created_at)[0]
  }
}

const instance = new EventCacheService()
export default instance
