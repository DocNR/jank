// src/components/AddColumnModal/AccountRail.tsx
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { cn } from '@/lib/utils'
import { formatPubkey, isValidPubkey, pubkeyToHsl, userIdToPubkey } from '@/lib/pubkey'
import { useAccounts } from '@/providers/AccountsProvider'
import userSearchIndex from '@/services/search/user-search-index.service'
import { TProfile } from '@/types'
import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserPlus, X } from 'lucide-react'

type Props = {
  /** Currently-selected viewContext — a paired-account pubkey OR a foreign pubkey. */
  value: string | undefined
  /**
   * User picked one of their own paired accounts. Under Decks v2 per-account-
   * workspaces, this sets ONLY the column's viewContext — the column's
   * signingIdentity is determined by the active workspace and is not overridable
   * at column-add time. To create a column signed by a different account,
   * the user switches active account first (AccountButton / `a` shortcut).
   */
  onSelectAccount: (pubkey: string) => void
  /** User picked a foreign user via "Other user…" (viewContext = foreign, signer stays active). */
  onSelectOtherUser: (pubkey: string) => void
}

/**
 * Keyboard navigation (paired-account list only — the "Other user…" search
 * input is a normal text field outside the listbox):
 *   - Arrow Up / Down move focus through the account list.
 *   - Enter / Space on the focused account selects it (stops propagation so
 *     the same keystroke doesn't also commit the modal); a second Enter on the
 *     already-selected account bubbles up to PreviewScreen and commits.
 *   - Digit shortcuts (1..9) directly select the account at that index.
 *   - On mount, focus the currently-selected account (or the first).
 */
export default function AccountRail({
  value,
  onSelectAccount,
  onSelectOtherUser
}: Props) {
  const { t } = useTranslation()
  const { accounts } = useAccounts()
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const initialIdx = Math.max(
    0,
    accounts.findIndex((a) => a.pubkey === value)
  )
  const [focusedIdx, setFocusedIdx] = useState(initialIdx)

  // `value` is a foreign pubkey when it's set but isn't one of the user's
  // paired accounts — i.e. an "Other user…" pick.
  const selectedForeignPubkey =
    value && !accounts.some((a) => a.pubkey === value) ? value : undefined

  const initialIdxRef = useRef(initialIdx)
  useEffect(() => {
    if (accounts.length === 0) return
    buttonsRef.current[initialIdxRef.current]?.focus()
  }, [accounts.length])

  const focusIdx = (next: number) => {
    if (accounts.length === 0) return
    const clamped = Math.max(0, Math.min(accounts.length - 1, next))
    setFocusedIdx(clamped)
    buttonsRef.current[clamped]?.focus()
  }

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusIdx(focusedIdx + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusIdx(focusedIdx - 1)
        return
      case 'Enter':
      case ' ': {
        const target = accounts[focusedIdx]
        if (!target) return
        if (target.pubkey === value) {
          // Already selected — let Enter bubble to PreviewScreen to commit.
          e.preventDefault()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onSelectAccount(target.pubkey)
        return
      }
    }
    // Digit shortcut: '1'..'9' selects the account at that 1-indexed position.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const digit = parseInt(e.key, 10)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const idx = digit - 1
        const target = accounts[idx]
        if (target) {
          e.preventDefault()
          e.stopPropagation()
          focusIdx(idx)
          onSelectAccount(target.pubkey)
        }
      }
    }
  }

  return (
    <div className="border-border bg-muted/30 scrollbar-hide flex min-h-0 w-[220px] shrink-0 flex-col gap-1 overflow-x-hidden overflow-y-auto border-e p-3">
      <div className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
        {t('View as')}
      </div>
      <div
        role="listbox"
        aria-label={t('View as')}
        className="flex flex-col gap-1"
        onKeyDown={handleKey}
      >
        {accounts.map((a, i) => {
          const selected = a.pubkey === value
          const digitHint = i < 9 ? String(i + 1) : null
          return (
            <button
              key={a.pubkey}
              ref={(el) => {
                buttonsRef.current[i] = el
              }}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={i === focusedIdx ? 0 : -1}
              onFocus={() => setFocusedIdx(i)}
              onClick={() => onSelectAccount(a.pubkey)}
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-2 text-start transition-colors',
                selected ? 'bg-primary/15' : 'hover:bg-muted',
                'focus:bg-muted focus:outline-hidden'
              )}
            >
              <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
                <div
                  className="rounded-full"
                  style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(a.pubkey)}` }}
                >
                  <UserAvatar userId={a.pubkey} size="small" />
                </div>
                <div className="min-w-0 flex-1">
                  <Username
                    userId={a.pubkey}
                    className="block truncate text-sm leading-tight font-medium"
                    withoutSkeleton
                  />
                  <div className="text-muted-foreground truncate text-xs leading-tight">
                    {formatPubkey(a.pubkey)}
                  </div>
                </div>
              </div>
              {digitHint && (
                <span
                  aria-hidden
                  className="text-muted-foreground pointer-events-none ms-1 font-mono text-[11px] leading-none"
                >
                  {digitHint}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <OtherUserPicker
        selectedForeignPubkey={selectedForeignPubkey}
        onSelect={onSelectOtherUser}
      />
    </div>
  )
}

/**
 * "Other user…" row — scopes the column's `viewContext` to any pubkey the user
 * has no key for. Accepts a pasted npub / hex pubkey directly, or a name query
 * matched against the local user-search index. The column's `signingIdentity`
 * stays one of the user's paired accounts (wired by PreviewScreen).
 */
function OtherUserPicker({
  selectedForeignPubkey,
  onSelect
}: {
  selectedForeignPubkey: string | undefined
  onSelect: (pubkey: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(!!selectedForeignPubkey)
  const [query, setQuery] = useState('')
  const [resultPubkeys, setResultPubkeys] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Resolve the query: a valid npub / hex pubkey resolves directly; anything
  // else is a name query against the local search index.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResultPubkeys([])
      return
    }
    const direct = userIdToPubkey(q)
    if (isValidPubkey(direct)) {
      setResultPubkeys([direct])
      return
    }
    let cancelled = false
    userSearchIndex.searchProfilesFromLocal(q, 8).then((profiles: TProfile[]) => {
      if (!cancelled) setResultPubkeys(profiles.map((p) => p.pubkey))
    })
    return () => {
      cancelled = true
    }
  }, [query])

  const pick = (pubkey: string) => {
    onSelect(pubkey)
    setQuery('')
    setResultPubkeys([])
  }

  return (
    <div className="mt-1">
      <div className="bg-border my-1 h-px" />
      {selectedForeignPubkey && !open ? (
        // A foreign user is selected — show it as a highlighted row with a
        // "change" affordance, mirroring how a paired account reads as selected.
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors"
          style={{ backgroundColor: pubkeyToHsl(selectedForeignPubkey, 0.15) }}
        >
          <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
            <div
              className="rounded-full"
              style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(selectedForeignPubkey)}` }}
            >
              <UserAvatar userId={selectedForeignPubkey} size="small" />
            </div>
            <div className="min-w-0 flex-1">
              <Username
                userId={selectedForeignPubkey}
                className="block truncate text-sm leading-tight font-medium"
                withoutSkeleton
              />
              <div className="text-muted-foreground truncate text-xs leading-tight">
                {t('Viewing as another user')}
              </div>
            </div>
          </div>
        </button>
      ) : open ? (
        <div className="flex flex-col gap-1">
          <div className="border-border focus-within:border-primary flex items-center gap-1 rounded-md border px-2 py-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('npub or name…')}
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-hidden"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setQuery('')
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label={t('Cancel')}
            >
              <X className="size-3.5" />
            </button>
          </div>
          {resultPubkeys.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {resultPubkeys.map((pk) => (
                <button
                  key={pk}
                  type="button"
                  onClick={() => pick(pk)}
                  className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors"
                >
                  <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
                    <div
                      className="rounded-full"
                      style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(pk)}` }}
                    >
                      <UserAvatar userId={pk} size="small" />
                    </div>
                    <Username
                      userId={pk}
                      className="block truncate text-sm leading-tight font-medium"
                      withoutSkeleton
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-2 py-2 text-sm font-medium transition-colors"
        >
          <UserPlus className="size-4" />
          {t('Other user…')}
        </button>
      )}
    </div>
  )
}
