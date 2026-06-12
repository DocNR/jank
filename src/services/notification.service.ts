import { ExtendedKind } from '@/constants'
import { compareEvents } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { mergeTimelines } from '@/lib/timeline'
import { kinds, NostrEvent } from 'nostr-tools'
import timelineCache from './caches/timeline-cache.service'
import relayListService from './fetchers/relay-list.service'
import stuffStatsService from './stuff-stats.service'
import threadService from './thread.service'

export const NOTIFICATION_KINDS = [
  kinds.ShortTextNote,
  kinds.Repost,
  kinds.GenericRepost,
  kinds.Reaction,
  kinds.Zap,
  kinds.Highlights,
  ExtendedKind.COMMENT,
  ExtendedKind.POLL_RESPONSE,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.POLL
]

const SUBSCRIPTION_LIMIT = 100

/**
 * One subscription + event buffer per pubkey. Multiple consumers (the
 * standalone Notifications page, per-account Notifications columns) refcount
 * a shared instance via the `notificationServices` registry, so we never run
 * duplicate subscriptions for the same account.
 */
export class NotificationServiceInstance {
  private readonly pubkey: string
  private events: NostrEvent[] = []
  private timelineKey: string | undefined
  private until: number | undefined
  private subscriptionCloser: (() => void) | null = null
  private startPromise: Promise<void> | null = null
  private initialLoading = false
  private disposed = false

  private dataChangedListeners = new Set<() => void>()
  private newEventListeners = new Set<(event: NostrEvent) => void>()
  private loadingListeners = new Set<(loading: boolean) => void>()

  constructor(pubkey: string) {
    this.pubkey = pubkey
  }

  getPubkey(): string {
    return this.pubkey
  }

  getEvents(): NostrEvent[] {
    return this.events
  }

  getInitialLoading(): boolean {
    return this.initialLoading
  }

  getUntil(): number | undefined {
    return this.until
  }

  hasMore(): boolean {
    return this.until !== undefined
  }

  onDataChanged(listener: () => void): () => void {
    this.dataChangedListeners.add(listener)
    return () => {
      this.dataChangedListeners.delete(listener)
    }
  }

  onNewEvent(listener: (event: NostrEvent) => void): () => void {
    this.newEventListeners.add(listener)
    return () => {
      this.newEventListeners.delete(listener)
    }
  }

  onLoadingChanged(listener: (loading: boolean) => void): () => void {
    this.loadingListeners.add(listener)
    return () => {
      this.loadingListeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    if (this.disposed) return
    if (this.startPromise || this.subscriptionCloser) {
      return this.startPromise ?? Promise.resolve()
    }

    this.startPromise = this._start()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async restart(): Promise<void> {
    if (this.disposed) return
    if (this.subscriptionCloser) {
      this.subscriptionCloser()
      this.subscriptionCloser = null
    }
    this.events = []
    this.timelineKey = undefined
    this.until = undefined
    await this._start()
  }

  async loadMore(limit = SUBSCRIPTION_LIMIT): Promise<boolean> {
    if (this.disposed) return false
    if (!this.timelineKey || this.until === undefined) return false
    const newEvents = await timelineCache.loadMoreTimeline(this.timelineKey, this.until, limit)
    if (newEvents.length === 0) {
      this.until = undefined
      this.emitDataChanged()
      return false
    }

    const filtered = newEvents.filter((evt) => evt.pubkey !== this.pubkey)
    if (filtered.length > 0) {
      const idSet = new Set(this.events.map((e) => e.id))
      for (const evt of filtered) {
        if (!idSet.has(evt.id)) {
          this.events.push(evt)
          idSet.add(evt.id)
        }
      }
    }
    this.until = newEvents[newEvents.length - 1].created_at - 1
    this.emitDataChanged()
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.subscriptionCloser) {
      this.subscriptionCloser()
      this.subscriptionCloser = null
    }
    this.events = []
    this.timelineKey = undefined
    this.until = undefined
    this.initialLoading = false
    this.dataChangedListeners.clear()
    this.newEventListeners.clear()
    this.loadingListeners.clear()
  }

  private async _start(): Promise<void> {
    this.initialLoading = true
    this.emitLoadingChanged()

    const filter = {
      '#p': [this.pubkey],
      kinds: NOTIFICATION_KINDS,
      limit: SUBSCRIPTION_LIMIT
    }

    try {
      const stored = (await timelineCache.getEventsFromIndexed(filter)).filter(
        (evt) => evt.pubkey !== this.pubkey
      )
      if (!this.disposed && stored.length > 0) {
        this.events = stored
        this.emitDataChanged()
      }
    } catch {
      // ignore
    }

    let relays: string[]
    try {
      const relayList = await relayListService.fetchRelayList(this.pubkey)
      relays = relayList.read.length > 0 ? relayList.read.slice(0, 5) : getDefaultRelayUrls()
    } catch {
      relays = getDefaultRelayUrls()
    }

    if (this.disposed) return

    const { closer, timelineKey } = await timelineCache.subscribeTimeline(
      [{ urls: relays, filter }],
      {
        onEvents: (events, eosed) => {
          if (this.disposed) return
          const filteredEvents = events.filter((evt) => evt.pubkey !== this.pubkey)
          if (eosed) {
            this.events = this.mergeWithStored(filteredEvents)
            this.until =
              filteredEvents.length > 0
                ? filteredEvents[filteredEvents.length - 1].created_at - 1
                : undefined
            this.initialLoading = false
            threadService.addRepliesToThread(filteredEvents)
            stuffStatsService.updateStuffStatsByEvents(filteredEvents)
            this.emitLoadingChanged()
            this.emitDataChanged()
          }
        },
        onNew: (event) => {
          if (this.disposed) return
          if (event.pubkey === this.pubkey) return
          this.handleNewEvent(event)
          threadService.addRepliesToThread([event])
          stuffStatsService.updateStuffStatsByEvents([event])
        }
      },
      { needSaveToDb: true }
    )

    if (this.disposed) {
      closer()
      return
    }
    this.timelineKey = timelineKey
    this.subscriptionCloser = closer
  }

  private handleNewEvent(event: NostrEvent): void {
    const idx = this.events.findIndex((e) => compareEvents(e, event) <= 0)
    if (idx !== -1 && this.events[idx].id === event.id) {
      return
    }
    if (idx === -1) {
      this.events = [...this.events, event]
    } else {
      this.events = [...this.events.slice(0, idx), event, ...this.events.slice(idx)]
    }
    this.emitNewEvent(event)
  }

  private mergeWithStored(liveEvents: NostrEvent[]): NostrEvent[] {
    const cachedFromInitialRead = this.events
    if (cachedFromInitialRead.length === 0) return liveEvents
    if (liveEvents.length === 0) return cachedFromInitialRead

    const idSet = new Set(liveEvents.map((e) => e.id))
    const oldestLive = liveEvents[liveEvents.length - 1].created_at
    const supplemental = cachedFromInitialRead.filter((evt) => {
      if (idSet.has(evt.id)) return false
      idSet.add(evt.id)
      return true
    })
    if (supplemental.length === 0) return liveEvents
    if (supplemental[0].created_at < oldestLive - 1) return liveEvents
    return mergeTimelines([liveEvents, supplemental])
  }

  private emitDataChanged(): void {
    for (const listener of this.dataChangedListeners) {
      listener()
    }
  }

  private emitNewEvent(event: NostrEvent): void {
    for (const listener of this.newEventListeners) {
      listener(event)
    }
    this.emitDataChanged()
  }

  private emitLoadingChanged(): void {
    for (const listener of this.loadingListeners) {
      listener(this.initialLoading)
    }
  }
}

/**
 * Registry of per-pubkey notification service instances. Multiple consumers
 * (page + N columns for the same account) share one instance via refcount on
 * an opaque `owner` symbol — the instance is `dispose()`d only after the last
 * owner releases it.
 */
class NotificationServiceRegistry {
  private instances = new Map<string, NotificationServiceInstance>()
  private owners = new Map<string, Set<symbol>>()

  get(pubkey: string, owner: symbol): NotificationServiceInstance {
    let instance = this.instances.get(pubkey)
    if (!instance) {
      instance = new NotificationServiceInstance(pubkey)
      this.instances.set(pubkey, instance)
    }
    let ownerSet = this.owners.get(pubkey)
    if (!ownerSet) {
      ownerSet = new Set()
      this.owners.set(pubkey, ownerSet)
    }
    ownerSet.add(owner)
    return instance
  }

  release(pubkey: string, owner: symbol): void {
    const ownerSet = this.owners.get(pubkey)
    if (!ownerSet) return
    ownerSet.delete(owner)
    if (ownerSet.size > 0) return
    this.owners.delete(pubkey)
    const instance = this.instances.get(pubkey)
    if (instance) {
      instance.dispose()
      this.instances.delete(pubkey)
    }
  }
}

const notificationServices = new NotificationServiceRegistry()
export default notificationServices
