import NoteCard from '@/components/NoteCard'
import { VirtualNoteList } from '@/components/NoteList/VirtualNoteList'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { useAccountScope } from '@/providers/AccountScope'
import { TColumn } from '@/types/column'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import DvmFeedStatusBanner from './DvmFeedStatusBanner'
import { useDvmFeed } from './useDvmFeed'

function formatRelative(unixSeconds: number, now: number = Date.now() / 1000): string {
  const diff = Math.max(0, Math.floor(now - unixSeconds))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/**
 * Single-DVM feed column. Renders the most recent kind-6300 result from the
 * configured DVM as a virtualized note feed, plus a top toolbar with a manual
 * "Refresh" button and any active kind-7000 status banner.
 *
 * Lifecycle (see useDvmFeed for details):
 *   1. First mount with no cache → publishes a kind-5300 automatically (once).
 *   2. Subsequent reloads → renders from `column.config.lastResultEventId`
 *      cache without re-publishing.
 *   3. User clicks Refresh → publishes a fresh kind-5300, waits up to 30s.
 *
 * View-only mode is hard-blocked: a DVM feed requires a paired signer to
 * personalize the request (the `["p", pubkey]` tag defaults to signer pubkey).
 * Falls through to the AccountScope's natural empty state otherwise.
 */
export default function DvmFeedColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const scope = useAccountScope()
  const dvmPubkey = column.config?.dvmPubkey
  const dvmIdentifier = column.config?.dvmIdentifier

  // Hooks must always run in the same order, so call useDvmFeed unconditionally;
  // the early-returns below short-circuit rendering, not hook execution. The
  // hook bails internally on missing pointer / signer.
  const feed = useDvmFeed(column)

  if (!dvmPubkey || !dvmIdentifier) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        {t('No DVM configured')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-card sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <UserAvatar userId={dvmPubkey} size="small" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Username
            userId={dvmPubkey}
            className="truncate text-sm font-medium leading-tight"
            withoutSkeleton
          />
          <span className="text-muted-foreground text-[10px] leading-tight">
            {scope.viewOnly
              ? t('View-only')
              : feed.lastUpdatedAt
                ? t('Updated {{time}}', { time: formatRelative(feed.lastUpdatedAt) })
                : feed.requesting
                  ? t('Requesting feed…')
                  : t('No feed yet')}
          </span>
        </div>
        {!scope.viewOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              feed.refresh().catch(() => {
                // Hook surfaces the error in state — nothing else to do.
              })
            }}
            disabled={feed.requesting}
            className="h-7 gap-1.5 text-xs"
          >
            <RefreshCw
              className={`size-3.5 ${feed.requesting ? 'animate-spin' : ''}`}
            />
            {t('Refresh')}
          </Button>
        )}
      </div>

      {feed.status && <DvmFeedStatusBanner status={feed.status} />}
      {feed.error && (
        <div className="text-destructive border-b px-3 py-2 text-xs">{feed.error}</div>
      )}

      {scope.viewOnly ? (
        <div className="text-muted-foreground p-6 text-center text-sm">
          {t('DVM feeds require a paired account')}
        </div>
      ) : feed.events.length === 0 ? (
        <div className="text-muted-foreground p-6 text-center text-sm">
          {feed.requesting
            ? t('Waiting for DVM results…')
            : feed.hasResult
              ? t('DVM returned no events')
              : t('Click Refresh to request a feed')}
        </div>
      ) : (
        <VirtualNoteList
          items={feed.events}
          renderItem={(event) => <NoteCard key={event.id} event={event} />}
        />
      )}
    </div>
  )
}
