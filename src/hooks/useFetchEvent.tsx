import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import eventCache from '@/services/caches/event-cache.service'
import threadService from '@/services/thread.service'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

export function useFetchEvent(eventId?: string) {
  const { isEventDeleted } = useDeletedEvent()
  // Synchronous cache peek: if we've already resolved this event once this session,
  // seed initial state from it so the first render paints real content with no
  // isFetching flash. That's what stops a remounting EmbeddedNote from flashing its
  // short skeleton and then jumping to full height inside the virtualized feed.
  const peekCached = () => {
    if (!eventId) return undefined
    const cached = eventCache.getCachedEvent(eventId)
    return cached && !isEventDeleted(cached) ? cached : undefined
  }
  const [event, setEvent] = useState<Event | undefined>(peekCached)
  const [isFetching, setIsFetching] = useState(() => !peekCached())
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId) {
        setIsFetching(false)
        setError(new Error('No id provided'))
        return
      }

      // Cached fast path: resolve synchronously, no loading state at all.
      const sync = eventCache.getCachedEvent(eventId)
      if (sync) {
        if (!isEventDeleted(sync)) {
          setEvent(sync)
          threadService.addRepliesToThread([sync])
        }
        setIsFetching(false)
        return
      }

      setIsFetching(true)
      const event = await eventCache.fetchEvent(eventId)
      if (event && !isEventDeleted(event)) {
        setEvent(event)
        threadService.addRepliesToThread([event])
      }
    }

    fetchEvent()
      .catch((err) => {
        console.error('Error fetching event in useFetchEvent:', eventId, err)
        setError(err as Error)
      })
      .finally(() => {
        setIsFetching(false)
      })
  }, [eventId])

  useEffect(() => {
    if (event && isEventDeleted(event)) {
      setEvent(undefined)
    }
  }, [isEventDeleted])

  return { isFetching, error, event }
}
