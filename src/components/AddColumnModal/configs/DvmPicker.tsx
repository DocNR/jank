import UserAvatar from '@/components/UserAvatar'
import { useDvmDirectory } from '@/hooks/useDvmDirectory'
import { getDvmName, TDvmHandler } from '@/lib/dvm'
import { cn } from '@/lib/utils'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Compass, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigFormProps } from '../column-types'

/**
 * ConfigForm for the DVM Feed column. Subscribes to the kind-31990 directory,
 * lets the user filter by name + about substring, and pick a single DVM to
 * pin. The selection is mirrored into `draft.config.{dvmPubkey, dvmIdentifier}`
 * so the PreviewBody (DvmFeedColumnBody) can render the toolbar with the
 * chosen DVM and so PreviewScreen's "Add column" button activates.
 *
 * Below the picker, a "Browse all DVMs as a column" link spawns a
 * dvm-discover column instead (and dismisses the modal) — escape hatch for
 * users who want the persistent browsing shelf rather than a single feed.
 */
export default function DvmPicker({ draft, onChange, onClose }: ConfigFormProps) {
  const { t } = useTranslation()
  const { handlers, eosed } = useDvmDirectory()
  const { addColumn } = useColumns()
  const { account } = useNostr()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return handlers
    return handlers.filter((h) => {
      const name = getDvmName(h).toLowerCase()
      const about = (h.metadata.about ?? '').toLowerCase()
      return name.includes(q) || about.includes(q)
    })
  }, [handlers, query])

  const selectedKey =
    draft.config?.dvmPubkey && draft.config?.dvmIdentifier
      ? `${draft.config.dvmPubkey}:${draft.config.dvmIdentifier}`
      : null

  const handleSelect = (handler: TDvmHandler) => {
    onChange({
      ...draft,
      config: {
        ...draft.config,
        dvmPubkey: handler.pubkey,
        dvmIdentifier: handler.identifier
      }
    })
  }

  const handleBrowseAll = () => {
    if (!account) return
    addColumn({
      id: crypto.randomUUID(),
      viewContext: account.pubkey,
      signingIdentity: account.pubkey,
      type: 'dvm-discover'
    })
    onClose?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search DVMs…')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-hidden"
        />
      </div>

      <div className="bg-background max-h-56 divide-y overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground p-3 text-center text-xs">
            {eosed
              ? query
                ? t('No matching DVMs')
                : t('No DVMs found')
              : t('Loading DVMs…')}
          </div>
        ) : (
          filtered.map((handler) => {
            const key = `${handler.pubkey}:${handler.identifier}`
            const isSelected = key === selectedKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelect(handler)}
                className={cn(
                  'flex w-full items-start gap-2 px-2 py-2 text-start outline-hidden transition-colors',
                  isSelected
                    ? 'bg-primary/10 hover:bg-primary/15'
                    : 'hover:bg-muted/40 focus-visible:bg-muted/40'
                )}
              >
                <UserAvatar userId={handler.pubkey} size="xSmall" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className="truncate text-xs font-medium leading-tight"
                    dir="auto"
                  >
                    {getDvmName(handler)}
                  </span>
                  {handler.metadata.about && (
                    <span
                      className="text-muted-foreground line-clamp-1 text-[10px] leading-snug"
                      dir="auto"
                    >
                      {handler.metadata.about}
                    </span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      <button
        type="button"
        onClick={handleBrowseAll}
        disabled={!account}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-[11px] underline-offset-2 hover:underline disabled:opacity-50"
      >
        <Compass className="size-3" />
        {t('Browse all DVMs as a column')}
      </button>
    </div>
  )
}
