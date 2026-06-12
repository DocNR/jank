import PostEditor from '@/components/PostEditor/LazyPostEditor'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAccounts } from '@/providers/AccountsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { TColumn } from '@/types/column'
import { notificationUnreadCountAtom } from '@/atoms/notification-unread-count'
import { useAtomValue } from 'jotai'
import { Pin, PinOff, X } from 'lucide-react'
import { HTMLAttributes, MouseEvent as ReactMouseEvent, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ColumnHeaderMenu from './ColumnHeaderMenu'
import SigningIndicator from './SigningIndicator'
import { signingState } from './signing-state'

/**
 * Column header. Adaptive layout:
 * - matched / view-only columns: a single row —
 *   avatar · label · [signing chip] · ——— · 📌 · ⋯ · ✕
 * - mismatched ("loud") columns: two rows — row 1 carries identity + controls,
 *   row 2 is the full-width "Acting as" signing indicator so it can never be
 *   squeezed or clipped.
 *
 * Pin/unpin stays an inline button (the icon is the pin-state indicator —
 * lit when pinned, muted when transient). Compose + the list-style toggle
 * live in the ⋯ ColumnHeaderMenu.
 */
const ColumnHeader = memo(function ColumnHeader({
  column,
  onRemove,
  onPin,
  onUnpin,
  onScrollToTop,
  dragHandleProps,
  isFocused,
  effectiveListStyle,
  onToggleListStyle,
  wotOnly,
  onToggleWotOnly
}: {
  column: TColumn
  onRemove: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  /** Scrolls the column body to the top. Fired on a plain title-bar click
   * (not on the inner controls or a drag). */
  onScrollToTop: () => void
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
  /** True when this column is the focused (spotlight) column in beam mode.
   * Drives the X button's tooltip ("Exit Focus" vs "Remove column"). */
  isFocused?: boolean
  /** List-style columns only (see LIST_STYLE_COLUMN_TYPES): the effective
   * (per-column override ?? global) list style, plus its toggle handler.
   * Both undefined for column types without the toggle. */
  effectiveListStyle?: 'compact' | 'detailed'
  onToggleListStyle?: () => void
  /** WoT-toggle columns only (see WOT_TOGGLE_COLUMN_TYPES): current
   *  `config.wotOnly` value + the toggle handler. Both undefined for column
   *  types without the toggle. */
  wotOnly?: boolean
  onToggleWotOnly?: () => void
}) {
  const { t } = useTranslation()
  const { density } = useUserPreferences()
  const { checkLogin, pubkey: activeAccountPubkey } = useNostr()
  const { accounts } = useAccounts()
  const isCompact = density === 'compact'
  const [composeOpen, setComposeOpen] = useState(false)

  // For profile columns the baseline depends on whether viewContext is one of
  // YOUR paired accounts (own profile) or a foreign pubkey (someone else's):
  //   - own profile  → baseline = viewContext (default).  Signing as yourself
  //                    when viewing yourself is the natural state → quiet.
  //   - foreign      → baseline = global active.  viewContext is the subject,
  //                    not you, so the indicator instead asks "are you signing
  //                    as your default self?" — quiet when yes, loud when
  //                    you've overridden to an alt paired account.
  // Every non-profile column keeps the default (viewContext-based) check.
  const viewContextIsPaired = accounts.some((a) => a.pubkey === column.viewContext)
  const baselinePubkey =
    column.type === 'profile' && !viewContextIsPaired && activeAccountPubkey
      ? activeAccountPubkey
      : undefined
  const state = signingState(column.viewContext, column.signingIdentity, baselinePubkey)
  const isLoud = state === 'loud'
  // The view @handle shows on row 1 EXCEPT in the quiet state, where the
  // signing chip already names that same account.
  const showHandle = state !== 'quiet'
  // Compose is hidden on view-only columns (no signer to compose with).
  const showCompose = column.signingIdentity !== null
  const showListStyleToggle = !!effectiveListStyle && !!onToggleListStyle
  const showWotToggle = !!onToggleWotOnly
  // Don't render the ⋯ trigger when the menu would be empty (a view-only,
  // non-list-style column — e.g. a foreign-pubkey Home column).
  const showMenu = showCompose || showListStyleToggle || showWotToggle

  // Plain title-bar click scrolls the column to top. Ignore clicks that
  // originate on an interactive control (pin / menu / X) or on the
  // avatar/username (which navigate to a profile) — those keep their own
  // behavior. A drag is filtered upstream by the 6px sensor activation
  // constraint, so onClick only fires on a stationary click.
  const handleHeaderClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    onScrollToTop()
  }

  return (
    <div
      {...dragHandleProps}
      onClick={handleHeaderClick}
      className={cn(
        'border-border bg-muted/40 cursor-grab border-b px-3 active:cursor-grabbing',
        isCompact ? 'py-1' : 'py-2'
      )}
    >
      {/* Row 1 — identity + controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserAvatar userId={column.viewContext} size="small" />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-title min-w-0 line-clamp-2 leading-tight font-medium">
              {columnLabel(column, t)}
            </span>
            {showHandle && (
              <Username
                userId={column.viewContext}
                className="text-muted-foreground text-micro min-w-0 truncate leading-tight"
                withoutSkeleton
              />
            )}
          </div>
          {column.type === 'notifications' && <NotificationCountBadge columnId={column.id} />}
          {/* Quiet / view-only signing chip rides inline on row 1. The loud
              chip drops to its own row 2 (below) so it can't be squeezed. */}
          {!isLoud && (
            <SigningIndicator
              viewContext={column.viewContext}
              signingIdentity={column.signingIdentity}
              baselinePubkey={baselinePubkey}
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {column.transient ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-9 sm:size-7"
                  aria-label={t('Pin column')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onPin(column.id)}
                >
                  <Pin className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('Pin column')}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-primary size-9 sm:size-7"
                  aria-label={t('Unpin column')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onUnpin(column.id)}
                >
                  <PinOff className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('Unpin column')}</TooltipContent>
            </Tooltip>
          )}
          {showMenu && (
            <ColumnHeaderMenu
              showCompose={showCompose}
              onCompose={
                showCompose ? () => checkLogin(() => setComposeOpen(true)) : () => {}
              }
              effectiveListStyle={effectiveListStyle}
              onToggleListStyle={onToggleListStyle}
              wotOnly={wotOnly}
              onToggleWotOnly={onToggleWotOnly}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground ms-1 size-9 sm:size-7"
                aria-label={isFocused ? t('Exit Focus Beam') : t('Remove column')}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(column.id)}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFocused ? t('Exit Focus Beam') : t('Remove column')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2 — full-width "Acting as" indicator, only when the column signs
          as a different account. */}
      {isLoud && (
        <div className="mt-1 ps-1">
          <SigningIndicator
            viewContext={column.viewContext}
            signingIdentity={column.signingIdentity}
            baselinePubkey={baselinePubkey}
          />
        </div>
      )}

      <PostEditor
        open={composeOpen}
        setOpen={setComposeOpen}
        accountId={column.signingIdentity ?? undefined}
      />
    </div>
  )
})

export default ColumnHeader

function NotificationCountBadge({ columnId }: { columnId: string }) {
  const count = useAtomValue(notificationUnreadCountAtom)[columnId] ?? 0
  if (count <= 0) return null
  return (
    <span className="bg-primary text-primary-foreground ms-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  )
}

// Exported for dispatch-coverage.spec.ts — every TColumnType must have a case
// here or the header falls back to "Unknown column".
export function columnLabel(column: TColumn, t: (k: string) => string): string {
  switch (column.type) {
    case 'articles':
      return t('Articles')
    case 'home':
      return t('Home')
    case 'notifications':
      return t('Notifications')
    case 'bookmarks':
      return t('Bookmarks')
    case 'favorites':
      return t('Favorites')
    case 'profile':
      return t('Profile')
    case 'hashtag': {
      const tags = column.config?.hashtags
      if (!tags?.length) return t('Hashtag')
      if (tags.length === 1) return `#${tags[0]}`
      return `#${tags[0]} +${tags.length - 1}`
    }
    case 'search': {
      const q = column.config?.query?.trim()
      if (!q) return t('Search')
      return `${t('Search')} · "${q}"`
    }
    case 'dvm-discover':
      return t('DVMs')
    case 'dvm-feed':
      // The DVM's human-readable name needs an async kind-31990 lookup —
      // surfaced in the body's toolbar instead. Header stays neutral.
      return t('DVM Feed')
    case 'relatr-discovery': {
      const q = column.config?.relatrQuery?.trim()
      if (!q) return t('Profile Search')
      return `${t('Profile Search')} · "${q}"`
    }
    case 'messages':
      return t('Messages')
    case 'detail':
      return t('Detail')
    case 'relay': {
      const url = column.config?.relayUrl
      if (!url) return t('Relay')
      try {
        return `${t('Relay')} · ${new URL(url).host}`
      } catch {
        return t('Relay')
      }
    }
    default:
      return t('Unknown column')
  }
}
