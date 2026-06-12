import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { formatAmount } from '@/lib/lightning'
import { Zap } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function ZapNotification({
  notification,
  isNew = false,
  perspective = 'self'
}: {
  notification: Event
  isNew?: boolean
  // 'self' = viewer-perspective copy ("zapped your note" / "zapped you") for the
  // Notifications surface; 'other' = neutral copy ("zapped this note" / "sent a
  // zap") for a profile's zaps-received tab, where the recipient is not the viewer.
  perspective?: 'self' | 'other'
}) {
  const { t } = useTranslation()
  const { senderPubkey, eventId, amount, comment } = useMemo(
    () => getZapInfoFromEvent(notification) ?? ({} as any),
    [notification]
  )
  const { event } = useFetchEvent(eventId)

  if (!senderPubkey || !amount) return null

  return (
    <Notification
      notificationId={notification.id}
      icon={<Zap size={16} className="text-muted-foreground shrink-0" />}
      sender={senderPubkey}
      sentAt={notification.created_at}
      targetEvent={event}
      middle={
        <div className="text-foreground truncate font-semibold">
          {formatAmount(amount)} {t('sats')} {comment}
        </div>
      }
      description={
        perspective === 'other'
          ? event
            ? t('zapped this note')
            : t('sent a zap')
          : event
            ? t('zapped your note')
            : t('zapped you')
      }
      isNew={isNew}
    />
  )
}
