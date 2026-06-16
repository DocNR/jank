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
  /** Local decks kept despite a remote tombstone or a conflicting remote change (unsaved local edits) — need explicit approval. */
  conflicts: TDeck[]
}

/** Tombstones older than this are garbage-collected on merge. 90 days: long
 *  enough that a device offline for months won't resurrect a deleted deck,
 *  cheap enough (each entry ~50 bytes) that growth is a non-issue. */
export const DECK_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** Union two tombstone maps, keeping the latest deletion timestamp per id. */
function unionTombstones(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) }
  for (const [id, ts] of Object.entries(b ?? {})) {
    if (out[id] === undefined || ts > out[id]) out[id] = ts
  }
  return out
}

/**
 * Per-deck merge of a remote workspace into the local workspace (pull side).
 *
 * Decks: remote-not-local → add; locally-dirty → keep + conflict; clean with
 * newer remote → take remote (per-deck LWW); else keep local; local-only → keep.
 *
 * Tombstones (`deletedDecks`): unioned across both sides (max timestamp per id).
 * A candidate deck whose id is tombstoned is DROPPED unless it was saved after
 * the delete (`lastSavedAt > deletedAt`, LWW resurrection) or has unsaved local
 * edits (kept + reported as a conflict). A deck that survives its tombstone
 * clears it. Tombstones older than `DECK_TOMBSTONE_TTL_MS` are GC'd. If the
 * result would be empty, the newest candidate is kept regardless (never strand
 * the user deckless). `now` is injectable for deterministic GC tests.
 *
 * `activeDeckId`: keep local's if its deck survives, else remote's, else first.
 * A `null`/absent local workspace means "fresh device" → take remote wholesale.
 */
export function mergeRemoteWorkspace(
  local: TAccountWorkspace | undefined,
  remote: TAccountWorkspace,
  now: number = Date.now()
): TMergeResult {
  if (!local) return { merged: remote, conflicts: [] }

  const localById = new Map(local.decks.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const conflicts: TDeck[] = []
  const candidateDecks: TDeck[] = []

  for (const rd of remote.decks) {
    seen.add(rd.id)
    const ld = localById.get(rd.id)
    if (!ld) {
      candidateDecks.push(rd) // new on another device
    } else if (deckDirty(ld)) {
      candidateDecks.push(ld) // unsaved local edits win
      conflicts.push(ld)
    } else if (rd.lastSavedAt > ld.lastSavedAt) {
      candidateDecks.push(rd) // remote is newer
    } else {
      candidateDecks.push(ld) // local newer or equal
    }
  }
  for (const ld of local.decks) {
    if (!seen.has(ld.id)) candidateDecks.push(ld) // local-only
  }

  // Apply tombstones (LWW, with a dirty exception). Survivors clear their tombstone.
  const tombstones = unionTombstones(local.deletedDecks, remote.deletedDecks)
  const survivors: TDeck[] = []
  for (const d of candidateDecks) {
    const ts = tombstones[d.id]
    if (ts === undefined) {
      survivors.push(d)
    } else if (d.lastSavedAt > ts) {
      survivors.push(d)
      delete tombstones[d.id] // saved after delete → resurrect
    } else if (deckDirty(d)) {
      survivors.push(d)
      delete tombstones[d.id] // unsaved edits → keep, surface as conflict
      if (!conflicts.includes(d)) conflicts.push(d)
    }
    // else: dropped (stays deleted)
  }

  // Never strand the user with zero decks.
  let mergedDecks = survivors
  if (mergedDecks.length === 0 && candidateDecks.length > 0) {
    const newest = candidateDecks.reduce((a, b) => (b.lastSavedAt > a.lastSavedAt ? b : a))
    mergedDecks = [newest]
    delete tombstones[newest.id]
  }

  // GC aged tombstones.
  for (const [id, ts] of Object.entries(tombstones)) {
    if (ts < now - DECK_TOMBSTONE_TTL_MS) delete tombstones[id]
  }

  const ids = new Set(mergedDecks.map((d) => d.id))
  let activeDeckId = local.activeDeckId
  if (!ids.has(activeDeckId)) {
    activeDeckId = ids.has(remote.activeDeckId)
      ? remote.activeDeckId
      : (mergedDecks[0]?.id ?? local.activeDeckId)
  }

  const mergedPairedAgents = mergePairedAgents(local.pairedAgents, remote.pairedAgents)
  const allowSiblingExposure = remote.allowSiblingExposure ?? local.allowSiblingExposure
  const hasTombstones = Object.keys(tombstones).length > 0

  return {
    merged: {
      activeDeckId,
      decks: mergedDecks,
      ...(mergedPairedAgents.length > 0 ? { pairedAgents: mergedPairedAgents } : {}),
      ...(allowSiblingExposure !== undefined ? { allowSiblingExposure } : {}),
      ...(hasTombstones ? { deletedDecks: tombstones } : {})
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
