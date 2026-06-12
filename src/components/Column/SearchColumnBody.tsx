import NoteList from '@/components/NoteList'
import UserItem from '@/components/UserItem'
import { rankPeopleResults } from '@/components/Column/search-people'
import { focusedColumnRequestAtom } from '@/atoms/active-column'
import { getSearchRelayUrls } from '@/lib/relay'
import { randomId } from '@/lib/utils'
import { useFetchFollowings } from '@/hooks/useFetchFollowings'
import userSearchIndex from '@/services/search/user-search-index.service'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useColumns } from '@/providers/ColumnsProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { TFeedSubRequest, TProfile } from '@/types'
import { TColumn } from '@/types/column'
import { useAtomValue, useSetAtom } from 'jotai'
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SEARCH_KINDS = [1]
const QUERY_COMMIT_DEBOUNCE_MS = 300

/**
 * Body of a Search column. Renders a chronological feed of kind-1 notes
 * matching the column's NIP-50 `search` filter, scoped to the user's
 * configured search relays (`getSearchRelayUrls()` → defaults from
 * `SEARCHABLE_RELAY_URLS`). The feed is global (no `authors` / `'#p'`); the
 * column still carries an account via <AccountScope> for compose / mute-list /
 * signing context, same as Hashtag and Relay.
 *
 * The query is edited inline at the top of the body — always visible, edits
 * in place, ~300ms debounce before persisting to `column.config.query` and
 * refreshing the subscription. SearchButton click lands users in an empty
 * Search column with the input ready to receive their next keystroke.
 */
export default function SearchColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const { updateColumnConfig, columns, addColumn } = useColumns()
  // AccountScope's `viewOnly` is true in the AddColumnModal LivePreview (which
  // mounts the body under `signingIdentity={null}`). Skip autoFocus there so
  // the body doesn't steal keyboard focus from the modal's account rail.
  const scope = useAccountScopeOptional()
  const isPreview = scope?.viewOnly ?? false
  const persistedQuery = column.config?.query ?? ''
  const [input, setInput] = useState(persistedQuery)
  const lastPersistedRef = useRef(persistedQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reconcile local input when an external change touches column.config.query —
  // e.g. focus-or-create reactivation, or a future shared-deck import. Guard
  // against the trivial loopback: if the persisted value matches what we just
  // committed, don't clobber the user's in-flight keystrokes.
  useEffect(() => {
    if (persistedQuery === lastPersistedRef.current) return
    lastPersistedRef.current = persistedQuery
    setInput(persistedQuery)
  }, [persistedQuery])

  // Auto-focus the input (and select-all if non-virgin) on (1) initial mount
  // and (2) every focus-or-create re-click that fires `focusedColumnRequestAtom`
  // with this column's id. Mount alone isn't enough — re-clicking the sidebar
  // SearchButton against an already-open Search column doesn't remount the
  // body; it just sets the focus-request atom. Listening to that atom lets the
  // same "land cursor + select existing text" affordance apply to both paths.
  //
  // Guard rail: DeckArea clears `focusedColumnRequestAtom` back to `null` after
  // handling, which would re-trigger this effect and yank in-progress typing
  // out of the input. The `mountedRef` lets the first run pass unconditionally
  // (mount); subsequent runs only fire when the request explicitly targets
  // THIS column.
  const focusRequest = useAtomValue(focusedColumnRequestAtom)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (isPreview) return
    const isMount = !mountedRef.current
    mountedRef.current = true
    if (!isMount && focusRequest !== column.id) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (el.value) el.select()
  }, [focusRequest, column.id, isPreview])

  // Debounced commit: 300ms after the last keystroke, write to
  // column.config.query, which re-renders NoteList with a new filter and
  // re-subscribes (NoteList deps are JSON.stringify(subRequests), so identity
  // change is detected naturally — no `key` prop needed).
  useEffect(() => {
    if (input === persistedQuery) return
    const handle = setTimeout(() => {
      lastPersistedRef.current = input
      updateColumnConfig(column.id, { query: input })
    }, QUERY_COMMIT_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [input, persistedQuery, column.id, updateColumnConfig])

  const trimmed = input.trim()
  const subRequests = useMemo<TFeedSubRequest[]>(
    () => [{ urls: getSearchRelayUrls(), filter: { kinds: SEARCH_KINDS, search: trimmed } }],
    [trimmed]
  )

  const PEOPLE_CAP = 3
  const accountPubkey = scope?.signingIdentity ?? scope?.viewContext ?? null
  const { followings } = useFetchFollowings(accountPubkey)
  const followingSet = useMemo(() => new Set(followings), [followings])
  const { isUserTrusted } = useUserTrust()
  const setFocusedColumn = useSetAtom(focusedColumnRequestAtom)

  const [people, setPeople] = useState<TProfile[]>([])
  useEffect(() => {
    const q = input.trim()
    if (isPreview || !q) {
      setPeople([])
      return
    }
    let active = true
    const handle = setTimeout(() => {
      userSearchIndex
        .searchProfilesFromLocal(q, 20)
        .then((profiles) => {
          if (active) setPeople(rankPeopleResults(profiles, followingSet, isUserTrusted, PEOPLE_CAP))
        })
        .catch(() => {})
    }, 300)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [input, isPreview, followingSet, isUserTrusted])

  const handleSeeAll = () => {
    if (accountPubkey === null) return
    const q = input.trim()
    if (!q) return
    const existing = columns.find(
      (c) => c.type === 'relatr-discovery' && c.config?.relatrQuery === q
    )
    if (existing) {
      setFocusedColumn(existing.id)
      return
    }
    const col: TColumn = {
      id: randomId(),
      type: 'relatr-discovery',
      viewContext: scope?.viewContext ?? accountPubkey,
      signingIdentity: scope?.signingIdentity ?? null,
      config: { relatrQuery: q }
    }
    addColumn(col)
    setFocusedColumn(col.id)
  }

  return (
    <div className="flex h-full flex-col">
      {!isPreview && (
        <div className="bg-card sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('Search Nostr…')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-hidden"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label={t('Clear')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
      {trimmed === '' ? (
        <div className="text-muted-foreground p-4 text-center text-sm">
          {t('Enter a search query')}
        </div>
      ) : (
        <>
          {people.length > 0 && (
            <div className="border-b">
              <div className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide">
                {t('People')}
              </div>
              <div className="px-3">
                {people.map((profile) => (
                  <UserItem key={profile.pubkey} userId={profile.pubkey} showFollowingBadge />
                ))}
              </div>
              <button
                type="button"
                onClick={handleSeeAll}
                className="text-primary w-full px-3 pb-2 pt-1 text-start text-sm hover:underline"
              >
                {t('See all')}
              </button>
            </div>
          )}
          <NoteList
            subRequests={subRequests}
            showKinds={SEARCH_KINDS}
            wotOnly={!!column.config?.wotOnly}
          />
        </>
      )}
    </div>
  )
}
