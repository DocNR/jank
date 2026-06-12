import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { TConflictChoice } from '@/types/deck-sync'
import { useTranslation } from 'react-i18next'

export function DeckSyncConflictModal({
  open,
  onChoice
}: {
  open: boolean
  onChoice: (choice: TConflictChoice) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onChoice('cancel')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Decks changed on another device')}</DialogTitle>
          <DialogDescription>
            {t(
              "This account's decks were updated elsewhere since you last synced. What would you like to do?"
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onChoice('cancel')}>
            {t('Cancel')}
          </Button>
          <Button variant="outline" onClick={() => onChoice('reload')}>
            {t('Reload theirs')}
          </Button>
          <Button onClick={() => onChoice('overwrite')}>{t('Overwrite with mine')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
