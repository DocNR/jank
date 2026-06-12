import { ExtendedKind } from '@/constants'
import { isValidPubkey } from '@/lib/pubkey'
import { getDefaultRelayUrls, getSearchRelayUrls } from '@/lib/relay'
import { SmartPool } from '@/lib/smart-pool'
import { tagNameEquals } from '@/lib/tag'
import { isSafari } from '@/lib/utils'
import { ISigner, TPublishOptions } from '@/types'
import { IRelayPool } from '@/types/relay-pool'
import dayjs from 'dayjs'
import {
  EventTemplate,
  Filter,
  kinds,
  matchFilters,
  Event as NEvent,
  VerifiedEvent
} from 'nostr-tools'
import seenOn from './caches/seen-on.service'
import relayListService from './fetchers/relay-list.service'
import storage from './local-storage.service'
import verificationPool from './verification-pool.service'
import { selectAuthSigner } from './auth-signer'

class ClientService extends EventTarget {
  static instance: ClientService

  // Legacy "active account" fields. Still mutated by NostrProvider for callers
  // that haven't been migrated to the per-account registry below (signHttpAuth,
  // lightning.service, media-upload.service). Phase 1 will retire these.
  signer?: ISigner
  pubkey?: string
  // Owner-tagged signer registry. Each registration carries a `symbol` owner;
  // an entry is removed only when its owner set drains to empty. Two owners use
  // it: NostrProvider's active mirror (ACTIVE_OWNER) and each AccountScope mount
  // (a unique per-mount symbol). Replacement is last-wins on the signer object.
  private signerEntries: Map<string, { signer: ISigner; owners: Set<symbol> }> = new Map()
  currentRelays: string[] = []
  pool: IRelayPool

  // Read-only legacy view: callers that want to inspect the registered set
  // without going through getSignerFor (e.g. the spike route's `signers.size`
  // check) can use this. Snapshot — does not reflect later mutations.
  get signers(): ReadonlyMap<string, ISigner> {
    return new Map(Array.from(this.signerEntries, ([k, e]) => [k, e.signer]))
  }

  constructor() {
    super()
    this.pool = new SmartPool()
    this.pool.setAllowInsecure(storage.getAllowInsecureConnection())
    this.pool.trackRelays = true
    verificationPool.preload()
    this.setupWakeReconnect()
  }

  // After the OS suspends (laptop sleep) or the network drops, relay WebSockets
  // go stale without firing `onclose`, leaving subscriptions bound to dead
  // sockets — the feed freezes and the Refresh button rebinds to the same
  // zombie. nostr-tools' internal ping/reconnect can't recover this because its
  // timers were suspended too. So we force a reconnect from an app-level wake
  // trigger: the tab becoming visible again after a meaningful gap, or the
  // browser regaining network.
  private setupWakeReconnect() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    // Sockets survive brief tab switches, so only a meaningful hidden gap
    // warrants tearing connections down — avoids thrashing on quick alt-tabs.
    const STALE_HIDDEN_MS = 60 * 1000
    let hiddenAt: number | null = null

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_HIDDEN_MS) {
        this.pool.reconnectStaleRelays()
      }
      hiddenAt = null
    })

    // Network regained — the prior sockets are gone regardless of timing.
    window.addEventListener('online', () => {
      this.pool.reconnectStaleRelays()
    })
  }

  public static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService()
    }
    return ClientService.instance
  }

  setAllowInsecure(allow: boolean) {
    this.pool.setAllowInsecure(allow)
  }

  setSigner(pubkey: string, signer: ISigner, owner: symbol) {
    const entry = this.signerEntries.get(pubkey)
    if (entry) {
      entry.owners.add(owner)
      entry.signer = signer
      return
    }
    this.signerEntries.set(pubkey, { signer, owners: new Set([owner]) })
  }

  removeSigner(pubkey: string, owner: symbol) {
    const entry = this.signerEntries.get(pubkey)
    if (!entry) return
    entry.owners.delete(owner)
    if (entry.owners.size === 0) {
      this.signerEntries.delete(pubkey)
    }
  }

  getSignerFor(pubkey: string): ISigner | undefined {
    return this.signerEntries.get(pubkey)?.signer
  }

  async signAs(pubkey: string, draft: EventTemplate): Promise<NEvent> {
    const signer = this.getSignerFor(pubkey)
    if (!signer) {
      throw new Error(`No signer registered for pubkey ${pubkey}`)
    }
    return signer.signEvent(draft)
  }

  async publishAs(pubkey: string, urls: string[], draft: EventTemplate): Promise<NEvent> {
    const signed = await this.signAs(pubkey, draft)
    await this.publishEvent(urls, signed)
    return signed
  }

  async determineTargetRelays(
    event: NEvent,
    { specifiedRelayUrls, additionalRelayUrls }: TPublishOptions = {}
  ) {
    if (event.kind === kinds.Report) {
      const targetEventId = event.tags.find(tagNameEquals('e'))?.[1]
      if (targetEventId) {
        return seenOn.getSeenEventRelayUrls(targetEventId)
      }
    }

    const defaultRelays = getDefaultRelayUrls()
    const relaySet = new Set<string>()
    if (specifiedRelayUrls?.length) {
      specifiedRelayUrls.forEach((url) => relaySet.add(url))
    } else {
      additionalRelayUrls?.forEach((url) => relaySet.add(url))
      if (
        !specifiedRelayUrls?.length &&
        ![kinds.Contacts, kinds.Mutelist, ExtendedKind.PINNED_USERS].includes(event.kind)
      ) {
        const mentions: string[] = []
        event.tags.forEach(([tagName, tagValue]) => {
          if (
            ['p', 'P'].includes(tagName) &&
            !!tagValue &&
            isValidPubkey(tagValue) &&
            !mentions.includes(tagValue)
          ) {
            mentions.push(tagValue)
          }
        })
        if (mentions.length > 0) {
          const relayLists = await relayListService.fetchRelayLists(mentions)
          relayLists.forEach((relayList) => {
            relayList.read.slice(0, 5).forEach((url) => relaySet.add(url))
          })
        }
      }

      const relayList = await relayListService.fetchRelayList(event.pubkey)
      relayList.write.forEach((url) => relaySet.add(url))

      if (
        [
          kinds.RelayList,
          kinds.Contacts,
          ExtendedKind.FAVORITE_RELAYS,
          ExtendedKind.BLOSSOM_SERVER_LIST,
          ExtendedKind.RELAY_REVIEW
        ].includes(event.kind)
      ) {
        defaultRelays.forEach((url) => relaySet.add(url))
      }

      if (event.kind === ExtendedKind.COMMENT) {
        const rootITag = event.tags.find(tagNameEquals('I'))
        if (rootITag) {
          // For external content comments, always publish to default relays
          defaultRelays.forEach((url) => relaySet.add(url))
        }
      }
    }

    if (!relaySet.size) {
      defaultRelays.forEach((url) => relaySet.add(url))
    }

    return Array.from(relaySet)
  }

  async determineRelaysByFilter(filter: Filter) {
    if (filter.search) {
      return getSearchRelayUrls()
    } else if (filter.authors?.length) {
      const relayLists = await relayListService.fetchRelayLists(filter.authors)
      return Array.from(new Set(relayLists.flatMap((list) => list.write.slice(0, 5))))
    } else if (filter['#p']?.length) {
      const relayLists = await relayListService.fetchRelayLists(filter['#p'])
      return Array.from(new Set(relayLists.flatMap((list) => list.read.slice(0, 5))))
    }
    return getDefaultRelayUrls()
  }

  async publishEvent(relayUrls: string[], event: NEvent) {
    const uniqueRelayUrls = Array.from(new Set(relayUrls))
    await new Promise<void>((resolve, reject) => {
      let successCount = 0
      let finishedCount = 0
      let resolved = false
      // If one third of the relays have accepted the event, consider it a success
      const successThreshold = uniqueRelayUrls.length / 3
      const errors: { url: string; error: any }[] = []

      const checkCompletion = (url: string, success: boolean, error?: unknown) => {
        if (error) {
          errors.push({ url, error })
        }
        if (success) {
          successCount++
        }
        finishedCount++

        if (!resolved && successCount >= successThreshold) {
          resolved = true
          this.emitNewEvent(event, uniqueRelayUrls)
          resolve()
        }
        if (finishedCount >= uniqueRelayUrls.length) {
          reject(
            new AggregateError(
              errors.map(
                ({ url, error }) =>
                  new Error(`${url}: ${error instanceof Error ? error.message : String(error)}`)
              )
            )
          )
        }
      }

      Promise.allSettled(
        uniqueRelayUrls.map(async (url) => {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const that = this
          const relay = await this.pool.ensureRelay(url).catch(() => {
            return undefined
          })
          if (!relay) {
            checkCompletion(url, false, new Error('Cannot connect to relay'))
            return
          }

          relay.publishTimeout = 10_000 // 10s
          let hasAuthed = false

          const publishPromise = async () => {
            try {
              await relay.publish(event)
              seenOn.trackEventSeenOn(event.id, relay)
              checkCompletion(url, true)
            } catch (error) {
              const authSigner = that.getSignerFor(event.pubkey) ?? that.signer
              if (
                !hasAuthed &&
                error instanceof Error &&
                error.message.startsWith('auth-required') &&
                !!authSigner
              ) {
                try {
                  await relay.auth((authEvt: EventTemplate) => authSigner.signEvent(authEvt))
                  hasAuthed = true
                  await publishPromise().catch(() => {
                    // ignore
                  })
                  return
                } catch (error) {
                  checkCompletion(url, false, error)
                }
              } else {
                checkCompletion(url, false, error)
              }
            }
          }

          return publishPromise()
        })
      )
    })
  }

  emitNewEvent(event: NEvent, relays: string[] = []) {
    this.dispatchEvent(new CustomEvent('newEvent', { detail: { event, relays } }))
  }

  /**
   * NIP-98 HTTP-auth header for a specific account. When `pubkey` is provided
   * and a signer for it is registered, signs as that account; otherwise falls
   * back to the active singleton (single-account behavior preserved).
   */
  async signHttpAuth(url: string, method: string, description = '', pubkey?: string) {
    const signer = selectAuthSigner((pk) => this.getSignerFor(pk), this.signer, pubkey)
    if (!signer) {
      throw new Error('Please login first to sign the event')
    }
    const event = await signer.signEvent({
      content: description,
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  subscribe(
    urls: string[],
    filter: Filter | Filter[],
    {
      onevent,
      oneose,
      onclose,
      startLogin,
      onAllClose,
      authPubkey
    }: {
      onevent?: (evt: NEvent) => void
      oneose?: (eosed: boolean) => void
      onclose?: (url: string, reason: string) => void
      startLogin?: () => void
      onAllClose?: (reasons: string[]) => void
      /**
       * Pubkey to authenticate as when a relay returns `auth-required`. When
       * unset, falls back to the active singleton signer (single-account behavior).
       *
       * KNOWN LIMITATION: NIP-42 AUTH is per-WebSocket-connection, and the relay
       * pool shares one connection per relay URL across all columns/accounts.
       * So a single connection can only be authenticated as one account at a
       * time. This option makes the common case correct (a column reading its
       * OWN account's restricted relay authenticates as that account). Two
       * different accounts reading the SAME restricted relay over the SAME
       * shared connection still can only authenticate as one — that needs
       * per-account connection pooling (separate, bigger-lift item; see
       * BACKLOG.md → "Account Isolation part 2 — out-of-scope follow-ups").
       */
      authPubkey?: string
    }
  ) {
    const relays = Array.from(new Set(urls))
    const filters = Array.isArray(filter) ? filter : [filter]

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    const _knownIds = new Set<string>()
    const startedCount = relays.length
    let eosedCount = 0
    let eosed = false
    let closedCount = 0
    const closeReasons: string[] = []
    const subPromises: Promise<{ close: () => void }>[] = []
    relays.forEach((url) => {
      let hasAuthed = false

      subPromises.push(startSub())

      async function startSub() {
        const relay = await that.pool.ensureRelay(url).catch(() => {
          return undefined
        })
        // cannot connect to relay
        if (!relay) {
          if (!eosed) {
            eosedCount++
            eosed = eosedCount >= startedCount
            oneose?.(eosed)
          }
          return {
            close: () => {}
          }
        }

        return relay.subscribe(filters, {
          receivedEvent: (relay, id) => {
            seenOn.trackEventSeenOn(id, relay)
          },
          alreadyHaveEvent: (id: string) => {
            const have = _knownIds.has(id)
            if (have) {
              return true
            }
            _knownIds.add(id)
            return false
          },
          onevent: (evt: NEvent) => {
            onevent?.(evt)
          },
          oneose: () => {
            // make sure eosed is not called multiple times
            if (eosed) return

            eosedCount++
            eosed = eosedCount >= startedCount
            oneose?.(eosed)
          },
          onclose: (reason: string) => {
            // auth-required
            if (reason.startsWith('auth-required') && !hasAuthed) {
              const authSigner = selectAuthSigner(
                (pk) => that.getSignerFor(pk),
                that.signer,
                authPubkey
              )
              // already logged in (somewhere — registry or active)
              if (authSigner) {
                relay
                  .auth(async (authEvt: EventTemplate) => {
                    const evt = await authSigner.signEvent(authEvt)
                    if (!evt) {
                      throw new Error('sign event failed')
                    }
                    return evt as VerifiedEvent
                  })
                  .then(() => {
                    hasAuthed = true
                    if (!eosed) {
                      subPromises.push(startSub())
                    }
                  })
                  .catch(() => {
                    // ignore
                  })
                return
              }

              // open login dialog
              if (startLogin) {
                startLogin()
                return
              }
            }

            // close the subscription
            closedCount++
            closeReasons.push(reason)
            onclose?.(url, reason)
            if (closedCount >= startedCount) {
              onAllClose?.(closeReasons)
            }
            return
          },
          eoseTimeout: 10_000 // 10s
        })
      }
    })

    const handleNewEventFromInternal = (data: Event) => {
      const customEvent = data as CustomEvent<{ event: NEvent; relays: string[] }>
      const { event: evt, relays: _relays } = customEvent.detail
      if (!_relays.some((url) => relays.includes(url))) {
        return
      }
      const _filters = filters.filter((f) => !f.search)
      if (_filters.length === 0 || !matchFilters(_filters, evt)) return

      const id = evt.id
      const have = _knownIds.has(id)
      if (have) return

      _knownIds.add(id)
      onevent?.(evt)
    }

    this.addEventListener('newEvent', handleNewEventFromInternal)

    return {
      close: () => {
        this.removeEventListener('newEvent', handleNewEventFromInternal)
        subPromises.forEach((subPromise) => {
          subPromise
            .then((sub) => {
              sub.close()
            })
            .catch((err) => {
              console.error(err)
            })
        })
      }
    }
  }

  /** =========== Event =========== */

  async query(
    urls: string[],
    filter: Filter | Filter[],
    onevent?: (evt: NEvent) => void,
    options?: { authPubkey?: string }
  ) {
    return await new Promise<NEvent[]>((resolve) => {
      const events: NEvent[] = []
      const sub = this.subscribe(urls, filter, {
        onevent(evt) {
          onevent?.(evt)
          events.push(evt)
        },
        oneose: (eosed) => {
          if (eosed) {
            sub.close()
            resolve(events)
          }
        },
        onAllClose: () => {
          resolve(events)
        },
        authPubkey: options?.authPubkey
      })
    })
  }

  // ================= Utils =================

  async generateSubRequestsForPubkeys(pubkeys: string[], myPubkey?: string | null) {
    // If many websocket connections are initiated simultaneously, it will be
    // very slow on Safari (for unknown reason)
    if (isSafari()) {
      let urls = getDefaultRelayUrls()
      if (myPubkey) {
        const relayList = await relayListService.fetchRelayList(myPubkey)
        urls = relayList.read.concat(getDefaultRelayUrls()).slice(0, 5)
      }
      return [{ urls, filter: { authors: pubkeys } }]
    }

    const relayLists = await relayListService.fetchRelayLists(pubkeys)
    const group: Record<string, Set<string>> = {}
    relayLists.forEach((relayList, index) => {
      relayList.write.slice(0, 4).forEach((url) => {
        if (!group[url]) {
          group[url] = new Set()
        }
        group[url].add(pubkeys[index])
      })
    })

    const relayCount = Object.keys(group).length
    const coveredCount = new Map<string, number>()
    Object.entries(group)
      .sort(([, a], [, b]) => b.size - a.size)
      .forEach(([url, pubkeys]) => {
        if (
          relayCount > 10 &&
          pubkeys.size < 10 &&
          Array.from(pubkeys).every((pubkey) => (coveredCount.get(pubkey) ?? 0) >= 2)
        ) {
          delete group[url]
        } else {
          pubkeys.forEach((pubkey) => {
            coveredCount.set(pubkey, (coveredCount.get(pubkey) ?? 0) + 1)
          })
        }
      })

    return Object.entries(group).map(([url, authors]) => ({
      urls: [url],
      filter: { authors: Array.from(authors) }
    }))
  }
}

const instance = ClientService.getInstance()
export default instance
