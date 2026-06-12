import { kinds } from 'nostr-tools'
import { ApplicationDataKey } from '@/constants'
import { createDeckSyncDraftEvent } from '@/lib/draft-event'
import { getDefaultRelayUrls } from '@/lib/relay'
import type { TAccountWorkspace, TDeck } from '@/types/column'
import type { TConflictChoice, TFetchResult, TRemoteStatus } from '@/types/deck-sync'
import client from './client.service'
import { decodeWorkspace, encodeWorkspace } from './deck-sync-codec'
import { decryptWorkspaceContent, encryptWorkspaceContent } from './deck-sync-crypto'
import { mergeRemoteWorkspace } from './deck-sync-merge'
import relayListService from './fetchers/relay-list.service'
import storage from './local-storage.service'

const DECK_D_TAG = ApplicationDataKey.DECKS

/** True if a remote-staleness check is due, given the last-check timestamp (ms). */
export function shouldCheckRemoteNow(
  lastCheckTs: number | null,
  now: number,
  intervalMs = 30000
): boolean {
  return lastCheckTs === null || now - lastCheckTs >= intervalMs
}

type TConflictHandler = (info: { pubkey: string }) => Promise<TConflictChoice>

class DeckSyncService {
  private conflictHandler: TConflictHandler | null = null
  /** created_at of the most recent remote event we have observed, per pubkey. */
  private knownRemoteCreatedAt = new Map<string, number>()

  setConflictHandler(handler: TConflictHandler | null) {
    this.conflictHandler = handler
  }

  /** Publish the account's workspace. Consults the cached staleness guard first. Never rejects. */
  async publishWorkspace(pubkey: string): Promise<void> {
    try {
      const localWorkspace = storage.getWorkspacesByAccount()[pubkey]
      if (!localWorkspace) return

      const known = this.knownRemoteCreatedAt.get(pubkey) ?? null
      const applied = storage.getDeckSyncAppliedCreatedAt(pubkey)
      // applied === null = brand-new device that has applied no remote yet; treat
      // any known remote as newer so the staleness guard engages.
      const remoteIsNewer = known !== null && (applied === null || known > applied)

      if (remoteIsNewer) {
        const choice = this.conflictHandler ? await this.conflictHandler({ pubkey }) : 'overwrite'
        if (choice === 'cancel') return
        if (choice === 'reload') {
          await this.reloadFromRemote(pubkey)
          return
        }
        // 'overwrite' → fall through to publish
      }

      await this.doPublish(pubkey, localWorkspace)
    } catch (err) {
      console.error('[deck-sync] publishWorkspace failed; will retry on next save/focus', err)
    }
  }

  private async doPublish(pubkey: string, workspace: TAccountWorkspace): Promise<void> {
    const signer = client.getSignerFor(pubkey)
    if (!signer) return
    const json = encodeWorkspace(workspace)
    const content = await encryptWorkspaceContent(signer, pubkey, json)
    const draft = createDeckSyncDraftEvent(content)
    const relayList = await relayListService.fetchRelayList(pubkey)
    // Fall back to default relays if the account's relay list has no write
    // relays — otherwise we'd publish to nowhere yet still mark the workspace
    // as applied, falsely reporting a successful sync.
    const writeRelays = relayList.write.length > 0 ? relayList.write : getDefaultRelayUrls()
    const signed = await client.publishAs(pubkey, writeRelays, draft)
    storage.setDeckSyncAppliedCreatedAt(pubkey, signed.created_at)
    this.knownRemoteCreatedAt.set(pubkey, signed.created_at)
  }

  /** Fetch + decrypt + decode the account's remote workspace. Returns null if absent/unreadable. */
  async fetchWorkspace(pubkey: string): Promise<TFetchResult | null> {
    const signer = client.getSignerFor(pubkey)
    if (!signer) return null
    try {
      const relayList = await relayListService.fetchRelayList(pubkey)
      const events = await client.query(relayList.read, {
        authors: [pubkey],
        kinds: [kinds.Application],
        '#d': [DECK_D_TAG]
      })
      if (events.length === 0) return null
      const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a))
      const plaintext = await decryptWorkspaceContent(signer, pubkey, newest.content)
      const decoded = decodeWorkspace(plaintext)
      if (!decoded.ok) return null
      return { workspace: decoded.workspace, createdAt: newest.created_at }
    } catch {
      return null
    }
  }

  /** Fetch remote and classify it against what we have locally applied. Updates the cache. */
  async checkRemote(pubkey: string): Promise<TRemoteStatus> {
    const remote = await this.fetchWorkspace(pubkey)
    if (!remote) return { status: 'no-remote' }
    this.knownRemoteCreatedAt.set(pubkey, remote.createdAt)
    const applied = storage.getDeckSyncAppliedCreatedAt(pubkey)
    if (applied !== null && remote.createdAt <= applied) return { status: 'up-to-date' }
    return { status: 'remote-newer', workspace: remote.workspace, createdAt: remote.createdAt }
  }

  private applyRemoteWorkspace(pubkey: string, workspace: TAccountWorkspace, createdAt: number) {
    const all = storage.getWorkspacesByAccount()
    storage.setWorkspacesByAccount({ ...all, [pubkey]: workspace })
    storage.setDeckSyncAppliedCreatedAt(pubkey, createdAt)
    this.knownRemoteCreatedAt.set(pubkey, createdAt)
  }

  /** Re-fetch fresh and wholesale-apply (used by the publish-side "reload theirs" conflict choice). */
  async reloadFromRemote(pubkey: string): Promise<boolean> {
    const remote = await this.fetchWorkspace(pubkey)
    if (!remote) return false
    this.applyRemoteWorkspace(pubkey, remote.workspace, remote.createdAt)
    return true
  }

  /**
   * Per-deck, non-destructive merge of an already-fetched remote workspace into local,
   * then persist. New decks are added, untouched local decks updated when remote
   * is newer (per-deck `lastSavedAt` LWW), local-only and locally-edited decks kept.
   * Returns the locally-edited decks that also changed remotely (conflicts) — the
   * focus-check applies the safe parts silently and lets those resolve at save-time.
   *
   * Bookkeeping: `knownRemoteCreatedAt` is always advanced (we observed this remote),
   * but `lastApplied` is advanced ONLY when there were no conflicts. A held conflict
   * means local does NOT fully correspond to the remote at `createdAt`, so leaving
   * `lastApplied` behind keeps `known > applied` true — which makes the next Save trip
   * the staleness guard and surface the Overwrite/Reload/Cancel modal instead of
   * silently overwriting the peer's edit.
   */
  applyRemoteMerge(pubkey: string, remote: TAccountWorkspace, createdAt: number): TDeck[] {
    const local = storage.getWorkspacesByAccount()[pubkey]
    const { merged, conflicts } = mergeRemoteWorkspace(local, remote)
    const all = storage.getWorkspacesByAccount()
    storage.setWorkspacesByAccount({ ...all, [pubkey]: merged })
    this.knownRemoteCreatedAt.set(pubkey, createdAt)
    if (conflicts.length === 0) {
      storage.setDeckSyncAppliedCreatedAt(pubkey, createdAt)
    }
    return conflicts
  }

  /**
   * For a freshly-paired account: if a remote workspace exists AND the local
   * workspace is still the pristine seeded default (single deck `seededDeckId`,
   * not dirty), replace it with the remote. Returns true if applied. A diverged
   * local workspace is left alone — the focus staleness guard surfaces it instead.
   */
  async hydrateNewlyPairedAccount(pubkey: string, seededDeckId: string): Promise<boolean> {
    const remote = await this.fetchWorkspace(pubkey)
    if (!remote) return false
    const local = storage.getWorkspacesByAccount()[pubkey]
    const pristine =
      !!local &&
      local.decks.length === 1 &&
      local.decks[0].id === seededDeckId &&
      !storage.isDeckDirtyById(pubkey, seededDeckId)
    if (!pristine) return false
    this.applyRemoteWorkspace(pubkey, remote.workspace, remote.createdAt)
    return true
  }
}

const instance = new DeckSyncService()
export default instance
