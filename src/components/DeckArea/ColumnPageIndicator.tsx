// src/components/DeckArea/ColumnPageIndicator.tsx
import { cn } from '@/lib/utils'
import { pubkeyToHsl } from '@/lib/pubkey'
import { TColumn } from '@/types/column'

type Props = {
  columns: TColumn[]
  activeColumnId: string | null
  onJumpToColumn: (id: string) => void
}

/**
 * WS3 — bottom-anchored page-dot indicator for the swipe-snap deck on mobile.
 * One dot per column; tap a dot to jump to it. The active dot tints to the
 * column's account hue so the indicator doubles as a "whose perspective am I
 * on?" reference at a glance. Overview / add-column / compose live in the
 * bottom bar, not here.
 *
 * Positioned above the BottomBar. The bar is a 3rem (h-12) button row plus
 * `env(safe-area-inset-bottom)` (the home-indicator inset), so the pager has
 * to offset by both — offsetting by a flat 3rem tucks it behind the bar on
 * home-indicator iPhones. `z-30` sits below the bottom bar (`z-40`) and below
 * drawers / modals (`z-50+`).
 *
 * The buttons are wrapped in larger transparent tap-targets so a thumb can
 * still hit them despite the visual dot being small.
 */
export default function ColumnPageIndicator({
  columns,
  activeColumnId,
  onJumpToColumn
}: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom) + 0.5rem)' }}
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
      </div>
    </div>
  )
}
