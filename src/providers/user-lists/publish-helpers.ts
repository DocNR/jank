// src/providers/user-lists/publish-helpers.ts
import client from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { EventTemplate, Event as NEvent } from 'nostr-tools'

/**
 * Publish a draft event as the specified paired account.
 *
 * Fetches the account's NIP-65 write relays via relayListService (dataloader-
 * cached; falls back to defaults if no kind 10002 found), then signs and
 * publishes via the signer registry through client.publishAs.
 *
 * The signer must already be registered in client.signers for `accountPubkey`
 * (see ClientService.setSigner). If no signer is registered, client.publishAs
 * throws "No signer registered for pubkey ...".
 *
 * Throws if publish fails on too many relays. Callers catch and surface.
 */
export async function publishAsAccount(
  accountPubkey: string,
  draft: EventTemplate
): Promise<NEvent> {
  const relayList = await relayListService.fetchRelayList(accountPubkey)
  return client.publishAs(accountPubkey, relayList.write, draft)
}
