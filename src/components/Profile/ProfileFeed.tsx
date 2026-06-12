import KindFilter from '@/components/KindFilter'
import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import { MAX_PINNED_NOTES } from '@/constants'
import { useReplaceableEvent } from '@/hooks/useReplaceableEvent'
import { getDefaultRelayUrls, getSearchRelayUrls } from '@/lib/relay'
import { generateBech32IdFromETag } from '@/lib/tag'
import { isTouchDevice } from '@/lib/utils'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScrollContainer } from '@/providers/ScrollContainerProvider'
import pinListService from '@/services/fetchers/pin-list.service'
import relayListService from '@/services/fetchers/relay-list.service'
import relayInfoService from '@/services/relay-info.service'
import { TFeedSubRequest } from '@/types'
import { kinds, NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshButton } from '../RefreshButton'
import { buildProfileTabs, TProfileTab } from './profile-feed-tabs'
import { isReplyNoteEvent } from '@/lib/event'
import ProfileRelaysTab from './tabs/ProfileRelaysTab'
import ProfileMediaTab from './tabs/ProfileMediaTab'
import ProfileReactionsTab from './tabs/ProfileReactionsTab'
import ProfileZapsTab from './tabs/ProfileZapsTab'

export default function ProfileFeed({ pubkey, search = '' }: { pubkey: string; search?: string }) {
  const { pubkey: accountPubkey } = useNostr()
  const scope = useAccountScopeOptional()
  const myPubkey = scope?.signingIdentity ?? accountPubkey
  const myPinListEvent = useReplaceableEvent(myPubkey, kinds.Pinlist)
  const { getShowKinds } = useKindFilter()
  const feedId = `profile-${pubkey}`
  const feedShowKinds = useMemo(() => getShowKinds(feedId), [getShowKinds, feedId])
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(feedShowKinds)

  const visibleTabs = useMemo<TProfileTab[]>(
    () => buildProfileTabs({ isSelf: myPubkey === pubkey, hasViewer: !!myPubkey }),
    [myPubkey, pubkey]
  )

  const [selectedTabId, setSelectedTabId] = useState<string | undefined>()
  const selectedTab: TProfileTab = selectedTabId
    ? (visibleTabs.find((tab) => tab.id === selectedTabId) ?? visibleTabs[0])
    : visibleTabs[0]

  useEffect(() => {
    if (selectedTab && selectedTab.id !== selectedTabId) {
      setSelectedTabId(selectedTab.id)
    }
  }, [selectedTab, selectedTabId])

  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [pinnedEventIds, setPinnedEventIds] = useState<string[]>([])
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const noteListRef = useRef<TNoteListRef>(null)
  const scrollContainerRef = useScrollContainer()
  const tabsAnchorRef = useRef<HTMLDivElement>(null)

  const view = selectedTab?.view ?? 'notes'
  const isYouMode = selectedTab?.id === 'you'
  const isArticles = selectedTab?.id === 'articles'
  const hideReplies = selectedTab?.hideReplies ?? false
  const onlyReplies = selectedTab?.onlyReplies ?? false
  const effectiveShowKinds = isArticles ? [kinds.LongFormArticle] : temporaryShowKinds

  useEffect(() => {
    const initPinnedEventIds = async () => {
      let evt: NostrEvent | null = null
      // Cache hit only when the column-effective signer matches the profile AND
      // the global active matches it too — otherwise myPinListEvent is the
      // wrong account's pin list (e.g. column overridden to B, global still A).
      if (pubkey === myPubkey && myPubkey === accountPubkey) {
        evt = myPinListEvent ?? null
      } else {
        evt = await pinListService.fetchPinListEvent(pubkey)
      }
      const hexIdSet = new Set<string>()
      const ids =
        (evt?.tags
          .filter((tag) => tag[0] === 'e')
          .reverse()
          .slice(0, MAX_PINNED_NOTES)
          .map((tag) => {
            const [, hexId, relay, _pubkey] = tag
            if (!hexId || hexIdSet.has(hexId) || (_pubkey && _pubkey !== pubkey)) {
              return undefined
            }

            const id = generateBech32IdFromETag(['e', hexId, relay ?? '', pubkey])
            if (id) {
              hexIdSet.add(hexId)
            }
            return id
          })
          .filter(Boolean) as string[]) ?? []
      setPinnedEventIds(ids)
    }
    initPinnedEventIds()
  }, [pubkey, myPubkey, accountPubkey, myPinListEvent])

  useEffect(() => {
    const init = async () => {
      if (view !== 'notes' && view !== 'articles') {
        setSubRequests([])
        return
      }

      if (isYouMode) {
        if (!myPubkey) {
          setSubRequests([])
          return
        }

        const [relayList, myRelayList] = await Promise.all([
          relayListService.fetchRelayList(pubkey),
          relayListService.fetchRelayList(myPubkey)
        ])

        setSubRequests([
          {
            urls: myRelayList.write.concat(getDefaultRelayUrls()).slice(0, 5),
            filter: {
              authors: [myPubkey],
              '#p': [pubkey]
            }
          },
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 5),
            filter: {
              authors: [pubkey],
              '#p': [myPubkey]
            }
          }
        ])
        return
      }

      if (isArticles) {
        const relayList = await relayListService.fetchRelayList(pubkey)
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: { authors: [pubkey], kinds: [kinds.LongFormArticle] }
          }
        ])
        return
      }

      const relayList = await relayListService.fetchRelayList(pubkey)

      if (search) {
        const writeRelays = relayList.write.slice(0, 8)
        const relayInfos = await relayInfoService.getRelayInfos(writeRelays)
        const searchableRelays = writeRelays.filter((_, index) =>
          relayInfos[index]?.supported_nips?.includes(50)
        )
        setSubRequests([
          {
            urls: searchableRelays.concat(getSearchRelayUrls()).slice(0, 8),
            filter: { authors: [pubkey], search }
          }
        ])
      } else {
        setSubRequests([
          {
            urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
            filter: {
              authors: [pubkey]
            }
          }
        ])
      }
    }
    init()
  }, [pubkey, view, isYouMode, isArticles, search])

  // The Tabs bar is CSS-sticky (`top-12`, i.e. 48px below the column header) and
  // the profile header (banner/bio/search) scrolls above it in the same container.
  // On tab switch we want the new feed to start at its first item with the tabs
  // pinned — NOT to scroll all the way up and re-reveal the banner. So we snap to
  // the tab anchor ONLY when the user is already scrolled past it (tabs pinned).
  // When the header is still visible, we leave the scroll alone and just swap the
  // feed below, so reading the bio isn't interrupted.
  const STICKY_TABS_OFFSET = 48 // matches Tabs `sticky top-12`
  const snapToTabAnchor = () => {
    const scrollEl = scrollContainerRef?.current
    const anchor = tabsAnchorRef.current
    if (!scrollEl || !anchor) return
    const anchorTop =
      scrollEl.scrollTop +
      anchor.getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top -
      STICKY_TABS_OFFSET
    if (scrollEl.scrollTop > anchorTop) {
      scrollEl.scrollTo({ top: Math.max(0, anchorTop), behavior: 'instant' })
    }
  }

  const handleListModeChange = (mode: string) => {
    setSelectedTabId(mode)
    snapToTabAnchor()
  }

  const handleShowKindsChange = (newShowKinds: number[]) => {
    setTemporaryShowKinds(newShowKinds)
    snapToTabAnchor()
  }

  const renderBody = () => {
    switch (view) {
      case 'relays':
        return <ProfileRelaysTab pubkey={pubkey} />
      case 'media':
        return <ProfileMediaTab pubkey={pubkey} />
      case 'zaps':
        return <ProfileZapsTab pubkey={pubkey} />
      case 'reactions':
        return <ProfileReactionsTab pubkey={pubkey} />
      case 'notes':
      case 'articles':
      default:
        return (
          <NoteList
            ref={noteListRef}
            subRequests={subRequests}
            showKinds={effectiveShowKinds}
            hideReplies={hideReplies}
            filterMutedNotes={false}
            filterFn={onlyReplies ? isReplyNoteEvent : undefined}
            pinnedEventIds={
              isYouMode || isArticles || onlyReplies || !!search ? [] : pinnedEventIds
            }
            showNewNotesDirectly={myPubkey === pubkey}
          />
        )
    }
  }

  return (
    <>
      <div ref={tabsAnchorRef} className="h-0" />
      <Tabs
        value={selectedTab?.id ?? ''}
        tabs={visibleTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        onTabChange={handleListModeChange}
        options={
          <>
            {!supportTouch && (view === 'notes' || view === 'articles') && (
              <RefreshButton onClick={() => noteListRef.current?.refresh()} />
            )}
            {view === 'notes' && !isYouMode && !isArticles && (
              <KindFilter
                feedId={feedId}
                showKinds={temporaryShowKinds}
                onShowKindsChange={handleShowKindsChange}
              />
            )}
          </>
        }
      />
      {renderBody()}
    </>
  )
}
