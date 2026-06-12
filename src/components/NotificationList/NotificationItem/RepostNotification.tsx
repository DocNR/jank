import { useNotification } from '@/providers/NotificationProvider'
import { useNotificationUserPreference } from '@/providers/NotificationUserPreferenceProvider'
import eventCache from '@/services/caches/event-cache.service'
import { Repeat } from 'lucide-react'
import { Event, validateEvent } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function RepostNotification({
  notification,
  isNew = false
}: {
  notification: Event
  isNew?: boolean
}) {
  const { t } = useTranslation()
  // The notification surface's pubkey — column's viewContext in column mode.
  const { pubkey } = useNotification()
  const { hideIndirect } = useNotificationUserPreference()
  const event = useMemo(() => {
    try {
      const event = JSON.parse(notification.content) as Event
      const isValid = validateEvent(event)
      if (!isValid) return null
      eventCache.addToCache(event)
      return event
    } catch {
      return null
    }
  }, [notification.content])
  if (!event) return null
  if (hideIndirect && event.pubkey !== pubkey) {
    return null
  }

  return (
    <Notification
      notificationId={notification.id}
      icon={<Repeat size={16} className="text-muted-foreground" />}
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={event}
      description={t('reposted your note')}
      isNew={isNew}
    />
  )
}
