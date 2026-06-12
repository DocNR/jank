import { getDefaultRelayUrls } from '@/lib/relay'
import {
  DVM_CONTENT_DISCOVERY_JOB_KIND,
  DVM_CONTENT_DISCOVERY_RESULT_KIND,
  DVM_JOB_STATUS_KIND,
  parseDvmResultEventIds,
  parseDvmStatus,
  TDvmStatusMessage
} from '@/lib/dvm'
import { useAccountScope } from '@/providers/AccountScope'
import { useColumns } from '@/providers/ColumnsProvider'
import client from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { TDraftEvent } from '@/types'
import { TColumn } from '@/types/column'
import dayjs from 'dayjs'
import { Event as NEvent } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'

const REQUEST_TIMEOUT_MS = 30_000
const REQUEST_LOOKBACK_HOURS = 24

export type TDvmFeedState = {
  /** Events resolved from the latest 6300's e-tag list, in the order the DVM returned them. */
  events: NEvent[]
  /** Most-recent kind-7000 status message (payment-required / processing / error / success / partial). */
  status: TDvmStatusMessage | null
  /** True between publishing a kind-5300 and the next 6300/error/timeout. */
  requesting: boolean
  /** unix seconds of the latest 6300 result, or null when no result yet. */
  lastUpdatedAt: number | null
  /** Local error string (publish failure / 30s timeout). Cleared on next refresh. */
  error: string | null
  /** Whether we currently have any result (cached or fresh) to render. */
  hasResult: boolean
  /** Manually trigger a fresh kind-5300 request. Mirrors auto-publish-on-first-mount. */
  refresh: () => Promise<void>
}

/**
 * Drives a dvm-feed column. Owns the full kind 5300 / 6300 / 7000 lifecycle:
 *
 *  - Hydrates from `column.config.lastResultEventId` on mount so reloads show
 *    cached results immediately without re-publishing.
 *  - Subscribes to recent 5300/6300/7000 events between the signer and DVM
 *    for the last 24h; promotes the latest 6300 from the DVM as the result.
 *  - Auto-publishes ONE kind-5300 on first mount when no cache exists
 *    (freshly-spawned column should not be empty).
 *  - `refresh()` publishes a new kind-5300 with a 30s client-side timeout.
 *  - Resolves the result's e-tag id list into actual events via a side `{ids: [...]}`
 *    subscription against the user's default relays.
 *  - Persists the latest result id back to column.config so the cache survives
 *    reload.
 *
 * No advanced `["param", ...]` controls in v1 — personalization defaults to
 * the signer's pubkey. Payment / kind-7000 handling surfaces the status to
 * the caller for inline banner rendering; no in-app Lightning flow yet.
 */
export function useDvmFeed(column: TColumn): TDvmFeedState {
  const scope = useAccountScope()
  const { updateColumnConfig } = useColumns()
  const dvmPubkey = column.config?.dvmPubkey
  const dvmIdentifier = column.config?.dvmIdentifier
  const signerPubkey = scope.signingIdentity

  const [events, setEvents] = useState<NEvent[]>([])
  const [latestResultId, setLatestResultId] = useState<string | null>(
    column.config?.lastResultEventId ?? null
  )
  const [status, setStatus] = useState<TDvmStatusMessage | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    column.config?.lastRequestedAt ?? null
  )

  // Mutable state that should NOT drive re-render
  const currentRequestIdRef = useRef<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // All kind-6300 events seen so far (from the live sub or cache hydration).
  // We always promote the highest-created_at one as the active result.
  const resultsSeenRef = useRef<Map<string, NEvent>>(new Map())
  // Close-handle for the active `{ids: [...]}` sub that fetches the events
  // referenced by the latest 6300. Re-opens when a new 6300 promotes.
  const eventsSubCloseRef = useRef<(() => void) | null>(null)
  // Snapshot of the cached result id at MOUNT time. Decoupled from the live
  // `column.config.lastResultEventId` (which we write to ourselves) so the
  // hydration effect only runs once and isn't re-triggered by our own writes.
  const initialCachedIdRef = useRef<string | null>(column.config?.lastResultEventId ?? null)
  // Guards the auto-publish-on-first-mount one-shot.
  const autoPublishedRef = useRef(false)

  const resolveEventIds = useCallback((ids: string[]) => {
    // Tear down any previous {ids} sub before starting a new one — preserves
    // the "latest 6300 wins" invariant when refreshes promote a new result.
    if (eventsSubCloseRef.current) {
      eventsSubCloseRef.current()
      eventsSubCloseRef.current = null
    }
    if (ids.length === 0) {
      setEvents([])
      return
    }
    const urls = getDefaultRelayUrls()
    const collected = new Map<string, NEvent>()
    const sub = client.subscribe(
      urls,
      { ids },
      {
        onevent: (evt) => {
          if (collected.has(evt.id)) return
          collected.set(evt.id, evt)
          // Preserve original order from the 6300's content (the DVM's ranking).
          const ordered = ids
            .map((id) => collected.get(id))
            .filter((e): e is NEvent => !!e)
          setEvents(ordered)
        }
      }
    )
    eventsSubCloseRef.current = () => sub.close()
  }, [])

  const promoteLatestResult = useCallback(
    (evt: NEvent) => {
      resultsSeenRef.current.set(evt.id, evt)
      // Always render the highest-created_at result we've seen. Refresh might
      // land an out-of-order 6300 before we see ours — sort wins.
      const latest = Array.from(resultsSeenRef.current.values()).sort(
        (a, b) => b.created_at - a.created_at
      )[0]
      setLatestResultId(latest.id)
      setLastUpdatedAt(latest.created_at)
      setRequesting(false)
      setError(null)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      const ids = parseDvmResultEventIds(latest)
      resolveEventIds(ids)
      updateColumnConfig(column.id, {
        lastResultEventId: latest.id,
        lastRequestedAt: latest.created_at
      })
    },
    [column.id, resolveEventIds, updateColumnConfig]
  )

  // Main subscription: live stream of 5300/6300/7000 between signer and DVM.
  useEffect(() => {
    if (!signerPubkey || !dvmPubkey || !dvmIdentifier) return

    // DVM swap (different column or pointer changed): reset transient state.
    setEvents([])
    setStatus(null)
    setError(null)
    setRequesting(false)
    resultsSeenRef.current = new Map()

    const urls = getDefaultRelayUrls()
    const since = dayjs().subtract(REQUEST_LOOKBACK_HOURS, 'hour').unix()
    const sub = client.subscribe(
      urls,
      {
        kinds: [
          DVM_CONTENT_DISCOVERY_JOB_KIND,
          DVM_CONTENT_DISCOVERY_RESULT_KIND,
          DVM_JOB_STATUS_KIND
        ],
        authors: [signerPubkey, dvmPubkey],
        '#p': [signerPubkey, dvmPubkey],
        since
      },
      {
        onevent: (evt) => {
          if (evt.kind === DVM_CONTENT_DISCOVERY_RESULT_KIND) {
            if (evt.pubkey !== dvmPubkey) return
            const taggedP = evt.tags.find((t) => t[0] === 'p')?.[1]
            // Accept results untagged (rare) or tagged to us. Drop results
            // explicitly addressed to other pubkeys.
            if (taggedP && taggedP !== signerPubkey) return
            promoteLatestResult(evt)
          } else if (evt.kind === DVM_JOB_STATUS_KIND) {
            if (evt.pubkey !== dvmPubkey) return
            const parsed = parseDvmStatus(evt)
            if (parsed) setStatus(parsed)
          }
        }
      }
    )

    return () => {
      sub.close()
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [signerPubkey, dvmPubkey, dvmIdentifier, promoteLatestResult])

  // Cache hydration: if we mounted with a cached lastResultEventId, fetch
  // that 6300 event by id from the user's default relays. Runs once per
  // (DVM-pointer, signer) tuple — the snapshotted ref isolates it from our
  // own subsequent cache writes.
  useEffect(() => {
    const cachedId = initialCachedIdRef.current
    if (!cachedId || !dvmPubkey || !signerPubkey) return
    const urls = getDefaultRelayUrls()
    const sub = client.subscribe(
      urls,
      { ids: [cachedId] },
      {
        onevent: (evt) => {
          if (evt.kind !== DVM_CONTENT_DISCOVERY_RESULT_KIND) return
          if (resultsSeenRef.current.has(evt.id)) return
          promoteLatestResult(evt)
          sub.close()
        }
      }
    )
    return () => sub.close()
  }, [dvmPubkey, signerPubkey, promoteLatestResult])

  const refresh = useCallback(async () => {
    if (!signerPubkey || !dvmPubkey) {
      setError('Missing signer or DVM pointer')
      return
    }
    setRequesting(true)
    setError(null)

    let dvmWriteRelays: string[]
    try {
      const relayList = await relayListService.fetchRelayList(dvmPubkey)
      dvmWriteRelays = relayList.write?.length ? relayList.write : getDefaultRelayUrls()
    } catch {
      dvmWriteRelays = getDefaultRelayUrls()
    }
    // Publish to BOTH the DVM's outbox AND our default relays so the result
    // (which the DVM sends to its own write relays) hits our live subscription.
    const allRelays = Array.from(new Set([...dvmWriteRelays, ...getDefaultRelayUrls()]))

    const draft: TDraftEvent = {
      kind: DVM_CONTENT_DISCOVERY_JOB_KIND,
      created_at: dayjs().unix(),
      content: '',
      tags: [
        ['p', dvmPubkey],
        ['relays', ...getDefaultRelayUrls()],
        ['expiration', String(dayjs().add(1, 'day').unix())]
      ]
    }

    try {
      const signed = await scope.publish(draft, { specifiedRelayUrls: allRelays })
      currentRequestIdRef.current = signed.id
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        // Only surface the timeout if THIS request is still the one we're
        // waiting on (subsequent refreshes overwrite the ref).
        if (currentRequestIdRef.current === signed.id) {
          setRequesting(false)
          setError('DVM didn’t respond — try again')
        }
      }, REQUEST_TIMEOUT_MS)
    } catch (err) {
      setRequesting(false)
      setError(err instanceof Error ? err.message : 'Failed to publish request')
    }
  }, [signerPubkey, dvmPubkey, scope])

  // Auto-publish once on first mount IF no cache. Runs after `refresh` is
  // defined (so the closure captures the latest version). Queued via
  // microtask so the main subscription effect mounts first — otherwise the
  // 6300 might land before our sub is listening.
  useEffect(() => {
    if (autoPublishedRef.current) return
    if (!signerPubkey || !dvmPubkey || !dvmIdentifier) return
    if (initialCachedIdRef.current) {
      // We're hydrating from cache — skip auto-publish, manual refresh only
      // from here on out.
      autoPublishedRef.current = true
      return
    }
    autoPublishedRef.current = true
    queueMicrotask(() => {
      refresh().catch((err) => {
        console.error('DVM auto-publish failed', err)
      })
    })
  }, [signerPubkey, dvmPubkey, dvmIdentifier, refresh])

  // Tear down the events sub on unmount.
  useEffect(() => {
    return () => {
      if (eventsSubCloseRef.current) {
        eventsSubCloseRef.current()
        eventsSubCloseRef.current = null
      }
    }
  }, [])

  return {
    events,
    status,
    requesting,
    lastUpdatedAt,
    error,
    refresh,
    hasResult: latestResultId !== null
  }
}
