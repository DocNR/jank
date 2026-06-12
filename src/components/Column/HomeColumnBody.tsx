// src/components/Column/HomeColumnBody.tsx
import FollowingFeed from '@/components/FollowingFeed'
import { useAccountScope } from '@/providers/AccountScope'

/**
 * Body of a Home column. Subscribes to the following feed of the column's
 * `viewContext` (not the global active account) — any pubkey, paired or
 * foreign — via the enclosing <AccountScope>. Passes that pubkey explicitly to
 * <FollowingFeed> so it ignores the global useNostr() pubkey.
 *
 * Lives as its own file because Phase 2 will customize per-column toolbars and
 * Phase 3 may swap the underlying feed component for a column-specific variant.
 */
export default function HomeColumnBody() {
  const { viewContext } = useAccountScope()
  return <FollowingFeed pubkey={viewContext} />
}
