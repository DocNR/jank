import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConfigFormProps } from '../column-types'

/**
 * Config form for the Search column: a single text input bound to
 * `draft.config.query`. Mirrors HashtagPicker's draft-writeback contract so
 * the query typed in the preview survives the "Add column" commit — without
 * this, SearchColumnBody's internal input only writes via updateColumnConfig
 * against a column that doesn't exist yet in the preview, and the typed
 * query is silently discarded on commit.
 *
 * The body still owns its inline input post-commit (always-visible by design,
 * per SearchColumnBody's header) — SearchColumnBody hides that header while
 * in preview mode (`isPreview`) so the user only sees one input here.
 */
export default function SearchPicker({ draft, onChange }: ConfigFormProps) {
  const { t } = useTranslation()
  const query = draft.config?.query ?? ''

  const setQuery = (next: string) => {
    onChange({ ...draft, config: { ...draft.config, query: next } })
  }

  return (
    <div className="flex items-start gap-3">
      <div className="text-muted-foreground w-20 shrink-0 pt-1.5 text-xs font-medium">
        {t('Search')}
      </div>
      <div className="border-border bg-background flex flex-1 items-center gap-2 rounded-md border px-2 py-1.5">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          type="text"
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search Nostr…')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-hidden"
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={t('Clear')}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
