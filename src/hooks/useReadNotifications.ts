import { readNotificationsAtomFamily, READ_NOTIFICATIONS_CAP } from '@/atoms/notification-read'
import { addCapped } from '@/lib/notification-read'
import storage from '@/services/local-storage.service'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'

/** Reactive read-set for one pubkey, plus persisting mutators. */
export function useReadNotifications(pubkey: string | null | undefined) {
  const key = pubkey ?? ''
  const family = useMemo(() => readNotificationsAtomFamily(key), [key])
  const readSet = useAtomValue(family)
  const setReadSet = useSetAtom(family)

  const markRead = useCallback(
    (id: string) => {
      if (!key) return
      setReadSet((prev) => {
        const next = addCapped(prev, id, READ_NOTIFICATIONS_CAP)
        if (next === prev) return prev
        storage.setReadNotifications(key, [...next])
        return next
      })
    },
    [key, setReadSet]
  )

  const markManyRead = useCallback(
    (ids: string[]) => {
      if (!key || ids.length === 0) return
      setReadSet((prev) => {
        let next = prev
        for (const id of ids) next = addCapped(next, id, READ_NOTIFICATIONS_CAP)
        if (next === prev) return prev
        storage.setReadNotifications(key, [...next])
        return next
      })
    },
    [key, setReadSet]
  )

  return { readSet, markRead, markManyRead }
}
