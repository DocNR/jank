import Image from '@/components/Image'
import { useSecondaryPage } from '@/DeckManager'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { toNote } from '@/lib/link'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import timelineCache from '@/services/caches/timeline-cache.service'
import relayListService from '@/services/fetchers/relay-list.service'
import dayjs from 'dayjs'
import { Loader, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Event } from 'nostr-tools'
import { extractMediaItems, TMediaItem } from './profile-media'

const LIMIT = 100
const MEDIA_KINDS = [1, 20, 21, 22]

export default function ProfileMediaTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const scope = useAccountScopeOptional()
  const [events, setEvents] = useState<Event[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const timelineKeyRef = useRef<string | null>(null)
  const eventsRef = useRef<Event[]>([])
  eventsRef.current = events
  const initialLoadedRef = useRef(false)

  // Derive the deduped media list from raw events. Key on
  // `${sourceEventId}:${url}` so the same image in two notes shows twice but
  // the same note's repeated extraction doesn't.
  const mediaItems = useMemo(() => {
    const seen = new Set<string>()
    const out: TMediaItem[] = []
    for (const item of events.flatMap(extractMediaItems)) {
      const key = `${item.sourceEvent.id}:${item.url}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(item)
      }
    }
    return out
  }, [events])

  // Subscribe to the profile's media-bearing notes. Mirrors NoteList's wiring:
  // build an async init() returning the closer, clean up via promise.then.
  useEffect(() => {
    setEvents([])
    setInitialLoading(true)
    initialLoadedRef.current = false
    timelineKeyRef.current = null

    const init = async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      const urls = relayList.write.concat(getDefaultRelayUrls()).slice(0, 8)

      const { closer, timelineKey } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { authors: [pubkey], kinds: MEDIA_KINDS, limit: LIMIT } }],
        {
          onEvents: (newEvents, eosed) => {
            // Only apply the full-replace merged timeline during the INITIAL load.
            // After EOSE, only onNew (prepend) and loadMoreTimeline (append) mutate
            // the list, so a late EOSE batch can't wipe paginated events.
            if (initialLoadedRef.current) return
            if (newEvents.length > 0) setEvents(newEvents)
            if (eosed) {
              initialLoadedRef.current = true
              setInitialLoading(false)
            }
          },
          onNew: (event) => {
            setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]))
          }
        },
        { needSaveToDb: true, authPubkey: scope?.signingIdentity ?? undefined }
      )
      timelineKeyRef.current = timelineKey
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer())
    }
  }, [pubkey, scope?.signingIdentity])

  const handleLoadMore = useCallback(async () => {
    const timelineKey = timelineKeyRef.current
    if (!timelineKey) return false
    // Media is sparse: a batch of older events may contain no media, leaving the
    // grid unchanged and the bottom sentinel statically intersecting — the
    // IntersectionObserver then never re-fires and pagination stalls. So loop,
    // fetching older events until we add at least one new media item or exhaust.
    for (let i = 0; i < 8; i++) {
      const evts = eventsRef.current
      const until = evts.length ? evts[evts.length - 1].created_at - 1 : dayjs().unix()
      const older = await timelineCache.loadMoreTimeline(timelineKey, until, LIMIT)
      if (older.length === 0) return false // truly exhausted
      const next = [...evts, ...older]
      eventsRef.current = next
      setEvents(next)
      if (older.some((e) => extractMediaItems(e).length > 0)) return true // grid grew
    }
    return true // fetched several batches without media; yield and allow re-trigger
  }, [])

  const { shouldShowLoadingIndicator, bottomRef } = useInfiniteScroll({
    items: mediaItems,
    showAllInitially: true,
    onLoadMore: handleLoadMore,
    initialLoading
  })

  // A min-height equal to the viewport keeps the column body from collapsing
  // while media loads (or when sparse/empty). Without it, switching TO this tab
  // shrinks the scrollable content to a tiny spinner, the browser clamps
  // scrollTop down, and the column jumps up to the profile banner — defeating
  // the snap-to-tab-anchor behavior the NoteList tabs get for free (their cached
  // feed already has height). See ProfileFeed.snapToTabAnchor.
  if (initialLoading && mediaItems.length === 0) {
    return (
      <div className="flex min-h-screen justify-center p-8">
        <Loader className="animate-spin" />
      </div>
    )
  }

  if (!initialLoading && mediaItems.length === 0) {
    return (
      <div className="text-muted-foreground min-h-screen p-8 text-center">{t('No media yet')}</div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="columns-2 gap-1 p-1">
        {mediaItems.map((item) => (
          <div
            role="button"
            key={`${item.sourceEvent.id}:${item.url}`}
            className="relative mb-1 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-md"
            onClick={() => push(toNote(item.sourceEvent))}
          >
            {item.type === 'video' ? (
              <video
                src={item.url}
                preload="metadata"
                muted
                playsInline
                className="block w-full object-cover"
              />
            ) : (
              <Image image={{ url: item.url }} className="w-full" />
            )}
            {item.type === 'video' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-black/50 p-2">
                  <Play className="size-6 fill-white text-white" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {shouldShowLoadingIndicator && (
        <div className="flex justify-center p-4">
          <Loader className="animate-spin" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
