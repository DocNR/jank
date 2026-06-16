// src/components/ColumnOverview/index.tsx
//
// The "exploding tabs" overview: a full-screen grid of every open column for
// the active deck. Jump to a column (tap), close one (×), or add a new one (+).
// Opened from the mobile page-dot pill's grid button and a desktop TopBar
// button, both of which set `columnOverviewOpenAtom`.
//
// Jumping routes through `focusedColumnRequestAtom` — DeckArea already watches
// it to set the column active AND scroll it into view, so this overlay doesn't
// need its own scroll logic. Cards are static metadata (hue + type icon +
// label), not live thumbnails: every column owns a subscription, so real
// snapshots would be expensive. A cached first-note preview can come later.
import { COLUMN_TYPES } from '@/components/AddColumnModal/column-types'
import { columnLabel } from '@/components/Column/ColumnHeader'
import UserAvatar from '@/components/UserAvatar'
import {
  activeColumnIdAtom,
  addColumnDialogOpenAtom,
  columnOverviewOpenAtom,
  focusedColumnRequestAtom
} from '@/atoms/active-column'
import { pubkeyToHsl } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useColumns } from '@/providers/ColumnsProvider'
import { TColumn, TColumnType } from '@/types/column'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Compass, LucideIcon, Plus, SquareStack, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// type → icon, sourced from the AddColumnModal registry so the overview stays
// in step with the picker. Built lazily (not at module load) to avoid reading
// COLUMN_TYPES before it's initialized through the column import cycle. Types
// without a picker tile (detail, dvm-discover) get sensible fallbacks.
let iconByType: Map<TColumnType, LucideIcon> | null = null
function iconFor(type: TColumnType): LucideIcon {
  if (!iconByType) iconByType = new Map(COLUMN_TYPES.map((d) => [d.type, d.icon]))
  return iconByType.get(type) ?? (type === 'dvm-discover' ? Compass : SquareStack)
}

export default function ColumnOverview() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(columnOverviewOpenAtom)
  const { columns, removeColumn } = useColumns()
  const activeId = useAtomValue(activeColumnIdAtom)
  const setFocusedRequest = useSetAtom(focusedColumnRequestAtom)
  const setAddOpen = useSetAtom(addColumnDialogOpenAtom)

  // Escape closes the overlay (desktop affordance; harmless on mobile).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const jumpTo = (id: string) => {
    setFocusedRequest(id) // DeckArea: set active + scroll into view
    setOpen(false)
  }

  const addColumn = () => {
    setOpen(false)
    setAddOpen(true)
  }

  return (
    <div
      className="bg-background/95 fixed inset-0 z-50 flex flex-col backdrop-blur-sm"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('Columns')}
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <span className="text-lg font-semibold">{t('Columns')}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('Close')}
          className="text-muted-foreground hover:text-foreground flex size-9 items-center justify-center rounded-full"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {columns.map((c) => (
            <ColumnCard
              key={c.id}
              column={c}
              isActive={c.id === activeId}
              onJump={() => jumpTo(c.id)}
              onClose={() => removeColumn(c.id)}
            />
          ))}
          <button
            type="button"
            onClick={addColumn}
            className="border-border text-muted-foreground hover:border-primary hover:text-foreground flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors"
          >
            <Plus className="size-6" />
            <span className="text-sm font-medium">{t('Add column')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ColumnCard({
  column,
  isActive,
  onJump,
  onClose
}: {
  column: TColumn
  isActive: boolean
  onJump: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const Icon = iconFor(column.type)
  const hue = pubkeyToHsl(column.viewContext)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onJump}
        aria-label={t('Jump to column')}
        className={cn(
          'bg-card border-border flex aspect-[4/3] w-full flex-col overflow-hidden rounded-xl border text-start transition-colors',
          isActive ? 'border-transparent' : 'hover:border-primary/60'
        )}
        style={isActive ? { boxShadow: `0 0 0 2px ${hue}` } : undefined}
      >
        {/* Account-hue stripe — same "whose perspective" cue as the column. */}
        <div className="h-1.5 w-full shrink-0" style={{ background: hue }} />
        <div className="flex flex-1 flex-col items-start gap-2 p-3">
          <div className="flex items-center gap-2">
            <UserAvatar userId={column.viewContext} size="small" />
            <Icon className="text-muted-foreground size-4 shrink-0" />
          </div>
          <span className="line-clamp-2 text-sm font-medium leading-tight" dir="auto">
            {columnLabel(column, t)}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('Remove column')}
        className="bg-background/80 text-muted-foreground hover:text-foreground absolute end-1.5 top-2.5 flex size-6 items-center justify-center rounded-full backdrop-blur-sm"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
