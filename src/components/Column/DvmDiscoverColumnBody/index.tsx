import { useDvmDirectory } from '@/hooks/useDvmDirectory'
import { TDvmHandler } from '@/lib/dvm'
import { useColumns } from '@/providers/ColumnsProvider'
import { TColumn } from '@/types/column'
import { useTranslation } from 'react-i18next'
import DvmDirectoryRow from './DvmDirectoryRow'

/**
 * Directory of NIP-90 content-discovery DVMs (kind 5300). Subscribes to
 * kind-31990 (NIP-89 Handler Information) events that advertise support for
 * kind 5300 via their `k` tag, validates them, and renders one row per DVM.
 *
 * Click a row → splices an adjacent `dvm-feed` column pinned to that DVM
 * (see ColumnsProvider.addDvmFeedColumn). Re-clicking the same row focuses
 * the existing dvm-feed column instead of spawning a duplicate.
 *
 * No per-account scoping — this is a global directory. The column is fine in
 * view-only mode (renders the list); the signer requirement kicks in only on
 * the spawned dvm-feed column.
 *
 * This column type has no AddColumnModal tile — it's only spawned via the
 * "Browse all DVMs as a column" link inside the DVM Feed picker. The picker
 * is the primary path for adding a configured dvm-feed; this column type is
 * the secondary "persistent browsing shelf" surface for power users.
 */
export default function DvmDiscoverColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const { addDvmFeedColumn } = useColumns()
  const { handlers, eosed } = useDvmDirectory()

  const handleRowClick = (handler: TDvmHandler) => {
    addDvmFeedColumn(
      { pubkey: handler.pubkey, identifier: handler.identifier },
      { signingIdentity: column.signingIdentity, columnId: column.id }
    )
  }

  if (handlers.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        {eosed ? t('No DVMs found') : t('Loading DVMs…')}
      </div>
    )
  }

  return (
    <div className="divide-border flex flex-col divide-y">
      {handlers.map((handler) => (
        <DvmDirectoryRow
          key={`${handler.pubkey}:${handler.identifier}`}
          handler={handler}
          onClick={() => handleRowClick(handler)}
        />
      ))}
    </div>
  )
}
