import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import replaceableEventCache from '@/services/caches/replaceable-event-cache.service'
import { ExtendedKind } from '@/constants'
import { groupConversations, type Conversation, type DmMessage } from '@/services/nip17/conversations'
import { runBounded } from '@/services/nip17/decrypt-queue'
import { createGiftWraps, unwrapGiftWrap, type Nip17Signer } from '@/services/nip17/gift-wrap'
import { Event as NEvent } from 'nostr-tools'

export const BACKFILL_WRAP_CAP = 500
export const BACKFILL_DAYS = 30

export function decryptConcurrencyFor(signerType?: string): number {
  // Remote signers (each decrypt is an RPC) → small pool; local key → larger.
  if (signerType === 'bunker' || signerType === 'ncryptsec') return 5
  return 16
}

type Listener = () => void

export function relayTagsToUrls(ev: NEvent | null | undefined): string[] {
  return (ev?.tags ?? [])
    .filter((t) => t[0] === 'relay' && !!t[1])
    .map((t) => t[1])
}

export class DmInboxServiceInstance {
  private account: string
  private messages = new Map<string, DmMessage>() // wrapId → message
  private processed = new Set<string>() // attempted wrap ids (incl. failed decrypts)
  private oldestFetched = 0
  private newestFetched = 0
  private lastReadAt: Record<string, number> = {}
  private sub: { close: () => void } | null = null
  private listeners = new Set<Listener>()
  private signerType: string | undefined
  private started = false
  private _version = 0
  protected disposed = false
  decryptingCount = 0
  slowRemoteSigner = false
  approvalLikelyRequired = false

  get version() { return this._version }

  constructor(account: string) {
    this.account = account
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  protected emit() {
    this._version++
    for (const l of this.listeners) l()
  }

  getConversations(myPubkey: string): Conversation[] {
    return groupConversations([...this.messages.values()], this.lastReadAt, myPubkey)
  }

  getThread(counterparty: string): DmMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.counterparty === counterparty)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  markRead(counterparty: string): void {
    this.lastReadAt[counterparty] = Math.floor(Date.now() / 1000)
    this.emit()
  }

  /** Read the account's own kind-10050 DM relays (where others send to me). */
  async getOwnDmRelays(): Promise<string[]> {
    const ev = await replaceableEventCache.fetchReplaceableEvent(
      this.account,
      ExtendedKind.DM_RELAY_LIST
    )
    return relayTagsToUrls(ev)
  }

  dispose() {
    this.disposed = true
    this.sub?.close()
    this.sub = null
    this.listeners.clear()
  }

  /**
   * Wrap a signer so that nip44Decrypt errors increment a caller-supplied
   * per-batch counter and successes clear `approvalLikelyRequired`. The wrapped
   * signer is otherwise transparent — it does NOT change decrypt results seen by callers.
   */
  private wrapSignerForAccounting(signer: Nip17Signer, batchErrors: { count: number }): Nip17Signer {
    return {
      ...signer,
      nip44Decrypt: async (pubkey: string, cipherText: string): Promise<string> => {
        try {
          const result = await signer.nip44Decrypt(pubkey, cipherText)
          // Success: signer is responding normally — clear the approval-required flag.
          if (this.approvalLikelyRequired) {
            this.approvalLikelyRequired = false
            this.emit()
          }
          return result
        } catch (err) {
          batchErrors.count++
          throw err
        }
      }
    }
  }

  /**
   * Decrypt a batch of gift wraps (bounded concurrency), add results to the
   * in-memory store, and record EVERY attempted wrap id (success or failure) so
   * junk/spam is never re-attempted — critical over remote signers.
   */
  async ingestWraps(
    wraps: NEvent[],
    myPubkey: string,
    signer: Nip17Signer,
    concurrency: number,
    persist: boolean
  ): Promise<void> {
    const fresh = wraps.filter((w) => !this.processed.has(w.id))
    if (!fresh.length) return
    fresh.sort((a, b) => b.created_at - a.created_at) // newest-first
    this.decryptingCount += fresh.length
    this.emit()

    const signerTypeIsRemote = this.signerType === 'bunker' || this.signerType === 'ncryptsec'
    // Per-batch error counter — cumulative tracking inflates the ratio over time.
    // NOTE: this heuristic also trips under a junk-wrap flood (known limitation, acceptable for v1).
    const batchErrors = { count: 0 }
    const accountedSigner = signerTypeIsRemote ? this.wrapSignerForAccounting(signer, batchErrors) : signer
    const startedAt = Date.now()

    const out = await runBounded(fresh, concurrency, async (wrap) => {
      const res = await unwrapGiftWrap(wrap, myPubkey, accountedSigner)
      return { wrap, res }
    })

    // Adaptive Clave prompt: measure per-decrypt latency over the batch.
    if (signerTypeIsRemote && fresh.length >= 3) {
      const avgMs = (Date.now() - startedAt) / fresh.length
      this.slowRemoteSigner = avgMs > 800
    }

    // Approval-required detection: if most decrypts threw RPC errors in THIS batch,
    // the signer is likely waiting for manual approval on every call.
    if (signerTypeIsRemote && fresh.length >= 3) {
      const ratio = batchErrors.count / fresh.length
      if (ratio >= 0.8) {
        this.approvalLikelyRequired = true
      }
    }

    const toPersist: DmMessage[] = []
    for (const item of out) {
      if (!item) continue
      const { wrap, res } = item
      this.processed.add(wrap.id) // record attempt regardless of outcome
      if (!res) continue // junk/undecryptable — recorded, skipped
      const message: DmMessage = {
        wrapId: wrap.id,
        counterparty: res.counterparty,
        fromPubkey: res.rumor.pubkey,
        content: res.rumor.content,
        createdAt: res.rumor.created_at,
        rumorId: res.rumor.id!
      }
      this.messages.set(wrap.id, message)
      toPersist.push(message)
    }
    this.decryptingCount = Math.max(0, this.decryptingCount - fresh.length)
    // Clear the Clave foreground hint once the backlog is fully drained.
    if (this.decryptingCount === 0 && this.slowRemoteSigner) {
      this.slowRemoteSigner = false
    }

    if (persist && !this.disposed) {
      await indexedDb.putDmMessages(toPersist.map((m) => ({ ...m, account: this.account })))
      await this.persistSyncState()
    }
    this.emit()
  }

  private async persistSyncState(): Promise<void> {
    await indexedDb.putDmSyncState({
      account: this.account,
      oldestFetched: this.oldestFetched,
      newestFetched: this.newestFetched,
      processedWrapIds: [...this.processed].slice(-5000) // cap unbounded growth
    })
  }

  /** Hydrate from IndexedDB, then backfill the most-recent window, then go live. */
  async start(myPubkey: string, signer: Nip17Signer, signerType?: string): Promise<void> {
    if (this.disposed || this.started) return
    this.started = true
    this.signerType = signerType
    const cached = await indexedDb.getDmMessages(this.account, { limit: 2000 })
    for (const m of cached) this.messages.set(m.wrapId, m)
    const state = await indexedDb.getDmSyncState(this.account)
    if (state) {
      this.oldestFetched = state.oldestFetched
      this.newestFetched = state.newestFetched
      for (const id of state.processedWrapIds) this.processed.add(id)
    }
    this.emit()

    const relays = await this.getOwnDmRelays()
    if (!relays.length) return // no inbox relays — caller surfaces setup affordance

    const nowSec = Math.floor(Date.now() / 1000)
    const since = nowSec - BACKFILL_DAYS * 24 * 60 * 60
    const concurrency = decryptConcurrencyFor(signerType)
    const authPubkey = signerType === 'bunker' ? undefined : myPubkey

    const backfill = await client.query(relays, {
      kinds: [1059],
      '#p': [myPubkey],
      since,
      limit: BACKFILL_WRAP_CAP
    }, undefined, { authPubkey })
    // Only set oldestFetched if not already set from hydration (preserves paged-back state).
    if (!this.oldestFetched) this.oldestFetched = since
    this.newestFetched = nowSec
    await this.ingestWraps(backfill, myPubkey, signer, concurrency, true)

    if (this.disposed) return
    this.sub?.close()
    // Gift wraps randomize created_at up to 2 days in the PAST (NIP-17 metadata
    // defence), so a freshly-sent wrap can be timestamped before `nowSec`. Back
    // the live `since` off by the 2-day fuzz window or the relay drops new wraps;
    // the `processed` set dedups the overlap with the backfill.
    const liveSince = nowSec - 2 * 24 * 60 * 60
    this.sub = client.subscribe(
      relays,
      { kinds: [1059], '#p': [myPubkey], since: liveSince },
      {
        authPubkey,
        onevent: (evt: NEvent) => {
          void this.ingestWraps([evt], myPubkey, signer, concurrency, true)
        }
      }
    )
  }

  /** Paginate further back in time and decrypt the next window. */
  async loadOlder(myPubkey: string, signer: Nip17Signer, signerType?: string): Promise<number> {
    const relays = await this.getOwnDmRelays()
    if (!relays.length) return 0
    const until = this.oldestFetched > 0 ? this.oldestFetched - 1 : Math.floor(Date.now() / 1000)
    const since = until - BACKFILL_DAYS * 24 * 60 * 60
    const authPubkey = signerType === 'bunker' ? undefined : myPubkey
    const older = await client.query(relays, {
      kinds: [1059],
      '#p': [myPubkey],
      since,
      until,
      limit: BACKFILL_WRAP_CAP
    }, undefined, { authPubkey })
    this.oldestFetched = since
    await this.ingestWraps(older, myPubkey, signer, decryptConcurrencyFor(signerType), true)
    return older.length
  }

  // Injectable seams (default to real client/cache; overridden in tests).
  private resolveRecipientRelays = async (pubkey: string): Promise<string[]> => {
    const ev = await replaceableEventCache.fetchReplaceableEvent(pubkey, ExtendedKind.DM_RELAY_LIST)
    return relayTagsToUrls(ev)
  }
  private resolveOwnRelays = (): Promise<string[]> => this.getOwnDmRelays()
  private publish = async (urls: string[], event: NEvent): Promise<void> => {
    await client.publishEvent(urls, event)
  }
  _test_setResolveRecipientRelays(fn: (pubkey: string) => Promise<string[]>) { this.resolveRecipientRelays = fn }
  _test_setResolveOwnRelays(fn: () => Promise<string[]>) { this.resolveOwnRelays = fn }
  _test_setPublish(fn: (urls: string[], event: NEvent) => Promise<void>) { this.publish = fn }

  async send(
    counterparty: string,
    content: string,
    signer: Nip17Signer,
    _signerType?: string,
    replyToId?: string
  ): Promise<void> {
    const recipientRelays = await this.resolveRecipientRelays(counterparty)
    if (!recipientRelays.length) {
      throw Object.assign(new Error('Recipient has not enabled private DMs'), {
        code: 'recipient-not-ready' as const
      })
    }
    const myPubkey = await signer.getPublicKey()
    const now = Math.floor(Date.now() / 1000)
    const { rumor, counterpartyWrap, selfWrap } = await createGiftWraps({
      senderPubkey: myPubkey,
      recipientPubkey: counterparty,
      content,
      signer,
      now,
      replyToId
    })

    // Optimistic local insert (keyed by self-wrap id, the stable archive id).
    const optimistic: DmMessage = {
      wrapId: selfWrap.id,
      counterparty,
      fromPubkey: myPubkey,
      content,
      createdAt: now,
      rumorId: rumor.id
    }
    this.messages.set(selfWrap.id, optimistic)
    this.processed.add(selfWrap.id)
    this.emit()

    const myRelays = await this.resolveOwnRelays()
    await Promise.all([
      this.publish(recipientRelays, counterpartyWrap),
      myRelays.length ? this.publish(myRelays, selfWrap) : Promise.resolve()
    ])
    if (!this.disposed) {
      try {
        await indexedDb.putDmMessages([{ ...optimistic, account: this.account }])
      } catch {
        // Best-effort persist; optimistic insert already visible.
      }
    }
  }
}

class DmInboxRegistry {
  private instances = new Map<string, DmInboxServiceInstance>()
  private owners = new Map<string, Set<symbol>>()

  get(pubkey: string, owner: symbol): DmInboxServiceInstance {
    let instance = this.instances.get(pubkey)
    if (!instance) {
      instance = new DmInboxServiceInstance(pubkey)
      this.instances.set(pubkey, instance)
    }
    let set = this.owners.get(pubkey)
    if (!set) {
      set = new Set()
      this.owners.set(pubkey, set)
    }
    set.add(owner)
    return instance
  }

  release(pubkey: string, owner: symbol): void {
    const set = this.owners.get(pubkey)
    if (!set) return
    set.delete(owner)
    if (set.size > 0) return
    this.owners.delete(pubkey)
    const instance = this.instances.get(pubkey)
    if (instance) {
      instance.dispose()
      this.instances.delete(pubkey)
    }
  }
}

const dmInboxServices = new DmInboxRegistry()
export default dmInboxServices
export type { Nip17Signer }
