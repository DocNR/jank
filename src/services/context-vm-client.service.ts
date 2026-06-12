import {
  CONTEXTVM_RESPONSE_KINDS,
  CONTEXTVM_RPC_KIND,
  DEFAULT_TIMEOUT_MS,
  JSONRPC_VERSION,
  RESPONSE_LOOKBACK_S,
  type TMcpRequest,
  type ToolCallOptions,
  type ToolCallResult
} from '@/lib/contextvm'
import { encodeMcpRequest, parseMcpResponse, unwrapGift, wrapGift } from '@/lib/contextvm-wire'
import { randomId } from '@/lib/utils'
import { ISigner } from '@/types'
import clientService from './client.service'
import relayListService from './fetchers/relay-list.service'

/**
 * In-memory cache of server-pubkey → its NIP-65 relays. Cleared on page reload.
 * Re-fetched lazily next session — no IndexedDB persistence for v1 (the server's
 * relay list rarely changes day-to-day, and an in-memory cache is enough to avoid
 * re-fetching across multiple calls in the same session).
 *
 * Module-scoped on purpose so a hypothetical future re-instantiation of the
 * service (e.g. test isolation) doesn't inadvertently drop the cache.
 */
const relayCache = new Map<string, string[]>()

/**
 * Relays known to be CDN-fronted and reliably reachable through restrictive
 * networks (corporate guest wifi, hotels, school networks, regions with bad
 * routing). When a server's NIP-65 list includes one of these, we bias it
 * toward the front of the resolution result so subscriptions register on
 * it first and publishes hit it first. Single-host strfry instances often
 * fail under hostile network conditions while CDN-fronted relays survive.
 *
 * Verified real-user problem 2026-05-26: a corporate guest wifi blocked
 * WSS to `relay.contextvm.org` (Relatr's primary relay). Cellular hotspot
 * worked. Relatr's NIP-65 also includes `relay.primal.net` (CDN-fronted);
 * biasing toward primal would have routed around the block automatically.
 *
 * Match is by `.includes(host)` so http/wss prefixes + trailing slashes
 * don't matter. Order matters: earlier entries hoist higher.
 */
const PREFERRED_HOSTS = ['relay.primal.net', 'relay.damus.io', 'nos.lol']

/**
 * Stable-sort `relays` so URLs matching a PREFERRED_HOSTS entry come first.
 * Within each group (preferred, non-preferred), original order is preserved.
 * Pure function; returns a new array. Exported for unit testing.
 */
export function sortByPreference(relays: string[]): string[] {
  // Tag with original index so the sort is stable within groups.
  const tagged = relays.map((url, originalIndex) => {
    const preferenceIndex = PREFERRED_HOSTS.findIndex((host) => url.includes(host))
    // preferenceIndex === -1 (no match) becomes Infinity so unpreferred sort last.
    const rank = preferenceIndex === -1 ? Infinity : preferenceIndex
    return { url, rank, originalIndex }
  })
  tagged.sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex)
  return tagged.map((t) => t.url)
}

/**
 * Resolve the relay set to publish the wrapped request to. Caller-provided
 * `override` wins; otherwise we fetch the server's NIP-65 list and union
 * read + write. NIP-65 says READ relays are where a user expects to RECEIVE
 * events addressed to them — so a ContextVM server's `read` set is where its
 * inbox lives. WRITE relays are where it publishes. Some servers may advertise
 * only one. Falling back to defaults (what `fetchRelayList` does when no list
 * event is found) is acceptable for v1: a ContextVM server reachable via the
 * Nostr default relay set is a real configuration.
 *
 * Result is sorted via `sortByPreference` so CDN-fronted relays come first.
 * See PREFERRED_HOSTS for the rationale (hostile-network resilience).
 */
async function resolveRelays(serverPubkey: string, override?: string[]): Promise<string[]> {
  if (override?.length) return sortByPreference(override)
  const cached = relayCache.get(serverPubkey)
  if (cached?.length) return cached

  const list = await relayListService.fetchRelayList(serverPubkey)
  const relays = sortByPreference(
    Array.from(new Set([...(list.read ?? []), ...(list.write ?? [])]))
  )
  if (relays.length === 0) {
    throw new Error(`No relays resolved for server ${serverPubkey.slice(0, 16)}…`)
  }
  relayCache.set(serverPubkey, relays)
  return relays
}

/** MCP protocol version we declare in the initialize handshake. */
const MCP_PROTOCOL_VERSION = '2025-06-18'

type InitStatus = 'init-pending' | 'init-done' | 'init-failed'

class ContextVmClientService {
  /**
   * Per-server initialize-handshake status. In-memory only; lifetime matches
   * the page session. Cleared explicitly via `resetInitState` (e.g. on logout)
   * or by tests.
   */
  private initStatus = new Map<string, InitStatus>()
  /**
   * Dedup map for concurrent `callTool` invocations against the same server.
   * Two parallel callers share one in-flight initialize round-trip rather than
   * racing two handshakes.
   */
  private initInFlight = new Map<string, Promise<void>>()

  /**
   * Clears the initialize-handshake state. Without arguments, clears every
   * server's state; with a `serverPubkey`, clears just that one.
   *
   * The next `callTool` against any cleared server will run a fresh
   * `initialize` handshake before its `tools/call`.
   */
  resetInitState(serverPubkey?: string): void {
    if (serverPubkey) {
      this.initStatus.delete(serverPubkey)
      this.initInFlight.delete(serverPubkey)
    } else {
      this.initStatus.clear()
      this.initInFlight.clear()
    }
  }

  /**
   * Manually mark a server as already-initialized. Primarily used by tests
   * that target `tools/call` behavior without the initialize round-trip in
   * the way; the app itself should let the handshake run naturally on the
   * first `callTool`.
   */
  markInitDone(serverPubkey: string): void {
    this.initStatus.set(serverPubkey, 'init-done')
  }

  /**
   * One-shot MCP tools/call against a remote ContextVM server.
   *
   * **Lifecycle:** on the FIRST call against each server in the session, this
   * runs the MCP `initialize` handshake (per the 2025-06-18 spec) before
   * sending the actual `tools/call`. That adds one extra request/response
   * round-trip to the first call. Subsequent calls in the same session reuse
   * the cached handshake state and skip directly to `tools/call`.
   *
   * **Leniency:** if `initialize` times out or returns an error, the client
   * falls back to a direct `tools/call` (and logs a console.warn). Preserves
   * backward compat with non-spec-strict servers (Relatr in particular). A
   * strict server that rejects the un-initialized `tools/call` will surface
   * its error to the caller through the normal error path.
   *
   * **Single-shot semantics:** subscribes for the response BEFORE publishing
   * the request, hard timeout (default 30s), no retries. Manual retry is the
   * caller's responsibility (the Refresh button in the column UI re-invokes).
   *
   * Subscribe filter includes all of `CONTEXTVM_RESPONSE_KINDS`: 1059 (persistent
   * gift wrap), 21059 (ephemeral — Relatr's actual response kind), and 25910
   * (defensive inclusion matching the SDK).
   */
  async callTool<T = unknown>(
    serverPubkey: string,
    toolName: string,
    args: Record<string, unknown>,
    opts: ToolCallOptions
  ): Promise<ToolCallResult<T>> {
    const signer = clientService.getSignerFor(opts.signerPubkey)
    if (!signer) {
      throw new Error(`No signer registered for pubkey ${opts.signerPubkey.slice(0, 16)}…`)
    }

    const relays = await resolveRelays(serverPubkey, opts.relays)
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    await this.ensureInitialized(serverPubkey, signer, opts.signerPubkey, relays, timeoutMs)

    return this.singleShotRequest<T>(
      serverPubkey,
      signer,
      opts.signerPubkey,
      relays,
      timeoutMs,
      'tools/call',
      { name: toolName, arguments: args }
    )
  }

  /**
   * Runs the MCP `initialize` handshake against `serverPubkey` if it hasn't
   * already completed this session. Dedups concurrent callers so two parallel
   * `callTool`s against the same server share one handshake.
   *
   * Always resolves — even on handshake failure — because the caller proceeds
   * leniently with `tools/call` either way. The handshake outcome is recorded
   * in `initStatus` for the next call to consult.
   */
  private async ensureInitialized(
    serverPubkey: string,
    signer: ISigner,
    signerPubkey: string,
    relays: string[],
    timeoutMs: number
  ): Promise<void> {
    if (this.initStatus.get(serverPubkey) === 'init-done') return

    const existing = this.initInFlight.get(serverPubkey)
    if (existing) return existing

    this.initStatus.set(serverPubkey, 'init-pending')
    const promise = this.performInitialize(serverPubkey, signer, signerPubkey, relays, timeoutMs)
    this.initInFlight.set(serverPubkey, promise)
    try {
      await promise
    } finally {
      this.initInFlight.delete(serverPubkey)
    }
  }

  private async performInitialize(
    serverPubkey: string,
    signer: ISigner,
    signerPubkey: string,
    relays: string[],
    timeoutMs: number
  ): Promise<void> {
    // Init gets half the configured tool-call timeout — adequate for a single
    // round-trip handshake without consuming the full per-call budget. The
    // subsequent `tools/call` uses the full configured timeout (the 30s is
    // the per-call budget, not per-session).
    const initTimeoutMs = Math.max(1, Math.floor(timeoutMs / 2))
    const result = await this.singleShotRequest(
      serverPubkey,
      signer,
      signerPubkey,
      relays,
      initTimeoutMs,
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'jank', version: import.meta.env.APP_VERSION }
      }
    )
    if (result.ok) {
      this.initStatus.set(serverPubkey, 'init-done')
      // MCP §Lifecycle: after a successful initialize, the client MUST send
      // a `notifications/initialized` to indicate it's ready for normal
      // operations. We await the publish so it reaches the relay before our
      // first `tools/call`, but the notification itself is JSON-RPC
      // fire-and-forget (no id, no response). A publish failure here is
      // best-effort: if the server later rejects calls because the
      // notification didn't arrive, that error flows through the normal path.
      try {
        await this.sendNotification(
          serverPubkey,
          signer,
          relays,
          'notifications/initialized',
          {}
        )
      } catch {
        // Best-effort.
      }
    } else {
      // Lenient fallback. The MCP 2025-06-18 spec says initialize MUST be
      // first, but real-world servers vary in enforcement. Falling back to
      // a direct `tools/call` here preserves prod behavior with Relatr
      // (which doesn't enforce). If a strict server returns an MCP error
      // (e.g. -32600 Invalid request) to the subsequent `tools/call`, the
      // existing error handling surfaces that to the column UI — no new
      // path needed.
      console.warn(
        `[ContextVM] Server ${serverPubkey.slice(0, 16)}… didn't respond to initialize; proceeding anyway`
      )
      this.initStatus.set(serverPubkey, 'init-failed')
    }
  }

  /**
   * Wrap + publish a JSON-RPC notification (no `id`, no response expected).
   * Awaits the publish so caller ordering against subsequent requests is
   * preserved at the relay; does not wait for the server to process it.
   */
  private async sendNotification(
    serverPubkey: string,
    signer: ISigner,
    relays: string[],
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const startedAt = Date.now()
    const logPrefix = `[ContextVM] ${method}`
    console.debug(`${logPrefix} notification sending`, { relays: relays.length })
    const notif = { jsonrpc: JSONRPC_VERSION, method, params }
    const wrapped = await wrapGift({
      senderSigner: signer,
      recipientPubkey: serverPubkey,
      innerKind: CONTEXTVM_RPC_KIND,
      innerContent: JSON.stringify(notif),
      // Load-bearing: @contextvm/sdk's server pipeline only ever decrypts ONE
      // wrap layer before treating the result as the signed inner event (see
      // ContextVM/sdk src/transport/nostr-server/event-pipeline.ts). A strict
      // 3-layer NIP-59 wrap would surface a kind-13 seal instead of the RPC
      // envelope and get silently dropped. Verified empirically against the
      // live Relatr server 2026-05-25: nip59=timeout, simple=accepted.
      mode: 'simple'
    })
    await clientService.publishEvent(relays, wrapped)
    console.debug(
      `${logPrefix} notification sent in ${Date.now() - startedAt}ms`,
      { wrapId: wrapped.id.slice(0, 12) }
    )
  }

  /**
   * Single-shot JSON-RPC request/response cycle, parameterized on method +
   * params so it serves both `tools/call` and `initialize`. Subscribes FIRST
   * to avoid racing the response, then wrap+publish; resolves on the first
   * matching response or hard timeout.
   */
  private singleShotRequest<T = unknown>(
    serverPubkey: string,
    signer: ISigner,
    signerPubkey: string,
    relays: string[],
    timeoutMs: number,
    method: TMcpRequest['method'],
    params: Record<string, unknown>
  ): Promise<ToolCallResult<T>> {
    const id = randomId()
    const request = encodeMcpRequest(id, method, params)
    const requestJson = JSON.stringify(request)

    // Diagnostic logging. `[ContextVM] <method> <id-prefix>` is the prefix for
    // every log line in this call's lifecycle so a developer can grep one
    // request's full path through devtools. Levels: debug for the success path
    // (filtered out unless devtools is set to "Verbose"); warn for failures.
    const startedAt = Date.now()
    const logPrefix = `[ContextVM] ${method} ${id.slice(0, 8)}`
    console.debug(`${logPrefix} start`, {
      relays: relays.length,
      signerPubkey: signerPubkey.slice(0, 16) + '…',
      serverPubkey: serverPubkey.slice(0, 16) + '…',
      timeoutMs
    })

    // Deferred-promise pattern (avoids `new Promise(async (resolve) => ...)`
    // which would trigger ESLint's `no-async-promise-executor`).
    let resolveResult!: (r: ToolCallResult<T>) => void
    const resultPromise = new Promise<ToolCallResult<T>>((resolve) => {
      resolveResult = resolve
    })

    // Settle state shared across subscribe onevent, timeout, and publish-error
    // paths. `finish` is closure-captured by all three; it idempotently
    // resolves the result, clears the timer, and closes the sub.
    const state = { settled: false }
    const handles: {
      timer?: ReturnType<typeof setTimeout>
      sub?: { close: () => void }
    } = {}
    const finish = (result: ToolCallResult<T>) => {
      if (state.settled) return
      state.settled = true
      if (handles.timer !== undefined) clearTimeout(handles.timer)
      handles.sub?.close()
      resolveResult(result)
    }

    // Subscribe FIRST so the response can't race ahead of us. Relatr responds
    // with kind 21059 (ephemeral); the SDK's defensive filter also covers 1059
    // and 25910. The `since` lookback handles modest clock skew between us
    // and the server.
    handles.sub = clientService.subscribe(
      relays,
      {
        kinds: [...CONTEXTVM_RESPONSE_KINDS],
        '#p': [signerPubkey],
        since: Math.floor(Date.now() / 1000) - RESPONSE_LOOKBACK_S
      },
      {
        onevent: async (evt) => {
          if (state.settled) return
          try {
            const unwrapped = await unwrapGift({
              gift: evt,
              recipientSigner: signer,
              recipientPubkey: signerPubkey
            })
            // Drop gifts from anyone other than our server (we share a sub
            // filtered only by `#p`, so other senders' wraps can land here).
            if (unwrapped.senderPubkey !== serverPubkey) return
            // Drop non-RPC envelopes (defensive — Relatr always wraps a 25910).
            if (unwrapped.innerKind !== CONTEXTVM_RPC_KIND) return
            const parsed = parseMcpResponse<T>(unwrapped.innerContent, id)
            if (!parsed.matched) return
            console.debug(
              `${logPrefix} response received in ${Date.now() - startedAt}ms`,
              { ok: parsed.result.ok }
            )
            finish(parsed.result)
          } catch {
            // Unwrap failures are EXPECTED here — the relay may surface stray
            // 1059s from other senders, or with mismatched p-tags. Silent drop
            // is correct; the timeout will surface real failures.
          }
        }
      }
    )
    console.debug(`${logPrefix} subscribe opened`)

    handles.timer = setTimeout(() => {
      console.warn(`${logPrefix} timed out after ${timeoutMs}ms`)
      finish({
        ok: false,
        error: { code: -32001, message: 'Request timed out' }
      })
    }, timeoutMs)

    // Wrap + publish AFTER subscribe is in place. Failures here finish() the
    // call immediately with JSON-RPC -32603 (Internal error). The IIFE keeps
    // the failure path inside the same closure as `finish` while letting the
    // caller receive the result promise without awaiting the publish step.
    ;(async () => {
      try {
        const wrapped = await wrapGift({
          senderSigner: signer,
          recipientPubkey: serverPubkey,
          innerKind: CONTEXTVM_RPC_KIND,
          innerContent: requestJson,
          // Load-bearing: see `sendNotification` for the explanation. The
          // ContextVM ecosystem (Relatr server pipeline, @contextvm/sdk
          // server transport) expects 2-layer wraps; a strict 3-layer NIP-59
          // wrap silently drops at the server's event pipeline.
          mode: 'simple'
        })
        await clientService.publishEvent(relays, wrapped)
        console.debug(
          `${logPrefix} publish complete in ${Date.now() - startedAt}ms`,
          { wrapId: wrapped.id.slice(0, 12), bytes: wrapped.content.length }
        )
      } catch (err) {
        console.warn(`${logPrefix} publish failed`, err)
        finish({
          ok: false,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : 'Publish failed'
          }
        })
      }
    })()

    return resultPromise
  }
}

const instance = new ContextVmClientService()
export default instance
