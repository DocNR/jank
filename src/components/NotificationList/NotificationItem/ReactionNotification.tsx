import Image from '@/components/Image'
import { useFetchEvent } from '@/hooks'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { useNotification } from '@/providers/NotificationProvider'
import { useNotificationUserPreference } from '@/providers/NotificationUserPreferenceProvider'
import { Heart } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'

export function ReactionNotification({
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
  const eventId = useMemo(() => {
    const aTag = notification.tags.findLast(tagNameEquals('a'))
    if (aTag) {
      return generateBech32IdFromATag(aTag)
    }
    const eTag = notification.tags.findLast(tagNameEquals('e'))
    return eTag ? generateBech32IdFromETag(eTag) : undefined
  }, [notification, pubkey])
  const { event } = useFetchEvent(eventId)
  const reaction = useMemo(() => {
    if (!notification.content || notification.content === '+') {
      return <Heart size={16} className="text-muted-foreground" />
    }

    const emojiName = /^:([^:]+):$/.exec(notification.content)?.[1]
    if (emojiName) {
      const emojiTag = notification.tags.find((tag) => tag[0] === 'emoji' && tag[1] === emojiName)
      const emojiUrl = emojiTag?.[2]
      if (emojiUrl) {
        return (
          <Image
            image={{ url: emojiUrl, pubkey: notification.pubkey }}
            alt={emojiName}
            className="h-4 w-4"
            classNames={{ errorPlaceholder: 'bg-transparent', wrapper: 'rounded-md' }}
            errorPlaceholder={<Heart size={16} className="text-muted-foreground" />}
          />
        )
      }
    }
    if (notification.content.length > 4) {
      return null
    }
    return notification.content
  }, [notification])

  if (!event || !eventId || !reaction) {
    return null
  }
  if (hideIndirect && event.pubkey !== pubkey) {
    return null
  }

  return (
    <Notification
      notificationId={notification.id}
      icon={<div className="min-w-4 text-center text-base">{reaction}</div>}
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={event}
      description={t('reacted to your note')}
      isNew={isNew}
    />
  )
}
