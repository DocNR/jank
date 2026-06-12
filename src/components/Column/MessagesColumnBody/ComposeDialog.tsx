import userSearchIndex from '@/services/search/user-search-index.service'
import replaceableEventCache from '@/services/caches/replaceable-event-cache.service'
import { ExtendedKind } from '@/constants'
import { relayTagsToUrls } from '@/services/dm-inbox.service'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TProfile } from '@/types'

type Props = {
  onPick: (pubkey: string) => void
  onClose: () => void
}

/**
 * ComposeDialog — search-as-you-type user picker for starting a new DM thread.
 *
 * Renders inline within the narrow column (no Dialog/Sheet primitive needed —
 * the full column body becomes the picker until the user cancels or picks).
 *
 * Selecting a user resolves their kind-10050 DM-relay list; if empty, shows an
 * inline "hasn't enabled private DMs" notice instead of opening a broken thread.
 */
export default function ComposeDialog({ onPick, onClose }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TProfile[]>([])
  const [notReadyPubkey, setNotReadyPubkey] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const search = async (q: string) => {
    setQuery(q)
    setNotReadyPubkey(null)
    if (!q.trim()) {
      setResults([])
      return
    }
    const profiles = await userSearchIndex.searchProfilesFromLocal(q, 50)
    setResults(profiles)
  }

  const choose = async (pubkey: string) => {
    setChecking(true)
    setNotReadyPubkey(null)
    try {
      const ev = await replaceableEventCache.fetchReplaceableEvent(pubkey, ExtendedKind.DM_RELAY_LIST)
      if (!relayTagsToUrls(ev).length) {
        setNotReadyPubkey(pubkey)
        return
      }
      onPick(pubkey)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header row with cancel */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <button
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <span className="inline-block rtl:-scale-x-100">‹</span>
          {t('Back')}
        </button>
        <span className="flex-1 text-sm font-medium">{t('New message')}</span>
      </div>

      {/* Search input */}
      <div className="p-2">
        <input
          autoFocus
          className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('Search people…')}
          value={query}
          onChange={(e) => void search(e.target.value)}
          disabled={checking}
        />
      </div>

      {/* "Not ready" notice (persists until next search change) */}
      {notReadyPubkey && (
        <div className="mx-2 mb-1 rounded bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {t("This user hasn't enabled private DMs")}
        </div>
      )}

      {/* Result rows */}
      <div className="flex-1 overflow-y-auto">
        {results.map((profile) => (
          <button
            key={profile.pubkey}
            className="flex w-full items-center gap-2 p-2 text-start hover:bg-muted disabled:opacity-50"
            disabled={checking}
            onClick={() => void choose(profile.pubkey)}
          >
            <SimpleUserAvatar userId={profile.pubkey} size="medium" />
            <div className="min-w-0 flex-1">
              <SimpleUsername
                userId={profile.pubkey}
                className="truncate text-sm font-medium"
                withoutSkeleton
              />
            </div>
            {/* Show "no DMs" badge next to the specific row that failed */}
            {notReadyPubkey === profile.pubkey && (
              <span className="shrink-0 text-xs text-destructive">
                {t('No DMs')}
              </span>
            )}
          </button>
        ))}

        {/* Empty state when a query returned nothing */}
        {query.trim() && results.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t('No results')}
          </div>
        )}
      </div>
    </div>
  )
}
