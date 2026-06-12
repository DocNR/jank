import { ExtendedKind } from '@/constants'
import { kinds } from 'nostr-tools'
import replaceableEventCache from '../caches/replaceable-event-cache.service'

class PinListService {
  async fetchPinListEvent(pubkey: string) {
    return replaceableEventCache.fetchReplaceableEvent(pubkey, kinds.Pinlist)
  }

  async fetchPinnedUsersList(pubkey: string) {
    return replaceableEventCache.fetchReplaceableEvent(pubkey, ExtendedKind.PINNED_USERS)
  }
}

const instance = new PinListService()
export default instance
