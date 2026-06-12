// src/components/RankExplanationPopover/BalancedContent.tsx
//
// BALANCED tier render of the rank-explanation popover. Shows social distance,
// distance weight, validator breakdown, freshness, and the anchor disclosure
// footer (Relatr's root pubkey + website). Data sourced from one
// calculate_trust_score MCP call, IndexedDB-cached with rank-pinned
// invalidation.

import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TRelatrStats } from '@/services/relatr-metadata.service'

export type TBalancedScore = {
  score: number // 0-1
  computedAt: number // unix seconds
  components: {
    socialDistance: number
    normalizedDistance: number
    distanceWeight: number
    validators: Record<string, { score: number; description: string }>
  }
}

type Props = {
  rank: number
  data: TBalancedScore | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onExpand: () => void
  maximalExpanded: boolean
  stats: TRelatrStats | null
}

function formatRelative(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function BalancedContent({
  rank,
  data,
  loading,
  error,
  onRetry,
  onExpand,
  maximalExpanded,
  stats
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">
          {t('Trust rank')}: <span className="tabular-nums">{rank}</span>
        </div>
        {data && (
          <span className="text-muted-foreground text-[10px]">
            {t('Computed {{time}}', { time: formatRelative(data.computedAt) })}
          </span>
        )}
      </div>

      <div className="bg-border h-px" />

      {/* Body: loading / error / data */}
      {loading && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          {t('Fetching explanation…')}
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col gap-2">
          <div className="text-destructive text-xs">{error}</div>
          {/* Self-diagnosis hint for the most common cause: corporate / hotel /
              school wifi blocking direct WebSocket connections to single-host
              Nostr relays. Validated 2026-05-26 by a real-user case where a
              guest network blocked relay.contextvm.org specifically; cellular
              hotspot worked. Generic enough to be useful even when the error
              has a different root cause (rare). */}
          <p className="text-muted-foreground text-[10px] leading-snug">
            {t(
              'If you are on corporate, hotel, or guest wifi, those networks sometimes block direct connections to Nostr relays. Try a different network if this persists.'
            )}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry} className="h-7 self-start text-xs">
            {t('Retry')}
          </Button>
        </div>
      )}

      {data && !loading && !error && (
        <>
          {/* Social distance */}
          <div className="flex flex-col gap-1 text-xs">
            <div>
              {t("Social distance: {{hops}} hops from Relatr's root", {
                hops: data.components.socialDistance
              })}
            </div>
            <div className="text-muted-foreground">
              {t('Distance accounts for {{pct}}% of score', {
                pct: Math.round(data.components.distanceWeight * 100)
              })}
            </div>
          </div>

          {/* Validators */}
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium">{t('Validators')}:</div>
            <div className="flex flex-col gap-1">
              {Object.entries(data.components.validators).map(([name, val]) => (
                <div key={name} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <div className="flex-1 truncate">{val.description}</div>
                  <div className="text-muted-foreground tabular-nums">{val.score.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="bg-border h-px" />

      {/* Anchor disclosure footer — always visible */}
      <div className="text-muted-foreground flex flex-col gap-1 text-[10px]">
        {stats?.socialGraph.rootPubkey ? (
          <div className="flex items-center gap-1">
            {t('Trust graph anchored at')}
            <UserAvatar userId={stats.socialGraph.rootPubkey} size="tiny" />
            <Username userId={stats.socialGraph.rootPubkey} className="font-medium" />
          </div>
        ) : (
          <Skeleton className="h-3 w-32" />
        )}
        <div className="flex items-center gap-1">
          {t('Source')}: Relatr
          <a
            href="https://relatr.contextvm.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-0.5 hover:underline"
          >
            relatr.contextvm.org
            <ExternalLink className="size-2.5" />
          </a>
        </div>
      </div>

      {/* Expand affordance */}
      {data && !loading && !error && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onExpand}
          className="h-7 self-start text-xs"
          disabled={maximalExpanded}
        >
          {maximalExpanded ? t('Hide technical details ↑') : t('Show technical details ↓')}
        </Button>
      )}
    </div>
  )
}
