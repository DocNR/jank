// src/components/DeckSwitcher/DeleteConfirmModal.tsx
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useColumns } from '@/providers/ColumnsProvider'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  /** Deck id to confirm deletion for; null = closed. */
  deckId: string | null
  onClose: () => void
}

export default function DeleteConfirmModal({ deckId, onClose }: Props) {
  const { t } = useTranslation()
  const { decks, deleteDeck, undoLastDelete } = useColumns()
  const deck = deckId ? decks.find((d) => d.id === deckId) : null

  // Guard: deckId became invalid (e.g. deck removed by another path).
  if (deckId && !deck) {
    queueMicrotask(onClose)
    return null
  }

  const handleDelete = () => {
    if (!deck) return
    const deletedName = deck.name
    deleteDeck(deck.id)
    onClose()
    // 5s undo toast (sonner-managed). Provider's internal timer also clears
    // its ref at 5s; the toast's Undo callback calls undoLastDelete() which
    // restores the deck from the ref (no-op if the ref already expired).
    toast(t('Deck "{{name}}" deleted.', { name: deletedName }), {
      duration: 5000,
      action: {
        label: t('Undo'),
        onClick: () => {
          undoLastDelete()
        }
      }
    })
  }

  return (
    <Dialog
      open={deckId !== null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('Delete "{{name}}"?', { name: deck?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'This deck has {{count}} column. Deleting won\'t remove them from your follow lists or bookmarks — just from this deck.',
              { count: deck?.columns.length ?? 0 }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            {t('Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
