import {
  activeColumnIdAtom,
  addColumnDialogOpenAtom,
  commandPaletteOpenAtom,
  focusBeamActiveAtom
} from '@/atoms/active-column'
import { useSecondaryPage } from '@/DeckManager'
import PostEditor from '@/components/PostEditor/LazyPostEditor'
import { TCommand } from '@/lib/commands/registry'
import { useRegisterCommands } from '@/lib/commands/useRegisterCommands'
import { toSettings } from '@/lib/link'
import { formatPubkey } from '@/lib/pubkey'
import profileFetcher from '@/services/profile-fetcher.service'
import { TProfile } from '@/types'
import { useAccounts } from '@/providers/AccountsProvider'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Registers jank's starter command set against the global registry, plus
 * an internal per-column-compose modal trigger. No DOM of its own beyond
 * the compose dialog (rendered when a column.compose command fires).
 *
 * Lives inside ColumnsProvider + SecondaryPageContext so it can read
 * columns and dispatch transient-column spawns.
 */
export default function StarterCommands() {
  const { t } = useTranslation()
  const secondary = useSecondaryPage()
  const {
    columns,
    focusOrCreateColumn,
    removeColumn,
    closeAllTransient,
    reorderColumns
  } = useColumns()
  const { account, switchAccount, setActivePubkey } = useNostr()
  const { accounts } = useAccounts()

  const activeColumnId = useAtomValue(activeColumnIdAtom)
  const focusBeamActive = useAtomValue(focusBeamActiveAtom)
  const setPaletteOpen = useSetAtom(commandPaletteOpenAtom)
  const setAddColumnOpen = useSetAtom(addColumnDialogOpenAtom)
  const setActiveColumnId = useSetAtom(activeColumnIdAtom)
  const setFocusBeamActive = useSetAtom(focusBeamActiveAtom)

  // Per-column compose: a small piece of local state for the modal triggered
  // by the column.compose command. The command sets `composeFor` to the
  // active column's accountId; PostEditor reads it.
  const [composeFor, setComposeFor] = useState<string | null>(null)

  // Paired-account profiles, keyed by pubkey. Used to label the per-account
  // `Switch to <display name>` palette commands. The sidebar AccountButton
  // already fetches these on its own, so by the time the user opens the
  // palette the cache is typically warm — this effect costs one in-flight
  // IndexedDB hit per account on first mount, then resolves synchronously.
  const [profileByPubkey, setProfileByPubkey] = useState<Map<string, TProfile>>(new Map())
  useEffect(() => {
    let cancelled = false
    for (const acc of accounts) {
      void profileFetcher.fetchProfile(acc.pubkey).then((profile) => {
        if (cancelled || !profile) return
        setProfileByPubkey((prev) => {
          if (prev.get(acc.pubkey)?.username === profile.username) return prev
          const next = new Map(prev)
          next.set(acc.pubkey, profile)
          return next
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [accounts])

  // Helpers
  const getActive = () => columns.find((c) => c.id === activeColumnId) ?? null
  const activeIndex = () => columns.findIndex((c) => c.id === activeColumnId)

  // FLIP wrapper around `reorderColumns` for keyboard-driven swaps.
  //   1. Snapshot each column wrapper's current rect, keyed by data-column-id.
  //   2. Trigger the React reorder (state update → DOM commits new layout).
  //   3. In the next animation frame, measure new rects, compute delta per
  //      moved wrapper, and apply the `animate-column-flip` class with the
  //      delta as a CSS custom property so the keyframe glides each wrapper
  //      from its old visual position to its new one.
  // The animation is purely visual; the underlying state is already the new
  // order by the time the keyframe runs. See `animate-column-flip` in
  // src/index.css for the keyframe definition.
  const reorderColumnsAnimated = (from: number, to: number) => {
    const scroller = document.querySelector('[data-deck-scroll]')
    if (!(scroller instanceof HTMLElement)) {
      reorderColumns(from, to)
      return
    }
    const oldRects = new Map<string, DOMRect>()
    for (const child of Array.from(scroller.children)) {
      if (!(child instanceof HTMLElement)) continue
      const id = child.dataset.columnId
      if (id) oldRects.set(id, child.getBoundingClientRect())
    }

    reorderColumns(from, to)

    requestAnimationFrame(() => {
      const nextScroller = document.querySelector('[data-deck-scroll]')
      if (!(nextScroller instanceof HTMLElement)) return
      for (const child of Array.from(nextScroller.children)) {
        if (!(child instanceof HTMLElement)) continue
        const id = child.dataset.columnId
        if (!id) continue
        const oldRect = oldRects.get(id)
        if (!oldRect) continue
        const newRect = child.getBoundingClientRect()
        const dx = oldRect.left - newRect.left
        if (Math.abs(dx) < 1) continue
        child.style.setProperty('--flip-x', `${dx}px`)
        // Re-add the class even if it's already present (rapid double-tap).
        child.classList.remove('animate-column-flip')
        // Force reflow so the keyframe restarts cleanly.
        void child.offsetWidth
        child.classList.add('animate-column-flip')
        const cleanup = () => {
          child.classList.remove('animate-column-flip')
          child.style.removeProperty('--flip-x')
          child.removeEventListener('animationend', cleanup)
        }
        child.addEventListener('animationend', cleanup)
      }
    })
  }
  const focusColumn = (id: string) => {
    setActiveColumnId(id)
    // Scroll into view on the deck scroller. Use rAF so the data-active
    // style transition starts before the scroll smooths.
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-deck-scroll] [role="region"][data-column-id="${id}"]`
      ) as HTMLElement | null
      // The column root doesn't carry data-column-id today; fall back to
      // index-based scrollIntoView via the column's getBoundingClientRect.
      // Simpler: target the column by its id-bearing wrapper. SortableColumn
      // doesn't set data-column-id either, so we resolve by id later. For
      // now: scroll the active deck so the index'th column is in view.
      const idx = columns.findIndex((c) => c.id === id)
      if (idx < 0) return
      const scroller = document.querySelector('[data-deck-scroll]') as HTMLElement | null
      if (!scroller) return
      const child = scroller.children[idx] as HTMLElement | undefined
      if (!child) return
      child.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      el?.focus?.()
    })
  }

  const commands = useMemo<TCommand[]>(() => {
    const list: TCommand[] = []

    // ── App: palette + search + settings ────────────────────────────
    list.push({
      id: 'app.openPalette',
      label: t('Open command palette'),
      group: 'app',
      shortcut: 'mod+k',
      // Toggle so a second Cmd-K closes the palette (Linear/Slack semantics).
      // `managesPaletteState` opts out of the dispatcher's auto-close — the
      // toggle reads the current state itself via the function-form setter.
      managesPaletteState: true,
      run: () => setPaletteOpen((prev) => !prev)
    })
    list.push({
      id: 'app.search',
      label: t('Search Nostr…'),
      group: 'app',
      shortcut: 's',
      // Open (or focus) a Search column scoped to the active account — the same
      // action as the top-bar Search QuickJump. Gated on a logged-in account.
      condition: () => !!account,
      run: () => {
        if (!account) return
        focusOrCreateColumn({
          type: 'search',
          viewContext: account.pubkey,
          signingIdentity: account.pubkey
        })
      }
    })
    list.push({
      id: 'app.settings',
      label: t('Settings'),
      group: 'app',
      // No shortcut binding: Cmd-, is Firefox's "Preferences" hotkey and is
      // not reliably preventable. Settings is one click in the palette.
      run: () => secondary.push(toSettings())
    })

    // ── Columns ─────────────────────────────────────────────────────
    // Single-letter, no-modifier bindings (Gmail/Linear/Notion convention).
    // The dispatcher only fires plain keys when focus is NOT in an editable
    // element, so typing in inputs is unaffected. We avoid `Cmd+*` for column
    // ops because most relevant combos (Cmd+W close-tab, Cmd+N new-window,
    // Cmd+1..9 switch-tab) are hardcoded browser shortcuts that the page
    // cannot preventDefault — especially on Firefox.
    list.push({
      id: 'column.add',
      label: t('Add column'),
      group: 'columns',
      shortcut: 'n',
      // AddColumnModal lives inside DeckArea, which renders EmptyDeckCTA
      // (not the modal) when there's no account and the deck is empty.
      // Gating on account presence keeps the shortcut from setting an atom
      // that nothing consumes.
      condition: () => !!account,
      run: () => {
        // Focus Beam modal-split rule: adding a column = "I'm done reading,
        // let me restructure." Exit beam before opening the picker so the
        // modal renders over the normal deck, not a dimmed one.
        setFocusBeamActive(false)
        setAddColumnOpen(true)
      }
    })
    list.push({
      id: 'column.close',
      label: t('Close active column'),
      group: 'columns',
      shortcut: 'x',
      condition: () => !!getActive(),
      run: () => {
        const a = getActive()
        if (!a) return
        // Exit beam first: the focused column is about to disappear, and
        // beam has nowhere to be. The neighbor becomes active in the normal
        // post-remove fallback (see DeckArea's lifecycle effect).
        setFocusBeamActive(false)
        removeColumn(a.id)
      }
    })
    list.push({
      id: 'column.closeAllTransient',
      label: t('Close all temporary columns'),
      group: 'columns',
      condition: () => columns.some((c) => c.transient === true),
      run: () => closeAllTransient()
    })
    list.push({
      id: 'column.moveLeft',
      label: t('Move column left'),
      group: 'columns',
      shortcut: '[',
      condition: () => activeIndex() > 0,
      run: () => {
        const i = activeIndex()
        if (i > 0) reorderColumnsAnimated(i, i - 1)
      }
    })
    list.push({
      id: 'column.moveRight',
      label: t('Move column right'),
      group: 'columns',
      shortcut: ']',
      condition: () => {
        const i = activeIndex()
        return i >= 0 && i < columns.length - 1
      },
      run: () => {
        const i = activeIndex()
        if (i >= 0 && i < columns.length - 1) reorderColumnsAnimated(i, i + 1)
      }
    })
    list.push({
      id: 'column.compose',
      label: t('Compose in active column'),
      group: 'columns',
      shortcut: 'c',
      condition: () => !!getActive(),
      run: () => {
        const a = getActive()
        if (a) setComposeFor(a.signingIdentity)
      }
    })
    list.push({
      id: 'account.cycleActive',
      label: t('Switch to next paired account'),
      group: 'columns',
      shortcut: 'a',
      // Under Decks v2 (per-account-workspaces), `a` cycles the global active
      // account — each workspace has its own deck, so switching accounts swaps
      // the visible deck along with the signer. Requires >1 paired account.
      // (v1 semantics: cycled focused column's signingIdentity; retired
      // because under per-account-workspaces every column in the active
      // workspace shares signingIdentity with the active account by construction.)
      condition: () => accounts.length > 1,
      run: () => {
        if (accounts.length < 2) return
        const activePk = account?.pubkey ?? null
        const curIdx = accounts.findIndex((acc) => acc.pubkey === activePk)
        const next = accounts[(curIdx + 1) % accounts.length]
        void setActivePubkey(next.pubkey)
      }
    })
    list.push({
      id: 'column.focusPrev',
      label: t('Focus previous column'),
      group: 'columns',
      shortcut: 'left',
      condition: () => activeIndex() > 0,
      run: () => {
        const i = activeIndex()
        if (i > 0) focusColumn(columns[i - 1].id)
      }
    })
    list.push({
      id: 'column.focusNext',
      label: t('Focus next column'),
      group: 'columns',
      shortcut: 'right',
      condition: () => {
        const i = activeIndex()
        return i >= 0 && i < columns.length - 1
      },
      run: () => {
        const i = activeIndex()
        if (i >= 0 && i < columns.length - 1) focusColumn(columns[i + 1].id)
      }
    })

    // ── Scroll the active column ────────────────────────────────────
    // ↑ / ↓ scroll the active column's body by ~80px (≈ one Note row in
    // compact density). Gated on `activeColumnId` so when no column is
    // focused the dispatcher returns null and native page-scroll fires.
    // Hidden from the palette to avoid two redundant rows — keyboard only.
    //
    // `behavior: 'auto'` (not smooth) because smooth-scroll is a no-op for
    // users with `prefers-reduced-motion: reduce`, and rapid arrow-key
    // presses feel snappier with instant scroll anyway (matches native
    // browser scrollbar arrow behavior).
    const scrollActiveColumn = (deltaY: number) => {
      if (!activeColumnId) return
      const body = document.querySelector(
        `[role="region"][data-column-id="${activeColumnId}"] [data-column-body]`
      )
      if (body instanceof HTMLElement) {
        body.scrollBy({ top: deltaY, behavior: 'auto' })
      }
    }
    list.push({
      id: 'column.scrollUp',
      label: t('Scroll up'),
      group: 'columns',
      shortcut: 'up',
      condition: () => activeColumnId !== null,
      hideFromPalette: true,
      run: () => scrollActiveColumn(-80)
    })
    list.push({
      id: 'column.scrollDown',
      label: t('Scroll down'),
      group: 'columns',
      shortcut: 'down',
      condition: () => activeColumnId !== null,
      hideFromPalette: true,
      run: () => scrollActiveColumn(80)
    })

    // ── Focus column N (1..9) ───────────────────────────────────────
    // Plain digits — `Cmd+1..9` is hardcoded "switch tab" in every desktop
    // browser, so we use the unmodified number keys (which browsers don't
    // bind). Same input-focus guard means typing 1..9 in inputs is unaffected.
    // Each digit is its own keyboard-active command but hidden from the
    // palette to avoid nine redundant rows — a single synthetic display
    // command below summarizes the whole range with a `1-9` chip.
    for (let n = 1; n <= 9; n++) {
      const targetIdx = n - 1
      list.push({
        id: `column.focus.${n}`,
        label: t('Focus column {{n}}', { n }),
        group: 'columns',
        shortcut: `${n}`,
        condition: () => columns.length > targetIdx,
        hideFromPalette: true,
        run: () => {
          const target = columns[targetIdx]
          if (target) focusColumn(target.id)
        }
      })
    }
    // Display-only summary row for the focus-1..9 fan-out. The `1-9`
    // shortcut string never matches a real KeyboardEvent.key, so this row
    // is keyboard-inert — it exists purely to teach the palette user about
    // the range. Clicking it focuses the first column as a sensible default.
    list.push({
      id: 'column.focus.range',
      label: t('Focus column 1-9'),
      group: 'columns',
      shortcut: '1-9',
      condition: () => columns.length > 0,
      run: () => {
        const target = columns[0]
        if (target) focusColumn(target.id)
      }
    })

    // ── Focus Beam ──────────────────────────────────────────────────
    // `f` toggles beam on the active column; `Esc` exits when beam is on.
    // Beam follows active — `←`/`→`/`1-9` move the beam by changing
    // active. Modal-split rules (`n`, `x` exit beam; `c`, `[`, `]` keep
    // it) are wired into those commands directly above.
    list.push({
      id: 'column.focusBeam.toggle',
      label: t('Toggle Focus Beam'),
      group: 'columns',
      shortcut: 'f',
      condition: () => !!getActive(),
      run: () => setFocusBeamActive((prev) => !prev)
    })
    list.push({
      id: 'app.focusBeam.exit',
      label: t('Exit Focus Beam'),
      group: 'app',
      shortcut: 'esc',
      // Trust the dispatcher's editable-target bail: when the palette,
      // compose, or any input-bearing modal is open and Esc is pressed,
      // focus is in their input/contenteditable and the dispatcher skips
      // this command entirely. Beam-only Esc lands on the deck itself.
      condition: () => focusBeamActive,
      run: () => setFocusBeamActive(false)
    })

    // ── Account: one switch command per paired account ──────────────
    // Each account becomes its own command — typing the account name
    // filters directly to it. No sub-page navigation needed in the
    // starter palette. Label prefers profile.username (display_name →
    // name → formatPubkey fallback handled inside getProfileFromEvent),
    // falling back to formatted npub if the profile hasn't loaded yet.
    for (const acc of accounts) {
      if (acc.pubkey === account?.pubkey) continue
      const profile = profileByPubkey.get(acc.pubkey)
      const display = profile?.username ?? formatPubkey(acc.pubkey)
      list.push({
        id: `account.switch.${acc.pubkey}`,
        label: t('Switch to {{npub}}', { npub: display }),
        group: 'account',
        run: () => {
          void switchAccount(acc)
        }
      })
    }

    return list
    // The closure captures columns / activeColumnId / accounts / account.
    // We want to re-register when any of these change so condition() reflects
    // current state. The TCommand objects themselves are recreated on each
    // dep change, which is what the hook wants.
  }, [
    columns,
    activeColumnId,
    focusBeamActive,
    accounts,
    account?.pubkey,
    profileByPubkey,
    removeColumn,
    closeAllTransient,
    reorderColumns,
    focusOrCreateColumn,
    switchAccount,
    setPaletteOpen,
    setAddColumnOpen,
    setActiveColumnId,
    setFocusBeamActive,
    t,
    secondary
  ])

  useRegisterCommands(commands)

  // Close compose modal once after the user confirms / cancels by
  // resetting composeFor when the dialog flips closed.
  useEffect(() => {
    if (composeFor === null) return
    // No-op — PostEditor manages its own lifecycle. We just need to keep
    // the prop set while it's open. setOpen(false) below resets.
  }, [composeFor])

  return (
    <PostEditor
      open={composeFor !== null}
      setOpen={(v) => {
        if (!v) setComposeFor(null)
      }}
      accountId={composeFor ?? undefined}
    />
  )
}
