import { kinds } from 'nostr-tools'
import replaceableEventCache from '../caches/replaceable-event-cache.service'

class BookmarkListService {
  async fetchBookmarkListEvent(pubkey: string) {
    return replaceableEventCache.fetchReplaceableEvent(pubkey, kinds.BookmarkList)
  }
}

const instance = new BookmarkListService()
export default instance
