import NoteList from '@/components/NoteList'
import { getDefaultRelayUrls } from '@/lib/relay'
import { TFeedSubRequest } from '@/types'
import { TColumn } from '@/types/column'
import { kinds } from 'nostr-tools'
import { useMemo } from 'react'

/** Exported for tests. */
export const ARTICLES_KINDS = [kinds.LongFormArticle]

/**
 * Pure filter-builder exported for unit tests.
 * Constructs the single sub-request for an Articles feed.
 */
export function buildArticlesSubRequests(urls: string[]): TFeedSubRequest[] {
  return [{ urls, filter: { kinds: ARTICLES_KINDS } }]
}

/**
 * Body of an Articles column. Open feed of kind-30023 long-form posts from
 * the user's default relays. No `authors` filter — the trust-score filter
 * (shield badge in the column header, `config.trustScoreThreshold`) narrows
 * to the user's chosen trust percentile via rank filtering inside NoteList.
 *
 * Mirrors HashtagColumnBody / SearchColumnBody / RelayColumnBody — open
 * feed + trust-score filter. Long-form is sparse enough (single-digit posts
 * per day across Nostr) that an unscoped subscription is cheap.
 */
export default function ArticlesColumnBody({ column }: { column: TColumn }) {
  const subRequests = useMemo<TFeedSubRequest[]>(
    () => buildArticlesSubRequests(getDefaultRelayUrls()),
    []
  )

  return (
    <NoteList
      subRequests={subRequests}
      showKinds={ARTICLES_KINDS}
      trustScoreThreshold={column.config?.trustScoreThreshold}
      // kind:30023 is sparse (single-digit per day across Nostr), so
      // caching every observed event to IndexedDB doesn't blow up storage.
      // Cold start replays cached articles instantly while the relay
      // subscription warms up in the background. See NoteList prop docs.
      cacheToIndexedDb
    />
  )
}
