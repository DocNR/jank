// src/components/AddColumnModal/PreviewScreen.tsx
import { Button } from '@/components/ui/button'
import { TColumn, TColumnType } from '@/types/column'
import { ArrowLeft } from 'lucide-react'
import { KeyboardEvent, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccountRail from './AccountRail'
import { COLUMN_TYPES } from './column-types'
import LivePreview from './LivePreview'
import { useAccounts } from '@/providers/AccountsProvider'
import { useNostr } from '@/providers/NostrProvider'

type Props = {
  type: TColumnType
  draft: Partial<TColumn>
  onDraftChange: (next: Partial<TColumn>) => void
  isCustom: boolean
  setIsCustom: (custom: boolean) => void
  onBack: () => void
  onCancel: () => void
  onConfirm: () => void
}

export default function PreviewScreen({
  type,
  draft,
  onDraftChange,
  isCustom,
  setIsCustom,
  onBack,
  onCancel,
  onConfirm
}: Props) {
  const { t } = useTranslation()
  const { accounts } = useAccounts()
  const { account: activeAccount } = useNostr()
  const desc = COLUMN_TYPES.find((d) => d.type === type)
  // Config forms (e.g. Relay) key off the signing account's read list.
  const account = useMemo(
    () => accounts.find((a) => a.pubkey === draft.signingIdentity),
    [accounts, draft.signingIdentity]
  )
  const canConfirm = desc?.isReadyToPreview(draft) ?? false

  if (!desc) {
    return <div className="text-muted-foreground p-6 text-sm">{t('Unknown column type')}</div>
  }

  const titleKey = `Add a ${desc.label} column`

  // Modal-level keyboard shortcuts. Two bindings handled here:
  //
  // **Enter → commit** (when canConfirm). Closes the loop on full-keyboard
  // column creation: pick a tile (h/n/r or arrow+Enter) → pick an account
  // (1..9 or arrow+Enter) → Enter to add. The AccountRail's own Enter
  // handler does NOT bubble when it's selecting a new account (it
  // stopPropagates), so a single Enter after arrow-nav selects without
  // committing. A second Enter (now focus === selection) bubbles up here
  // and commits. Digit-shortcut path is one-step: '1' selects + focuses,
  // Enter commits, both via separate keystrokes.
  //
  // **Backspace → back to picker.** Mirrors the visible ArrowLeft / `⌫`
  // back button in the header. Modern Chrome dropped Backspace-as-
  // history-back; Firefox only routes it to history outside inputs.
  // preventDefault keeps any edge case from firing the browser-back.
  //
  // Both bindings are gated on "focus isn't in a text input or content-
  // editable" — the Relay column's custom-URL input is editable and the
  // user needs Backspace there to delete characters and Enter to submit.
  const onModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const tag = target.tagName
    const isEditable =
      tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    if (isEditable) return

    if (e.key === 'Enter') {
      if (!canConfirm) return
      e.preventDefault()
      onConfirm()
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      onBack()
      return
    }
  }

  // Prevent the Add / Cancel buttons' own Enter (which the browser turns
  // into a synthetic click on the focused button) from also bubbling up
  // to onModalKeyDown — without this, Enter on the Cancel button would
  // both close the modal AND fire onConfirm.
  const stopEnterPropagation = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }

  return (
    <div
      className="flex h-[min(520px,85svh)] w-full min-w-0 flex-col overflow-hidden"
      onKeyDown={onModalKeyDown}
    >
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          aria-label={t('Back')}
        >
          <ArrowLeft className="size-5 rtl:-scale-x-100" />
          {/* Keyboard hint mirroring the modal's Backspace→back binding.
              Monospace + muted to read as metadata, not content. */}
          <span aria-hidden className="font-mono text-[10px] leading-none">
            ⌫
          </span>
        </button>
        <div className="ms-1 text-sm font-semibold">{t(titleKey)}</div>
      </div>

      <div className="flex min-h-0 flex-1">
        {desc.supportsViewAs && (
          <AccountRail
            value={draft.viewContext}
            onSelectAccount={(newId) => {
              // Under Decks v2 per-account-workspaces, the rail is a "view as"
              // picker — picking a paired account sets ONLY viewContext. The
              // column's signingIdentity stays the active account (set at
              // modal-open by defaults()). To add a column whose signingIdentity
              // is a different account, the user must switch active first
              // (via AccountButton or the `a` shortcut).
              onDraftChange({
                ...draft,
                viewContext: newId
              })
            }}
            onSelectOtherUser={(pubkey) => {
              // Foreign view-as: viewContext is the foreign pubkey; signingIdentity
              // stays the currently-active paired account.
              onDraftChange({
                ...draft,
                viewContext: pubkey,
                signingIdentity: activeAccount?.pubkey ?? accounts[0]?.pubkey ?? null
              })
            }}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {desc.ConfigForm && (
            <div className="border-border bg-muted/20 border-b px-4 py-3">
              <desc.ConfigForm
                draft={draft}
                onChange={onDraftChange}
                account={account}
                isCustom={isCustom}
                setIsCustom={setIsCustom}
                onClose={onCancel}
              />
            </div>
          )}
          <LivePreview type={type} draft={draft} />
        </div>
      </div>

      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" onClick={onCancel} onKeyDown={stopEnterPropagation}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={onConfirm}
          onKeyDown={stopEnterPropagation}
          disabled={!canConfirm}
        >
          {t('Add column')}
        </Button>
      </div>
    </div>
  )
}
