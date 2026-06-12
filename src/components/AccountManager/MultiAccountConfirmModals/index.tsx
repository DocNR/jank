import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatPubkey } from '@/lib/pubkey'
import { AlertTriangle } from 'lucide-react'

export type ConflictKind = 'privkey' | 'remote'

export type MultiAccountConflict = {
  signerPubkey: string
  /** Display name from the accumulated ack's metadata (optional). */
  name?: string
  /** Source signer type of the EXISTING paired account. Drives modal mode. */
  existingSignerType: 'nsec' | 'browser-nsec' | 'ncryptsec' | 'nip-07' | 'bunker' | 'npub'
}

function conflictKind(existing: MultiAccountConflict['existingSignerType']): ConflictKind {
  if (existing === 'nsec' || existing === 'browser-nsec' || existing === 'ncryptsec') {
    return 'privkey'
  }
  return 'remote'
}

function existingLabel(t: MultiAccountConflict['existingSignerType']): string {
  switch (t) {
    case 'nsec':
    case 'browser-nsec':
      return 'a stored private key'
    case 'ncryptsec':
      return 'an encrypted private key'
    case 'nip-07':
      return 'a browser extension'
    case 'bunker':
      return 'bunker'
    case 'npub':
      return 'read-only mode'
  }
}

export default function MultiAccountConfirmModal({
  conflict,
  onReplace,
  onKeepCurrent,
  onExportPrivkey
}: {
  conflict: MultiAccountConflict | null
  onReplace: () => void
  onKeepCurrent: () => void
  /** Optional. If not provided, the Export button is hidden (privkey mode only). */
  onExportPrivkey?: () => void
}) {
  if (!conflict) return null
  const kind = conflictKind(conflict.existingSignerType)
  const displayName = conflict.name ?? formatPubkey(conflict.signerPubkey)

  return (
    <Dialog open={!!conflict} onOpenChange={(open) => { if (!open) onKeepCurrent() }}>
      <DialogContent>
        {kind === 'privkey' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-4 w-4" />
                Replace {displayName}'s signer?
              </DialogTitle>
              <DialogDescription className="space-y-2 pt-2">
                <p>
                  <b>{displayName}</b> is currently paired with{' '}
                  {existingLabel(conflict.existingSignerType)}. Replacing with NostrConnect
                  rotates to a remote signer — you'll lose direct private-key access in jank.
                </p>
                <p>Make sure you've backed up the key before continuing.</p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              {onExportPrivkey && (
                <Button variant="outline" onClick={onExportPrivkey}>
                  Export private key
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onKeepCurrent}>Cancel</Button>
                <Button variant="destructive" onClick={onReplace}>
                  I've backed it up — replace
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {displayName} is paired via {existingLabel(conflict.existingSignerType)}
              </DialogTitle>
              <DialogDescription className="pt-2">
                Replace with this NostrConnect pairing?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="secondary" onClick={onKeepCurrent}>Keep current</Button>
              <Button onClick={onReplace}>Replace</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
