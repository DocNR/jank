import FollowButton from '@/components/FollowButton'
import RankExplanationPopover from '@/components/RankExplanationPopover'
import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { cn } from '@/lib/utils'
import { useAccountScope } from '@/providers/AccountScope'
import { useColumns } from '@/providers/ColumnsProvider'
import { useFollowList } from '@/providers/UserListsProvider'
import { type TRelatrProfileResult } from '@/lib/relatr'
import { TColumn } from '@/types/column'
import { Compass, Info, RefreshCw, UserMinus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import RelatrInfoBanner from './RelatrInfoBanner'
import { normalizeQuery } from './helpers'
import { useRelatrDiscovery } from './useRelatrDiscovery'

function formatRelative(unixSeconds: number, now: number = Date.now() / 1000): string {
  const diff = Math.max(0, Math.floor(now - unixSeconds))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/**
 * Relatr People column body. Renders ranked authors Relatr's web of trust
 * scores highly for the user-configured topic, with inline Follow buttons +
 * profile drill-down. Snapshot+refresh lifecycle mirrors DvmFeedColumnBody.
 *
 * Why an author list (not a notes feed): Relatr's `search_profiles` returns
 * ranked author entries — `{pubkey, trustScore, rank}` — that's the shape of
 * the data, and the use case ("find new people to follow on a topic") is
 * about people not posts. A notes feed on top of these authors floods on any
 * one prolific author and adds friction-to-follow (note → profile → follow).
 *
 * View-only mode is hard-blocked: search_profiles requires a signed gift
 * wrap, and Relatr's ranking is global (not per-caller), so there's no value
 * in a view-only render.
 */
export default function RelatrDiscoveryColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const scope = useAccountScope()
  const { updateColumnConfig } = useColumns()
  // Hooks must always run in the same order; call useRelatrDiscovery
  // unconditionally before any early returns. It bails internally on missing
  // signer / empty query.
  const state = useRelatrDiscovery(column)
  const { followingSet } = useFollowList()
  const query = normalizeQuery(column.config?.relatrQuery)
  const hideFollows = !!column.config?.relatrHideFollows

  // Apply the discovery-mode filter to the author list directly. Client-side
  // so toggling off restores the unfiltered list without re-querying Relatr.
  const visibleAuthors = useMemo(() => {
    if (!hideFollows) return state.authorResults
    return state.authorResults.filter((r) => !followingSet.has(r.pubkey))
  }, [hideFollows, followingSet, state.authorResults])

  if (!query) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        {t('No topic configured')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="bg-card sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <Compass className="text-muted-foreground size-4" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" dir="auto">
            {query}
          </span>
          <span className="text-muted-foreground text-[10px] leading-tight">
            {scope.viewOnly
              ? t('View-only')
              : state.lastRefreshedAt
                ? t('Updated {{time}}', { time: formatRelative(state.lastRefreshedAt) })
                : state.refreshing
                  ? t('Querying Relatr…')
                  : t('No results yet')}
          </span>
        </div>
        {!scope.viewOnly && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                updateColumnConfig(column.id, { relatrHideFollows: !hideFollows })
              }
              title={
                hideFollows
                  ? t("Showing only people you don't follow")
                  : t('Hide people you follow')
              }
              aria-pressed={hideFollows}
              className={cn(
                'size-7 p-0',
                hideFollows && 'bg-accent text-accent-foreground'
              )}
            >
              <UserMinus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                state.refresh().catch(() => {
                  /* surfaced in state.error */
                })
              }}
              disabled={state.refreshing}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshCw className={`size-3.5 ${state.refreshing ? 'animate-spin' : ''}`} />
              {t('Refresh')}
            </Button>
          </>
        )}
      </div>

      {/* Honesty banner — dismissable */}
      {!column.config?.relatrHideBanner && (
        <RelatrInfoBanner
          onDismiss={() => updateColumnConfig(column.id, { relatrHideBanner: true })}
        />
      )}

      {/* Error chip */}
      {state.error && (
        <div className="text-destructive border-b px-3 py-2 text-xs">{state.error}</div>
      )}

      {/* Body — author list or empty/loading state */}
      {scope.viewOnly ? (
        <div className="text-muted-foreground p-6 text-center text-sm">
          {t('Relatr People requires a paired account')}
        </div>
      ) : state.authorResults.length === 0 ? (
        <div className="text-muted-foreground p-6 text-center text-sm">
          {state.refreshing ? t('Waiting for Relatr…') : t('Click Refresh to query Relatr')}
        </div>
      ) : visibleAuthors.length === 0 ? (
        // Cache populated but all entries filtered out by hide-follows.
        <div className="text-muted-foreground p-6 text-center text-sm">
          {t('All ranked people are already in your follow list.')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {visibleAuthors.map((result) => (
            <RelatrPersonRow key={result.pubkey} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Single author row. Avatar + username already wrap themselves in
 * `SecondaryPageLink` to the profile route, so clicking either drills into a
 * transient profile column. FollowButton wires to the signer's follow list
 * via the existing reactive store (Bucket 1 / `followListService`).
 */
function RelatrPersonRow({ result }: { result: TRelatrProfileResult }) {
  const { t } = useTranslation()
  const trustPct = Math.round(result.trustScore * 100)
  return (
    <div className="hover:bg-muted/30 flex items-start gap-3 border-b px-3 py-3 transition-colors">
      <UserAvatar userId={result.pubkey} size="medium" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Username userId={result.pubkey} className="text-sm font-medium" />
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <RankExplanationPopover pubkey={result.pubkey}>
            <button
              type="button"
              title={t('Click for trust details')}
              className="bg-muted hover:bg-muted/80 inline-flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors"
              aria-label={t('Inspect trust rank')}
            >
              #{result.rank}
              <Info className="size-2.5 opacity-60" />
            </button>
          </RankExplanationPopover>
          <span>
            {trustPct}
            {'% '}
            <span className="opacity-70">trust</span>
          </span>
          {result.exactMatch && (
            <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
              exact match
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <FollowButton pubkey={result.pubkey} />
      </div>
    </div>
  )
}
