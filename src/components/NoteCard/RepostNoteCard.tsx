import { isInMutedThread, isMentioningMutedUsers } from '@/lib/event'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import seenOnService from '@/services/caches/seen-on.service'
import eventCache from '@/services/caches/event-cache.service'
import threadService from '@/services/thread.service'
import { Event, kinds, verifyEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import MainNoteCard from './MainNoteCard'

export default function RepostNoteCard({
  event,
  className,
  filterMutedNotes = true,
  pinned = false,
  reposters
}: {
  event: Event
  className?: string
  filterMutedNotes?: boolean
  pinned?: boolean
  reposters?: string[]
}) {
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [targetEvent, setTargetEvent] = useState<Event | null>(null)
  const shouldHide = useMemo(() => {
    if (!targetEvent) return true
    if (filterMutedNotes && mutePubkeySet.has(targetEvent.pubkey)) {
      return true
    }
    // Hide a repost whose target is in a muted thread. The outer NoteCard check
    // runs isInMutedThread on the kind-6 wrapper, but this also catches the case
    // where the target was fetched async (no embedded JSON) and is a reply whose
    // root we only know after the fetch.
    if (filterMutedNotes && isInMutedThread(targetEvent, muteEventIdSet)) {
      return true
    }
    if (hideContentMentioningMutedUsers && isMentioningMutedUsers(targetEvent, mutePubkeySet)) {
      return true
    }
    return false
  }, [
    targetEvent,
    filterMutedNotes,
    hideContentMentioningMutedUsers,
    mutePubkeySet,
    muteEventIdSet
  ])
  useEffect(() => {
    const fetch = async () => {
      let eventFromContent: Event | null = null
      if (event.content) {
        try {
          eventFromContent = JSON.parse(event.content) as Event
        } catch {
          eventFromContent = null
        }
      }
      if (eventFromContent && verifyEvent(eventFromContent)) {
        if (
          eventFromContent.kind === kinds.Repost ||
          eventFromContent.kind === kinds.GenericRepost
        ) {
          return
        }
        eventCache.addToCache(eventFromContent)
        const targetSeenOn = seenOnService.getSeenEventRelays(eventFromContent.id)
        if (targetSeenOn.length === 0) {
          const seenOn = seenOnService.getSeenEventRelays(event.id)
          seenOn.forEach((relay) => {
            seenOnService.trackEventSeenOn(eventFromContent.id, relay)
          })
        }
        setTargetEvent(eventFromContent)
        threadService.addRepliesToThread([eventFromContent])
        return
      }

      let targetEventId: string | undefined
      const aTag = event.tags.find(tagNameEquals('a'))
      if (aTag) {
        targetEventId = generateBech32IdFromATag(aTag)
      } else {
        const eTag = event.tags.find(tagNameEquals('e'))
        if (eTag) {
          targetEventId = generateBech32IdFromETag(eTag)
        }
      }
      if (!targetEventId) {
        return
      }

      const targetEvent = await eventCache.fetchEvent(targetEventId)
      if (targetEvent) {
        setTargetEvent(targetEvent)
        threadService.addRepliesToThread([targetEvent])
      }
    }
    fetch()
  }, [event])

  if (!targetEvent || shouldHide) return null

  return (
    <MainNoteCard
      className={className}
      reposters={reposters?.includes(event.pubkey) ? reposters : [event.pubkey]}
      event={targetEvent}
      pinned={pinned}
    />
  )
}
