import ParentNotePreview from '@/components/ParentNotePreview'
import { ExtendedKind, NOTIFICATION_LIST_STYLE } from '@/constants'
import { getEmbeddedPubkeys, getParentStuff, getParentTag } from '@/lib/event'
import { toExternalContent, toNote } from '@/lib/link'
import { generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { useSecondaryPage } from '@/DeckManager'
import { useNotification } from '@/providers/NotificationProvider'
import { useNotificationUserPreference } from '@/providers/NotificationUserPreferenceProvider'
import eventCache from '@/services/caches/event-cache.service'
import { AtSign, MessageCircle, Quote } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from './Notification'
import { useEffectiveListStyle } from '@/components/Column/column-list-style-context'

export function MentionNotification({
  notification,
  isNew = false
}: {
  notification: Event
  isNew?: boolean
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  // The notification surface's pubkey — column's viewContext in column mode.
  const { pubkey } = useNotification()
  const notificationListStyle = useEffectiveListStyle()
  const { hideIndirect } = useNotificationUserPreference()
  const isMention = useMemo(() => {
    if (!pubkey) return false
    const mentions = getEmbeddedPubkeys(notification)
    return mentions.includes(pubkey)
  }, [pubkey, notification])
  const { parentEventId, parentExternalContent } = useMemo(() => {
    return getParentStuff(notification)
  }, [notification])
  const [isDirectMention, setIsDirectMention] = useState(false)
  useEffect(() => {
    const checkIsDirectMention = async () => {
      if (!pubkey) return false
      if (isMention) return true
      if (notification.kind === ExtendedKind.POLL) return true

      if (
        notification.kind === ExtendedKind.VOICE_COMMENT ||
        notification.kind === ExtendedKind.COMMENT
      ) {
        const parentPTag = notification.tags.findLast(tagNameEquals('p'))
        const parentPubkey = parentPTag?.[1]
        return parentPubkey === pubkey
      }

      const parentTag = getParentTag(notification)
      if (parentTag?.type === 'e') {
        const [, , , , parentPubkey] = parentTag.tag
        if (parentPubkey) {
          return parentPubkey === pubkey
        }
        const parentEventId = generateBech32IdFromETag(parentTag.tag)
        if (!parentEventId) return false
        const parentEvent = await eventCache.fetchEvent(parentEventId)
        if (parentEvent) {
          return parentEvent.pubkey === pubkey
        }
        return false
      }
      if (parentTag?.type === 'a') {
        const coordinate = parentTag.tag[1]
        const [, parentPubkey] = coordinate.split(':')
        return parentPubkey === pubkey
      }
      return false
    }
    checkIsDirectMention().then(setIsDirectMention)
  }, [pubkey, notification, isMention])

  if (hideIndirect && !isDirectMention) {
    return null
  }

  return (
    <Notification
      notificationId={notification.id}
      icon={
        isMention ? (
          <AtSign size={16} className="text-muted-foreground" />
        ) : parentEventId ? (
          <MessageCircle size={16} className="text-muted-foreground" />
        ) : (
          <Quote size={16} className="text-muted-foreground" />
        )
      }
      sender={notification.pubkey}
      sentAt={notification.created_at}
      targetEvent={notification}
      middle={
        notificationListStyle === NOTIFICATION_LIST_STYLE.DETAILED && (
          <ParentNotePreview
            eventId={parentEventId}
            externalContent={parentExternalContent}
            className=""
            onClick={(e) => {
              e.stopPropagation()
              if (parentExternalContent) {
                push(toExternalContent(parentExternalContent))
              } else if (parentEventId) {
                push(toNote(parentEventId))
              }
            }}
          />
        )
      }
      description={
        isMention ? t('mentioned you in a note') : parentEventId ? '' : t('quoted your note')
      }
      isNew={isNew}
      showStats
    />
  )
}
