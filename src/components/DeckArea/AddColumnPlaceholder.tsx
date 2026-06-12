// src/components/DeckArea/AddColumnPlaceholder.tsx
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = { onClick: () => void }

/**
 * Trailing column-shaped placeholder pinned to the deck's right edge. Lives
 * outside the SortableContext (not draggable). Clicking opens the add-column
 * modal.
 *
 * WS3: reads `var(--deck-placeholder-width, 240px)` — desktop keeps 240px,
 * mobile expands to viewport width so scroll-snap can settle on this as a
 * full-width "add column" final page.
 */
export default function AddColumnPlaceholder({ onClick }: Props) {
  const { t } = useTranslation()
  return (
    <div
      className="border-border/60 bg-muted/10 flex h-full shrink-0 items-center justify-center rounded-lg border-2 border-dashed snap-center snap-always"
      style={{ width: 'var(--deck-placeholder-width, 240px)' }}
    >
      <Button variant="outline" onClick={onClick} className="gap-2">
        <Plus className="size-4" />
        {t('Add column')}
      </Button>
    </div>
  )
}
