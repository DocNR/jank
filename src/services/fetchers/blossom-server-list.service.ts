import { ExtendedKind } from '@/constants'
import { getServersFromServerTags } from '@/lib/tag'
import { Event as NEvent } from 'nostr-tools'
import replaceableEventCache from '../caches/replaceable-event-cache.service'

class BlossomServerListService {
  async fetchBlossomServerListEvent(pubkey: string) {
    return await replaceableEventCache.fetchReplaceableEvent(
      pubkey,
      ExtendedKind.BLOSSOM_SERVER_LIST
    )
  }

  async fetchBlossomServerList(pubkey: string) {
    const evt = await this.fetchBlossomServerListEvent(pubkey)
    return evt ? getServersFromServerTags(evt.tags) : []
  }

  async updateBlossomServerListEventCache(evt: NEvent) {
    await replaceableEventCache.updateCache(evt)
  }
}

const instance = new BlossomServerListService()
export default instance
