import { compareEvents, getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { isValidPubkey } from '@/lib/pubkey'
import { getDefaultRelayUrls } from '@/lib/relay'
import DataLoader from 'dataloader'
import { Filter, kinds, Event as NEvent } from 'nostr-tools'
import client from '../client.service'
import relayListService from '../fetchers/relay-list.service'
import indexedDb from '../indexed-db.service'

class ReplaceableEventCacheService {
  private cacheMap = new Map<string, NEvent>()
  private subscribers = new Map<string, Set<() => void>>()

  private dataloader = new DataLoader<
    { pubkey: string; kind: number; d?: string },
    NEvent | null,
    string
  >(this.batchLoad.bind(this), {
    cacheKeyFn: ({ pubkey, kind, d }) => `${kind}:${pubkey}:${d ?? ''}`
  })

  /** Synchronous read of the in-memory replaceable map. */
  getFromCache(coordinate: string): NEvent | undefined {
    return this.cacheMap.get(coordinate)
  }

  /** Returns the current canonical event for a coordinate (stable reference until replaced). */
  getSnapshot(coordinate: string): NEvent | undefined {
    return this.cacheMap.get(coordinate)
  }

  /**
   * Subscribe to changes for a coordinate. Returns an unsubscribe function.
   * The callback fires synchronously whenever a newer event is installed.
   */
  subscribe(coordinate: string, callback: () => void): () => void {
    let set = this.subscribers.get(coordinate)
    if (!set) {
      set = new Set()
      this.subscribers.set(coordinate, set)
    }
    set.add(callback)
    return () => {
      set?.delete(callback)
      if (set?.size === 0) this.subscribers.delete(coordinate)
    }
  }

  private notify(coordinate: string) {
    const set = this.subscribers.get(coordinate)
    if (set) {
      set.forEach((cb) => cb())
    }
  }

  /**
   * Single canonical write path: installs event into cacheMap only when it is
   * newer than whatever is already cached (newer-wins gate), then notifies.
   */
  private setCanonical(event: NEvent) {
    if (!isReplaceableEvent(event.kind)) return
    const coordinate = getReplaceableCoordinateFromEvent(event)
    const cached = this.cacheMap.get(coordinate)
    if (!cached || compareEvents(event, cached) > 0) {
      this.cacheMap.set(coordinate, event)
      this.notify(coordinate)
    }
  }

  /**
   * Cross-coalesce write from event-cache: if the event is replaceable,
   * store the latest version in the replaceable map.
   */
  addToCache(event: NEvent) {
    this.setCanonical(event)
  }

  /** Synchronous prime — used by event-cache.fetchEvent's naddr path. */
  primeCache(coordinate: string, event: NEvent) {
    this.cacheMap.set(coordinate, event)
  }

  async fetchReplaceableEvent(
    pubkey: string,
    kind: number,
    d?: string,
    updateCache = true,
    skipCache = false
  ) {
    if (!skipCache) {
      const storedEvent = await indexedDb.getReplaceableEvent(pubkey, kind, d)
      if (storedEvent !== undefined) {
        if (storedEvent) this.setCanonical(storedEvent)
        if (updateCache) {
          this.dataloader.load({ pubkey, kind, d }) // update cache in background
        }
        return storedEvent
      }
    }

    this.dataloader.clear({ pubkey, kind, d })
    const result = await this.dataloader.load({ pubkey, kind, d })
    if (result) this.setCanonical(result)
    return result
  }

  async updateCache(event: NEvent) {
    const newEvent = await indexedDb.putReplaceableEvent(event)
    if (newEvent.id !== event.id) {
      return
    }

    this.dataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.dataloader.prime({ pubkey: event.pubkey, kind: event.kind }, Promise.resolve(event))
    this.setCanonical(event)
  }

  private async batchLoad(params: readonly { pubkey: string; kind: number; d?: string }[]) {
    const groups = new Map<string, { kind: number; d?: string }[]>()
    params.forEach(({ pubkey, kind, d }) => {
      if (!groups.has(pubkey)) {
        groups.set(pubkey, [])
      }
      groups.get(pubkey)!.push({ kind: kind, d })
    })

    const eventMap = new Map<string, NEvent | null>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([pubkey, _params]) => {
        // A malformed pubkey makes the relay reject the whole REQ
        // ("bad req: filter item too small"); skip it so it resolves to null.
        if (!isValidPubkey(pubkey)) return
        const groupByKind = new Map<number, string[]>()
        _params.forEach(({ kind, d }) => {
          if (!groupByKind.has(kind)) {
            groupByKind.set(kind, [])
          }
          if (d) {
            groupByKind.get(kind)!.push(d)
          }
        })
        const filters = Array.from(groupByKind.entries()).map(
          ([kind, dList]) =>
            (dList.length > 0
              ? {
                  authors: [pubkey],
                  kinds: [kind],
                  '#d': dList
                }
              : { authors: [pubkey], kinds: [kind] }) as Filter
        )
        const relayList = await relayListService.fetchRelayList(pubkey)
        const relays = relayList.write.concat(getDefaultRelayUrls()).slice(0, 5)
        const events = await client.query(relays, filters)

        for (const event of events) {
          const key = getReplaceableCoordinateFromEvent(event)
          const existing = eventMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventMap.set(key, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind, d }) => {
      const key = `${kind}:${pubkey}:${d ?? ''}`
      const event = eventMap.get(key)
      if (kind === kinds.Pinlist) return event ?? null

      if (event) {
        indexedDb.putReplaceableEvent(event)
        return event
      } else {
        indexedDb.putNullReplaceableEvent(pubkey, kind, d)
        return null
      }
    })
  }
}

const instance = new ReplaceableEventCacheService()
export default instance
