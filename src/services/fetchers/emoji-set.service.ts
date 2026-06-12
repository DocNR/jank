import { kinds } from 'nostr-tools'
import replaceableEventCache from '../caches/replaceable-event-cache.service'

class EmojiSetService {
  async fetchUserEmojiListEvent(pubkey: string) {
    return replaceableEventCache.fetchReplaceableEvent(pubkey, kinds.UserEmojiList)
  }

  async fetchEmojiSetEvents(pointers: string[], updateCacheInBackground = true) {
    const params = pointers
      .map((pointer) => {
        const [kindStr, pubkey, d = ''] = pointer.split(':')
        if (!pubkey || !kindStr) return null

        const kind = parseInt(kindStr, 10)
        if (kind !== kinds.Emojisets) return null

        return { pubkey, kind, d }
      })
      .filter(Boolean) as { pubkey: string; kind: number; d: string }[]
    return await Promise.all(
      params.map(({ pubkey, kind, d }) =>
        replaceableEventCache.fetchReplaceableEvent(pubkey, kind, d, updateCacheInBackground)
      )
    )
  }
}

const instance = new EmojiSetService()
export default instance
