import { BIG_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import type { ChatSubstrate } from './ChatSubstrate'
import { createNip04ChatSubstrate } from './nip04-impl'

export type { ChatMessage, ChatSubstrate } from './ChatSubstrate'

/**
 * Resolve the relay set for an owner↔agent conversation: the owner's write
 * relays plus the default big relays (damus / nos.lol / …) as a reliable
 * fallback. Subscribe and publish use the same set.
 */
async function resolveRelaysForOwner(ownerPubkey: string): Promise<string[]> {
  const relaySet = new Set<string>(BIG_RELAY_URLS)
  try {
    const relayList = await relayListService.fetchRelayList(ownerPubkey)
    relayList.write.forEach((url) => relaySet.add(url))
  } catch {
    // No relay list available — defaults alone are fine for v1.
  }
  return Array.from(relaySet)
}

/**
 * Factory returning the active ChatSubstrate impl for a workspace owner. v1 is
 * NIP-04; swap the impl here to move to a Clave / NIP-17 backend later without
 * touching the AgentDrawer components.
 */
export function createChatSubstrate(ownerPubkey: string): ChatSubstrate {
  return createNip04ChatSubstrate({
    ownerPubkey,
    getSigner: (pubkey) => client.getSignerFor(pubkey),
    publish: (urls, event) => client.publishEvent(urls, event),
    query: (urls, filter) => client.query(urls, filter),
    subscribe: (urls, filter, handlers) => client.subscribe(urls, filter, handlers),
    resolveRelays: () => resolveRelaysForOwner(ownerPubkey),
    now: () => Math.floor(Date.now() / 1000)
  })
}
