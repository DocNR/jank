import { kinds } from 'nostr-tools'
import replaceableEventCache from '../caches/replaceable-event-cache.service'

class MuteListService {
  async fetchMuteListEvent(pubkey: string) {
    return await replaceableEventCache.fetchReplaceableEvent(pubkey, kinds.Mutelist)
  }
}

const instance = new MuteListService()
export default instance
