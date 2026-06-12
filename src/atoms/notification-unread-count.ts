import { atom } from 'jotai'

/** Unread count per Notifications column id, published by each column's
 *  NotificationList, read by that column's ColumnHeader badge. */
export const notificationUnreadCountAtom = atom<Record<string, number>>({})
