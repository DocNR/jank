// src/components/DeckSwitcher/SwitchDirtyModal.tsx
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
import { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** Deck id to switch to once user decides; null = closed. */
  targetDeckId: string | null
  /** Source deck name for the modal copy. */
  sourceDeckName: string
  /** Target deck name for the modal copy. */
  targetDeckName: string
  onClose: () => void
}

export default function SwitchDirtyModal({
  targetDeckId,
  sourceDeckName,
  targetDeckName,
  onClose
}: Props) {
  const { t } = useTranslation()
  const { saveActiveDeck, discardActiveDeckChanges, switchDeck } = useColumns()

  const handleSave = () => {
    if (!targetDeckId) return
    saveActiveDeck()
    switchDeck(targetDeckId)
    onClose()
  }

  const handleDiscard = () => {
    if (!targetDeckId) return
    discardActiveDeckChanges()
    switchDeck(targetDeckId)
    onClose()
  }

  // Enter = Save (default), Esc = Cancel (Dialog default). Discard requires
  // explicit click — never a keyboard default to avoid destructive accidents.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <Dialog
      open={targetDeckId !== null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-md" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('Save changes to "{{name}}"?', { name: sourceDeckName })}</DialogTitle>
          <DialogDescription>
            {t(
              'Switching to "{{name}}" without saving will keep your changes pending in "{{source}}" — they\'ll be there when you come back, but won\'t be saved.',
              { name: targetDeckName, source: sourceDeckName }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="outline" onClick={handleDiscard}>
            {t('Discard')}
          </Button>
          <Button onClick={handleSave}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
