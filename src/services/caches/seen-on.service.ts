import { isLocalNetworkUrl } from '@/lib/url'
import { IRelay } from '@/types/relay-pool'
import client from '../client.service'

class SeenOnService {
  private externalSeenOn = new Map<string, Set<string>>()

  getSeenEventRelays(eventId: string) {
    return client.pool.getSeenRelays(eventId)
  }

  getSeenEventRelayUrls(eventId: string) {
    return Array.from(
      new Set([
        ...this.getSeenEventRelays(eventId).map((relay) => relay.url),
        ...(this.externalSeenOn.get(eventId) || [])
      ])
    )
  }

  getEventHints(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).filter((url) => !isLocalNetworkUrl(url))
  }

  getEventHint(eventId: string) {
    return this.getSeenEventRelayUrls(eventId).find((url) => !isLocalNetworkUrl(url)) ?? ''
  }

  trackEventSeenOn(eventId: string, relay: IRelay) {
    client.pool.trackEventSeen(eventId, relay)
  }

  trackEventExternalSeenOn(eventId: string, relayUrls: string[]) {
    let set = this.externalSeenOn.get(eventId)
    if (!set) {
      set = new Set()
      this.externalSeenOn.set(eventId, set)
    }
    relayUrls.forEach((url) => set.add(url))
  }
}

const instance = new SeenOnService()
export default instance
