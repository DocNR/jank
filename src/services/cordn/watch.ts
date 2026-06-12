/**
 * CEP-41 watch — fetch-then-subscribe over the Cordn coordinator.
 *
 * Port of cordn-web's `chatGroupWatch.svelte.ts` (lines 171-334) reduced to
 * the v1 essentials: one function, one returned handle, no Svelte stores, no
 * multi-account coordination, no batched flush, no removed-from-group
 * detection, no presence loading. Phase 3 (drawer UI) layers those concerns
 * on top of this primitive.
 *
 * Strategy (per the Cordn CLI README synchronization model):
 *   1. Backlog phase (one-shot): fetch all messages newer than the persisted
 *      cursor, deliver each via callback, persist cursor as we go. Resolves
 *      the `ready` promise on success; rejects it on cold-start failure so
 *      callers learn about coordinator-unreachable conditions immediately.
 *   2. Subscribe phase (poll-loop): every `pollIntervalMs`, repeat the same
 *      fetch-then-deliver cycle using the now-advanced cursor as the floor.
 *      Transient errors are console.warn'd; the next poll cycle retries.
 *
 * Why a poll-loop (and not contextVmClient.subscribeTool):
 *   contextVmClient lacks a `subscribeTool` method as of 2026-05-26
 *   (Phase 2a carry-forward). When it gains native CEP-41 subscription
 *   support, swap the `setTimeout(pollOnce, ...)` body here for a real
 *   subscribe stream — the public API (WatchHandle) stays compatible.
 *
 * Self-echo dedup:
 *   When we encrypt + send an application message via `messages.encryptOutbound`
 *   + `coordinator.sendGroupMessage`, the coordinator round-trips our own
 *   ciphertext back to us in the next fetch. We MUST NOT pass it through
 *   `messages.decryptInbound` again — the local MLS ratchet was already
 *   advanced during the encrypt call, so re-processing would consume the
 *   same key material a second time and desync the group. Callers wire the
 *   echo registration into their send path immediately after encryptOutbound
 *   resolves.
 *
 *   **Commit bytes (inviter side) need the same treatment.** When
 *   `groups.createGroup` returns `commitBytes` and the caller posts them via
 *   `coordinator.sendGroupMessage`, the watch loop will round-trip them too.
 *   `messages.decryptInbound` throws on non-application messages, so the
 *   caller MUST `registerSelfEcho(commitBytes)` BEFORE posting. Same rule
 *   applies to any future member-add / metadata-update commit Phase 3+ posts.
 *
 *   We keep a bounded sliding window (default 256 entries) of registered
 *   echoes keyed by base64-encoded ciphertext. Beyond the window, the oldest
 *   registrations age out — practical for the v1 chat cadence where a self-
 *   send is delivered back within seconds. Persistent dedup would need an
 *   IDB-backed set, which we explicitly defer.
 *
 *   Even when we skip the callback for an echo, we still advance + persist
 *   the cursor. Without this, a restart would re-fetch the echo and have no
 *   way to know it's ours (the registration is in-memory only).
 *
 * Cursor type quirk:
 *   `CursorRecord.cursor` is declared `string` in indexed-db.service (opaque
 *   pagination cursor convention), but the Cordn coordinator wire returns
 *   `number`. We convert at the boundary: parse to int on read, stringify on
 *   write. Aligning these is a follow-up; the local conversion keeps the IDB
 *   contract stable for this PR.
 */

import { bytesToBase64 } from 'ts-mls'

import idb from '@/services/indexed-db.service'
import { fetchGroupMessages } from './coordinatorClient'

/** Default poll interval. cordn-web has no native equivalent (real subscribe
 *  stream); aligns with `coordinatorClient.subscribeGroupMessages`'s constant. */
const DEFAULT_POLL_INTERVAL_MS = 5_000

/** Bounded sliding window for self-echo registrations. 256 covers the entire
 *  chat-cadence horizon between send + echo arrival; beyond that the user has
 *  almost certainly already seen the message via local optimistic UI. */
const SELF_ECHO_WINDOW_SIZE = 256

/** A single message delivered to the watcher callback. */
export interface WatchedMessage {
  /** Base64 of the MLS opaque message bytes (the coordinator's `msg_64` field). */
  msg64: string
  /** Coordinator-assigned monotonic cursor for this group. Used for pagination. */
  cursor: number
  /** Coordinator timestamp (unix seconds). */
  at: number
}

/** Handle returned by `watchGroup`. */
export interface WatchHandle {
  /** Register a ciphertext as self-authored. Subsequent inbound deliveries with
   *  the same `msg_64` payload are skipped (the local MLS state was already
   *  advanced during the corresponding `encryptOutbound` call; re-processing
   *  via the watcher would attempt to process our own already-consumed
   *  message and desync the ratchet).
   *
   *  Argument is the same `Uint8Array` that came back from
   *  `messages.encryptOutbound`. Internally base64-encoded for set-key lookup
   *  against the coordinator's `msg_64` field.
   *
   *  Watch keeps a bounded sliding-window of the last N (default 256)
   *  registered echoes to avoid unbounded memory growth. Beyond N self-sends,
   *  the oldest registrations age out — practically unbounded for the v1 chat
   *  cadence. */
  registerSelfEcho: (ciphertext: Uint8Array) => void

  /** Stop polling. Idempotent. */
  close: () => void

  /** Resolves when the initial backlog fetch completes. Useful for tests + for
   *  callers that want to know "I'm caught up" before processing input. Rejects
   *  if the backlog fetch fails. Subscribe-phase errors do NOT reject this
   *  (they're console.warn'd; the next poll retries). */
  ready: Promise<void>
}

/**
 * Watch a Cordn group for inbound MLS-encrypted messages.
 *
 * Returns immediately with a `WatchHandle`. The backlog fetch runs in the
 * background; await `handle.ready` to block until caught up. The poll loop
 * then runs until `handle.close()` is called.
 *
 * Caller responsibilities:
 *   - On each call to `messages.encryptOutbound` for this group, also call
 *     `handle.registerSelfEcho(ciphertext)` before posting to the coordinator
 *     (or immediately after — registration before delivery is safe because
 *     the dedup window covers the round-trip).
 *   - The `onMessage` callback is awaited before the next message is delivered
 *     AND before the cursor is persisted, providing strict ordering. Keep it
 *     reasonably fast; downstream processing (MLS decrypt + UI update) is
 *     the caller's job.
 *   - Errors thrown from `onMessage` are not caught here; they propagate up
 *     through the poll-loop and trigger the same console.warn + retry path as
 *     a coordinator error. The cursor is NOT advanced for a callback that
 *     threw, so the message will be re-delivered on the next poll.
 */
export function watchGroup(input: {
  coordPubkey: string
  signerPubkey: string
  /** The protocol groupId (UTF-8 decode of `state.groupContext.groupId`).
   *  Used for both coordinator `gid` and IDB cursor key. */
  groupId: string
  /** Invoked once per NEW non-self-echo message in order. Async-safe (the
   *  watcher awaits the callback before delivering the next message + persisting
   *  the cursor — ordering guarantee). */
  onMessage: (msg: WatchedMessage) => void | Promise<void>
  /** Optional: override the default 5000ms poll interval. Tests use a small
   *  value to keep runtime tight. */
  pollIntervalMs?: number
}): WatchHandle {
  const {
    coordPubkey,
    signerPubkey,
    groupId,
    onMessage,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  } = input

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastCursor: number | undefined

  // Self-echo bookkeeping: set for O(1) lookup, queue for FIFO eviction.
  const selfEchoSet = new Set<string>()
  const selfEchoQueue: string[] = []

  function registerSelfEcho(ciphertext: Uint8Array) {
    const key = bytesToBase64(ciphertext)
    if (selfEchoSet.has(key)) return
    selfEchoSet.add(key)
    selfEchoQueue.push(key)
    while (selfEchoQueue.length > SELF_ECHO_WINDOW_SIZE) {
      const evicted = selfEchoQueue.shift()
      if (evicted !== undefined) selfEchoSet.delete(evicted)
    }
  }

  /** Process a coordinator FetchGroupMessages response: deliver non-echoes via
   *  the callback, always advance + persist the cursor (echo or not). Throws
   *  on persistence or callback failure so the surrounding loop can decide
   *  what to do (backlog phase rejects ready; subscribe phase console.warns). */
  async function processFetchResult(result: unknown) {
    const sc = (result as { ok: boolean; structuredContent?: unknown })?.structuredContent as
      | { messages?: Array<{ msg_64?: string; cursor?: number; at?: number }> }
      | undefined
    if (!Array.isArray(sc?.messages)) return

    for (const m of sc.messages) {
      if (typeof m?.msg_64 !== 'string' || typeof m?.cursor !== 'number') continue
      const at = typeof m.at === 'number' ? m.at : 0
      const isEcho = selfEchoSet.has(m.msg_64)
      if (!isEcho) {
        await onMessage({ msg64: m.msg_64, cursor: m.cursor, at })
      }
      lastCursor = m.cursor
      await idb.putCursor({
        groupId,
        cursor: String(m.cursor),
        updatedAt: Date.now()
      })
    }
  }

  function scheduleNextPoll() {
    if (closed) return
    timer = setTimeout(() => {
      void pollOnce()
    }, pollIntervalMs)
  }

  async function pollOnce() {
    if (closed) return
    try {
      const result = await fetchGroupMessages(coordPubkey, signerPubkey, {
        gid: groupId,
        ...(lastCursor !== undefined ? { after: lastCursor } : {})
      })
      await processFetchResult(result)
    } catch (err) {
      console.warn('[cordn watch] poll failed:', err)
    } finally {
      scheduleNextPoll()
    }
  }

  // Backlog phase: fetch-then-deliver, then enter the subscribe loop.
  const ready = (async () => {
    // Load persisted cursor (opaque string in IDB; coordinator wants a number).
    const stored = await idb.getCursor(groupId)
    if (stored !== null && stored !== undefined) {
      const parsed = parseInt(stored, 10)
      if (Number.isFinite(parsed)) lastCursor = parsed
    }

    // One-shot backlog. Errors here REJECT the ready promise (callers need
    // to know about cold-start failures).
    const result = await fetchGroupMessages(coordPubkey, signerPubkey, {
      gid: groupId,
      ...(lastCursor !== undefined ? { after: lastCursor } : {})
    })
    await processFetchResult(result)
  })()

  // Start the subscribe loop AFTER backlog resolves (success OR failure). On
  // failure, ready rejects but we still want the watcher to keep trying on
  // each poll cycle, mirroring the transient-error recovery contract.
  void ready.then(scheduleNextPoll, () => {
    if (!closed) scheduleNextPoll()
  })

  function close() {
    if (closed) return
    closed = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return {
    registerSelfEcho,
    close,
    ready
  }
}
