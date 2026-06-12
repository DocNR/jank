// src/services/relatr-trust.service.ts
//
// Path B: Relatr-backed trust score lookup, replacing fayan.fetchUserPercentile.
//
// Reads Relatr's openly-published kind-30382 Trusted Assertion events via
// batched nostr subscriptions. Same 0-100 scale as fayan's percentile (no
// rescaling). Same fail-open semantics as fayan (null return → consumer
// allows the user). 3-day TTL on both positive and negative cache entries.
//
// Spec: docs/superpowers/specs/2026-05-25-path-b-fayan-to-relatr-trust-swap-design.md

import { relatrComputeStateAtomFamily, type TComputeState } from '@/atoms/relatr-compute'
import { RELATR_PUBKEY } from '@/lib/relatr'
import DataLoader from 'dataloader'
import { getDefaultStore } from 'jotai'
import { Event } from 'nostr-tools'
import clientService from './client.service'
import contextVmClient from './context-vm-client.service'
import relayListService from './fetchers/relay-list.service'
import indexedDb from './indexed-db.service'

/** Kind for NIP-77 Trusted Assertion events. Relatr publishes one per ranked
 *  target pubkey, parameterized-replaceable by d-tag = target hex. */
export const TRUSTED_ASSERTION_KIND = 30382

/** Wall-clock TTL for both positive and negative cache entries.
 *  After this, the next getRank() for the pubkey re-subscribes. */
export const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

/** Per-batch subscription timeout. Closes the sub after this even if EOSE
 *  hasn't arrived. Tuned for 50-pubkey batches against typical relay latency. */
export const SUBSCRIBE_TIMEOUT_MS = 5_000

/** DataLoader batch settings. */
export const BATCH_MAX_SIZE = 50
export const BATCH_WINDOW_MS = 100

/** Shape stored in the in-memory + IndexedDB cache. `rank: null` is the
 *  negative-cache entry — we asked Relatr, no event came back. Distinguishes
 *  "haven't asked yet" (Map miss) from "asked, unranked" (rank: null). */
export type TRelatrTrustEntry = {
  rank: number | null
  computedAt: number // unix seconds — for both positive (event.created_at) and negative (Date.now()/1000)
}

export interface IRelatrTrustService {
  /**
   * Read the rank Relatr has assigned to a target pubkey.
   * Returns 0-100 (matches fayan's percentile scale) or null when Relatr
   * has no TA for this pubkey AFTER a fetch (fail-open at consumer layer).
   */
  getRank(pubkey: string): Promise<number | null>

  /**
   * Prime the cache with a known rank — e.g. from the Relatr People column's
   * search_profiles results, which carry trust scores. Skips the network round
   * trip when the consumer later calls getRank() for the same pubkey.
   */
  primeRank(pubkey: string, rank: number, computedAt: number): void

  /**
   * Synchronous lookup for the popover's cache-pin check. Returns the cached
   * rank (number) or null (negative cache) or undefined (not cached yet).
   */
  peekRank(pubkey: string): number | null | undefined

  /**
   * Proactively populate the cache for many pubkeys (e.g. the user's kind-3
   * follow list). Dedups, skips entries already fresh in cache, and lets the
   * existing DataLoader batch the rest. Fire-and-forget at call sites.
   */
  warmRanks(pubkeys: string[]): Promise<void>

  /**
   * Fire calculate_trust_score MCP call in the background. Updates the Jotai
   * atomFamily so badges + popovers re-render reactively as state transitions
   * ('idle' → 'pending' → 'idle' on success / 'failed' on error). Dedups
   * concurrent calls for the same pubkey.
   */
  triggerCompute(pubkey: string, signerPubkey: string): void

  /**
   * Test-only / diagnostic subscription for compute state transitions.
   * Production consumers should read via relatrComputeStateAtomFamily(pubkey).
   */
  onComputeStateChange(pubkey: string, listener: (s: TComputeState) => void): () => void

  /** Test-only: clear all in-memory state. */
  _resetForTests(): void
}

// ────────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────────

class RelatrTrustService implements IRelatrTrustService {
  private cache = new Map<string, TRelatrTrustEntry>()
  private hydratedFromIdb = false
  private hydratePromise: Promise<void> | null = null

  /** True after fetchRelayList has thrown once — short-circuits subsequent
   *  calls to return null without retrying for the rest of the session. */
  private relayLookupFailed = false

  /** In-flight compute dedup. Keyed by pubkey. */
  private computeInFlight = new Map<string, Promise<void>>()

  /** Optional subscribers for tests/diagnostics — emits state transitions. */
  private computeListeners = new Map<string, Set<(s: TComputeState) => void>>()

  private loader = new DataLoader<string, number | null>(
    async (pubkeys) => this.batchFetch(pubkeys),
    {
      maxBatchSize: BATCH_MAX_SIZE,
      batchScheduleFn: (callback) => setTimeout(callback, BATCH_WINDOW_MS),
      cacheKeyFn: (k) => k
    }
  )

  async getRank(pubkey: string): Promise<number | null> {
    await this.ensureHydrated()
    const cached = this.cache.get(pubkey)
    if (cached && Date.now() - cached.computedAt * 1000 < CACHE_TTL_MS) {
      return cached.rank
    }
    if (this.relayLookupFailed) {
      return null
    }
    this.loader.clear(pubkey)
    return this.loader.load(pubkey)
  }

  primeRank(pubkey: string, rank: number, computedAt: number): void {
    const entry: TRelatrTrustEntry = { rank, computedAt }
    this.cache.set(pubkey, entry)
    indexedDb.putRelatrTrust(pubkey, entry).catch(() => {})
  }

  peekRank(pubkey: string): number | null | undefined {
    const cached = this.cache.get(pubkey)
    if (!cached) return undefined
    if (Date.now() - cached.computedAt * 1000 >= CACHE_TTL_MS) return undefined
    return cached.rank
  }

  onComputeStateChange(pubkey: string, listener: (s: TComputeState) => void): () => void {
    const set = this.computeListeners.get(pubkey) ?? new Set()
    set.add(listener)
    this.computeListeners.set(pubkey, set)
    return () => {
      set.delete(listener)
    }
  }

  triggerCompute(pubkey: string, signerPubkey: string): void {
    if (this.computeInFlight.has(pubkey)) return // dedup

    const store = getDefaultStore()
    const stateAtom = relatrComputeStateAtomFamily(pubkey)
    const setState = (s: TComputeState) => {
      store.set(stateAtom, s)
      this.computeListeners.get(pubkey)?.forEach((l) => l(s))
    }

    setState('pending')

    const promise = (async () => {
      try {
        type McpScore = {
          trustScore: {
            sourcePubkey: string
            targetPubkey: string
            score: number
            components: {
              socialDistance: number
              normalizedDistance: number
              distanceWeight: number
              validators: Record<string, { score: number; description: string }>
            }
            computedAt: number
          }
          computationTimeMs: number
        }
        const result = await contextVmClient.callTool<McpScore>(
          RELATR_PUBKEY,
          'calculate_trust_score',
          { targetPubkey: pubkey },
          { signerPubkey, timeoutMs: 120_000 } // cold computes can take 30-90s
        )
        if (!result.ok) {
          console.warn('[relatrTrust] compute failed', pubkey.slice(0, 16), result.error)
          setState('failed')
          return
        }
        const rank = Math.round(result.structuredContent.trustScore.score * 100)
        const computedAt = result.structuredContent.trustScore.computedAt
        const entry: TRelatrTrustEntry = { rank, computedAt }
        this.cache.set(pubkey, entry)
        indexedDb.putRelatrTrust(pubkey, entry).catch(() => {})
        console.debug('[relatrTrust] compute success', { pubkey: pubkey.slice(0, 16), rank })
        setState('idle')
      } catch (err) {
        console.warn('[relatrTrust] compute threw', pubkey.slice(0, 16), err)
        setState('failed')
      } finally {
        this.computeInFlight.delete(pubkey)
      }
    })()
    this.computeInFlight.set(pubkey, promise)
  }

  async warmRanks(pubkeys: string[]): Promise<void> {
    if (pubkeys.length === 0) return
    await this.ensureHydrated()
    const seen = new Set<string>()
    for (const pubkey of pubkeys) {
      if (seen.has(pubkey)) continue
      seen.add(pubkey)
      // peekRank returns undefined only when not cached or expired; a fresh
      // number OR a fresh negative (null) both count as "already warm".
      if (this.peekRank(pubkey) !== undefined) continue
      // getRank enqueues into the shared DataLoader (batched 50 / 100ms).
      this.getRank(pubkey).catch(() => {})
    }
  }

  _resetForTests(): void {
    this.cache.clear()
    this.hydratedFromIdb = false
    this.hydratePromise = null
    this.relayLookupFailed = false
    this.loader.clearAll()
    this.computeInFlight.clear()
    this.computeListeners.clear()
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydratedFromIdb) return
    if (this.hydratePromise) return this.hydratePromise
    this.hydratePromise = (async () => {
      try {
        await indexedDb.iterateRelatrTrust((pubkey, value) => {
          if (Date.now() - value.computedAt * 1000 < CACHE_TTL_MS) {
            this.cache.set(pubkey, value)
          }
        })
      } catch {
        // IDB unavailable (happy-dom test env, SSR) — start with empty cache.
      }
      this.hydratedFromIdb = true
    })()
    return this.hydratePromise
  }

  private async batchFetch(pubkeys: readonly string[]): Promise<(number | null)[]> {
    const startedAt = Date.now()
    console.debug('[relatrTrust] batch fired', { count: pubkeys.length })

    let relays: string[]
    try {
      const list = await relayListService.fetchRelayList(RELATR_PUBKEY)
      relays = Array.from(new Set([...(list.read ?? []), ...(list.write ?? [])]))
      if (relays.length === 0) throw new Error('No relays in Relatr NIP-65 list')
    } catch (err) {
      console.warn('[relatrTrust] failed to resolve Relatr relays — failing open', err)
      this.relayLookupFailed = true
      return pubkeys.map(() => null)
    }

    const results = new Map<string, number>()

    let eoseResolve: (() => void) | undefined
    const completion = new Promise<void>((resolve) => {
      eoseResolve = resolve
    })

    const sub = clientService.subscribe(
      relays,
      {
        kinds: [TRUSTED_ASSERTION_KIND],
        authors: [RELATR_PUBKEY],
        '#d': [...pubkeys]
      },
      {
        onevent: (evt: Event) => {
          const dTag = evt.tags.find((t) => t[0] === 'd')?.[1]
          const rankTag = evt.tags.find((t) => t[0] === 'rank')?.[1]
          if (!dTag || rankTag === undefined) return
          const parsed = parseInt(rankTag, 10)
          if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) return
          results.set(dTag, parsed)
        },
        oneose: () => {
          eoseResolve?.()
        }
      }
    )

    // Race EOSE against 5s timeout.
    await Promise.race([
      completion,
      new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS))
    ])
    sub.close()

    // Persist + cache every pubkey in the batch — hits get their rank,
    // misses get the negative-cache entry.
    const now = Math.floor(Date.now() / 1000)
    const ranks = pubkeys.map((pubkey) => {
      const rank = results.get(pubkey) ?? null
      const entry: TRelatrTrustEntry = { rank, computedAt: now }
      this.cache.set(pubkey, entry)
      indexedDb.putRelatrTrust(pubkey, entry).catch(() => {})
      return rank
    })

    const hits = results.size
    console.debug('[relatrTrust] batch complete', {
      count: pubkeys.length,
      hits,
      misses: pubkeys.length - hits,
      durationMs: Date.now() - startedAt
    })

    return ranks
  }
}

const instance = new RelatrTrustService()
export default instance
