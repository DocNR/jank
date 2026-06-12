import { getRelayListFromEvent } from '@/lib/event-metadata'
import { getDefaultRelayUrls } from '@/lib/relay'
import { TRelayList } from '@/types'
import { kinds, Event as NEvent } from 'nostr-tools'
import bigRelayFetcher from '../big-relay-fetcher.service'
import storage from '../local-storage.service'

class RelayListService {
  async fetchRelayList(pubkey: string): Promise<TRelayList> {
    const [relayList] = await this.fetchRelayLists([pubkey])
    return relayList
  }

  async fetchRelayLists(pubkeys: string[]): Promise<TRelayList[]> {
    const relayEvents = await bigRelayFetcher.fetchManyReplaceable(pubkeys, kinds.RelayList)

    return relayEvents.map((event) => {
      if (event) {
        return getRelayListFromEvent(event, storage.getFilterOutOnionRelays())
      }
      const defaultRelays = getDefaultRelayUrls()
      return {
        write: defaultRelays,
        read: defaultRelays,
        originalRelays: []
      }
    })
  }

  async forceUpdateRelayListEvent(pubkey: string) {
    await bigRelayFetcher.forceFetchReplaceable(pubkey, kinds.RelayList)
  }

  async updateRelayListCache(event: NEvent) {
    return await bigRelayFetcher.updateCache(event)
  }
}

const instance = new RelayListService()
export default instance
