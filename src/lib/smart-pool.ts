import { SimplePool } from 'nostr-tools'
import { AbstractRelay } from 'nostr-tools/abstract-relay'
import { matchFilters, type Event as NEvent } from 'nostr-tools'
import { verifiedSymbol } from 'nostr-tools/pure'
import verificationPool from '@/services/verification-pool.service'
import { IRelay, IRelayPool } from '../types/relay-pool'
import { isInsecureUrl } from './url'

const DEFAULT_CONNECTION_TIMEOUT = 10 * 1000 // 10 seconds
const CLEANUP_THRESHOLD = 15 // number of relays to trigger cleanup
const CLEANUP_INTERVAL = 30 * 1000 // 30 seconds
const IDLE_TIMEOUT = 10 * 1000 // 10 seconds

/**
 * JankRelay overrides AbstractRelay._onmessage so EVENT messages are
 * verified asynchronously via the worker pool. Verification is owned here
 * end-to-end; the inherited verifyEvent (set on the parent AbstractRelay)
 * is configured to a noop and never used.
 *
 * Per-sub in-flight counter + deferred EOSE preserves the EOSE-after-EVENTs
 * ordering guarantee. Other message types fall through to super._onmessage.
 *
 * Upgrade-review note: depends on nostr-tools' _onmessage shape (parsed JSON
 * envelope, this.openSubs lookup, sub.onevent / oninvalidevent / receivedEose
 * callbacks). nostr-tools is pinned to exact 2.23.3 in package.json; before
 * any version bump, re-verify this override against the new parent's body.
 */
export class JankRelay extends AbstractRelay {
  private pendingBySub = new Map<string, number>()
  private eoseDeferred = new Set<string>()

  async _onmessage(ev: MessageEvent): Promise<void> {
    const json = ev.data as string
    if (!json) return

    let data: any[]
    try {
      data = JSON.parse(json)
    } catch {
      super._onmessage(ev)
      return
    }

    // EVENT — async-verify branch
    if (data[0] === 'EVENT') {
      const subId = data[1] as string
      const event = data[2] as NEvent
      const so: any = this.openSubs.get(subId)
      if (!so) return

      // Dedupe before scheduling verification (matches parent's getSubscriptionId shortcut).
      const alreadyHave = so.alreadyHaveEvent?.(event.id)
      so.receivedEvent?.(this, event.id)
      if (alreadyHave) return

      this.pendingBySub.set(subId, (this.pendingBySub.get(subId) ?? 0) + 1)

      let valid = false
      try {
        valid = await verificationPool.verify(event)
      } catch {
        valid = false
      }

      if (valid) {
        ;(event as any)[verifiedSymbol] = true
        if (matchFilters(so.filters, event)) {
          so.onevent(event)
        }
      } else {
        ;(event as any)[verifiedSymbol] = false
        so.oninvalidevent?.(event)
      }
      // Advance the reconnect-refire watermark (ws.onopen resubscribes with
      // since = lastEmitted + 1), clamped to the present so one future-dated
      // event can't make the refire skip everything until its timestamp.
      const watermark = Math.min(event.created_at, Math.floor(Date.now() / 1000))
      if (!so.lastEmitted || so.lastEmitted < watermark) {
        so.lastEmitted = watermark
      }

      const next = (this.pendingBySub.get(subId) ?? 1) - 1
      if (next <= 0) {
        this.pendingBySub.delete(subId)
        if (this.eoseDeferred.delete(subId)) {
          so.receivedEose()
        }
      } else {
        this.pendingBySub.set(subId, next)
      }
      return
    }

    // EOSE — defer if verifications are still in flight for this sub.
    if (data[0] === 'EOSE') {
      const subId = data[1] as string
      const so: any = this.openSubs.get(subId)
      if (!so) return
      if ((this.pendingBySub.get(subId) ?? 0) > 0) {
        this.eoseDeferred.add(subId)
        return
      }
      so.receivedEose()
      return
    }

    // Everything else (OK, CLOSED, NOTICE, AUTH, COUNT) → parent.
    super._onmessage(ev)
  }
}

export type SmartPoolOptions = {
  allowInsecure?: boolean
}

export class SmartPool extends SimplePool implements IRelayPool {
  private relayIdleTracker = new Map<string, number>()
  private allowInsecure: boolean

  constructor(options: SmartPoolOptions = {}) {
    // Pass a noop verifier — JankRelay owns verification. We deliberately
    // bypass the parent's sync verifier; if a SmartPool ever ends up wrapping
    // a plain AbstractRelay (shouldn't happen given ensureRelay below, but
    // defense in depth) the noop is safe because we ALSO guard at the seam.
    super({
      enablePing: true,
      enableReconnect: true,
      verifyEvent: () => true
    } as any)

    this.allowInsecure = options.allowInsecure ?? false

    setInterval(() => this.cleanIdleRelays(), CLEANUP_INTERVAL)
  }

  setAllowInsecure(allow: boolean) {
    this.allowInsecure = allow
  }

  getSeenRelays(eventId: string): IRelay[] {
    return Array.from(this.seenOn.get(eventId)?.values() ?? [])
  }

  trackEventSeen(eventId: string, relay: IRelay) {
    let set = this.seenOn.get(eventId)
    if (!set) {
      set = new Set()
      this.seenOn.set(eventId, set)
    }
    set.add(relay as AbstractRelay)
  }

  async ensureRelay(url: string): Promise<AbstractRelay> {
    if (!this.allowInsecure && isInsecureUrl(url)) {
      return Promise.reject(new Error(`Insecure relay connection blocked: ${url}`))
    }
    if (!this.relayIdleTracker.has(url) && this.relayIdleTracker.size > CLEANUP_THRESHOLD) {
      this.cleanIdleRelays()
    }
    this.relayIdleTracker.set(url, Date.now())

    // Reach into the parent's relay map. If a relay for this URL doesn't exist
    // yet, construct a JankRelay; otherwise reuse the existing one (which
    // is also a JankRelay because we constructed it last time).
    const parent = this as unknown as { relays: Map<string, AbstractRelay> }
    const normalized = normalizeUrl(url)
    let relay = parent.relays.get(normalized)
    if (!relay) {
      relay = new JankRelay(normalized, {
        verifyEvent: () => true,
        enablePing: true,
        enableReconnect: true
      } as any)
      relay.onclose = () => {
        parent.relays.delete(normalized)
      }
      parent.relays.set(normalized, relay)
    }
    await relay.connect({ timeout: DEFAULT_CONNECTION_TIMEOUT })
    return relay
  }

  /**
   * Force every live relay connection to drop its (possibly dead) socket and
   * reconnect, WITHOUT closing the relay's open subscriptions. nostr-tools'
   * AbstractRelay refires `openSubs` from `ws.onopen` on reconnect, so feeds
   * recover in place.
   *
   * Why this is needed: after the OS suspends (laptop sleep), the underlying
   * TCP connections are torn down but the browser's WebSocket objects often
   * never fire `onclose`. AbstractRelay is left with `connectionPromise` set
   * and `_connected` true, so `connect()` short-circuits and never notices the
   * socket is dead — every re-subscribe (including the feed's Refresh button)
   * binds to a zombie and receives nothing. nostr-tools' own ping/reconnect
   * can't help because its timers were suspended during sleep too. We force
   * the recovery from an app-level wake trigger instead (see client.service).
   *
   * Upgrade-review note: reaches into AbstractRelay private fields (`ws`,
   * `connectionPromise`, `_connected`, `reconnectAttempts`, `pingIntervalHandle`).
   * nostr-tools is pinned to exact 2.23.3 (see JankRelay note above); before
   * any version bump, re-verify these field names and the `ws.onopen` resubscribe
   * behavior against the new parent.
   */
  reconnectStaleRelays(): void {
    this.relays.forEach((relay) => {
      // Zombie sockets still report `connected`; a relay backing an open feed
      // has subs. Skip genuinely-idle, disconnected relays — `ensureRelay`
      // reconnects those on demand.
      if (!relay.connected && relay.openSubs.size === 0) return

      const r = relay as unknown as {
        ws?: WebSocket
        connectionPromise?: Promise<void>
        _connected: boolean
        reconnectAttempts: number
        pingIntervalHandle?: ReturnType<typeof setInterval>
      }

      // Detach the old (possibly zombie) socket so its delayed close/message
      // events can't clobber the fresh connection we're about to open.
      const oldWs = r.ws
      if (oldWs) {
        oldWs.onopen = null
        oldWs.onclose = null
        oldWs.onerror = null
        oldWs.onmessage = null
        try {
          oldWs.close()
        } catch {
          // best-effort teardown of a dead socket
        }
      }
      if (r.pingIntervalHandle) {
        clearInterval(r.pingIntervalHandle)
        r.pingIntervalHandle = undefined
      }

      // Clear the short-circuit state so connect() actually opens a new socket.
      r.ws = undefined
      r.connectionPromise = undefined
      r._connected = false
      // reconnectAttempts > 0 makes ws.onopen treat this as a reconnection and
      // resubscribe each open sub with `since = lastEmitted + 1` (only fetch
      // events newer than the last one already shown).
      if (r.reconnectAttempts < 1) r.reconnectAttempts = 1

      relay.connect({ timeout: DEFAULT_CONNECTION_TIMEOUT }).catch(() => {
        // connect() owns its own hard-close/retry path on failure
      })
    })
  }

  private cleanIdleRelays() {
    const idleRelays: string[] = []
    this.relays.forEach((relay, url) => {
      if (!relay.connected || relay.openSubs.size > 0) return
      const lastActivity = this.relayIdleTracker.get(url) ?? 0
      if (Date.now() - lastActivity < IDLE_TIMEOUT) return
      idleRelays.push(url)
      this.relayIdleTracker.delete(url)
    })

    if (idleRelays.length > 0) {
      console.log('[SmartPool] Closing idle relays:', idleRelays)
      this.close(idleRelays)
    }
  }
}

// Local copy of nostr-tools' URL normalizer — keeps ensureRelay's relay-map
// keys in sync with parent's internal usage. nostr-tools doesn't export
// normalizeURL publicly; the rule is "matches what AbstractSimplePool does."
function normalizeUrl(url: string): string {
  try {
    if (url.indexOf('://') === -1) url = 'wss://' + url
    const p = new URL(url)
    if (p.protocol === 'http:') p.protocol = 'ws:'
    else if (p.protocol === 'https:') p.protocol = 'wss:'
    p.pathname = p.pathname.replace(/\/+/g, '/')
    if (p.pathname.endsWith('/')) p.pathname = p.pathname.slice(0, -1)
    if (
      (p.port === '80' && p.protocol === 'ws:') ||
      (p.port === '443' && p.protocol === 'wss:')
    )
      p.port = ''
    p.searchParams.sort()
    p.hash = ''
    return p.toString()
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
}
