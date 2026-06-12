import { signingState } from '@/components/Column/ColumnHeader/signing-state'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useAccounts } from '@/providers/AccountsProvider'
import { useNostr } from '@/providers/NostrProvider'

/**
 * Resolves the effective signing context for a note action surface (Like /
 * Repost / Reply / Zap). Inside a column's <AccountScope> the action signs as
 * the column's `signingIdentity`; outside any scope (primary / secondary
 * pages) it falls back to the global active account.
 *
 * `signerPubkey` is also what the "did I react / repost / zap" indicators
 * compare against — the indicator reflects the identity you'd actually be
 * acting as in this column, not whatever the sidebar-active account happens
 * to be.
 *
 * `signingMismatch` is derived via the canonical `signingState()` helper
 * (shared with the column header chip + the two-tone stripe) so all three
 * surfaces agree on what counts as a mis-sign. Profile columns get a
 * baseline that depends on whether viewContext is one of your paired
 * accounts (own profile → viewContext baseline, signing as yourself reads
 * quiet) or a foreign pubkey (foreign profile → global-active baseline,
 * signing as your default self reads quiet, signing as an alt reads loud).
 * Same rule as the column header — see ColumnHeader/index.tsx.
 */
export function useSigningContext() {
  const scope = useAccountScopeOptional()
  const { pubkey, publish, checkLogin } = useNostr()
  const { accounts } = useAccounts()

  if (scope) {
    const viewContextIsPaired = accounts.some((a) => a.pubkey === scope.viewContext)
    const baselinePubkey =
      scope.columnType === 'profile' && !viewContextIsPaired && pubkey ? pubkey : undefined
    return {
      /** Pubkey that will sign actions here. `null` on a view-only column. */
      signerPubkey: scope.signingIdentity,
      /** Publish signed by the scope's signingIdentity — same shape as useNostr().publish. */
      publish: scope.publish,
      /** True when this scope cannot sign (foreign viewContext, no paired signer). */
      viewOnly: scope.viewOnly,
      /** True when the column signs as a different account than its baseline. */
      signingMismatch:
        signingState(scope.viewContext, scope.signingIdentity, baselinePubkey) === 'loud',
      checkLogin
    }
  }

  return {
    signerPubkey: pubkey,
    publish,
    viewOnly: false,
    signingMismatch: false,
    checkLogin
  }
}
