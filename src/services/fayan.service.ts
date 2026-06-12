import { getProfileFromEvent } from '@/lib/event-metadata'
import { proxyFetch } from '@/lib/proxy-fetch'
import { TProfile } from '@/types'
import { NostrEvent } from 'nostr-tools'
import profileFetcher from './profile-fetcher.service'

// NOTE (2026-05-25): trust-score reads were removed from this file as part
// of Path B (Relatr trust swap). Only the mention-picker user search (used
// by PostEditor/PostTextarea/Mention/MentionList.tsx) remains. This whole
// file goes away when the mention-picker swap lands (BACKLOG follow-up).

const SERVICE_URL = 'https://fayan.jumble.social'

class FayanService {
  static instance: FayanService

  private searchResultCache: Map<string, TProfile[]> = new Map()

  constructor() {
    if (!FayanService.instance) {
      FayanService.instance = this
    }
    return FayanService.instance
  }

  async searchUsers(query: string, limit = 20, offset = 0) {
    const cache = this.searchResultCache.get(query)
    if (cache) {
      if (offset + limit <= cache.length) {
        console.log('FayanService searchUsers returning from cache')
        return cache.slice(offset, offset + limit)
      }
    }
    try {
      const url = new URL('/search', SERVICE_URL)
      url.searchParams.append('q', query)
      url.searchParams.append('limit', limit.toString())
      if (offset > 0) {
        url.searchParams.append('offset', offset.toString())
      }

      const res = await proxyFetch(url.toString())
      if (!res.ok) {
        return []
      }
      const data = JSON.parse(res.body) as { event: NostrEvent; percentile: number }[]
      const profiles: TProfile[] = []
      data.forEach(({ event }) => {
        const profile = getProfileFromEvent(event)
        profiles.push(profile)
        profileFetcher.updateProfileEventCache(event)
      })

      // Cache the results
      const existingCache = this.searchResultCache.get(query) || []
      if (offset === 0) {
        this.searchResultCache.set(query, profiles)
      } else if (offset <= existingCache.length) {
        const newCache = existingCache.slice(0, offset).concat(profiles)
        this.searchResultCache.set(query, newCache)
      }

      return profiles
    } catch {
      return []
    }
  }
}

const instance = new FayanService()
export default instance
