// src/components/DeckSwitcher/SaveAsModal.tsx
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useColumns } from '@/providers/ColumnsProvider'
import { KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeDeckName } from './helpers'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SaveAsModal({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { activeDeck, saveActiveDeckAs } = useColumns()
  const [name, setName] = useState('')

  const handleSubmit = () => {
    saveActiveDeckAs({ name: normalizeDeckName(name) })
    setName('')
    onOpenChange(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Save as new deck')}</DialogTitle>
          <DialogDescription>
            {t(
              'Your current column arrangement will be saved as a separate deck. "{{name}}" stays unchanged.',
              { name: activeDeck?.name ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {t('Name')}
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Untitled deck')}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
