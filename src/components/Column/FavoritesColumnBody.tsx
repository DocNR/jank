import NoteList from '@/components/NoteList'
import Tabs from '@/components/Tabs'
import { DEFAULT_FEED_TABS } from '@/constants'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useFavorites } from '@/providers/UserListsProvider'
import { TFeedSubRequest } from '@/types'
import { TColumn } from '@/types/column'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Exported for tests. */
export const FAVORITES_KINDS = [1, 6]

/**
 * Pure filter-builder exported for unit tests. Builds the single sub-request
 * for a Favorites feed: kind:1,6 from the user's pinned-users pubkey set.
 */
export function buildFavoritesSubRequests(
  urls: string[],
  favoritePubkeys: string[]
): TFeedSubRequest[] {
  return [
    {
      urls,
      filter: {
        kinds: FAVORITES_KINDS,
        authors: favoritePubkeys
      }
    }
  ]
}

/**
 * Body of a Favorites column. Subscribes to kind:1,6 notes from the user's
 * "favorited" pubkeys (kind 10010, internally PINNED_USERS — see
 * ExtendedKind.PINNED_USERS comment).
 *
 * Tabs mirror Home (Notes / Notes and replies) — imports DEFAULT_FEED_TABS
 * directly from constants as the single source of truth. The
 * Uses `useFavorites` (renamed from `usePinnedUsers` in the same PR).
 * Wire/storage identifier stays ExtendedKind.PINNED_USERS = 10010.
 */
export default function FavoritesColumnBody({ column: _column }: { column: TColumn }) {
  const { t } = useTranslation()
  const { favoritePubkeySet } = useFavorites()

  if (favoritePubkeySet.size === 0) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        {t(
          "You haven't favorited any users yet. Tap the star on a profile or in the ⋯ menu of a note to add them here."
        )}
      </div>
    )
  }

  return <FavoritesFeed favoritePubkeySet={favoritePubkeySet} />
}

function FavoritesFeed({ favoritePubkeySet }: { favoritePubkeySet: Set<string> }) {
  const [activeTabId, setActiveTabId] = useState(DEFAULT_FEED_TABS[0].id)
  const activeTab = DEFAULT_FEED_TABS.find((tab) => tab.id === activeTabId) ?? DEFAULT_FEED_TABS[0]

  const subRequests = useMemo<TFeedSubRequest[]>(
    () => buildFavoritesSubRequests(getDefaultRelayUrls(), Array.from(favoritePubkeySet)),
    [favoritePubkeySet]
  )

  return (
    <>
      <Tabs
        // Tabs calls t(tab.label) internally — pass raw label strings from
        // DEFAULT_FEED_TABS, not pre-translated, to avoid double-translation.
        tabs={DEFAULT_FEED_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        value={activeTabId}
        onTabChange={setActiveTabId}
      />
      <NoteList
        subRequests={subRequests}
        showKinds={FAVORITES_KINDS}
        hideReplies={!!activeTab.hideReplies}
        isPubkeyFeed
      />
    </>
  )
}
