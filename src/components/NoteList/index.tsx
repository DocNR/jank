import NewNotesButton from '@/components/NewNotesButton'
import { Button } from '@/components/ui/button'
import { FUTURE_EVENT_TOLERANCE_SECONDS, NOTIFICATION_LIST_STYLE } from '@/constants'
import { useColumnVisible } from '@/hooks/useColumnVisible'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { isInMutedThread, isMentioningMutedUsers } from '@/lib/event'
import { buildNoteRows, TNoteRow } from '@/lib/note-rows'
import { mergeTimelines } from '@/lib/timeline'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { usePageActive } from '@/providers/PageActiveProvider'
import { useScrollContainer } from '@/providers/ScrollContainerProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import timelineCache from '@/services/caches/timeline-cache.service'
import client from '@/services/client.service'
import threadService from '@/services/thread.service'
import { TFeedSubRequest, TNotificationStyle } from '@/types'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { decode } from 'nostr-tools/nip19'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from '../PullToRefresh'
import { toast } from 'sonner'
import { LoadingBar } from '../LoadingBar'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'
import PinnedNoteCard from '../PinnedNoteCard'
import { NewlyArrivedContext } from './context'
import { VirtualNoteList } from './VirtualNoteList'
import CompactNoteRow from './CompactNoteRow'

const LIMIT = 200
const ALGO_LIMIT = 500

// Stored (IndexedDB-replayed) events merge into the live timeline only while
// they still overlap or extend it; a stale stored snapshot older than the
// whole live window would otherwise paint a gap into the feed.
function mergeStoredAndLive(storedEvents: Event[], events: Event[]) {
  if (
    storedEvents.length &&
    (!events.length || storedEvents[0].created_at >= events[events.length - 1].created_at)
  ) {
    return mergeTimelines([storedEvents, events])
  }
  return events
}

export type TNoteListRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
  refresh: () => void
}

const NoteList = forwardRef<
  TNoteListRef,
  {
    subRequests: TFeedSubRequest[]
    showKinds?: number[]
    /** Per-row rendering style. 'compact' renders a one-line CompactNoteRow;
     *  omitted/'detailed' renders the full NoteCard (the default for every
     *  caller that doesn't opt in). */
    listStyle?: TNotificationStyle
    filterMutedNotes?: boolean
    hideReplies?: boolean
    hideSpam?: boolean
    /** When true, hide notes from authors outside the user's 2-hop WoT (your
     *  follows + their follows). Driven by per-column `config.wotOnly` for
     *  hashtag/search/relay columns; default false. */
    wotOnly?: boolean
    areAlgoRelays?: boolean
    showRelayCloseReason?: boolean
    pinnedEventIds?: string[]
    filterFn?: (event: Event) => boolean
    showNewNotesDirectly?: boolean
    isPubkeyFeed?: boolean
    /**
     * Persist subscribed events to IndexedDB and replay them on mount.
     * Distinct from `isPubkeyFeed`, which uses an author-bounded replay
     * filter (`{authors, kinds}`) — this uses either a kind-bounded
     * filter (`{kinds}`) or, when the sub-request carries `ids`, an
     * ids-bounded filter (`{kinds, ids}`). Suitable for open feeds whose
     * kind is sparse enough that caching every observed event doesn't
     * blow up storage (kind:30023 Articles), or for set-bounded feeds
     * where the ids are the constraint (kind-10003 Bookmarks).
     *
     * Use for kind:30023 (long-form articles) — single-digit per day
     * across Nostr, so cache stays small. Do NOT use for kind:1 open
     * feeds (Hashtag/Search/Relay) — too much volume.
     *
     * Default false. Either flag enables IndexedDB writes; they read
     * via different filter shapes so they don't conflict.
     */
    cacheToIndexedDb?: boolean
    onFilteredCountChange?: (count: number) => void
  }
>(
  (
    {
      subRequests,
      showKinds,
      listStyle,
      filterMutedNotes = true,
      hideReplies = false,
      hideSpam = false,
      wotOnly = false,
      areAlgoRelays = false,
      showRelayCloseReason = false,
      pinnedEventIds,
      filterFn,
      showNewNotesDirectly = false,
      isPubkeyFeed = false,
      cacheToIndexedDb = false,
      onFilteredCountChange
    },
    ref
  ) => {
    const { t } = useTranslation()
    const active = usePageActive()
    // Defer the FIRST subscription open until the enclosing column has entered
    // the horizontal viewport (cold-start perf); once open, the subscription
    // stays live when the column scrolls off-screen — closing it would force a
    // catch-up round-trip on every deck scroll. Outside a column (e.g.
    // ProfileFeed) this is always true.
    const columnVisible = useColumnVisible()
    const [hasBeenVisible, setHasBeenVisible] = useState(columnVisible)
    useEffect(() => {
      if (columnVisible) setHasBeenVisible(true)
    }, [columnVisible])
    const scope = useAccountScopeOptional()
    const authPubkey = scope?.signingIdentity ?? undefined
    const { startLogin } = useNostr()
    const { isSpammer, isUserTrusted } = useUserTrust()
    const { mutePubkeySet, muteEventIdSet } = useMuteList()
    const { hideContentMentioningMutedUsers, mutedWords } = useContentPolicy()
    const { isEventDeleted } = useDeletedEvent()
    const [storedEvents, setStoredEvents] = useState<Event[]>([])
    const [events, setEvents] = useState<Event[]>([])
    const [newEvents, setNewEvents] = useState<Event[]>([])
    const [initialLoading, setInitialLoading] = useState(true)
    const [filtering, setFiltering] = useState(false)
    const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
    const [filteredNotes, setFilteredNotes] = useState<TNoteRow[]>([])
    const [pendingNewRows, setPendingNewRows] = useState<TNoteRow[]>([])
    const [refreshCount, setRefreshCount] = useState(0)
    const [recentlyArrivedIds, setRecentlyArrivedIds] = useState<Set<string>>(new Set())
    const seenKeysRef = useRef<Set<string>>(new Set())
    const initialLoadedRef = useRef(false)
    const topRef = useRef<HTMLDivElement | null>(null)
    // Identity of everything currently held in feed state (displayed events +
    // the buffered new-notes pill). Catch-up batches and live arrivals are
    // partitioned against THIS, never against timestamps — an unseen note
    // older than the newest on screen is still new (slow relays, offline
    // notes republished late, skewed author clocks).
    const knownEventIdsRef = useRef<Set<string>>(new Set())
    useEffect(() => {
      const ids = new Set<string>()
      events.forEach((evt) => ids.add(evt.id))
      newEvents.forEach((evt) => ids.add(evt.id))
      knownEventIdsRef.current = ids
    }, [events, newEvents])
    const showNewNotesDirectlyRef = useRef(showNewNotesDirectly)
    showNewNotesDirectlyRef.current = showNewNotesDirectly
    const scrollContainerRef = useScrollContainer()

    const pinnedEventHexIdSet = useMemo(() => {
      const set = new Set<string>()
      pinnedEventIds?.forEach((id) => {
        try {
          const { type, data } = decode(id)
          if (type === 'nevent') {
            set.add(data.id)
          }
        } catch {
          // ignore
        }
      })
      return set
    }, [pinnedEventIds?.join(',')])

    const shouldHideEvent = useCallback(
      (evt: Event) => {
        // Author clock far ahead (or abuse): hide until the timestamp becomes
        // plausible, so the note can't squat the top of the feed.
        if (evt.created_at > dayjs().unix() + FUTURE_EVENT_TOLERANCE_SECONDS) return true
        if (pinnedEventHexIdSet.has(evt.id)) return true
        if (isEventDeleted(evt)) return true
        if (filterMutedNotes && mutePubkeySet.has(evt.pubkey)) return true
        if (filterMutedNotes && isInMutedThread(evt, muteEventIdSet)) return true
        if (
          filterMutedNotes &&
          hideContentMentioningMutedUsers &&
          isMentioningMutedUsers(evt, mutePubkeySet)
        ) {
          return true
        }
        if (wotOnly && !isUserTrusted(evt.pubkey)) return true
        if (filterFn && !filterFn(evt)) {
          return true
        }
        if (mutedWords.length > 0) {
          const contentLower = evt.content.toLowerCase()
          for (const word of mutedWords) {
            if (contentLower.includes(word)) {
              return true
            }
          }
        }

        return false
      },
      [
        mutePubkeySet,
        muteEventIdSet,
        isEventDeleted,
        filterFn,
        mutedWords,
        pinnedEventHexIdSet,
        wotOnly,
        isUserTrusted
      ]
    )

    useEffect(() => {
      const processEvents = async () => {
        const rows = buildNoteRows(mergeStoredAndLive(storedEvents, events), {
          hideReplies,
          shouldHideEvent
        })

        if (!hideSpam) {
          setFilteredNotes(rows)
          return
        }

        const spamFlags = await Promise.all(rows.map(({ event }) => isSpammer(event.pubkey)))
        setFilteredNotes(rows.filter((_, i) => !spamFlags[i]))
      }

      setFiltering(true)
      processEvents().finally(() => setFiltering(false))
    }, [events, storedEvents, shouldHideEvent, hideReplies, hideSpam, isSpammer])

    useEffect(() => {
      onFilteredCountChange?.(filteredNotes.length)
    }, [filteredNotes.length, onFilteredCountChange])

    // The pill promises only what clicking it will actually add: run the
    // buffered events through the SAME merge + collapse pipeline the feed
    // renders with, and keep the rows that aren't on screen yet. A batch that
    // adds no rows (e.g. reposts of notes already shown) is folded in
    // silently so reposter chips still update.
    useEffect(() => {
      const processNewEvents = async () => {
        if (newEvents.length === 0) {
          setPendingNewRows([])
          return
        }

        const current = mergeStoredAndLive(storedEvents, events)
        const currentKeys = new Set(
          buildNoteRows(current, { hideReplies, shouldHideEvent }).map(({ key }) => key)
        )
        let rows = buildNoteRows(mergeTimelines([newEvents, current]), {
          hideReplies,
          shouldHideEvent
        }).filter(({ key }) => !currentKeys.has(key))

        if (hideSpam && rows.length > 0) {
          const spamFlags = await Promise.all(rows.map(({ event }) => isSpammer(event.pubkey)))
          rows = rows.filter((_, i) => !spamFlags[i])
        }

        if (rows.length === 0) {
          setEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
          setNewEvents([])
          setPendingNewRows([])
          return
        }
        setPendingNewRows(rows)
      }
      processNewEvents()
    }, [newEvents, events, storedEvents, shouldHideEvent, hideReplies, hideSpam, isSpammer])

    const scrollToTop = (behavior: ScrollBehavior = 'instant') => {
      setTimeout(() => {
        // Prefer scrolling the container to absolute 0: in a virtualized feed
        // topRef.scrollIntoView chases a target whose offset shifts as virtua
        // re-measures rows, so it lands partway. A direct scrollTo(0) jumps
        // reliably. Fall back to scrollIntoView only outside a scroll
        // container (window-scroll layouts).
        const scrollEl = scrollContainerRef?.current
        if (scrollEl) {
          scrollEl.scrollTo({ top: 0, behavior })
        } else {
          topRef.current?.scrollIntoView({ behavior, block: 'start' })
        }
      }, 20)
    }

    const refresh = () => {
      scrollToTop()
      setTimeout(() => {
        setRefreshCount((count) => count + 1)
      }, 500)
    }

    useImperativeHandle(ref, () => ({ scrollToTop, refresh }), [])

    useEffect(() => {
      if (!subRequests.length) return

      knownEventIdsRef.current = new Set()
      setEvents([])
      setStoredEvents([])
      setNewEvents([])
      // Refresh / re-subscribe resets the pulse tracker — the next batch of
      // events is a new "initial load," not arrivals to pulse.
      seenKeysRef.current = new Set()
      initialLoadedRef.current = false
      setRecentlyArrivedIds(new Set())
    }, [JSON.stringify(subRequests), refreshCount, JSON.stringify(showKinds)])

    // W6 pulse: once the initial load completes, any subsequent notes that
    // newly enter `filteredNotes` get pulsed for ~2.2s (see the
    // `note-pulse` keyframe in src/index.css). The seenKeys ref
    // ensures we don't pulse the initial batch — those notes are added to
    // the set before initialLoadedRef flips to true.
    useEffect(() => {
      if (!initialLoading) {
        initialLoadedRef.current = true
      }
    }, [initialLoading])

    useEffect(() => {
      const newArrivals: string[] = []
      filteredNotes.forEach(({ key, event }) => {
        if (!seenKeysRef.current.has(key)) {
          seenKeysRef.current.add(key)
          if (initialLoadedRef.current) {
            newArrivals.push(event.id)
          }
        }
      })
      if (newArrivals.length === 0) return
      setRecentlyArrivedIds((prev) => {
        const next = new Set(prev)
        newArrivals.forEach((id) => next.add(id))
        return next
      })
      const timer = setTimeout(() => {
        setRecentlyArrivedIds((prev) => {
          const next = new Set(prev)
          newArrivals.forEach((id) => next.delete(id))
          return next
        })
      }, 2300)
      return () => clearTimeout(timer)
    }, [filteredNotes])

    useEffect(() => {
      if (!subRequests.length || !active || !hasBeenVisible) return

      async function init() {
        setInitialLoading(true)

        if (showKinds?.length === 0 && subRequests.every(({ filter }) => !filter.kinds)) {
          return () => {}
        }

        // Re-subscribing on top of retained feed state (active-page flip,
        // wake) is a catch-up: batches partition against known event ids
        // instead of replacing the timeline.
        const isCatchUp = knownEventIdsRef.current.size > 0

        if (isPubkeyFeed) {
          const storedEvents = await timelineCache.getEventsFromIndexed({
            authors: subRequests.flatMap(({ filter }) => filter.authors ?? []),
            kinds: showKinds,
            limit: LIMIT
          })
          setStoredEvents(storedEvents)
        } else if (cacheToIndexedDb && showKinds && showKinds.length > 0) {
          // Kind-bounded replay (kind:30023 Articles) or ids-bounded replay
          // (Bookmarks column passes {ids:[...]} for its bookmark set). When
          // `ids` is present in the sub-request filter, narrow the replay to
          // those ids so the cursor's matchFilter Set lookup short-circuits
          // rather than scanning every cached event of these kinds. No
          // `authors` constraint either way.
          const replayIds = subRequests[0]?.filter.ids
          const storedEvents = await timelineCache.getEventsFromIndexed({
            kinds: showKinds,
            ...(replayIds ? { ids: replayIds } : {}),
            limit: LIMIT
          })
          setStoredEvents(storedEvents)
        }

        const preprocessedSubRequests = await Promise.all(
          subRequests.map(async ({ urls, filter }) => {
            const relays = urls.length ? urls : await client.determineRelaysByFilter(filter)
            return {
              urls: relays,
              filter: {
                kinds: showKinds ?? [],
                ...filter,
                limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
              }
            }
          })
        )

        const handleNewEvents = (newEvents: Event[]) => {
          if (showNewNotesDirectlyRef.current) {
            setEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
          } else {
            // Detect "at top" by reading the actual scroll container's
            // scrollTop. The old viewport-relative check on topRef broke
            // when column header heights drifted (W5 compact mode put the
            // sentinel under the 50px threshold, so every column was
            // treated as "scrolled" even at the top).
            const scrollEl = scrollContainerRef?.current
            const isAtTop = scrollEl ? scrollEl.scrollTop < 50 : window.scrollY < 50

            if (isAtTop) {
              setEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
              // virtua anchors the viewport to the previously-top row, so a row
              // prepended above it renders just above the fold and stays
              // invisible — the feed appears to get no new notes even though the
              // data arrived. The "new notes" pill path (showNewEvents) avoids
              // this by scrolling to the top after prepending; mirror that here
              // so an auto-prepended arrival is actually revealed. Regression
              // from the #95 react-virtual -> virtua swap (scroll anchoring).
              setTimeout(() => scrollToTop('instant'), 0)
            } else {
              setNewEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
            }
          }
        }

        const { closer, timelineKey } = await timelineCache.subscribeTimeline(
          preprocessedSubRequests,
          {
            onEvents: (events, eosed) => {
              if (events.length > 0) {
                if (!isCatchUp) {
                  setEvents(events)
                } else {
                  const fresh = events.filter((evt) => !knownEventIdsRef.current.has(evt.id))
                  if (fresh.length > 0) {
                    handleNewEvents(fresh)
                  }
                }
              }
              if (eosed) {
                threadService.addRepliesToThread(events)
                setInitialLoading(false)
              }
            },
            onNew: (event) => {
              if (knownEventIdsRef.current.has(event.id)) return
              handleNewEvents([event])
              threadService.addRepliesToThread([event])
            },
            onClose: (url, reason) => {
              if (!showRelayCloseReason) return
              // ignore reasons from nostr-tools
              if (
                [
                  'closed by caller',
                  'relay connection errored',
                  'relay connection closed',
                  'pingpong timed out',
                  'relay connection closed by us'
                ].includes(reason)
              ) {
                return
              }

              toast.error(`${url}: ${reason}`)
            }
          },
          {
            startLogin,
            needSort: !areAlgoRelays,
            needSaveToDb: isPubkeyFeed || cacheToIndexedDb,
            authPubkey
          }
        )
        setTimelineKey(timelineKey)
        return closer
      }

      const promise = init()
      return () => {
        promise.then((closer) => closer())
      }
    }, [
      JSON.stringify(subRequests),
      refreshCount,
      JSON.stringify(showKinds),
      active,
      hasBeenVisible,
      // Subscription options that the effect reads. In production these
      // are static per column at mount time, so omitting them was harmless;
      // including them lets HMR-driven prop changes during dev restart the
      // subscription with the new flag (caught when adding cacheToIndexedDb).
      isPubkeyFeed,
      cacheToIndexedDb
    ])

    const handleLoadMore = useCallback(async () => {
      if (!timelineKey || areAlgoRelays) return false
      const newEvents = await timelineCache.loadMoreTimeline(
        timelineKey,
        events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
        LIMIT
      )
      if (newEvents.length === 0) {
        return false
      }
      setEvents((oldEvents) => [...oldEvents, ...newEvents])
      return true
    }, [timelineKey, events, areAlgoRelays])

    // With virtualization, in-DOM windowing is handled by VirtualNoteList; the
    // hook is retained for its bottom IntersectionObserver, which still drives
    // relay-level pagination via onLoadMore. `showAllInitially: true` neutralizes
    // the hook's internal slicing (visibleItems === items), so we render the
    // full filteredNotes array into the virtualizer.
    const { shouldShowLoadingIndicator, bottomRef } = useInfiniteScroll({
      items: filteredNotes,
      showAllInitially: true,
      onLoadMore: handleLoadMore,
      initialLoading
    })

    const showNewEvents = () => {
      setEvents((oldEvents) => mergeTimelines([newEvents, oldEvents]))
      setNewEvents([])
      setTimeout(() => {
        // Instant, not smooth: prepending events makes virtua re-measure the
        // new rows, so a smooth animation chases a moving target and lands
        // partway. A direct position set snaps reliably to the top.
        scrollToTop('instant')
      }, 0)
    }

    const list = (
      <div className="min-h-screen">
        {initialLoading && shouldShowLoadingIndicator && <LoadingBar />}
        {pinnedEventIds?.map((id) => <PinnedNoteCard key={id} eventId={id} className="w-full" />)}
        <VirtualNoteList
          items={filteredNotes}
          renderItem={({ key, event, reposters }) =>
            listStyle === NOTIFICATION_LIST_STYLE.COMPACT ? (
              <CompactNoteRow key={key} event={event} />
            ) : (
              <NoteCard
                key={key}
                className="w-full"
                event={event}
                filterMutedNotes={filterMutedNotes}
                reposters={reposters}
              />
            )
          }
        />
        <div ref={bottomRef} />
        {shouldShowLoadingIndicator || filtering || initialLoading ? (
          <NoteCardLoadingSkeleton />
        ) : events.length ? (
          <div className="text-muted-foreground mt-2 text-center text-sm">{t('no more notes')}</div>
        ) : (
          <div className="mt-8 flex w-full flex-col items-center justify-center gap-4">
            <div className="text-muted-foreground text-center">
              <div className="text-lg font-medium">{t('No notes found')}</div>
              <div className="mt-1 text-sm">{t('Try again later or check your connection')}</div>
            </div>
            <Button size="lg" onClick={() => setRefreshCount((count) => count + 1)}>
              {t('Reload')}
            </Button>
          </div>
        )}
      </div>
    )

    return (
      <NewlyArrivedContext.Provider value={recentlyArrivedIds}>
        <div>
          <div ref={topRef} className="scroll-mt-24.25" />
          <PullToRefresh
            onRefresh={async () => {
              refresh()
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }}
          >
            {list}
          </PullToRefresh>
          <div className="h-20" />
          {pendingNewRows.length > 0 && (
            <NewNotesButton newEvents={pendingNewRows.map(({ event }) => event)} onClick={showNewEvents} />
          )}
        </div>
      </NewlyArrivedContext.Provider>
    )
  }
)
NoteList.displayName = 'NoteList'
export default NoteList
