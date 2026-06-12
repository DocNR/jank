import { filterValidPubkeys } from '@/lib/pubkey'
import { getDefaultRelayUrls } from '@/lib/relay'
import DataLoader from 'dataloader'
import { Event as NEvent } from 'nostr-tools'
import client from './client.service'
import indexedDb from './indexed-db.service'

class BigRelayFetcherService {
  private eventByIdDataloader = new DataLoader<string, NEvent | undefined>(
    this.eventByIdBatchLoad.bind(this),
    { cache: false, batchScheduleFn: (callback) => setTimeout(callback, 50) }
  )

  private replaceableDataloader = new DataLoader<
    { pubkey: string; kind: number },
    NEvent | null,
    string
  >(this.replaceableBatchLoad.bind(this), {
    batchScheduleFn: (callback) => setTimeout(callback, 50),
    maxBatchSize: 500,
    cacheKeyFn: ({ pubkey, kind }) => `${pubkey}:${kind}`
  })

  /** For event-cache._fetchEvent's first-pass attempt against big relays. */
  async fetchEvent(id: string): Promise<NEvent | undefined> {
    return this.eventByIdDataloader.load(id)
  }

  /** For profile-fetcher._fetchProfileEvent and relay-list internals. */
  async fetchReplaceable(pubkey: string, kind: number): Promise<NEvent | null> {
    return this.replaceableDataloader.load({ pubkey, kind })
  }

  /**
   * Batch-fetch replaceable events for many pubkeys, using indexedDb as a
   * first-pass cache and refreshing existing entries in the background.
   */
  async fetchManyReplaceable(pubkeys: string[], kind: number) {
    const events = await indexedDb.getManyReplaceableEvents(pubkeys, kind)
    const nonExistingPubkeyIndexMap = new Map<string, number>()
    const existingPubkeys: string[] = []
    pubkeys.forEach((pubkey, i) => {
      if (events[i] === undefined) {
        nonExistingPubkeyIndexMap.set(pubkey, i)
      } else {
        existingPubkeys.push(pubkey)
      }
    })
    const newEvents = await this.replaceableDataloader.loadMany(
      Array.from(nonExistingPubkeyIndexMap.keys()).map((pubkey) => ({ pubkey, kind }))
    )
    newEvents.forEach((event) => {
      if (event && !(event instanceof Error)) {
        const index = nonExistingPubkeyIndexMap.get(event.pubkey)
        if (index !== undefined) {
          events[index] = event
        }
      }
    })

    this.replaceableDataloader.loadMany(existingPubkeys.map((pubkey) => ({ pubkey, kind }))) // update cache in background

    return events
  }

  /**
   * Force-fetch a replaceable event, bypassing the dataloader cache. Same
   * semantics as the original `forceUpdateRelayListEvent` — calls the batch
   * fn directly so indexedDb is updated but the dataloader's in-memory cache
   * is untouched.
   */
  async forceFetchReplaceable(pubkey: string, kind: number): Promise<NEvent | null> {
    const [result] = await this.replaceableBatchLoad([{ pubkey, kind }])
    return result
  }

  /**
   * Persist `event` to indexedDb (returns the latest stored version, which
   * may be `event` or an existing newer one). If `event` was the latest,
   * also primes the dataloader cache.
   */
  async updateCache(event: NEvent): Promise<NEvent> {
    const newEvent = await indexedDb.putReplaceableEvent(event)
    if (newEvent.id !== event.id) {
      return newEvent
    }

    this.replaceableDataloader.clear({ pubkey: event.pubkey, kind: event.kind })
    this.replaceableDataloader.prime(
      { pubkey: event.pubkey, kind: event.kind },
      Promise.resolve(event)
    )
    return newEvent
  }

  private async eventByIdBatchLoad(ids: readonly string[]) {
    const events = await client.query(getDefaultRelayUrls(), {
      ids: Array.from(new Set(ids)),
      limit: ids.length
    })
    const eventsMap = new Map<string, NEvent>()
    for (const event of events) {
      eventsMap.set(event.id, event)
    }

    return ids.map((id) => eventsMap.get(id))
  }

  private async replaceableBatchLoad(params: readonly { pubkey: string; kind: number }[]) {
    const groups = new Map<number, string[]>()
    params.forEach(({ pubkey, kind }) => {
      if (!groups.has(kind)) {
        groups.set(kind, [])
      }
      groups.get(kind)!.push(pubkey)
    })

    const eventsMap = new Map<string, NEvent>()
    await Promise.allSettled(
      Array.from(groups.entries()).map(async ([kind, pubkeys]) => {
        // Relays reject the whole REQ if `authors` holds a non-hex item
        // ("bad req: filter item too small"), so drop empties/malformed first.
        const validPubkeys = filterValidPubkeys(pubkeys)
        if (validPubkeys.length === 0) return
        const events = await client.query(getDefaultRelayUrls(), {
          authors: validPubkeys,
          kinds: [kind]
        })

        for (const event of events) {
          const key = `${event.pubkey}:${event.kind}`
          const existing = eventsMap.get(key)
          if (!existing || existing.created_at < event.created_at) {
            eventsMap.set(key, event)
          }
        }
      })
    )

    return params.map(({ pubkey, kind }) => {
      const key = `${pubkey}:${kind}`
      const event = eventsMap.get(key)
      if (event) {
        indexedDb.putReplaceableEvent(event)
        return event
      } else {
        indexedDb.putNullReplaceableEvent(pubkey, kind)
        return null
      }
    })
  }
}

const instance = new BigRelayFetcherService()
export default instance
