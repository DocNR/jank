// src/components/Column/HomeColumnBody.tsx
import FollowingFeed from '@/components/FollowingFeed'
import { useAccountScope } from '@/providers/AccountScope'
import { useColumns } from '@/providers/ColumnsProvider'
import { TColumn } from '@/types/column'
import { useCallback } from 'react'

/**
 * Body of a Home column. Subscribes to the following feed of the column's
 * `viewContext` (not the global active account) — any pubkey, paired or
 * foreign — via the enclosing <AccountScope>. Passes that pubkey explicitly to
 * <FollowingFeed> so it ignores the global useNostr() pubkey.
 *
 * Also owns the per-column "Notes vs Notes-and-replies" tab preference: seeds
 * the feed from `column.config.feedTab` and persists the user's choice back via
 * updateColumnConfig (localStorage immediately; rides the deck's NIP-78 sync on
 * the next deck save). Absent config → 'posts' (Notes), the app default.
 *
 * Lives as its own file because Phase 2 will customize per-column toolbars and
 * Phase 3 may swap the underlying feed component for a column-specific variant.
 */
export default function HomeColumnBody({ column }: { column: TColumn }) {
  const { viewContext } = useAccountScope()
  const { updateColumnConfig } = useColumns()
  const handleTabChange = useCallback(
    (tabId: string) => {
      // Only the two known feed tabs reach here; cast narrows string → the
      // config union. An unknown value would be ignored by resolveInitialTabId
      // on next mount anyway.
      updateColumnConfig(column.id, { feedTab: tabId as 'posts' | 'postsAndReplies' })
    },
    [column.id, updateColumnConfig]
  )
  return (
    <FollowingFeed
      pubkey={viewContext}
      initialTabId={column.config?.feedTab}
      onTabChange={handleTabChange}
    />
  )
}
