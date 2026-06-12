import { getProfileFromEvent } from '@/lib/event-metadata'
import { formatPubkey, pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { filterOutBigRelays } from '@/lib/relay'
import { TProfile } from '@/types'
import DataLoader from 'dataloader'
import dayjs from 'dayjs'
import { kinds, Event as NEvent, nip19 } from 'nostr-tools'
import bigRelayFetcher from './big-relay-fetcher.service'
import client from './client.service'
import relayListService from './fetchers/relay-list.service'
import indexedDb from './indexed-db.service'
import userSearchIndex from './search/user-search-index.service'

class ProfileFetcherService {
  private dataloader = new DataLoader<string, TProfile | null, string>(async (ids) => {
    const results = await Promise.allSettled(ids.map((id) => this._fetchProfile(id)))
    return results.map((res) => (res.status === 'fulfilled' ? res.value : null))
  })

  async fetchProfile(id: string, skipCache = false): Promise<TProfile | null> {
    if (skipCache) {
      return this._fetchProfile(id)
    }

    const pubkey = userIdToPubkey(id, true)
    const localProfileEvent = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
    if (localProfileEvent) {
      if (localProfileEvent.created_at < dayjs().subtract(3, 'day').unix()) {
        this.dataloader.load(id) // update cache in background
      }
      const localProfile = getProfileFromEvent(localProfileEvent)
      return localProfile
    }
    return await this.dataloader.load(id)
  }

  async updateProfileEventCache(event: NEvent) {
    await Promise.allSettled([
      bigRelayFetcher.updateCache(event),
      userSearchIndex.addToIndex(event)
    ])
  }

  private async _fetchProfile(id: string): Promise<TProfile | null> {
    const profileEvent = await this._fetchProfileEvent(id)
    if (profileEvent) {
      return getProfileFromEvent(profileEvent)
    }

    try {
      const pubkey = userIdToPubkey(id)
      return { pubkey, npub: pubkeyToNpub(pubkey) ?? '', username: formatPubkey(pubkey) }
    } catch {
      return null
    }
  }

  private async _fetchProfileEvent(id: string): Promise<NEvent | undefined> {
    let pubkey: string | undefined
    let relays: string[] = []
    if (/^[0-9a-f]{64}$/.test(id)) {
      pubkey = id
    } else {
      const { data, type } = nip19.decode(id)
      switch (type) {
        case 'npub':
          pubkey = data
          break
        case 'nprofile':
          pubkey = data.pubkey
          if (data.relays) relays = data.relays
          break
      }
    }

    if (!pubkey) {
      throw new Error('Invalid id')
    }

    const profileFromBigRelays = await bigRelayFetcher.fetchReplaceable(pubkey, kinds.Metadata)
    if (profileFromBigRelays) {
      userSearchIndex.addToIndex(profileFromBigRelays)
      return profileFromBigRelays
    }

    // If the user has a relay list, try those relays first
    if (!relays.length) {
      const relayList = await relayListService.fetchRelayList(pubkey)
      relays = filterOutBigRelays(relayList.write).slice(0, 5)
    }

    // If the user has no relay list, try current relays
    if (!relays.length) {
      relays = filterOutBigRelays(client.currentRelays)
    }

    const profileEvents = relays.length
      ? await client.query(relays, {
          authors: [pubkey],
          kinds: [kinds.Metadata],
          limit: 1
        })
      : []
    const profileEvent = profileEvents.sort((a, b) => b.created_at - a.created_at)[0]

    if (profileEvent) {
      userSearchIndex.addToIndex(profileEvent)
      indexedDb.putReplaceableEvent(profileEvent)
    }

    return profileEvent
  }
}

const instance = new ProfileFetcherService()
export default instance
