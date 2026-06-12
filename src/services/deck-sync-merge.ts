import type { TAccountWorkspace, TColumn, TDeck, TPairedAgent } from '@/types/column'

/** A deck has unsaved edits if its live columns differ from its saved snapshot (transient excluded). */
function deckDirty(deck: TDeck): boolean {
  const live = deck.columns.filter((c: TColumn) => !c.transient)
  const saved = deck.savedColumns.filter((c: TColumn) => !c.transient)
  return JSON.stringify(live) !== JSON.stringify(saved)
}

export type TMergeResult = {
  /** The merged workspace to write to storage (safe parts applied). */
  merged: TAccountWorkspace
  /** Local decks kept because they had unsaved edits while the remote also changed — need explicit approval. */
  conflicts: TDeck[]
}

/**
 * Per-deck merge of a remote workspace into the local workspace (pull side). Non-destructive:
 *
 * - remote deck **not present** locally → **add** it
 * - local deck with **unsaved edits** (dirty) → **keep local**, report as a conflict
 * - local deck clean, remote's `lastSavedAt` **newer** → **update** to remote (per-deck LWW)
 * - local deck clean, local **newer/equal** → **keep local** (don't downgrade)
 * - **local-only** deck (absent from remote) → **keep** (delete-propagation is a separate backlog item)
 *
 * `activeDeckId`: keep local's if its deck survives, else remote's, else the first merged deck.
 * A `null`/absent local workspace means "fresh device" → take remote wholesale.
 */
export function mergeRemoteWorkspace(
  local: TAccountWorkspace | undefined,
  remote: TAccountWorkspace
): TMergeResult {
  if (!local) return { merged: remote, conflicts: [] }

  const localById = new Map(local.decks.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const conflicts: TDeck[] = []
  const mergedDecks: TDeck[] = []

  for (const rd of remote.decks) {
    seen.add(rd.id)
    const ld = localById.get(rd.id)
    if (!ld) {
      mergedDecks.push(rd) // new on another device
    } else if (deckDirty(ld)) {
      mergedDecks.push(ld) // unsaved local edits win
      conflicts.push(ld)
    } else if (rd.lastSavedAt > ld.lastSavedAt) {
      mergedDecks.push(rd) // remote is newer
    } else {
      mergedDecks.push(ld) // local newer or equal
    }
  }

  for (const ld of local.decks) {
    if (!seen.has(ld.id)) mergedDecks.push(ld) // local-only → keep (no delete propagation)
  }

  const ids = new Set(mergedDecks.map((d) => d.id))
  let activeDeckId = local.activeDeckId
  if (!ids.has(activeDeckId)) {
    activeDeckId = ids.has(remote.activeDeckId)
      ? remote.activeDeckId
      : (mergedDecks[0]?.id ?? local.activeDeckId)
  }

  const mergedPairedAgents = mergePairedAgents(local.pairedAgents, remote.pairedAgents)
  // allowSiblingExposure: remote indicates a recent edit by another device — if
  // the user toggled on the other device, that's authoritative.
  const allowSiblingExposure = remote.allowSiblingExposure ?? local.allowSiblingExposure

  return {
    merged: {
      activeDeckId,
      decks: mergedDecks,
      ...(mergedPairedAgents.length > 0 ? { pairedAgents: mergedPairedAgents } : {}),
      ...(allowSiblingExposure !== undefined ? { allowSiblingExposure } : {})
    },
    conflicts
  }
}

/**
 * Merge two paired-agent lists. Rules (per spec §6.2):
 * - Union by npub: agents in either list are kept
 * - Same-npub conflict: last-`pairedAt`-wins for the agent's properties
 * - `lastCalledAt`: max-of-both (heartbeat data, monotonic non-decreasing)
 */
export function mergePairedAgents(
  local: TPairedAgent[] | undefined,
  remote: TPairedAgent[] | undefined
): TPairedAgent[] {
  if (!local && !remote) return []
  if (!local) return [...(remote as TPairedAgent[])]
  if (!remote) return [...local]

  const byNpub = new Map<string, TPairedAgent>()
  for (const a of local) byNpub.set(a.npub, a)

  for (const remoteAgent of remote) {
    const localAgent = byNpub.get(remoteAgent.npub)
    if (!localAgent) {
      byNpub.set(remoteAgent.npub, remoteAgent)
      continue
    }
    // Same-npub: pick newer pairedAt for the agent record itself
    const winner = remoteAgent.pairedAt > localAgent.pairedAt ? remoteAgent : localAgent
    // lastCalledAt: max-of-both
    const lastCalledAt =
      localAgent.lastCalledAt && remoteAgent.lastCalledAt
        ? Math.max(localAgent.lastCalledAt, remoteAgent.lastCalledAt)
        : (localAgent.lastCalledAt ?? remoteAgent.lastCalledAt)
    byNpub.set(remoteAgent.npub, { ...winner, lastCalledAt })
  }

  return Array.from(byNpub.values())
}
