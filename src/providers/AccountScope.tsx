import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { ISigner, TAccount, TDraftEvent, TPublishOptions } from '@/types'
import { TColumnType } from '@/types/column'
import { Event as NEvent } from 'nostr-tools'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAccounts } from './AccountsProvider'
import { buildSignerForAccount } from './NostrProvider/build-signer'
import { useNostr } from './NostrProvider'
import { ScopedUserListsProvider } from './ScopedUserListsProvider'

type TAccountScopeContext = {
  /** Pubkey whose perspective this scope shows — any pubkey, paired OR foreign. Drives feeds, filters, the header avatar, viewer-state lists. */
  viewContext: string
  /** Paired-account pubkey whose key signs actions, or `null` = view-only (no signer on this device). */
  signingIdentity: string | null
  /**
   * Column type backing this scope, when mounted under a deck column. Lets
   * deep consumers (e.g. useSigningContext) apply the same profile-aware
   * baseline as the column header / stripe — for profile columns the
   * mis-sign baseline is the viewer's active account, not viewContext. Not
   * set when AccountScope is mounted outside a column (LivePreview,
   * SpikePage).
   */
  columnType?: TColumnType
  /** Stored account backing `signingIdentity` (the account that signs). `null` when view-only or unknown. */
  account: TAccount | null
  /** Signer resolved from `signingIdentity`. `null` when view-only or still building. */
  signer: ISigner | null
  /** True when there is no signing identity — write actions are disabled for this scope. */
  viewOnly: boolean
  ready: boolean
  error: string | null
  /**
   * Publish signed by this scope's `signingIdentity`. Signature mirrors
   * `useNostr().publish` so action surfaces can swap transparently between the
   * scoped and the global publisher. Throws on a view-only scope.
   */
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<NEvent>
}

const AccountScopeContext = createContext<TAccountScopeContext | undefined>(undefined)

/**
 * Per-column account scope. Splits two concerns the deck used to conflate:
 *
 *   - `viewContext`: whose perspective the column shows (any pubkey — a paired
 *     account OR a foreign npub the user has no key for).
 *   - `signingIdentity`: which paired account's key signs actions taken from
 *     this column. `null` when no paired account exists on this device →
 *     view-only column (reads work, writes are disabled).
 *
 * The signer is built (or reused) for `signingIdentity` and registered in the
 * owner-tagged signer registry so other column-scoped subtrees can publish/sign
 * as that account in parallel. Each mount mints a unique owner symbol and pairs
 * setSigner/removeSigner symmetrically; the registry refcount handles overlap
 * with NostrProvider's active mirror — neither side can yank the other's entry.
 *
 * Mounts <ScopedUserListsProvider> as its inner child to override the five
 * user-list contexts — reads keyed on `viewContext`, mutations on
 * `signingIdentity`. This pairing is the structural guarantee — do not insert
 * other providers between AccountScope and ScopedUserListsProvider.
 */
export function AccountScope({
  viewContext,
  signingIdentity,
  columnType,
  children
}: {
  viewContext: string
  signingIdentity: string | null
  columnType?: TColumnType
  children: React.ReactNode
}) {
  const { getSigner } = useAccounts()
  const { publishAs, pubkey: activePubkey } = useNostr()
  const [signer, setSigner] = useState<ISigner | null>(null)
  const [account, setAccount] = useState<TAccount | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Decks v2 invariant: every column in the active workspace has
  // signingIdentity === active account. Foreign-viewContext columns
  // (e.g. view-as) carry signingIdentity = active too, so a mismatch
  // here is a sign of a v1 → v2 migration bug or stale column state.
  // Dev-mode console warn only; no behavior change.
  if (
    process.env.NODE_ENV !== 'production' &&
    signingIdentity &&
    activePubkey &&
    signingIdentity !== activePubkey
  ) {
     
    console.warn(
      '[AccountScope] invariant: signingIdentity does not match active account.',
      { signingIdentity, activePubkey, viewContext }
    )
  }

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    setSigner(null)
    setAccount(null)

    // No signing identity → view-only scope. Reads still work (feeds, profiles,
    // and viewer-state lists are all public reads); only writes are disabled.
    if (!signingIdentity) {
      setReady(true)
      return
    }

    const scopeOwner = Symbol('AccountScope:' + signingIdentity)

    const stored =
      storage.findAccount({ pubkey: signingIdentity, signerType: 'nsec' as never }) ??
      storage.getAccounts().find((a) => a.pubkey === signingIdentity)
    if (!stored) {
      setError(`No stored account found for signing identity ${signingIdentity}`)
      setReady(true)
      return
    }
    setAccount(stored)

    const register = (s: ISigner) => {
      client.setSigner(signingIdentity, s, scopeOwner)
      setSigner(s)
      setReady(true)
    }

    // Reuse already-registered signer if present (e.g. mirrored from active
    // NostrProvider). Avoids re-running expensive bunker handshakes.
    const existing = getSigner(signingIdentity)
    if (existing) {
      register(existing)
    } else {
      buildSignerForAccount(stored)
        .then((built) => {
          if (cancelled) return
          if (!built) {
            setError(
              `Could not build signer for account ${signingIdentity} (signerType=${stored.signerType})`
            )
            setReady(true)
            return
          }
          register(built)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : String(err))
          setReady(true)
        })
    }

    return () => {
      cancelled = true
      // Refcount handles the rest: if any other owner still holds the entry
      // (e.g. NostrProvider's ACTIVE_OWNER), the signer stays.
      client.removeSigner(signingIdentity, scopeOwner)
    }
  }, [signingIdentity, getSigner])

  const value = useMemo<TAccountScopeContext>(
    () => ({
      viewContext,
      signingIdentity,
      columnType,
      account,
      signer,
      viewOnly: signingIdentity === null,
      ready,
      error,
      publish: (draftEvent, options) => {
        if (!signingIdentity) {
          throw new Error('Cannot publish from a view-only column (no signing identity)')
        }
        return publishAs(signingIdentity, draftEvent, options)
      }
    }),
    [viewContext, signingIdentity, columnType, account, signer, ready, error, publishAs]
  )

  return (
    <AccountScopeContext.Provider value={value}>
      <ScopedUserListsProvider viewContext={viewContext} signingIdentity={signingIdentity}>
        {children}
      </ScopedUserListsProvider>
    </AccountScopeContext.Provider>
  )
}

export function useAccountScope(): TAccountScopeContext {
  const ctx = useContext(AccountScopeContext)
  if (!ctx) {
    throw new Error('useAccountScope must be used within <AccountScope>')
  }
  return ctx
}

/**
 * Soft variant for components that render BOTH inside a column's
 * <AccountScope> and outside it — e.g. the note action buttons (Like / Repost
 * / Reply / Zap), which appear in feed columns, detail columns, and also in
 * primary/secondary pages that have no surrounding scope. Returns `null`
 * instead of throwing; callers fall back to the global active account.
 */
export function useAccountScopeOptional(): TAccountScopeContext | null {
  return useContext(AccountScopeContext) ?? null
}
