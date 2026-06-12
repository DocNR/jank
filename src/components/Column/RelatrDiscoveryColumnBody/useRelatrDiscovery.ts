import {
  isRelatrSearchProfilesResult,
  RELATR_PUBKEY,
  type TRelatrProfileResult,
  type TRelatrSearchProfilesResult
} from '@/lib/relatr'
import { useAccountScope } from '@/providers/AccountScope'
import { useColumns } from '@/providers/ColumnsProvider'
import contextVmClient from '@/services/context-vm-client.service'
import relatrTrust from '@/services/relatr-trust.service'
import { TColumn } from '@/types/column'
import { useCallback, useEffect, useRef, useState } from 'react'
import { extractAuthorResults, normalizeQuery, shouldAutoRun } from './helpers'

export type TRelatrDiscoveryState = {
  /** Ranked author entries (pubkey + trustScore + rank + exactMatch?) returned
   *  by the most recent successful query, in rank order. */
  authorResults: TRelatrProfileResult[]
  /** True between starting a `callTool` and its resolution / rejection. */
  refreshing: boolean
  /** unix seconds of the latest successful query, or null when none yet. */
  lastRefreshedAt: number | null
  /** Surfaces network / server / shape-validation errors for the inline chip. */
  error: string | null
  /** Whether we currently have any cached or fresh result. */
  hasResult: boolean
  /** Manually trigger a fresh search_profiles call. */
  refresh: () => Promise<void>
}

/**
 * Track A defaults from Phase 0:
 *  - `limit: 50` — Relatr's API returns up to 50 by default; the spec calls
 *    for a single-page snapshot.
 *  - `extendToNostr: true` — broadens beyond Relatr's ~12k cached profiles by
 *    falling through to Nostr name-search. Less surprising empty results for
 *    long-tail topics.
 */
const SEARCH_DEFAULT_LIMIT = 50
const SEARCH_EXTEND_TO_NOSTR = true

/**
 * Drives a relatr-discovery column. Owns the snapshot+refresh lifecycle:
 *
 *  - Hydrates from `column.config.relatrLastResults` on mount so reloads
 *    render the same author list instantly without re-calling Relatr.
 *  - Auto-runs ONE `search_profiles` call on first mount when no cache exists
 *    + the column has a query + a paired signer. Microtask-queued so the
 *    component effect order is deterministic.
 *  - Resets cache + auto-run guard when the column's query changes (user
 *    re-creates with a different topic — v1 doesn't support inline editing).
 *  - `refresh()` re-runs the query and replaces the cache.
 *
 * View-only mode (signingIdentity === null) is hard-blocked at the body level;
 * this hook bails internally with an error if called without a signer to
 * defend the contract.
 */
export function useRelatrDiscovery(column: TColumn): TRelatrDiscoveryState {
  const scope = useAccountScope()
  const { updateColumnConfig } = useColumns()
  const signerPubkey = scope.signingIdentity
  const query = normalizeQuery(column.config?.relatrQuery)

  const [authorResults, setAuthorResults] = useState<TRelatrProfileResult[]>(
    column.config?.relatrLastResults ?? []
  )
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(
    column.config?.relatrLastRefreshedAt ?? null
  )
  const [error, setError] = useState<string | null>(null)

  // Auto-run guard. Snapshotted to a ref so a config write (which triggers
  // a re-render through our own setState) doesn't reset it.
  const autoRanRef = useRef(false)
  // Tracks the last query value we observed; lets us reset state when the
  // user changes the query without a remount.
  const lastQueryRef = useRef<string>(query)

  const refresh = useCallback(async () => {
    if (!signerPubkey) {
      setError('No paired signer')
      return
    }
    if (!query) {
      setError('No topic configured')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const result = await contextVmClient.callTool<TRelatrSearchProfilesResult>(
        RELATR_PUBKEY,
        'search_profiles',
        {
          query,
          limit: SEARCH_DEFAULT_LIMIT,
          extendToNostr: SEARCH_EXTEND_TO_NOSTR
        },
        { signerPubkey }
      )
      if (!result.ok) {
        setError(result.error.message)
        setRefreshing(false)
        return
      }
      if (!isRelatrSearchProfilesResult(result.structuredContent)) {
        setError('Unexpected response shape from Relatr')
        setRefreshing(false)
        return
      }
      const results = extractAuthorResults(result.structuredContent)
      const now = Math.floor(Date.now() / 1000)
      setAuthorResults(results)
      // Prime relatrTrust cache with these ranks (saves a re-fetch when
      // any of these pubkeys later flows through a feed's trust filter
      // or a popover open).
      results.forEach((r) => {
        relatrTrust.primeRank(r.pubkey, Math.round(r.trustScore * 100), now)
      })
      setLastRefreshedAt(now)
      setRefreshing(false)
      updateColumnConfig(column.id, {
        relatrLastResults: results,
        relatrLastRefreshedAt: now
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to call Relatr')
      setRefreshing(false)
    }
  }, [signerPubkey, query, column.id, updateColumnConfig])

  // Auto-run on first mount IF no cache + has query + has signer. Microtask-
  // queued so the rest of the body's setup (including the column's React tree
  // settling) lands before the network call.
  useEffect(() => {
    if (autoRanRef.current) return
    if (!shouldAutoRun({ query, signerPubkey, hasCache: authorResults.length > 0 })) return
    autoRanRef.current = true
    queueMicrotask(() => {
      refresh().catch((err) => console.error('[Relatr] auto-run failed', err))
    })
    // We deliberately exclude `refresh` / `authorResults` from the deps. The
    // ref + shouldAutoRun() gate the one-shot; including the closure would
    // re-arm it on every cache write.
  }, [signerPubkey, query])

  // Reset cache + auto-run guard when the column's query changes (user
  // re-creates the column with a different topic — v1 doesn't support inline
  // editing, but this guards future iterations + remount-driven query changes).
  useEffect(() => {
    if (lastQueryRef.current !== query) {
      lastQueryRef.current = query
      setAuthorResults([])
      setLastRefreshedAt(null)
      autoRanRef.current = false
    }
  }, [query])

  return {
    authorResults,
    refreshing,
    lastRefreshedAt,
    error,
    refresh,
    hasResult: authorResults.length > 0
  }
}
