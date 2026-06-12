import { ExtendedKind } from '@/constants'
import { getPubkeysFromPTags } from '@/lib/tag'
import { getDefaultRelayUrls } from '@/lib/relay'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import { LRUCache } from 'lru-cache'
import { kinds, Event as NEvent } from 'nostr-tools'
import eventCache from '../caches/event-cache.service'
import replaceableEventCache from '../caches/replaceable-event-cache.service'
import indexedDb from '../indexed-db.service'

class FollowListService {
  private followingFavoriteRelaysCache = new LRUCache<string, Promise<[string, string[]][]>>({
    max: 10,
    fetchMethod: this._fetchFollowingFavoriteRelays.bind(this)
  })

  async fetchFollowListEvent(pubkey: string, updateCache = true) {
    return await replaceableEventCache.fetchReplaceableEvent(
      pubkey,
      kinds.Contacts,
      undefined,
      updateCache
    )
  }

  async fetchFollowings(pubkey: string, updateCache = true) {
    const followListEvent = await this.fetchFollowListEvent(pubkey, updateCache)
    return followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
  }

  async updateFollowListCache(evt: NEvent) {
    await replaceableEventCache.updateCache(evt)
  }

  async fetchFollowingFavoriteRelays(pubkey: string) {
    return this.followingFavoriteRelaysCache.fetch(pubkey)
  }

  private async _fetchFollowingFavoriteRelays(pubkey: string) {
    const fetchNewData = async () => {
      const followings = await this.fetchFollowings(pubkey)
      const events = await eventCache.fetchEvents(getDefaultRelayUrls(), {
        authors: followings,
        kinds: [ExtendedKind.FAVORITE_RELAYS, kinds.Relaysets],
        limit: 1000
      })
      const alreadyExistsFavoriteRelaysPubkeySet = new Set<string>()
      const alreadyExistsRelaySetsPubkeySet = new Set<string>()
      const uniqueEvents: NEvent[] = []
      events
        .sort((a, b) => b.created_at - a.created_at)
        .forEach((event) => {
          if (event.kind === ExtendedKind.FAVORITE_RELAYS) {
            if (alreadyExistsFavoriteRelaysPubkeySet.has(event.pubkey)) return
            alreadyExistsFavoriteRelaysPubkeySet.add(event.pubkey)
          } else if (event.kind === kinds.Relaysets) {
            if (alreadyExistsRelaySetsPubkeySet.has(event.pubkey)) return
            alreadyExistsRelaySetsPubkeySet.add(event.pubkey)
          } else {
            return
          }
          uniqueEvents.push(event)
        })

      const relayMap = new Map<string, Set<string>>()
      uniqueEvents.forEach((event) => {
        event.tags.forEach(([tagName, tagValue]) => {
          if (tagName === 'relay' && tagValue && isWebsocketUrl(tagValue)) {
            const url = normalizeUrl(tagValue)
            relayMap.set(url, (relayMap.get(url) || new Set()).add(event.pubkey))
          }
        })
      })
      const relayMapEntries = Array.from(relayMap.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .map(([url, pubkeys]) => [url, Array.from(pubkeys)]) as [string, string[]][]

      indexedDb.putFollowingFavoriteRelays(pubkey, relayMapEntries)
      return relayMapEntries
    }

    const cached = await indexedDb.getFollowingFavoriteRelays(pubkey)
    if (cached) {
      fetchNewData()
      return cached
    }
    return fetchNewData()
  }
}

const instance = new FollowListService()
export default instance
