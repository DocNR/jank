// src/components/AddColumnModal/index.tsx
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useNostr } from '@/providers/NostrProvider'
import { randomId } from '@/lib/utils'
import { TColumn, TColumnType } from '@/types/column'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COLUMN_TYPES } from './column-types'
import PickerGrid from './PickerGrid'
import PreviewScreen from './PreviewScreen'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (column: TColumn) => void
}

type Mode = 'grid' | 'preview'

export default function AddColumnModal({ open, onOpenChange, onAdd }: Props) {
  const { t } = useTranslation()
  const { account } = useNostr()
  const [mode, setMode] = useState<Mode>('grid')
  const [draft, setDraft] = useState<Partial<TColumn>>({})
  const [type, setType] = useState<TColumnType | null>(null)
  const [isCustom, setIsCustom] = useState(false)

  // Reset state on each open: false → true transition.
  useEffect(() => {
    if (open) {
      setMode('grid')
      setDraft({ id: randomId() })
      setType(null)
      setIsCustom(false)
    }
  }, [open])

  const handleSelectType = (newType: TColumnType) => {
    const desc = COLUMN_TYPES.find((d) => d.type === newType)
    if (!desc) return
    setType(newType)
    setDraft((prev) => ({
      ...prev,
      ...desc.defaults(account ?? undefined)
    }))
    setIsCustom(false)
    setMode('preview')
  }

  const handleBack = () => {
    // Clear type/accountId/config from draft; keep id so reopening the same tile starts fresh.
    setMode('grid')
    setType(null)
    setDraft((prev) => ({ id: prev.id }))
    setIsCustom(false)
  }

  const handleConfirm = () => {
    if (!type) return
    const desc = COLUMN_TYPES.find((d) => d.type === type)
    if (!desc || !desc.isReadyToPreview(draft)) return
    onAdd(draft as TColumn)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogTitle className="sr-only">
          {mode === 'preview' && type
            ? t(`Add a ${COLUMN_TYPES.find((d) => d.type === type)?.label ?? ''} column`)
            : t('Choose a column type')}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t('Choose a column type to add to your deck')}
        </DialogDescription>
        {mode === 'grid' || !type ? (
          <div>
            <div className="border-border border-b px-4 py-3 text-sm font-semibold">
              {t('Choose a column type')}
            </div>
            <PickerGrid onSelect={handleSelectType} />
          </div>
        ) : (
          <PreviewScreen
            type={type}
            draft={draft}
            onDraftChange={setDraft}
            isCustom={isCustom}
            setIsCustom={setIsCustom}
            onBack={handleBack}
            onCancel={() => onOpenChange(false)}
            onConfirm={handleConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
