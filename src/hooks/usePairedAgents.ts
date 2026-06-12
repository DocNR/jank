import { useColumns } from '@/providers/ColumnsProvider'
import type { TPairedAgent } from '@/types/column'

/** React hook reading the paired-agents list for a Workspace. Reactive on
 *  ColumnsProvider's `workspacesByAccount` state, so adds/removes from the
 *  pairing wizard update the UI immediately. */
export function usePairedAgents(
  workspaceOwner: string | null | undefined
): TPairedAgent[] {
  const { workspacesByAccount } = useColumns()
  if (!workspaceOwner) return []
  return workspacesByAccount[workspaceOwner]?.pairedAgents ?? []
}
