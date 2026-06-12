import { useNostr } from '@/providers/NostrProvider'

/**
 * @deprecated Decks v2 (Option A) — the per-column `signingIdentity` override
 * is no longer the "active acting account" semantics. Under per-account-workspaces,
 * every column in the active workspace already has `signingIdentity === active`
 * by construction. `useActingPubkey` is now a thin alias for `useNostr().pubkey`
 * to give existing callers a soft landing during the v2 transition.
 *
 * Callers should migrate to `useNostr().pubkey` directly; this file will be
 * deleted in a v2.1 follow-up.
 *
 * Returns null only when logged out.
 */
export function useActingPubkey(): string | null {
  return useNostr().pubkey
}
