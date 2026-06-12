// src/components/AddColumnModal/PickerGrid.tsx
import { cn } from '@/lib/utils'
import { TColumnType } from '@/types/column'
import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COLUMN_TYPES, type ColumnTypeDescriptor } from './column-types'

type Props = {
  onSelect: (type: TColumnType) => void
}

const GRID_TOTAL = 16 // 4×4
const COLS = 4

/**
 * Keyboard navigation:
 *   - Arrow keys move focus between tiles. Vertical moves are clamped to
 *     the populated range (no jumping into empty slots).
 *   - Enter / Space activates the focused tile.
 *   - **Letter shortcuts**: each tile's label first-letter (e.g. `H` for
 *     Home, `M` for Mentions, `R` for Relay) selects that tile directly.
 *     Bound off the English `desc.label` so the shortcut is stable across
 *     locales — the bound letter is displayed in the tile's bottom-end
 *     corner so users see what's available.
 *   - First tile is focused on mount so the picker is usable without a
 *     mouse click first.
 */
export default function PickerGrid({ onSelect }: Props) {
  const { t } = useTranslation()
  const empties = Math.max(0, GRID_TOTAL - COLUMN_TYPES.length)
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const [focusedIdx, setFocusedIdx] = useState(0)

  // Letter shortcut per tile = the descriptor's explicit `shortcut` override,
  // else the first character of the (English) label, lowercased. The override
  // exists for first-letter collisions (e.g. Hashtag vs Home).
  const shortcutFor = (desc: ColumnTypeDescriptor): string =>
    desc.shortcut ?? desc.label.charAt(0).toLowerCase()

  useEffect(() => {
    buttonsRef.current[0]?.focus()
  }, [])

  const focusIdx = (next: number) => {
    const clamped = Math.max(0, Math.min(COLUMN_TYPES.length - 1, next))
    setFocusedIdx(clamped)
    buttonsRef.current[clamped]?.focus()
  }

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusIdx(focusedIdx + 1)
        return
      case 'ArrowLeft':
        e.preventDefault()
        focusIdx(focusedIdx - 1)
        return
      case 'ArrowDown':
        e.preventDefault()
        focusIdx(focusedIdx + COLS)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusIdx(focusedIdx - COLS)
        return
      case 'Enter':
      case ' ': {
        const target = COLUMN_TYPES[focusedIdx]
        if (target) {
          e.preventDefault()
          onSelect(target.type)
        }
        return
      }
    }
    // Letter-shortcut path: single-letter, no modifier, matches one of the
    // descriptors' first-letter shortcuts → activate that tile directly.
    // stopPropagation prevents the keystroke from bubbling to the global
    // CommandDispatcher and re-triggering the column.add shortcut (which
    // shares a letter — e.g. `n` is both "Notifications tile" here and
    // "open the new-column modal" globally).
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const key = e.key.toLowerCase()
      const match = COLUMN_TYPES.findIndex((d) => shortcutFor(d) === key)
      if (match !== -1) {
        e.preventDefault()
        e.stopPropagation()
        onSelect(COLUMN_TYPES[match].type)
      }
    }
  }

  return (
    <div className="p-6">
      <div
        className="mx-auto grid max-w-[480px] grid-cols-4 gap-2"
        role="grid"
        onKeyDown={handleKey}
      >
        {COLUMN_TYPES.map((desc, i) => {
          const Icon = desc.icon
          const shortcut = shortcutFor(desc)
          return (
            <button
              key={desc.type}
              ref={(el) => {
                buttonsRef.current[i] = el
              }}
              type="button"
              role="gridcell"
              tabIndex={i === focusedIdx ? 0 : -1}
              onFocus={() => setFocusedIdx(i)}
              onClick={() => onSelect(desc.type)}
              className={cn(
                'border-border bg-card text-card-foreground relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border transition-colors',
                'hover:border-primary hover:bg-primary/5',
                'focus:border-primary focus:bg-primary/5 focus:outline-hidden'
              )}
            >
              <Icon className="size-7 opacity-80" />
              <span className="w-full px-1 text-center text-xs leading-tight font-medium">
                {t(desc.label)}
              </span>
              {/* Keyboard-shortcut hint in the bottom-end corner. Muted +
                  monospace so it reads as metadata, not content. RTL-safe
                  via `end-2`. */}
              <span
                aria-hidden
                className="text-muted-foreground absolute end-2 bottom-1.5 font-mono text-[10px] leading-none"
              >
                {shortcut.toUpperCase()}
              </span>
            </button>
          )
        })}
        {Array.from({ length: empties }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" aria-hidden />
        ))}
      </div>
    </div>
  )
}
