// src/components/DeckArea/SortableColumn.tsx
import { Column } from '@/components/Column'
import { activeColumnIdAtom, focusBeamActiveAtom } from '@/atoms/active-column'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TColumn } from '@/types/column'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { atom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

type Props = {
  column: TColumn
}

/**
 * Wraps <Column> with dnd-kit's useSortable. Drag attributes/listeners get
 * forwarded as `dragHandleProps` so they attach only to the ColumnHeader (not
 * the body), keeping the feed scrollable.
 *
 * W6 drag polish: while dragging, the wrapper lifts (shadow-2xl, z-50) and
 * the column dims slightly. The other columns still animate into their new
 * positions via dnd-kit's default `transition` prop.
 *
 * Keyboard reorder animation lives outside dnd-kit: see the FLIP wrapper in
 * StarterCommands' `column.moveLeft` / `column.moveRight` commands. dnd-kit's
 * `useDerivedTransform` only fires while a drag is active (its rect ref is
 * gated on `!active`), so non-drag reorders need their own animation path.
 * The wrapper carries `data-column-id` so the FLIP code can match elements
 * to ids before and after the React commit.
 */
export default function SortableColumn({ column }: Props) {
  const { isSmallScreen } = useScreenSize()
  // WS3: dnd-kit's pointer sensor fights CSS scroll-snap on touch — disable
  // drag-reorder on mobile. Desktop reorder unchanged.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    disabled: isSmallScreen
  })
  // Per-column derived subscription: only re-renders when THIS column's
  // beam-focused state flips. Without this, every active-column change
  // re-rendered all N SortableColumns (which then re-rendered Column
  // and the unmemoized children inside). See Column.tsx for the
  // matching optimization.
  //
  // When this column is the focus-beam target, the inner <Column> lifts to
  // `position: fixed` and leaves the wrapper's content area empty. Reserve
  // the slot's width here so the rest of the deck doesn't reflow into the
  // gap — dimmed columns stay exactly where they were. The reservation
  // releases instantly when isBeamFocused flips false (no exit-animation
  // delay needed; column snaps back to slot under the fading scrim).
  const isBeamFocusedAtom = useMemo(
    () =>
      atom(
        (get) => get(focusBeamActiveAtom) && get(activeColumnIdAtom) === column.id
      ),
    [column.id]
  )
  // Beam is a no-op on mobile (WS3), so we never reserve the slot there.
  const isBeamFocused = useAtomValue(isBeamFocusedAtom) && !isSmallScreen

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : ('auto' as const),
    // Slot width: when Focus Beam lifts the inner Column to position:fixed,
    // reserve the slot so the deck doesn't reflow into the gap. The CSS var
    // gives mobile a viewport-wide slot (so scroll-snap settles one column
    // per page) and desktop the 400px default.
    width: isBeamFocused
      ? (column.width ?? 'var(--deck-col-width, 400px)')
      : 'var(--deck-col-width, 400px)'
  }

  // Memoize the spread so ColumnHeader's React.memo can short-circuit when
  // dnd-kit's attribute/listener refs are stable (they are, outside drag).
  const dragHandleProps = useMemo(
    () => ({ ...attributes, ...listeners }),
    [attributes, listeners]
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-column-id={column.id}
      className={cn(
        'flex h-full shrink-0 transition-[box-shadow] duration-150 snap-center snap-always',
        isDragging && 'shadow-2xl'
      )}
    >
      <Column column={column} dragHandleProps={dragHandleProps} />
    </div>
  )
}
