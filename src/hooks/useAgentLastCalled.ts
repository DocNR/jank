import { atom, getDefaultStore, useAtomValue } from 'jotai'

/** In-memory map of `${workspaceOwner}:${agentPubkey}` → unix seconds.
 *  Updated by contextVmServer's handleToolsCall on every successful call.
 *  Persisted to NIP-78 throttled at 5-min granularity in a follow-up if
 *  cross-device sync of timestamps becomes visible (see spec §9.6). */
const agentCallStatsAtom = atom<Map<string, number>>(new Map())

const KEY = (workspace: string, agent: string) => workspace + ':' + agent

/** Record a tool call. Called from the server service on every successful
 *  handler invocation. */
export function recordAgentCall(workspaceOwner: string, agentPubkey: string): void {
  const store = getDefaultStore()
  const current = store.get(agentCallStatsAtom)
  const next = new Map(current)
  next.set(KEY(workspaceOwner, agentPubkey), Math.floor(Date.now() / 1000))
  store.set(agentCallStatsAtom, next)
}

/** Read the last-called timestamp for a specific agent. Reactive. */
export function useAgentLastCalled(
  workspaceOwner: string | null,
  agentPubkey: string
): number | null {
  const stats = useAtomValue(agentCallStatsAtom)
  if (!workspaceOwner) return null
  return stats.get(KEY(workspaceOwner, agentPubkey)) ?? null
}
