import { Highlighter } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function HighlightNotification({
  notification,
  isNew = false
}: {
  notification: Event
  isNew?: boolean
}) {
  const { t } = useTranslation()

  return (
    <Notification
      notificationId={notification.id}
      icon={<Highlighter size={16} className="text-muted-foreground" />}
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={notification}
      description={t('highlighted your note')}
      isNew={isNew}
    />
  )
}
