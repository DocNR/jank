import type { TColumn, TDeck, TDeckV1, TWorkspacesByAccount } from '@/types/column'
import { randomId } from '@/lib/utils'

export type MigrateWorkspacesByAccountResult = {
  workspacesByAccount: TWorkspacesByAccount
  migrated: boolean
}

/**
 * Migrate v1 flat deck array into per-account-workspaces structure (v2).
 *
 * - Groups each v1 deck's columns by `signingIdentity`.
 * - For each (signingIdentity, columns) bucket where signingIdentity is in
 *   `accountPubkeys`, creates a TDeck in that account's workspace.
 * - Drops view-only columns (signingIdentity == null) with console.warn.
 * - Drops orphan columns (signingIdentity not in paired list) with console.warn.
 * - If a v1 deck's columns are ALL dropped, the deck doesn't appear in output.
 *
 * Pure function — no localStorage access, no side effects beyond console.warn.
 *
 * `_activeAccountPubkey` is currently unused but reserved for future heuristics
 * (e.g. preferring the active account's workspace's first deck as that
 * workspace's `activeDeckId`). v2.1 may wire it in.
 */
export function migrateWorkspacesByAccount(
  v1Decks: TDeckV1[] | unknown,
  accountPubkeys: string[],

  _activeAccountPubkey: string | null
): MigrateWorkspacesByAccountResult {
  // Defensive: handle malformed input gracefully.
  if (!Array.isArray(v1Decks)) {
    return { workspacesByAccount: {}, migrated: true }
  }

  const pairedSet = new Set(accountPubkeys)
  const workspacesByAccount: TWorkspacesByAccount = {}

  for (const v1 of v1Decks) {
    if (!v1 || typeof v1 !== 'object' || !Array.isArray((v1 as TDeckV1).columns)) continue
    const v1Deck = v1 as TDeckV1

    // Group columns by signingIdentity.
    const byOwner = new Map<string, TColumn[]>()
    for (const c of v1Deck.columns) {
      if (!c || typeof c !== 'object') continue
      const owner = (c as TColumn).signingIdentity
      if (!owner) {
        console.warn('[migrateWorkspacesByAccount] dropping view-only column', c)
        continue
      }
      if (!pairedSet.has(owner)) {
        console.warn(
          '[migrateWorkspacesByAccount] dropping orphan column (signer not paired)',
          c
        )
        continue
      }
      const existing = byOwner.get(owner) ?? []
      existing.push(c as TColumn)
      byOwner.set(owner, existing)
    }

    // For each surviving (owner, columns) bucket, create a v2 deck.
    for (const [owner, columns] of byOwner) {
      const workspace = workspacesByAccount[owner] ?? { activeDeckId: '', decks: [] }
      const id = randomId()
      const deck: TDeck = {
        id,
        name: v1Deck.name ?? 'My Deck',
        columns,
        savedColumns: [...columns],
        createdAt: v1Deck.createdAt ?? Date.now(),
        updatedAt: v1Deck.updatedAt ?? Date.now(),
        lastSavedAt: v1Deck.updatedAt ?? Date.now()
      }
      workspace.decks.push(deck)
      // First migrated deck becomes the workspace's active.
      if (!workspace.activeDeckId) workspace.activeDeckId = id
      workspacesByAccount[owner] = workspace
    }
  }

  return { workspacesByAccount, migrated: true }
}
