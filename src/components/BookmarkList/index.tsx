import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { useFetchEvent } from '@/hooks'
import { generateBech32IdFromATag, generateBech32IdFromETag } from '@/lib/tag'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useBookmarkList } from '@/providers/UserListsProvider'
import { useScrollContainer } from '@/providers/ScrollContainerProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useSecondaryPage } from '@/DeckManager'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'
import ContentPreview from '../ContentPreview'
import { FormattedTimestamp } from '../FormattedTimestamp'
import UserAvatar, { UserAvatarSkeleton } from '../UserAvatar'
import { Skeleton } from '../ui/skeleton'
import { useEffectiveListStyle } from '../Column/column-list-style-context'

const SHOW_COUNT = 10

/**
 * Per-event bookmark renderer for the standalone <BookmarkPage> (the legacy
 * `/bookmarks` secondary route, kept for URL compatibility). Runs N independent
 * `useFetchEvent` hooks, one per bookmarked id.
 *
 * The Bookmarks *column* does NOT use this — it renders everything through a
 * single bulk-fetch <NoteList> (see BookmarksColumnBody) so notes and articles
 * interleave by created_at and paint from the IndexedDB cache replay.
 */
export default function BookmarkList() {
  const { t } = useTranslation()
  const { bookmarkListEvent } = useBookmarkList()
  const scrollContainerRef = useScrollContainer()
  const eventIds = useMemo(() => {
    if (!bookmarkListEvent) return []

    return (
      bookmarkListEvent.tags
        .map((tag) =>
          tag[0] === 'e'
            ? generateBech32IdFromETag(tag)
            : tag[0] === 'a'
              ? generateBech32IdFromATag(tag)
              : null
        )
        .filter(Boolean) as (`nevent1${string}` | `naddr1${string}`)[]
    ).reverse()
  }, [bookmarkListEvent])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const options = {
      // Inside a deck column the feed scrolls in the column body, not the
      // window — observe the bottom sentinel against the column's scroll
      // container when one is provided. `null` (no provider) falls back to
      // the viewport, which is correct for the standalone bookmark page.
      root: scrollContainerRef?.current ?? null,
      rootMargin: '10px',
      threshold: 0.1
    }

    const loadMore = () => {
      if (showCount < eventIds.length) {
        setShowCount((prev) => prev + SHOW_COUNT)
      }
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [showCount, eventIds, scrollContainerRef])

  if (eventIds.length === 0) {
    return (
      <div className="text-muted-foreground mt-2 text-center text-sm">
        {t('no bookmarks found')}
      </div>
    )
  }

  return (
    <div>
      {eventIds.slice(0, showCount).map((eventId) => (
        <BookmarkedNote key={eventId} eventId={eventId} />
      ))}

      {showCount < eventIds.length ? (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      ) : (
        <div className="text-muted-foreground mt-2 text-center text-sm">
          {t('no more bookmarks')}
        </div>
      )}
    </div>
  )
}

function BookmarkedNote({ eventId }: { eventId: string }) {
  const { event, isFetching } = useFetchEvent(eventId)
  // `listStyle` is the effective per-column override ?? global pref, shared
  // with the Notifications column. `detailed` renders the full NoteCard;
  // `compact` renders a one-line ContentPreview row (same grammar as the
  // compact notification row).
  const listStyle = useEffectiveListStyle()

  if (listStyle === NOTIFICATION_LIST_STYLE.COMPACT) {
    if (isFetching) return <CompactBookmarkSkeleton />
    if (!event) return null
    return <CompactBookmarkRow event={event} />
  }

  if (isFetching) {
    return <NoteCardLoadingSkeleton className="border-b" />
  }

  if (!event) {
    return null
  }

  return <NoteCard event={event} className="w-full" />
}

function CompactBookmarkRow({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  const { density } = useUserPreferences()
  const isCompactDensity = density === 'compact'
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 px-4',
        isCompactDensity ? 'py-1 text-[14.5px]' : 'py-2'
      )}
      onClick={(e) => {
        e.stopPropagation()
        push(toNote(event))
      }}
    >
      <UserAvatar userId={event.pubkey} size="small" />
      <ContentPreview className="text-muted-foreground w-0 flex-1 truncate" event={event} />
      <FormattedTimestamp
        timestamp={event.created_at}
        className="text-muted-foreground shrink-0 text-sm"
        short
      />
    </div>
  )
}

function CompactBookmarkSkeleton() {
  return (
    <div className="flex h-11 items-center gap-2 px-4 py-2">
      <UserAvatarSkeleton className="h-7 w-7" />
      <Skeleton className="h-6 w-0 flex-1" />
    </div>
  )
}
