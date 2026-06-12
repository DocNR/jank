// src/components/DeckArea/ColumnPageIndicator.tsx
import { cn } from '@/lib/utils'
import { pubkeyToHsl } from '@/lib/pubkey'
import { TColumn } from '@/types/column'
import { Plus } from 'lucide-react'

type Props = {
  columns: TColumn[]
  activeColumnId: string | null
  onJumpToColumn: (id: string) => void
  onJumpToAddPlaceholder: () => void
}

/**
 * WS3 — bottom-anchored page-dot indicator for the swipe-snap deck on mobile.
 * One dot per column plus a trailing `+` slot for the add-column placeholder
 * page. The active dot tints to the column's account hue so the indicator
 * doubles as a "whose perspective am I on?" reference at a glance.
 *
 * Positioned above the BottomBar via the `--bottom-bar-offset` CSS variable
 * the Shell sets on its stacked-layout wrapper. `z-30` sits below the bottom
 * bar (`z-40`) and below drawers / modals (`z-50+`).
 *
 * The buttons are wrapped in larger transparent tap-targets so a thumb can
 * still hit them despite the visual dot being small.
 */
export default function ColumnPageIndicator({
  columns,
  activeColumnId,
  onJumpToColumn,
  onJumpToAddPlaceholder
}: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{ bottom: 'calc(var(--bottom-bar-offset, 3rem) + 0.5rem)' }}
      aria-hidden={columns.length === 0}
    >
      <div
        className="bg-card/95 border-border pointer-events-auto flex items-center gap-0.5 rounded-full border px-2 py-1 shadow-md"
        role="tablist"
      >
        {columns.map((c) => {
          const isActive = c.id === activeColumnId
          const hue = pubkeyToHsl(c.viewContext)
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Jump to column ${c.id.slice(0, 8)}`}
              onClick={() => onJumpToColumn(c.id)}
              className="flex h-7 w-5 items-center justify-center"
            >
              <span
                className={cn(
                  'rounded-full transition-all',
                  isActive ? 'size-2.5' : 'bg-muted-foreground/40 size-1.5'
                )}
                style={isActive ? { background: hue } : undefined}
              />
            </button>
          )
        })}
        <button
          type="button"
          role="tab"
          aria-label="Jump to add column"
          onClick={onJumpToAddPlaceholder}
          className="text-muted-foreground hover:text-foreground flex h-7 w-7 items-center justify-center"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
