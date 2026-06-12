// src/components/Column/NotificationsColumnBody.tsx
import NotificationList from '@/components/NotificationList'
import { useAccountScope } from '@/providers/AccountScope'
import { NotificationProvider } from '@/providers/NotificationProvider'
import { TColumn } from '@/types/column'

/**
 * Body of a Notifications column. Mounts its own per-pubkey
 * <NotificationProvider> in column mode (no favicon/title badge, no
 * primary-page sentinel) so each column drives an independent service
 * instance scoped to the column's `viewContext` — the pubkey whose mentions
 * are shown (any pubkey, paired or foreign).
 *
 * The underlying service is refcounted by pubkey, so two columns for the
 * same viewContext share one subscription. Read-state is per-mount.
 *
 * The `column` prop carries `config.listStyle` — the per-column override of
 * the global compact/detailed pref (shared with every list-style column
 * type). Toggled by the compact/detailed button in ColumnHeader.
 */
export default function NotificationsColumnBody({ column }: { column: TColumn }) {
  const { viewContext } = useAccountScope()
  return (
    <NotificationProvider pubkey={viewContext} mode="column">
      <NotificationList styleOverride={column.config?.listStyle} columnId={column.id} />
    </NotificationProvider>
  )
}
