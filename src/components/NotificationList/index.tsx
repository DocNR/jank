import { useInfiniteScroll } from '@/hooks'
import { useColumnVisible } from '@/hooks/useColumnVisible'
import { useNotificationFilter } from '@/hooks/useNotificationFilter'
import { useReadNotifications } from '@/hooks/useReadNotifications'
import { cn } from '@/lib/utils'
import { isNotificationUnread } from '@/lib/notification-read'
import { AtSign, CheckCheck, Heart, MessageCircle, Repeat2, Zap } from 'lucide-react'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider'
import { useNotification } from '@/providers/NotificationProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { TNotificationType } from '@/types'
import { notificationBucket } from '@/lib/notification-bucket'
import dayjs from 'dayjs'
import { NostrEvent } from 'nostr-tools'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { notificationUnreadCountAtom } from '@/atoms/notification-unread-count'
import PullToRefresh from '../PullToRefresh'
import { LoadingBar } from '../LoadingBar'
import { NotificationItem } from './NotificationItem'
import { NotificationSkeleton } from './NotificationItem/Notification'
import { ColumnListStyleProvider } from '@/components/Column/column-list-style-context'
import { TNotificationStyle } from '@/types'

const SHOW_COUNT = 30
const LOAD_MORE_LIMIT = 100

export default function NotificationList({
  styleOverride,
  columnId
}: {
  /**
   * Per-column override of the global notificationListStyle pref. When
   * provided, this list (and its children — items, skeleton, mention body)
   * render in the overridden mode regardless of what Settings says.
   * Undefined = follow global. Set by NotificationsColumnBody from
   * `column.config?.listStyle`.
   */
  styleOverride?: TNotificationStyle
  /** The owning Notifications column's id. When set, this list publishes its
   *  unread count to notificationUnreadCountAtom[columnId] for the header badge. */
  columnId?: string
} = {}) {
  const { t } = useTranslation()
  const {
    pubkey,
    service,
    getNotificationsSeenAt,
    markAllNotificationsAsRead
  } = useNotification()
  const { readSet } = useReadNotifications(pubkey)
  const { density } = useUserPreferences()
  const isCompact = density === 'compact'
  const isColumnVisible = useColumnVisible()
  // Pass the column's `pubkey` (= the surface whose notifications are being
  // shown), NOT the sidebar-active singleton — kind-7 reactions tagging this
  // pubkey would otherwise be dropped by notificationFilter's recipient check
  // when active != pubkey.
  const filterFn = useNotificationFilter(pubkey)
  const [notificationType, setNotificationType] = useState<TNotificationType>('all')
  const [filteredEvents, setFilteredEvents] = useState<NostrEvent[]>([])
  const [initialLoading, setInitialLoading] = useState(service.getInitialLoading())
  const topRef = useRef<HTMLDivElement | null>(null)

  // Track service loading state.
  useEffect(() => {
    setInitialLoading(service.getInitialLoading())
    const unsub = service.onLoadingChanged(setInitialLoading)
    return unsub
  }, [service])

  // Recompute filtered events whenever the underlying data or filter inputs change.
  //
  // Coalesce on rAF: the service emits dataChanged synchronously for every
  // incoming event. Without batching, a burst of 40 events triggers 40 parallel
  // async recomputes (the `await filterFn` per event breaks React 18 automatic
  // batching) and 40 setFilteredEvents calls. With rAF coalescing the burst
  // collapses to ~1 render per frame.
  useEffect(() => {
    if (!pubkey) {
      setFilteredEvents([])
      return
    }
    // Column-mode cold-start defer: if the column is off-screen, wait until
    // it scrolls into view before paying for the filter pass. Outside a
    // column the hook returns true so this is a no-op for the page.
    if (!isColumnVisible) return

    let cancelled = false
    let scheduled = false
    let needsRerun = false
    let rafId = 0
    const cache = new Map<string, boolean>()

    const recompute = async () => {
      const events = service.getEvents()
      const seenIds = new Set<string>()
      const passed: NostrEvent[] = []
      for (const evt of events) {
        if (seenIds.has(evt.id)) continue
        seenIds.add(evt.id)
        let ok = cache.get(evt.id)
        if (ok === undefined) {
          ok = await filterFn(evt)
          if (cancelled) return
          cache.set(evt.id, ok)
        }
        if (ok) passed.push(evt)
      }
      if (cancelled) return
      setFilteredEvents(passed)
      scheduled = false
      if (needsRerun) {
        needsRerun = false
        schedule()
      }
    }

    const schedule = () => {
      if (cancelled) return
      if (scheduled) {
        needsRerun = true
        return
      }
      scheduled = true
      rafId = requestAnimationFrame(() => {
        if (cancelled) return
        recompute()
      })
    }

    schedule()
    const unsub = service.onDataChanged(schedule)
    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      unsub()
    }
  }, [pubkey, filterFn, service, isColumnVisible])

  const handleLoadMore = useCallback(async () => {
    return service.loadMore(LOAD_MORE_LIMIT)
  }, [service])

  const notifications = useMemo(() => {
    if (notificationType === 'all') return filteredEvents
    return filteredEvents.filter((evt) => notificationBucket(evt, pubkey) === notificationType)
  }, [filteredEvents, notificationType, pubkey])

  const { visibleItems, shouldShowLoadingIndicator, bottomRef, setShowCount } = useInfiniteScroll({
    items: notifications,
    showCount: SHOW_COUNT,
    onLoadMore: handleLoadMore,
    initialLoading
  })

  const groupedNotifications = useMemo(() => groupNotifications(visibleItems), [visibleItems])

  const floor = getNotificationsSeenAt()

  const unreadIds = useMemo(
    () => filteredEvents.filter((e) => isNotificationUnread(e, floor, readSet)).map((e) => e.id),
    [filteredEvents, floor, readSet]
  )

  const setUnreadCounts = useSetAtom(notificationUnreadCountAtom)
  useEffect(() => {
    if (!columnId) return
    setUnreadCounts((prev) => ({ ...prev, [columnId]: unreadIds.length }))
    return () => {
      setUnreadCounts((prev) => {
        if (!(columnId in prev)) return prev
        const rest = { ...prev }
        delete rest[columnId]
        return rest
      })
    }
  }, [columnId, unreadIds.length, setUnreadCounts])

  const handleMarkAllAsRead = useCallback(() => {
    if (unreadIds.length === 0) return
    markAllNotificationsAsRead(unreadIds)
  }, [unreadIds, markAllNotificationsAsRead])

  const handleChipClick = useCallback(
    (type: TNotificationType) => {
      setShowCount(SHOW_COUNT)
      setNotificationType((prev) => (prev === type ? 'all' : type))
      topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    },
    [setShowCount]
  )

  const refresh = () => {
    topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    setTimeout(() => {
      service.restart()
    }, 500)
  }

  const list = (
    <div>
      {initialLoading && shouldShowLoadingIndicator && <LoadingBar />}
      {groupedNotifications.map((group) => (
        <Fragment key={group.key}>
          <NotificationGroupHeader label={group.label} />
          {group.items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              isNew={isNotificationUnread(notification, floor, readSet)}
            />
          ))}
        </Fragment>
      ))}
      <div ref={bottomRef} />
      <div className="text-muted-foreground text-center text-sm">
        {service.hasMore() || shouldShowLoadingIndicator ? (
          <NotificationSkeleton />
        ) : (
          t('no more notifications')
        )}
      </div>
    </div>
  )

  return (
    <ColumnListStyleProvider styleOverride={styleOverride}>
    <div>
      <div
        className={cn(
          'bg-background sticky top-12 z-30 flex items-center gap-2 border-b border-border/30 px-3 backdrop-blur-md',
          isCompact ? 'py-1' : 'py-2'
        )}
      >
        <div className="flex flex-1 items-center justify-between gap-1">
          <NotificationChip
            type="replies"
            icon={MessageCircle}
            active={notificationType === 'replies'}
            onClick={handleChipClick}
            label={t('Replies')}
          />
          <NotificationChip
            type="reactions"
            icon={Heart}
            active={notificationType === 'reactions'}
            onClick={handleChipClick}
            label={t('Reactions')}
          />
          <NotificationChip
            type="zaps"
            icon={Zap}
            active={notificationType === 'zaps'}
            onClick={handleChipClick}
            label={t('Zaps')}
          />
          <NotificationChip
            type="reposts"
            icon={Repeat2}
            active={notificationType === 'reposts'}
            onClick={handleChipClick}
            label={t('Reposts')}
          />
          <NotificationChip
            type="mentions"
            icon={AtSign}
            active={notificationType === 'mentions'}
            onClick={handleChipClick}
            label={t('Mentions')}
          />
        </div>
        <div className="bg-border/40 h-4 w-px shrink-0" />
        <button
          type="button"
          title={t('Mark all as read')}
          aria-label={t('Mark all as read')}
          onClick={handleMarkAllAsRead}
          disabled={unreadIds.length === 0}
          className={cn(
            'flex shrink-0 items-center rounded-md p-1.5 transition-colors',
            unreadIds.length === 0
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
          )}
        >
          <CheckCheck className="size-3.5" />
        </button>
      </div>
      <div ref={topRef} className="scroll-mt-21.5" />
      <PullToRefresh
        onRefresh={async () => {
          refresh()
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }}
      >
        {list}
      </PullToRefresh>
    </div>
    </ColumnListStyleProvider>
  )
}

type TNotificationGroupKey = 'today' | 'week' | 'month' | 'earlier'

const GROUP_LABELS: Record<TNotificationGroupKey, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  earlier: 'Earlier'
}

function groupNotifications(events: NostrEvent[]) {
  const now = dayjs()
  const todayStart = now.startOf('day').unix()
  const weekStart = now.startOf('week').unix()
  const monthStart = now.startOf('month').unix()

  const groups: { key: TNotificationGroupKey; label: string; items: NostrEvent[] }[] = []
  let current: { key: TNotificationGroupKey; label: string; items: NostrEvent[] } | null = null

  for (const evt of events) {
    let key: TNotificationGroupKey
    if (evt.created_at >= todayStart) key = 'today'
    else if (evt.created_at >= weekStart) key = 'week'
    else if (evt.created_at >= monthStart) key = 'month'
    else key = 'earlier'

    if (!current || current.key !== key) {
      current = { key, label: GROUP_LABELS[key], items: [] }
      groups.push(current)
    }
    current.items.push(evt)
  }
  return groups
}

function NotificationGroupHeader({ label }: { label: string }) {
  const { t } = useTranslation()
  const { deepBrowsing } = useDeepBrowsing()

  return (
    <div
      className={cn(
        'bg-border text-muted-foreground sticky z-20 border-b px-4 py-1 text-sm font-semibold backdrop-blur-md transition-[top] duration-300',
        deepBrowsing ? 'top-12' : 'top-21.5'
      )}
    >
      {t(label)}
    </div>
  )
}

function NotificationChip({
  type,
  icon: Icon,
  active,
  onClick,
  label
}: {
  type: TNotificationType
  icon: typeof MessageCircle
  active: boolean
  onClick: (type: TNotificationType) => void
  label: string
}) {
  const { density } = useUserPreferences()
  const isCompact = density === 'compact'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onClick(type)}
      className={cn(
        'flex shrink-0 items-center rounded-full border px-2 transition-colors',
        isCompact ? 'py-0.5' : 'py-1',
        active
          ? 'bg-primary/15 border-primary/35 text-primary'
          : 'border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
