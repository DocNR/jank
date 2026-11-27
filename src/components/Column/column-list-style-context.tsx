// src/components/Column/column-list-style-context.tsx
//
// Per-column override for a feed column's list style ("compact" vs
// "detailed"). A column body (NotificationsColumnBody, BookmarksColumnBody…)
// provides its `config.listStyle` here; the feed's child renderers read the
// effective value through `useEffectiveListStyle()`, which falls back to the
// global user pref when no override is set.
//
// Shared by every column type in LIST_STYLE_COLUMN_TYPES — the compact/
// detailed toggle button in ColumnHeader writes `config.listStyle`, and this
// context fans it down to whichever feed component the column renders.
//
// Lives under components/Column (rather than NotificationList) because it's
// column-general now, and to keep clear of the NotificationList ↔
// NotificationItem import cycle.

import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { TNotificationStyle } from '@/types'
import { TColumnType } from '@/types/column'
import { createContext, ReactNode, useContext } from 'react'

/**
 * Column types that expose the compact/detailed list-style toggle in their
 * ColumnHeader. To opt a new feed column in: add its type here and have its
 * body wrap the feed in <ColumnListStyleProvider>.
 *
 * (The global pref + value enum are still named `notificationListStyle` /
 * `NOTIFICATION_LIST_STYLE` — renaming those to a generic name is a deferred,
 * blast-radius-only cleanup; the per-column override is what this feature
 * actually needs and it's already generic.)
 */
export const LIST_STYLE_COLUMN_TYPES = new Set<TColumnType>([
  'notifications',
  'bookmarks',
  'hashtag'
])

/**
 * Column types that expose the trust-score filter (shield badge) in their
 * ColumnHeader. The badge sets a per-column threshold (config
 * `.trustScoreThreshold`, falling back to the global default from Settings)
 * that hides notes from authors in the bottom N% of Relatr trust rank —
 * WoT members always pass, unranked authors count as rank 0, 100 = WoT-only.
 *
 * Home's Notes tab is all follows (already WoT), but its Notes-and-replies
 * tab pulls in replies from strangers, which is exactly what the threshold
 * narrows. Notifications filters through useNotificationFilter's pipeline,
 * which applies the same threshold per event (the spam-reply wave lands
 * there first, so it's in).
 */
export const TRUST_FILTER_COLUMN_TYPES = new Set<TColumnType>([
  'home',
  'notifications',
  'hashtag',
  'search',
  'relay',
  'articles'
])

const ColumnListStyleContext = createContext<TNotificationStyle | undefined>(undefined)

export function ColumnListStyleProvider({
  styleOverride,
  children
}: {
  styleOverride: TNotificationStyle | undefined
  children: ReactNode
}) {
  return (
    <ColumnListStyleContext.Provider value={styleOverride}>
      {children}
    </ColumnListStyleContext.Provider>
  )
}

/**
 * Returns the effective list style for the current column subtree — the
 * column-scoped override if any, otherwise the global user pref.
 */
export function useEffectiveListStyle(): TNotificationStyle {
  const override = useContext(ColumnListStyleContext)
  const { notificationListStyle } = useUserPreferences()
  return override ?? notificationListStyle ?? NOTIFICATION_LIST_STYLE.DETAILED
}
