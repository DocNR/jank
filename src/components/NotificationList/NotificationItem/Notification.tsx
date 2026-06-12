import ContentPreview from '@/components/ContentPreview'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import StuffStats from '@/components/StuffStats'
import { Skeleton } from '@/components/ui/skeleton'
import UserAvatar, { UserAvatarSkeleton } from '@/components/UserAvatar'
import Username from '@/components/Username'
import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { toNote, toProfile } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/DeckManager'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useNotification } from '@/providers/NotificationProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { NostrEvent } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import { useEffectiveListStyle } from '@/components/Column/column-list-style-context'

export default function Notification({
  icon,
  notificationId,
  sender,
  sentAt,
  description,
  middle = null,
  targetEvent,
  isNew = false,
  showStats = false
}: {
  icon: React.ReactNode
  notificationId: string
  sender: string
  sentAt: number
  description: string
  middle?: React.ReactNode
  targetEvent?: NostrEvent
  isNew?: boolean
  showStats?: boolean
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  // The notification surface's pubkey — column's viewContext in column mode,
  // active account in page mode.
  const { pubkey, markNotificationAsRead } = useNotification()
  const { autoLoadProfilePicture } = useContentPolicy()
  const { density } = useUserPreferences()
  const notificationListStyle = useEffectiveListStyle()
  const isCompact = density === 'compact'
  // `isNew` is now the full predicate (created_at > floor && id ∉ readSet),
  // computed by NotificationList from the shared read-set.
  const unread = isNew

  const handleClick = () => {
    markNotificationAsRead(notificationId)
    if (targetEvent) {
      push(toNote(targetEvent.id))
    } else if (pubkey) {
      push(toProfile(pubkey))
    }
  }

  if (notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT) {
    return (
      <div
        className={cn(
          'flex cursor-pointer items-center justify-between px-4',
          isCompact ? 'py-1 text-[14.5px]' : 'py-2'
        )}
        onClick={handleClick}
      >
        <div className="flex w-0 flex-1 items-center gap-2">
          {icon}
          {autoLoadProfilePicture && <UserAvatar userId={sender} size="small" />}
          {!autoLoadProfilePicture && (
            <Username
              userId={sender}
              className="max-w-32 shrink-0 truncate text-sm font-semibold"
            />
          )}
          {middle}
          {targetEvent && (
            <ContentPreview
              className={cn(
                'w-0 flex-1 truncate',
                unread ? 'font-semibold' : 'text-muted-foreground'
              )}
              event={targetEvent}
            />
          )}
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-2">
          <FormattedTimestamp timestamp={sentAt} short />
          {unread && (
            <button
              className="bg-primary hover:ring-primary/20 size-2 shrink-0 rounded-full transition-all hover:ring-4"
              title={t('Mark as read')}
              onClick={(e) => {
                e.stopPropagation()
                markNotificationAsRead(notificationId)
              }}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'clickable border-border/30 flex cursor-pointer items-start gap-2 border-b px-4',
        isCompact ? 'py-1.5' : 'py-3'
      )}
      onClick={handleClick}
    >
      <div className="mt-1.5 flex items-center gap-2">
        {icon}
        <UserAvatar userId={sender} size="medium" />
      </div>
      <div className={cn('w-0 flex-1', isCompact && 'text-[14.5px]')}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <Username
              userId={sender}
              className="max-w-fit flex-1 truncate font-semibold"
              skeletonClassName="h-4"
            />
            <div className="text-muted-foreground shrink-0 text-sm">{description}</div>
          </div>
          {unread && (
            <button
              className="bg-primary hover:ring-primary/20 m-0.5 size-3 shrink-0 rounded-full transition-all hover:ring-4"
              title={t('Mark as read')}
              onClick={(e) => {
                e.stopPropagation()
                markNotificationAsRead(notificationId)
              }}
            />
          )}
        </div>
        {middle}
        {targetEvent && (
          <ContentPreview
            className={cn('line-clamp-2', !unread && 'text-muted-foreground')}
            event={targetEvent}
          />
        )}
        <FormattedTimestamp timestamp={sentAt} className="text-muted-foreground shrink-0 text-sm" />
        {showStats && targetEvent && (
          <StuffStats stuff={targetEvent} className={isCompact ? 'mt-1' : 'mt-2'} />
        )}
      </div>
    </div>
  )
}

export function NotificationSkeleton() {
  const notificationListStyle = useEffectiveListStyle()

  if (notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT) {
    return (
      <div className="flex h-11 items-center gap-2 px-4 py-2">
        <UserAvatarSkeleton className="h-7 w-7" />
        <Skeleton className="h-6 w-0 flex-1" />
      </div>
    )
  }

  return (
    <div className="flex cursor-pointer items-start gap-2 px-4 py-2">
      <div className="mt-1.5 flex items-center gap-2">
        <Skeleton className="h-6 w-6" />
        <UserAvatarSkeleton className="h-9 w-9" />
      </div>
      <div className="w-0 flex-1">
        <div className="py-1">
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="py-1">
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="py-1">
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    </div>
  )
}
