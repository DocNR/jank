import client from '@/services/client.service'
import contextVmServer from '@/services/context-vm-server.service'
import storage from '@/services/local-storage.service'
import { ISigner, TAccount, TAccountPointer } from '@/types'
import { BunkerSigner } from '@/providers/NostrProvider/bunker.signer'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// Owner token used by NostrProvider's active-account mirror. Module-scoped so
// the same symbol identifies "the active mirror" across mirror-set, switch,
// and removeAccount call sites. Additive on switch — only removeAccount
// decrements (matches Phase 0 invariant).
export const ACTIVE_OWNER = Symbol('NostrProvider.active')

type TAccountsContext = {
  accounts: TAccountPointer[]
  addAccount: (account: TAccount) => TAccountPointer[]
  removeAccount: (account: TAccountPointer) => void
  removeAllAccounts: () => void
  getSigner: (pubkey: string) => ISigner | undefined
}

const AccountsContext = createContext<TAccountsContext | undefined>(undefined)

export const useAccounts = () => {
  const ctx = useContext(AccountsContext)
  if (!ctx) {
    throw new Error('useAccounts must be used within an AccountsProvider')
  }
  return ctx
}

const toPointer = (a: TAccount | TAccountPointer): TAccountPointer => ({
  pubkey: a.pubkey,
  signerType: a.signerType
})

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<TAccountPointer[]>(() =>
    storage.getAccounts().map(toPointer)
  )

  const addAccount = useCallback((account: TAccount) => {
    const next = storage.addAccount(account).map(toPointer)
    setAccounts(next)
    return next
  }, [])

  const removeAccount = useCallback((account: TAccountPointer) => {
    const stored = storage.findAccount(account)
    // NIP-46 logout (nips#2373): if this is a live bunker connection, tell the
    // remote signer to drop our session before we discard it locally. Fire-and-
    // forget — the in-flight request keeps the signer alive long enough to
    // publish (removeSigner below is just a refcounted registry delete, not a
    // connection close); logout() is best-effort, timeout-bounded, never throws.
    if (stored?.signerType === 'bunker') {
      const signer = client.getSignerFor(account.pubkey)
      if (signer instanceof BunkerSigner) {
        void signer.logout()
      }
    }
    if (stored) {
      storage.removeAccount(stored)
    }
    client.removeSigner(account.pubkey, ACTIVE_OWNER)
    setAccounts(storage.getAccounts().map(toPointer))
  }, [])

  const removeAllAccounts = useCallback(() => {
    // Capture pubkeys before clearing storage so we can drain each signer's
    // ACTIVE_OWNER refcount. removeSigner only deletes the registry entry when
    // its owner set is empty (per-mount AccountScope owners release on unmount).
    storage.getAccounts().forEach((a) => client.removeSigner(a.pubkey, ACTIVE_OWNER))
    storage.removeAllAccounts()
    setAccounts([])
  }, [])

  const getSigner = useCallback((pubkey: string) => client.getSignerFor(pubkey), [])

  // Track B — detach the MCP-server subscription for any account that has been
  // removed since the last render. Attach happens lazily in ColumnsProvider's
  // pairedAgents-diff effect (which fires when a Workspace gains paired agents).
  const prevAccountPubkeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const accountPubkeys = new Set(accounts.map((a) => a.pubkey))
    for (const prevPk of prevAccountPubkeysRef.current) {
      if (!accountPubkeys.has(prevPk)) {
        contextVmServer.detachWorkspace(prevPk)
      }
    }
    prevAccountPubkeysRef.current = accountPubkeys
  }, [accounts])

  return (
    <AccountsContext.Provider
      value={{ accounts, addAccount, removeAccount, removeAllAccounts, getSigner }}
    >
      {children}
    </AccountsContext.Provider>
  )
}
