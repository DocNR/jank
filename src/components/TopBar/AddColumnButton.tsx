import { addColumnDialogOpenAtom } from '@/atoms/active-column'
import { Button } from '@/components/ui/button'
import { useSetAtom } from 'jotai'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Opens the existing AddColumnModal (already mounted by DeckArea) by flipping
 * its open atom. Lives in TopBar so mobile users can add columns without the
 * Sidebar (which is hidden on stacked layouts).
 */
export default function AddColumnButton() {
  const { t } = useTranslation()
  const setAddOpen = useSetAtom(addColumnDialogOpenAtom)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10"
      onClick={() => setAddOpen(true)}
      aria-label={t('Add column')}
    >
      <Plus className="size-5" />
    </Button>
  )
}
