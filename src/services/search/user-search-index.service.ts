import { pubkeyToNpub } from '@/lib/pubkey'
import { TProfile } from '@/types'
import FlexSearch from 'flexsearch'
import { Event as NEvent } from 'nostr-tools'
import followListService from '../fetchers/follow-list.service'
import indexedDb from '../indexed-db.service'
import profileFetcher from '../profile-fetcher.service'

class UserSearchIndexService {
  private userIndex = new FlexSearch.Index({
    tokenize: 'forward'
  })

  constructor() {
    this.init()
  }

  private async init() {
    await indexedDb.iterateProfileEvents((profileEvent) => this.addToIndex(profileEvent))
  }

  async addToIndex(profileEvent: NEvent) {
    try {
      const profileObj = JSON.parse(profileEvent.content)
      const text = [
        profileObj.display_name?.trim() ?? '',
        profileObj.name?.trim() ?? '',
        profileObj.nip05
          ?.split('@')
          .map((s: string) => s.trim())
          .join(' ') ?? ''
      ]
        .join(' ')
        .normalize('NFKD')
      if (!text) return

      await this.userIndex.addAsync(profileEvent.pubkey, text)
    } catch {
      return
    }
  }

  async searchNpubsFromLocal(query: string, limit: number = 100) {
    const result = await this.userIndex.searchAsync(query.normalize('NFKD'), { limit })
    return result.map((pubkey) => pubkeyToNpub(pubkey as string)).filter(Boolean) as string[]
  }

  async searchProfilesFromLocal(query: string, limit: number = 100) {
    const npubs = await this.searchNpubsFromLocal(query, limit)
    const profiles = await Promise.all(npubs.map((npub) => profileFetcher.fetchProfile(npub)))
    return profiles.filter((profile) => !!profile) as TProfile[]
  }

  async initFromFollowings(pubkey: string, signal: AbortSignal) {
    const followings = await followListService.fetchFollowings(pubkey, false)
    for (let i = 0; i * 20 < followings.length; i++) {
      if (signal.aborted) return
      await Promise.all(
        followings
          .slice(i * 20, (i + 1) * 20)
          .map((pubkey) => profileFetcher.fetchProfile(pubkey, false))
      )
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

const instance = new UserSearchIndexService()
export default instance
