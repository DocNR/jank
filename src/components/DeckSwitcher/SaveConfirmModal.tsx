// src/components/DeckSwitcher/SaveConfirmModal.tsx
//
// Guards the chip's Save pill against accidental overwrite. The pill is easy
// to mis-click and saveActiveDeck() irreversibly overwrites the deck's saved
// snapshot, so the pill opens this dialog instead of committing directly.
// The dropdown's "Save changes" item stays one-click (it's already behind a
// deliberate menu open).

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
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open the Save-As flow instead of overwriting. */
  onSaveAsNew: () => void
}

export default function SaveConfirmModal({ open, onOpenChange, onSaveAsNew }: Props) {
  const { t } = useTranslation()
  const { activeDeck, saveActiveDeck } = useColumns()

  const handleOverwrite = () => {
    saveActiveDeck()
    onOpenChange(false)
  }

  const handleSaveAsNew = () => {
    onOpenChange(false)
    onSaveAsNew()
  }

  // Enter = Overwrite (the default, matches clicking the Save pill intent).
  // Esc = Cancel (Dialog default).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleOverwrite()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('Save changes to "{{name}}"?', { name: activeDeck?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('"Overwrite" replaces its saved version. "Save as new" keeps it unchanged.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="outline" onClick={handleSaveAsNew}>
            {t('Save as new')}
          </Button>
          <Button onClick={handleOverwrite}>{t('Overwrite')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
