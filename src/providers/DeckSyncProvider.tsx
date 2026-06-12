import { DeckSyncConflictModal } from '@/components/DeckSyncConflictModal'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import deckSyncService, { shouldCheckRemoteNow } from '@/services/deck-sync.service'
import type { TConflictChoice } from '@/types/deck-sync'
import { useEffect, useRef, useState } from 'react'

export function DeckSyncProvider({ children }: { children: React.ReactNode }) {
  const { pubkey } = useNostr()
  const { reloadFromStorage } = useColumns()
  const lastCheckRef = useRef<number | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const conflictResolverRef = useRef<((c: TConflictChoice) => void) | null>(null)

  useEffect(() => {
    deckSyncService.setConflictHandler(
      () =>
        new Promise<TConflictChoice>((resolve) => {
          // If a prior conflict modal is still open, cancel it so its awaiting
          // publishWorkspace doesn't hang when a second conflict arrives.
          conflictResolverRef.current?.('cancel')
          conflictResolverRef.current = resolve
          setConflictOpen(true)
        })
    )
    return () => {
      deckSyncService.setConflictHandler(null)
      // Resolve any in-flight conflict on unmount so its publish doesn't hang.
      conflictResolverRef.current?.('cancel')
      conflictResolverRef.current = null
    }
  }, [])

  const handleChoice = (choice: TConflictChoice) => {
    setConflictOpen(false)
    conflictResolverRef.current?.(choice)
    conflictResolverRef.current = null
  }

  useEffect(() => {
    if (!pubkey) return
    const activePubkey = pubkey

    const runCheck = async () => {
      const now = Date.now()
      if (!shouldCheckRemoteNow(lastCheckRef.current, now)) return
      lastCheckRef.current = now
      const status = await deckSyncService.checkRemote(activePubkey)
      if (status.status !== 'remote-newer') return
      // Per-deck merge: add new decks + update untouched ones silently. A deck you've
      // edited locally is kept and surfaces at save-time via the conflict modal.
      deckSyncService.applyRemoteMerge(activePubkey, status.workspace, status.createdAt)
      reloadFromStorage()
    }

    void runCheck() // on mount / account switch
    const onFocus = () => void runCheck()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [pubkey, reloadFromStorage])

  return (
    <>
      {children}
      <DeckSyncConflictModal open={conflictOpen} onChoice={handleChoice} />
    </>
  )
}
