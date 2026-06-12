import { BRAND } from '@/branding'
import { isNotificationUnread } from '@/lib/notification-read'
import { useReadNotifications } from '@/hooks/useReadNotifications'
import { useNotificationFilter } from '@/hooks/useNotificationFilter'
import notificationServices, { NotificationServiceInstance } from '@/services/notification.service'
import storage from '@/services/local-storage.service'
import { NostrEvent } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNostr } from './NostrProvider'

export type TNotificationProviderMode = 'page' | 'column'

type TNotificationContext = {
  pubkey: string
  service: NotificationServiceInstance
  mode: TNotificationProviderMode
  hasNewNotification: boolean
  newNotificationCount: number
  getNotificationsSeenAt: () => number
  isNotificationRead: (id: string) => boolean
  markNotificationAsRead: (id: string) => void
  markAllNotificationsAsRead: (ids: string[]) => void
}

const NotificationContext = createContext<TNotificationContext | undefined>(undefined)

export const useNotification = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider')
  }
  return context
}

/**
 * Provides notification state for one pubkey.
 *
 * `mode='page'` (default) — used by DeckManager-level mounts. Drives the
 * favicon/title badge, listens for the primary-page sentinel to advance
 * `notificationsSeenAt` on entering/leaving the standalone Notifications page.
 *
 * `mode='column'` — used by per-account Notifications columns. Skips the
 * badge effect and the page-active sentinel (a column doesn't know "the
 * user entered the notifications surface"). Read-state is shared and
 * persisted per-pubkey via useReadNotifications (not per-mount).
 */
export function NotificationProvider({
  pubkey,
  mode = 'page',
  children
}: {
  pubkey: string | null | undefined
  mode?: TNotificationProviderMode
  children: React.ReactNode
}) {
  // Phase 2: the Notifications primary page retired (only home remains).
  // Page-mode `active` is therefore permanently false — the page-mode mount
  // in DeckManager.tsx still drives the app-wide unread badge (via the
  // `mode === 'page' && !active` branch in the effects below), it just no
  // longer toggles seen-at on entry/exit. Column-mode providers (one per
  // Notifications column) carry their own active semantics.
  const active = false
  const { notificationsSeenAt, updateNotificationsSeenAt } = useNostr()
  // Pass the provider's `pubkey` prop (= the column's viewContext in column
  // mode, the active account in page mode). NOT the sidebar-active singleton
  // — a column scoped to B while A is active must filter B's notifications
  // using B's pubkey so kind-7 reactions tagging B aren't dropped.
  const filterFn = useNotificationFilter(pubkey)
  const { readSet, markRead, markManyRead } = useReadNotifications(pubkey)
  const [filteredNewNotifications, setFilteredNewNotifications] = useState<NostrEvent[]>([])
  const wasActiveRef = useRef(false)

  // Snapshot the page's declared favicon links so the unread-badge effect can
  // restore them. index.html ships a theme-aware /favicon.svg (light/dark via
  // prefers-color-scheme); the badge effect must put that back when the count
  // hits 0 instead of pinning the static /favicon.ico raster — otherwise the
  // favicon stops tracking the OS color scheme (stuck black-on-white).
  const originalIconsRef = useRef<{ el: HTMLLinkElement; href: string }[] | null>(null)

  // Stable owner symbol per mount — refcounts the shared service instance.
  const ownerRef = useRef<symbol>(Symbol('NotificationProvider'))

  // Acquire (or share) the service instance for this pubkey. Falls back to a
  // disposable placeholder when pubkey is empty so consumers always get a
  // valid object; the placeholder never starts and has no events.
  const service = useMemo(() => {
    if (!pubkey) return new NotificationServiceInstance('')
    return notificationServices.get(pubkey, ownerRef.current)
  }, [pubkey])

  // Start subscription on mount/pubkey-change; release on unmount.
  useEffect(() => {
    if (!pubkey) {
      return
    }
    const owner = ownerRef.current
    service.start()
    return () => {
      notificationServices.release(pubkey, owner)
    }
  }, [pubkey, service])

  // Page-mode only: snapshot seen-at on entry, refresh on exit. Columns skip
  // this — they don't have a primary-page sentinel to react to.
  useEffect(() => {
    if (mode !== 'page') return
    if (active) {
      if (wasActiveRef.current) return
      wasActiveRef.current = true
      updateNotificationsSeenAt()
      return
    }
    if (wasActiveRef.current) {
      wasActiveRef.current = false
      updateNotificationsSeenAt()
    }
  }, [mode, active, updateNotificationsSeenAt])

  // Page-mode only: compute `filteredNewNotifications` for the badge.
  // Columns skip this — only the active-account page mount drives the
  // app-wide favicon/title badge.
  useEffect(() => {
    if (mode !== 'page' || active || notificationsSeenAt < 0 || !pubkey) {
      setFilteredNewNotifications([])
      return
    }

    let cancelled = false
    const recompute = async () => {
      const events = service.getEvents()
      const filtered: NostrEvent[] = []
      await Promise.allSettled(
        events.map(async (notification) => {
          if (!isNotificationUnread(notification, notificationsSeenAt, readSet) || filtered.length >= 10) {
            return
          }
          if (!(await filterFn(notification))) {
            return
          }
          filtered.push(notification)
        })
      )
      if (!cancelled) {
        setFilteredNewNotifications(filtered)
      }
    }

    recompute()
    const unsub = service.onDataChanged(recompute)
    return () => {
      cancelled = true
      unsub()
    }
  }, [mode, active, notificationsSeenAt, pubkey, filterFn, service, readSet])

  // Page-mode only: drive favicon + document.title. Only one provider mount
  // should own this — the DeckManager-level page mount.
  useEffect(() => {
    if (mode !== 'page') return

    const totalBadgeCount = filteredNewNotifications.length

    if (totalBadgeCount > 0) {
      document.title = `(${totalBadgeCount >= 10 ? '9+' : totalBadgeCount}) ${BRAND.name}`
    } else {
      document.title = BRAND.name
    }

    // Only the real tab icons — `rel='icon'`, exact match. The old `rel*='icon'`
    // substring selector also swept up the apple-touch-icon links.
    const favicons = document.querySelectorAll<HTMLLinkElement>("link[rel='icon']")
    if (!favicons.length) return

    // Capture the declared (theme-aware) hrefs once, before any mutation.
    if (!originalIconsRef.current) {
      originalIconsRef.current = Array.from(favicons).map((el) => ({ el, href: el.href }))
    }

    if (totalBadgeCount === 0) {
      // Restore the declared icons so the dark/light-aware /favicon.svg drives
      // the tab again. Pinning /favicon.ico here was the bug: it overrode the
      // SVG with a static black-on-white raster regardless of color scheme.
      originalIconsRef.current.forEach(({ el, href }) => {
        el.href = href
      })
    } else {
      // Unread badge: rasterize the theme-aware SVG mark, then stamp a red dot.
      // Drawing /favicon.svg (not /favicon.ico) keeps the badged favicon on the
      // same color scheme as the un-badged one.
      const img = new Image()
      img.src = '/favicon.svg'
      img.onload = () => {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        // favicon.svg viewBox is 332x281 — preserve aspect so the mark isn't
        // stretched into the square canvas.
        const drawH = size * (281 / 332)
        ctx.drawImage(img, 0, (size - drawH) / 2, size, drawH)
        const r = size * 0.16
        ctx.beginPath()
        ctx.arc(size - r - 4, r + 4, r, 0, 2 * Math.PI)
        ctx.fillStyle = '#FF0000'
        ctx.fill()
        const dataUrl = canvas.toDataURL('image/png')
        favicons.forEach((favicon) => {
          favicon.href = dataUrl
        })
      }
    }
  }, [mode, filteredNewNotifications])

  const getNotificationsSeenAt = useCallback(() => {
    // Column mode: always use the per-pubkey stored seen-at. The global
    // `notificationsSeenAt` from useNostr() belongs to the sidebar-active
    // account — reading it here would leak the wrong value into a column
    // scoped to a different pubkey's notifications.
    if (mode === 'column') {
      return pubkey ? storage.getLastReadNotificationTime(pubkey) : 0
    }
    if (notificationsSeenAt >= 0) {
      return notificationsSeenAt
    }
    if (pubkey) {
      return storage.getLastReadNotificationTime(pubkey)
    }
    return 0
  }, [mode, notificationsSeenAt, pubkey])

  const isNotificationRead = useCallback(
    (notificationId: string): boolean => readSet.has(notificationId),
    [readSet]
  )

  const markNotificationAsRead = useCallback(
    (notificationId: string): void => markRead(notificationId),
    [markRead]
  )

  const markAllNotificationsAsRead = useCallback(
    (notificationIds: string[]): void => {
      if (notificationIds.length === 0) return
      markManyRead(notificationIds) // reactive clear across bell + badges + dots

      // updateNotificationsSeenAt(false, pubkey) routes through the per-account
      // signer registry: active → existing publish(); paired-but-not-active →
      // publishAs(pubkey, ...); foreign-not-paired → silent skip. Storage
      // persistence happens inside in all three cases.
      if (mode !== 'column' || !pubkey) return
      updateNotificationsSeenAt(false, pubkey).catch(() => {})
    },
    [markManyRead, mode, pubkey, updateNotificationsSeenAt]
  )

  return (
    <NotificationContext.Provider
      value={{
        pubkey: pubkey ?? '',
        service,
        mode,
        hasNewNotification: filteredNewNotifications.length > 0,
        newNotificationCount: filteredNewNotifications.length,
        getNotificationsSeenAt,
        isNotificationRead,
        markNotificationAsRead,
        markAllNotificationsAsRead
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}
