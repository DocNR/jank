import type { TColumn, TDeck } from '@/types/column'
import { randomId } from '@/lib/utils'

/**
 * Returns the initial deck list for a freshly-paired account.
 *
 * v2: local default — one "My Deck" with Home + Notifications columns scoped
 * to the account (both `viewContext` and `signingIdentity` point at the
 * account itself).
 *
 * NIP-78 sync (shipped): this function stays SYNCHRONOUS and always returns the
 * local default. Remote hydration is layered on separately and asynchronously —
 * ColumnsProvider's seeding effect calls `deckSyncService.hydrateNewlyPairedAccount`
 * after this seeds the default, replacing it with the decrypted remote workspace
 * when the local workspace is still pristine. This avoided making the synchronous
 * callers (ColumnsProvider's pair effect, NostrProvider's setActivePubkey path) async.
 */
export function getInitialDecksForAccount(pubkey: string): TDeck[] {
  const now = Date.now()
  const columns: TColumn[] = [
    {
      id: randomId(),
      viewContext: pubkey,
      signingIdentity: pubkey,
      type: 'home'
    },
    {
      id: randomId(),
      viewContext: pubkey,
      signingIdentity: pubkey,
      type: 'notifications'
    }
  ]
  return [
    {
      id: randomId(),
      name: 'My Deck',
      columns,
      savedColumns: columns.map((c) => ({ ...c })),
      createdAt: now,
      updatedAt: now,
      lastSavedAt: now
    }
  ]
}
