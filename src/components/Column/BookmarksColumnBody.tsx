// src/components/Column/BookmarksColumnBody.tsx
import NoteList from '@/components/NoteList'
import { ALLOWED_FILTER_KINDS } from '@/constants'
import { getReplaceableCoordinateFromEvent } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useBookmarkList } from '@/providers/UserListsProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import seenOn from '@/services/caches/seen-on.service'
import { TFeedSubRequest } from '@/types'
import { TColumn } from '@/types/column'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColumnListStyleProvider, useEffectiveListStyle } from './column-list-style-context'

/**
 * Kinds the Bookmarks column subscription accepts. `ALLOWED_FILTER_KINDS`
 * already covers every bookmarkable kind, including kind:30023 long-form
 * articles, so both e-tag (note) and a-tag (addressable article) bookmarks
 * render in the same feed.
 *
 * Exported for tests.
 */
export const BOOKMARK_KINDS = ALLOWED_FILTER_KINDS

/**
 * Splits the kind-10003 bookmark list event into raw hex e-tag ids and a-tag
 * coordinate strings (`kind:pubkey:d`). Other tag types are ignored. Dedupes
 * both (real bookmark lists carry resync-collision duplicates; duplicate
 * naddrs surfaced as a React duplicate-key warning during smoke).
 *
 * Exported for tests.
 */
export function extractBookmarkIds(bookmarkListEvent: Event | null): {
  eTagIds: string[]
  aTagCoords: string[]
} {
  if (!bookmarkListEvent) return { eTagIds: [], aTagCoords: [] }
  const eTagIds: string[] = []
  const aTagCoords: string[] = []
  const seenEIds = new Set<string>()
  const seenACoords = new Set<string>()
  for (const tag of bookmarkListEvent.tags) {
    if (typeof tag[1] !== 'string' || tag[1].length === 0) continue
    if (tag[0] === 'e') {
      if (!seenEIds.has(tag[1])) {
        seenEIds.add(tag[1])
        eTagIds.push(tag[1])
      }
    } else if (tag[0] === 'a') {
      if (!seenACoords.has(tag[1])) {
        seenACoords.add(tag[1])
        aTagCoords.push(tag[1])
      }
    }
  }
  return { eTagIds, aTagCoords }
}

/**
 * Parses an a-tag coordinate `kind:pubkey:d` into its parts. The d-tag may
 * itself contain colons, so everything after the second colon is the d-tag.
 * Returns null for malformed coordinates.
 *
 * Exported for tests.
 */
export function parseATagCoordinate(
  coord: string
): { kind: number; pubkey: string; dTag: string } | null {
  const parts = coord.split(':')
  if (parts.length < 3) return null
  const kind = Number(parts[0])
  const pubkey = parts[1]
  if (!Number.isFinite(kind) || !pubkey) return null
  return { kind, pubkey, dTag: parts.slice(2).join(':') }
}

/**
 * Builds the over-fetch filter that resolves a-tag (addressable) bookmarks to
 * concrete events. NIP-01 array values are OR'd, so this returns the cartesian
 * product of the bookmarked kinds × authors × d-tags; the caller trims back to
 * the exact coordinates. The `#d` constraint keeps the over-fetch tiny in
 * practice (d-tags are near-unique). Returns null when there are no a-tags.
 *
 * Exported for tests.
 */
export function buildATagResolveFilter(aTagCoords: string[]): {
  kinds: number[]
  authors: string[]
  '#d': string[]
} | null {
  const kindSet = new Set<number>()
  const authorSet = new Set<string>()
  const dTagSet = new Set<string>()
  for (const coord of aTagCoords) {
    const parsed = parseATagCoordinate(coord)
    if (!parsed) continue
    kindSet.add(parsed.kind)
    authorSet.add(parsed.pubkey)
    dTagSet.add(parsed.dTag)
  }
  if (kindSet.size === 0 || authorSet.size === 0) return null
  return { kinds: [...kindSet], authors: [...authorSet], '#d': [...dTagSet] }
}

/**
 * Builds the single NoteList sub-request for the Bookmarks column: one
 * ids-bounded request over the union of e-tag ids and the resolved a-tag
 * article ids. A single ids request means one relay subscription (no
 * per-coordinate REQ fan-out) and the fast primary-key IndexedDB replay for
 * everything, and lets notes and articles interleave by created_at.
 *
 * Exported for tests.
 */
export function buildBookmarksSubRequests(urls: string[], ids: string[]): TFeedSubRequest[] {
  if (ids.length === 0) return []
  return [{ urls, filter: { ids, kinds: BOOKMARK_KINDS } }]
}

/**
 * Resolves a-tag (addressable) bookmark coordinates to concrete event ids.
 * Reads the local IndexedDB coordinate index first (v24 coordinateIndex) so
 * cached articles resolve with no relay round-trip; only genuinely-missing
 * coordinates hit a relay, and those results are written back so the next load
 * is local. Trims the cartesian relay over-fetch to the exact coordinates and
 * keeps the latest version per coordinate.
 *
 * Exported for reuse/tests.
 */
export async function resolveATagEventIds(
  urls: string[],
  aTagCoords: string[]
): Promise<string[]> {
  if (aTagCoords.length === 0) return []
  const wanted = new Set(aTagCoords)
  const byCoord = new Map<string, Event>()
  const keepLatest = (evt: Event) => {
    const coord = getReplaceableCoordinateFromEvent(evt)
    if (!wanted.has(coord)) return
    const existing = byCoord.get(coord)
    if (!existing || evt.created_at > existing.created_at) byCoord.set(coord, evt)
  }

  // 1. Local coordinate cache (fast, no network).
  const cached = await indexedDb.getEventsByCoordinates(aTagCoords)
  cached.forEach(keepLatest)

  // 2. Relay fallback for coordinates still missing; write back so the next
  //    load resolves locally. One query (not a REQ per coordinate).
  const missing = aTagCoords.filter((c) => !byCoord.has(c))
  const filter = buildATagResolveFilter(missing)
  if (filter) {
    const fetched = await client.query(urls, filter)
    if (fetched.length) {
      indexedDb.putEvents(
        fetched.map((evt) => ({ event: evt, relays: seenOn.getEventHints(evt.id) }))
      )
    }
    fetched.forEach(keepLatest)
  }

  return [...byCoord.values()].map((evt) => evt.id)
}

/**
 * Body of a Bookmarks column. Renders one reverse-chronological <NoteList>
 * (sorted by created_at) covering both e-tag notes and a-tag addressable
 * articles, rather than separate tag-grouped sections.
 *
 * e-tag ids are known up front and drive the instant IndexedDB cache replay.
 * a-tag (article) coordinates are resolved to event ids — from the local
 * coordinate cache when possible, else one relay query — then folded into the
 * same ids feed so articles slot into place by date. Keeping everything in a
 * single ids sub-request means one subscription (not a REQ per article) and
 * the fast primary-key replay path.
 *
 * No account plumbing here: the column is already wrapped in <AccountScope> →
 * <ScopedUserListsProvider>, which re-provides BookmarkListContext keyed on the
 * column's `viewContext`. So `useBookmarkList()` resolves to viewContext's
 * bookmark list, including foreign pubkeys, since kind-10003 lists are public.
 *
 * The `column` prop carries `config.listStyle` — the per-column compact/
 * detailed override, toggled by the compact/detailed button in ColumnHeader.
 */
export default function BookmarksColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const { bookmarkListEvent } = useBookmarkList()

  const { eTagIds, aTagCoords } = useMemo(
    () => extractBookmarkIds(bookmarkListEvent),
    [bookmarkListEvent]
  )

  // Resolve a-tag (addressable) bookmarks to concrete event ids. e-tag notes
  // render immediately from the ids we already have; articles fold in once
  // resolved (local cache is near-instant; cold cache does one relay query).
  const [articleIds, setArticleIds] = useState<string[]>([])
  const aTagKey = aTagCoords.join(',')
  useEffect(() => {
    if (aTagCoords.length === 0) {
      setArticleIds([])
      return
    }
    let cancelled = false
    resolveATagEventIds(getDefaultRelayUrls(), aTagCoords)
      .then((ids) => {
        if (!cancelled) setArticleIds(ids)
      })
      .catch(() => {
        if (!cancelled) setArticleIds([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aTagKey])

  const allIds = useMemo(() => [...eTagIds, ...articleIds], [eTagIds, articleIds])

  const subRequests = useMemo<TFeedSubRequest[]>(
    () => buildBookmarksSubRequests(getDefaultRelayUrls(), allIds),
    [allIds]
  )

  if (eTagIds.length === 0 && aTagCoords.length === 0) {
    return (
      <ColumnListStyleProvider styleOverride={column.config?.listStyle}>
        <div className="text-muted-foreground mt-2 text-center text-sm">
          {t('no bookmarks found')}
        </div>
      </ColumnListStyleProvider>
    )
  }

  return (
    <ColumnListStyleProvider styleOverride={column.config?.listStyle}>
      <BookmarksNoteListInner subRequests={subRequests} />
    </ColumnListStyleProvider>
  )
}

function BookmarksNoteListInner({ subRequests }: { subRequests: TFeedSubRequest[] }) {
  const listStyle = useEffectiveListStyle()
  return (
    <NoteList
      subRequests={subRequests}
      showKinds={BOOKMARK_KINDS}
      listStyle={listStyle}
      // Replay cached bookmark events from IndexedDB on mount so the column
      // paints instantly; uncached bookmarks arrive via the relay
      // subscription. See NoteList prop docs.
      cacheToIndexedDb
    />
  )
}
