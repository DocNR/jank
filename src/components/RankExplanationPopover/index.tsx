// src/components/RankExplanationPopover/index.tsx
//
// Popover container for trust-rank explanation. Manages:
// - Rank lookup (via relatrTrust.getRank, cached)
// - BALANCED tier fetch (calculate_trust_score MCP, rank-pinned IndexedDB cache)
// - MAXIMAL expand (stats() + plugins_list() MCP, IndexedDB cache)
// - View-only mode (signingIdentity null → no MCP, "Sign in to inspect" message)
// - Concurrent open dedup (module-scoped in-flight Map)

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { relatrComputeStateAtomFamily } from '@/atoms/relatr-compute'
import indexedDb from '@/services/indexed-db.service'
import contextVmClient from '@/services/context-vm-client.service'
import { RELATR_PUBKEY } from '@/lib/relatr'
import relatrMetadata, {
  type TRelatrPlugin,
  type TRelatrStats
} from '@/services/relatr-metadata.service'
import relatrTrust from '@/services/relatr-trust.service'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import BalancedContent, { type TBalancedScore } from './BalancedContent'
import MaximalContent from './MaximalContent'
import NoRankContent from './NoRankContent'

type CachedComponents = {
  data: TBalancedScore
  sourceRankAtCacheTime: number
  cachedAt: number // ms
}

const COMPONENT_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

// Module-scoped in-flight dedup map: pubkey → promise. Two simultaneous
// popover opens for the same pubkey share one MCP call.
const inFlight = new Map<string, Promise<TBalancedScore | null>>()

async function loadBalanced(
  pubkey: string,
  signerPubkey: string,
  currentRank: number
): Promise<TBalancedScore | null> {
  // 1. Cache check (rank-pinned + TTL)
  const cached = await indexedDb.getRelatrTrustComponents<CachedComponents>(pubkey)
  if (
    cached &&
    cached.sourceRankAtCacheTime === currentRank &&
    Date.now() - cached.cachedAt < COMPONENT_TTL_MS
  ) {
    return cached.data
  }

  // 2. In-flight dedup
  const existing = inFlight.get(pubkey)
  if (existing) return existing

  // 3. Fresh MCP fetch
  const promise = (async () => {
    type McpScore = {
      trustScore: {
        sourcePubkey: string
        targetPubkey: string
        score: number
        computedAt: number
        components: TBalancedScore['components']
      }
      computationTimeMs: number
    }
    const result = await contextVmClient.callTool<McpScore>(
      RELATR_PUBKEY,
      'calculate_trust_score',
      { targetPubkey: pubkey },
      { signerPubkey }
    )
    if (!result.ok) return null
    const data: TBalancedScore = {
      score: result.structuredContent.trustScore.score,
      computedAt: result.structuredContent.trustScore.computedAt,
      components: result.structuredContent.trustScore.components
    }
    const envelope: CachedComponents = {
      data,
      sourceRankAtCacheTime: currentRank,
      cachedAt: Date.now()
    }
    indexedDb.putRelatrTrustComponents(pubkey, envelope).catch(() => {})
    return data
  })()
  inFlight.set(pubkey, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(pubkey)
  }
}

type Props = {
  children: ReactNode
  pubkey: string
}

export default function RankExplanationPopover({ children, pubkey }: Props) {
  const { t } = useTranslation()
  const scope = useAccountScopeOptional()
  const signerPubkey = scope?.signingIdentity ?? null
  const viewOnly = signerPubkey === null

  const [open, setOpen] = useState(false)
  const [rank, setRank] = useState<number | null>(null)
  const computeState = useAtomValue(relatrComputeStateAtomFamily(pubkey))
  const [balanced, setBalanced] = useState<TBalancedScore | null>(null)
  const [balancedLoading, setBalancedLoading] = useState(false)
  const [balancedError, setBalancedError] = useState<string | null>(null)
  const [maximalExpanded, setMaximalExpanded] = useState(false)
  const [maximalLoading, setMaximalLoading] = useState(false)
  const [maximalError, setMaximalError] = useState<string | null>(null)
  const [stats, setStats] = useState<TRelatrStats | null>(null)
  const [plugins, setPlugins] = useState<TRelatrPlugin[] | null>(null)

  const loadBalancedFor = useCallback(
    async (currentRank: number) => {
      if (viewOnly || !signerPubkey) return
      setBalancedLoading(true)
      setBalancedError(null)
      try {
        const data = await loadBalanced(pubkey, signerPubkey, currentRank)
        if (data === null) {
          setBalancedError(t("Couldn't reach Relatr"))
        } else {
          setBalanced(data)
        }
      } catch (err) {
        setBalancedError(err instanceof Error ? err.message : t("Couldn't reach Relatr"))
      } finally {
        setBalancedLoading(false)
      }
    },
    [pubkey, signerPubkey, viewOnly, t]
  )

  useEffect(() => {
    if (!open) return
    let active = true
    ;(async () => {
      const peeked = relatrTrust.peekRank(pubkey)
      const liveRank = peeked !== undefined ? peeked : await relatrTrust.getRank(pubkey)
      if (!active) return
      setRank(liveRank)
      if (liveRank !== null && !viewOnly) {
        loadBalancedFor(liveRank)
      }
      // Always load stats for the anchor footer (signed; cached for 3d).
      if (signerPubkey) {
        relatrMetadata.getStats(signerPubkey).then((s) => {
          if (active) setStats(s)
        })
      }
    })()
    return () => {
      active = false
    }
    // computeState in deps so the popover re-reads the rank after a
    // background compute resolves (pending → idle transitions to BALANCED).
  }, [open, pubkey, signerPubkey, viewOnly, loadBalancedFor, computeState])

  const handleExpand = useCallback(async () => {
    if (!signerPubkey || maximalExpanded) return
    setMaximalExpanded(true)
    setMaximalLoading(true)
    setMaximalError(null)
    try {
      const [s, p] = await Promise.all([
        relatrMetadata.getStats(signerPubkey),
        relatrMetadata.getPlugins(signerPubkey)
      ])
      if (s === null || p === null) {
        setMaximalError(t('Failed to load details'))
      } else {
        setStats(s)
        setPlugins(p)
      }
    } catch (err) {
      setMaximalError(err instanceof Error ? err.message : t('Failed to load details'))
    } finally {
      setMaximalLoading(false)
    }
  }, [signerPubkey, maximalExpanded, t])

  // Reset transient state when popover closes — but keep cached IDB entries.
  useEffect(() => {
    if (!open) {
      setMaximalExpanded(false)
      setMaximalError(null)
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[340px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
        sideOffset={6}
        collisionPadding={8}
      >
        {viewOnly ? (
          <div className="text-muted-foreground p-4 text-center text-xs">
            {rank !== null && (
              <div className="text-foreground mb-2 text-sm font-medium">
                {t('Trust rank')}: <span className="tabular-nums">{rank}</span>
              </div>
            )}
            {t('Sign in to inspect trust source')}
          </div>
        ) : rank === null ? (
          <NoRankContent pubkey={pubkey} signerPubkey={signerPubkey} />
        ) : (
          <>
            <BalancedContent
              rank={rank}
              data={balanced}
              loading={balancedLoading}
              error={balancedError}
              onRetry={() => loadBalancedFor(rank)}
              onExpand={handleExpand}
              maximalExpanded={maximalExpanded}
              stats={stats}
            />
            {maximalExpanded && (
              <MaximalContent
                data={balanced}
                stats={stats}
                plugins={plugins}
                loading={maximalLoading}
                error={maximalError}
              />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
