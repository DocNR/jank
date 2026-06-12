// src/components/DeckSwitcher/Dropdown.tsx
//
// The dropdown UI under the chip. Three sections:
//   - Active-deck actions: Save / Save As / Discard
//   - Switch-to list: this workspace's decks; per-row ⋮ menu for Rename / Duplicate / Delete
//   - Footer: + New deck
//
// "Switch to" while dirty → SwitchDirtyModal prompts Save/Discard/Cancel.
// Per-row ⋮ + right-click both surface the same menu; renaming is inline edit.

import { addColumnDialogOpenAtom } from '@/atoms/active-column'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { pubkeyToHsl } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useSetAtom } from 'jotai'
import {
  ChevronDown,
  Copy,
  MoreVertical,
  PencilLine,
  Plus,
  Save,
  Trash2,
  Undo2
} from 'lucide-react'
import {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  useEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { computeChipState, computeDropdownRows, normalizeDeckName } from './helpers'
import DeleteConfirmModal from './DeleteConfirmModal'
import SaveAsModal from './SaveAsModal'
import SaveConfirmModal from './SaveConfirmModal'
import SwitchDirtyModal from './SwitchDirtyModal'

export default function DeckSwitcher() {
  const { t } = useTranslation()
  const {
    decks,
    activeDeck,
    isActiveDeckDirty,
    saveActiveDeck,
    discardActiveDeckChanges,
    addEmptyDeck,
    switchDeck
  } = useColumns()
  const { pubkey: activeAccountPubkey } = useNostr()
  const setAddColumnOpen = useSetAtom(addColumnDialogOpenAtom)
  const [open, setOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [switchDirtyTarget, setSwitchDirtyTarget] = useState<string | null>(null)

  const chipState = computeChipState({ activeDeck, isActiveDeckDirty })
  const hue = activeAccountPubkey ? pubkeyToHsl(activeAccountPubkey) : 'hsl(200, 70%, 50%)'

  const handleSwitchClick = (deckId: string) => {
    if (!activeDeck || deckId === activeDeck.id) {
      setOpen(false)
      return
    }
    if (isActiveDeckDirty) {
      setSwitchDirtyTarget(deckId)
      return
    }
    switchDeck(deckId)
    setOpen(false)
  }

  const handleNewDeck = () => {
    addEmptyDeck()
    setOpen(false)
    // Auto-open AddColumnModal so the user lands in "pick your first column"
    // immediately after creating the empty deck.
    setAddColumnOpen(true)
  }

  const handleSave = () => {
    saveActiveDeck()
  }

  const handleDiscard = () => {
    discardActiveDeckChanges()
  }

  const rows = computeDropdownRows({
    decks,
    activeDeckId: activeDeck?.id ?? ''
  })

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="clickable hover:bg-accent flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span className="max-w-[160px] truncate" dir="auto">
              {chipState.name}
            </span>
            {chipState.showDirtyPip && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: hue }}
                aria-label={t('Unsaved changes')}
              />
            )}
            {chipState.showSavePill && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  // Open the confirm dialog rather than committing directly —
                  // the pill is easy to mis-click and overwrite is irreversible.
                  setSaveConfirmOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    setSaveConfirmOpen(true)
                  }
                }}
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'ms-1 h-auto px-2 py-0.5 text-xs font-semibold'
                )}
              >
                {t('Save')}
              </span>
            )}
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-80 p-0">
          {/* Header: Save / Save As / Discard */}
          <div className="border-b">
            <div className="text-muted-foreground px-3 py-2 text-[10px] font-semibold tracking-wider uppercase">
              {isActiveDeckDirty
                ? t('{{name}} (unsaved changes)', { name: activeDeck?.name ?? '' })
                : (activeDeck?.name ?? t('No deck'))}
            </div>
            {isActiveDeckDirty && (
              <button
                type="button"
                onClick={() => {
                  handleSave()
                }}
                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm"
              >
                <Save className="size-4" />
                {t('Save changes')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSaveAsOpen(true)
                setOpen(false)
              }}
              className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm"
            >
              <Copy className="size-4" />
              {t('Save as new deck…')}
            </button>
            {isActiveDeckDirty && (
              <button
                type="button"
                onClick={() => {
                  handleDiscard()
                }}
                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm"
              >
                <Undo2 className="size-4" />
                {t('Discard changes')}
              </button>
            )}
          </div>

          {/* Switch-to */}
          <div className="border-b">
            <div className="text-muted-foreground px-3 py-2 text-[10px] font-semibold tracking-wider uppercase">
              {t('Switch to')}
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {rows.map((row) => (
                <DeckRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  isActive={row.isActive}
                  isDirty={row.isDirty}
                  hue={hue}
                  onSwitch={() => handleSwitchClick(row.id)}
                  onDelete={() => setDeleteCandidate(row.id)}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <button
            type="button"
            onClick={handleNewDeck}
            className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-start text-sm"
          >
            <Plus className="size-4" />
            {t('New deck')}
          </button>
        </PopoverContent>
      </Popover>

      <SaveAsModal open={saveAsOpen} onOpenChange={setSaveAsOpen} />
      <SaveConfirmModal
        open={saveConfirmOpen}
        onOpenChange={setSaveConfirmOpen}
        onSaveAsNew={() => setSaveAsOpen(true)}
      />
      <DeleteConfirmModal
        deckId={deleteCandidate}
        onClose={() => setDeleteCandidate(null)}
      />
      <SwitchDirtyModal
        targetDeckId={switchDirtyTarget}
        sourceDeckName={activeDeck?.name ?? ''}
        targetDeckName={decks.find((d) => d.id === switchDirtyTarget)?.name ?? ''}
        onClose={() => {
          setSwitchDirtyTarget(null)
          setOpen(false)
        }}
      />
    </>
  )
}

type DeckRowProps = {
  id: string
  name: string
  isActive: boolean
  isDirty: boolean
  hue: string
  onSwitch: () => void
  onDelete: () => void
}

function DeckRow({ id, name, isActive, isDirty, hue, onSwitch, onDelete }: DeckRowProps) {
  const { t } = useTranslation()
  const { renameDeck, duplicateDeck } = useColumns()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      // Pre-fill + select-all on edit start.
      setDraftName(name)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, name])

  const commitRename = () => {
    const normalized = normalizeDeckName(draftName)
    if (normalized !== name) {
      renameDeck(id, normalized)
    }
    setEditing(false)
  }

  const cancelRename = () => {
    setDraftName(name)
    setEditing(false)
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setMenuOpen(true)
  }

  return (
    <div
      className={cn(
        'group hover:bg-accent relative flex items-center gap-2 px-3 py-1.5 text-sm',
        isActive && 'bg-accent/50 cursor-default'
      )}
      style={
        isActive
          ? {
              borderInlineStartWidth: 2,
              borderInlineStartStyle: 'solid',
              borderInlineStartColor: hue,
              background: `color-mix(in srgb, ${hue} 10%, transparent)`
            }
          : undefined
      }
      onContextMenu={onContextMenu}
    >
      {editing ? (
        <Input
          ref={inputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={onInputKeyDown}
          className="h-7 flex-1 px-2 py-1 text-sm"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          onClick={onSwitch}
          onDoubleClick={(e) => {
            e.preventDefault()
            setEditing(true)
          }}
          className="min-w-0 flex-1 truncate text-start"
          dir="auto"
        >
          {name}
        </button>
      )}
      {isDirty && (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: hue }}
          aria-label={t('Unsaved changes')}
        />
      )}
      {!editing && (
        <DeckRowMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRename={() => {
            setMenuOpen(false)
            setEditing(true)
          }}
          onDuplicate={() => {
            setMenuOpen(false)
            duplicateDeck(id)
          }}
          onDelete={() => {
            setMenuOpen(false)
            onDelete()
          }}
        >
          <button
            type="button"
            className={cn(
              'text-muted-foreground hover:text-foreground shrink-0 rounded p-1 transition-opacity',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            )}
            aria-label={t('More options')}
          >
            <MoreVertical className="size-4" />
          </button>
        </DeckRowMenu>
      )}
    </div>
  )
}

type DeckRowMenuProps = {
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function DeckRowMenu({
  children,
  open,
  onOpenChange,
  onRename,
  onDuplicate,
  onDelete
}: DeckRowMenuProps) {
  const { t } = useTranslation()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-44 p-1">
        <button
          type="button"
          onClick={onRename}
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm"
        >
          <PencilLine className="size-4" />
          {t('Rename')}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm"
        >
          <Copy className="size-4" />
          {t('Duplicate')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="hover:bg-destructive/10 hover:text-destructive flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm"
        >
          <Trash2 className="size-4" />
          {t('Delete…')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
