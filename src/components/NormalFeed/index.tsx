import NoteList, { TNoteListRef } from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import { DEFAULT_FEED_TABS } from '@/constants'
import { isTouchDevice } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { TFeedSubRequest, TFeedTabConfig } from '@/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KindFilter from '../KindFilter'
import { RefreshButton } from '../RefreshButton'

export default function NormalFeed({
  feedId,
  subRequests,
  areAlgoRelays = false,
  showRelayCloseReason = false,
  onRefresh,
  isPubkeyFeed = false
}: {
  feedId: string
  subRequests: TFeedSubRequest[]
  areAlgoRelays?: boolean
  showRelayCloseReason?: boolean
  onRefresh?: () => void
  isPubkeyFeed?: boolean
}) {
  const { getShowKinds } = useKindFilter()
  const feedShowKinds = useMemo(() => getShowKinds(feedId), [getShowKinds, feedId])
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(feedShowKinds)

  const visibleTabs = useMemo(
    () => DEFAULT_FEED_TABS.filter((tab) => !tab.hidden),
    []
  )

  const [selectedTabId, setSelectedTabId] = useState<string | undefined>()
  const selectedTab: TFeedTabConfig = selectedTabId
    ? (visibleTabs.find((tab) => tab.id === selectedTabId) ?? visibleTabs[0])
    : visibleTabs[0]

  useEffect(() => {
    if (selectedTab && selectedTab.id !== selectedTabId) {
      setSelectedTabId(selectedTab.id)
    }
  }, [selectedTab, selectedTabId])

  const supportTouch = useMemo(() => isTouchDevice(), [])
  const noteListRef = useRef<TNoteListRef>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const subRequestsHaveKinds = useMemo(() => {
    return subRequests.some((req) => !!req.filter.kinds?.length)
  }, [subRequests])
  const tabHasFixedKinds = !!selectedTab?.kinds
  const effectiveShowKinds = selectedTab?.kinds ?? temporaryShowKinds
  const hideReplies = selectedTab?.hideReplies ?? false

  useEffect(() => {
    setTemporaryShowKinds(feedShowKinds)
  }, [feedShowKinds])

  const handleListModeChange = useCallback((mode: string) => {
    setSelectedTabId(mode)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleShowKindsChange = useCallback((newShowKinds: number[]) => {
    setTemporaryShowKinds(newShowKinds)
    noteListRef.current?.scrollToTop()
  }, [])

  return (
    <>
      <Tabs
        value={selectedTab?.id ?? ''}
        tabs={visibleTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        onTabChange={handleListModeChange}
        options={
          <>
            {!supportTouch && (
              <RefreshButton
                onClick={() => {
                  if (onRefresh) {
                    onRefresh()
                    return
                  }
                  noteListRef.current?.refresh()
                }}
              />
            )}
            {!subRequestsHaveKinds && !tabHasFixedKinds && (
              <KindFilter
                feedId={feedId}
                showKinds={temporaryShowKinds}
                onShowKindsChange={handleShowKindsChange}
              />
            )}
          </>
        }
      />
      <div ref={topRef} className="scroll-mt-24.25" />
      {selectedTab ? (
        <NoteList
          ref={noteListRef}
          showKinds={effectiveShowKinds}
          subRequests={subRequests}
          hideReplies={hideReplies}
          areAlgoRelays={areAlgoRelays}
          showRelayCloseReason={showRelayCloseReason}
          isPubkeyFeed={isPubkeyFeed}
        />
      ) : null}
    </>
  )
}
