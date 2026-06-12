// src/providers/ColumnsProvider.tsx
import { focusedColumnRequestAtom } from '@/atoms/active-column'
import contextVmServer from '@/services/context-vm-server.service'
import deckSyncService from '@/services/deck-sync.service'
import storage from '@/services/local-storage.service'
import { getInitialDecksForAccount } from '@/services/get-initial-decks-for-account'
import { parseHashtagRoute, parseProfileRoute, parseRelayRoute, parseSearchRoute } from '@/lib/link'
import { isIntentionalReload } from '@/lib/reload-coordinator'
import { randomId } from '@/lib/utils'
import { TColumn, TColumnConfig, TColumnType, TDeck } from '@/types/column'
import { arrayMove } from '@dnd-kit/sortable'
import { useSetAtom } from 'jotai'
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNostr } from './NostrProvider'
import { useUserPreferences } from './UserPreferencesProvider'

type TColumnsContext = {
  columns: TColumn[]
  /**
   * Set of column ids currently in the 280ms fade-out animation window.
   * Column reads `removingIds.has(column.id)` to apply the
   * `animate-column-fade-out` class. Lifting this here (instead of
   * Column local state) lets the keyboard `x` shortcut animate too —
   * both code paths funnel through `removeColumn`, which is the only
   * way to enter the set.
   */
  removingIds: Set<string>
  /** Append a permanent column. Persists immediately. */
  addColumn: (col: TColumn) => void
  /**
   * Focus the user's existing column of `type` for `viewContext`, or create
   * one (persisted) if none exists. Either way the matched/created column is
   * scrolled into view via `focusedColumnRequestAtom`. Backs the "jump-to"
   * behavior of sidebar buttons converted from primary-page navigation.
   */
  focusOrCreateColumn: (spec: {
    type: TColumnType
    viewContext: string
    signingIdentity: string | null
  }) => void
  /**
   * Spawn a transient detail column for a secondary-route URL.
   *
   * Placement: the new column is spliced in directly after `parentColumnId`
   * (adjacency), falling back to end-of-deck when the parent is unknown or
   * already gone. This holds in BOTH transient modes — `transientColumnMode`
   * governs how many transients may coexist, not where they sit:
   *   - 'replace': at most one transient at a time — every prior transient is
   *     dropped, but the new one still lands adjacent to its parent.
   *   - 'append': prior transients are kept; the new one lands adjacent.
   *
   * On re-click of an already-open transient detail (same route + accountId),
   * the existing column's `parentColumnId` is updated to the new parent and
   * a focus/scroll request is fired — the column itself does not move.
   * Transient columns are NOT persisted to localStorage.
   */
  addTransientColumn: (
    route: string,
    source: { viewContext: string; signingIdentity: string | null } | null,
    parentColumnId?: string
  ) => void
  /** Promote a transient column to persisted (transient: false), then write through to localStorage. */
  pinColumn: (id: string) => void
  /** Demote a pinned column to transient (transient: true). Drops it from the persisted set without removing it from the live deck. */
  unpinColumn: (id: string) => void
  /**
   * Remove any column (transient or persisted). Animates: marks the id
   * as removing for 280ms (column-fade-out keyframe) before the actual
   * filter+persist. No-ops on a second call for the same id while it's
   * already in `removingIds`.
   */
  removeColumn: (id: string) => void
  /** Remove every column where transient === true. Pinned columns are untouched. */
  closeAllUnpinned: () => void
  /**
   * Patch a column's `config` object in-place (shallow merge). Persists
   * immediately. Used today by the per-column notification list-style
   * toggle; will likely host more per-type config edits as Phase 2 grows.
   */
  updateColumnConfig: (id: string, patch: Partial<TColumn['config']>) => void
  /**
   * Spawn (or focus) a dvm-feed column pinned to `pointer`. Only path that
   * creates dvm-feed columns — no AddColumnModal tile, no naddr paste. Called
   * by DvmDiscoverColumnBody rows.
   *
   * Dedup: keyed on (dvmPubkey + dvmIdentifier). A re-click on the same DVM
   * row focuses the existing column instead of spawning a duplicate; no second
   * kind-5300 publishes.
   *
   * Persisted (not transient) — the cached lastResultEventId is the whole
   * point of survival across reloads. Inherits signingIdentity from `source`
   * (the discover column the row was clicked in); falls back to the active
   * account when the source has none. Placement: spliced directly after
   * `source.columnId` for adjacent-detail-column ergonomics.
   */
  addDvmFeedColumn: (
    pointer: { pubkey: string; identifier: string },
    source: { signingIdentity: string | null; columnId: string }
  ) => void
  /**
   * Bulk-remove every column scoped to `pubkey`. Snap removal (no fade)
   * — the "this account is gone" semantic reads better as immediate
   * disappearance than a 280ms stagger. Used by LogoutDialog before
   * `removeAccount` to clean orphan columns.
   */
  closeColumnsForAccount: (pubkey: string) => void
  /** Reorder columns by indices (used by DnD-kit drag end). */
  reorderColumns: (from: number, to: number) => void

  // ──────────────────────────────────────────────────────────────────
  // Decks v2 — workspace + deck-level surface. Consumed by the Phase B
  // DeckSwitcher chip. Phase A wires this headlessly; no UI calls these
  // methods yet (the existing column-mutation surface still drives the
  // active deck under per-account-workspaces auto-routing).
  // ──────────────────────────────────────────────────────────────────

  /** Active workspace's deck list (for dropdown rendering). */
  decks: TDeck[]
  /** Active workspace's active deck. */
  activeDeck: TDeck | null
  /** True when the active deck has unsaved changes (transients excluded). */
  isActiveDeckDirty: boolean
  /** True when ANY workspace's active deck has unsaved changes (for beforeunload). */
  isAnyWorkspaceDirty: boolean
  /** Copy `columns` → `savedColumns` for the active deck. */
  saveActiveDeck: () => void
  /** Re-read all decks + columns from storage (used after applying a remote sync). */
  reloadFromStorage: () => void
  /** Revert `columns` to `savedColumns` for the active deck. */
  discardActiveDeckChanges: () => void
  /** Save-as: clone the active deck into a new deck within the same workspace. */
  saveActiveDeckAs: (input: { name: string }) => void
  /** Append an empty deck to the active workspace. Switches active to the new deck. */
  addEmptyDeck: (input?: { name?: string }) => void
  /** Rename a deck within the active workspace. */
  renameDeck: (deckId: string, name: string) => void
  /** Duplicate a deck within the active workspace (clones savedColumns, does NOT switch active). */
  duplicateDeck: (deckId: string) => void
  /** Delete a deck (with last-deck-guard). Returns the deleted deck for undo. */
  deleteDeck: (deckId: string) => void
  /** Switch active deck within the active workspace. */
  switchDeck: (deckId: string) => void
  /** Restore the most recently deleted deck (within 5s). Returns true on success. */
  undoLastDelete: () => boolean

  // ──────────────────────────────────────────────────────────────────
  // Track B — paired agents per workspace (for usePairedAgents hook +
  // the pairing wizard). The pairedAgents-diff effect (see file body)
  // already mirrors these into the in-memory MCP server, so the wizard
  // doesn't need to drive that itself.
  // ──────────────────────────────────────────────────────────────────

  /** Read-only access to the current workspaces map; lets hooks subscribe
   *  to React state instead of polling storage. */
  workspacesByAccount: import('@/types/column').TWorkspacesByAccount
  /** Add or update a paired agent on a Workspace. Last-write-wins on npub. */
  addPairedAgent: (
    workspaceOwner: string,
    agent: import('@/types/column').TPairedAgent
  ) => void
  /** Remove a paired agent from a Workspace by npub. No-op if not present. */
  removePairedAgent: (workspaceOwner: string, npub: string) => void
  /** Toggle allowSiblingExposure for a Workspace. */
  setAllowSiblingExposure: (workspaceOwner: string, allow: boolean) => void
}

const ColumnsContext = createContext<TColumnsContext | undefined>(undefined)

export const useColumns = (): TColumnsContext => {
  const ctx = useContext(ColumnsContext)
  if (!ctx) {
    throw new Error('useColumns must be used within <ColumnsProvider>')
  }
  return ctx
}

/**
 * Soft variant for components that may render outside the deck (e.g. login
 * flows triggered from the logged-out Welcome screen, where AccountManager
 * mounts above ColumnsProvider). Returns `null` instead of throwing when
 * the context is missing — caller decides what to do (typically: skip the
 * column-creation step, just register the account).
 */
export const useColumnsOptional = (): TColumnsContext | null => {
  return useContext(ColumnsContext) ?? null
}

/**
 * Rewrite the browser addressbar in-place to the canonical form when a
 * legacy URL shape spawned the column. Defensive try/catch handles
 * non-browser test environments where `window.history` is absent.
 */
function rewriteAddressBarToCanonical(canonical: string) {
  try {
    window.history.replaceState(window.history.state, '', canonical)
  } catch {
    /* non-browser env — skip */
  }
}

/**
 * Single-instance-per-(account|subject) column types. A user has at most one
 * Notifications column for their active account, at most one Profile column
 * per pubkey they care about, etc. Deep-link clicks (`/p/<npub>`,
 * `/notifications`, `/bookmarks`, `/me`) should focus existing columns
 * instead of spawning duplicates.
 *
 * Excluded:
 *   - 'home' — handled by focusOrCreateColumn, not the deep-link dispatcher.
 *   - 'detail', 'hashtag', 'relay', 'dvm-feed', 'dvm-discover' — keyed on
 *     content (note id / tag / relay url / DVM pointer), not viewContext;
 *     hashtag carries its own broader-rules dedup in addTransientColumn.
 */
const STANDING_TYPES: ReadonlySet<TColumnType> = new Set([
  'profile',
  'notifications',
  'bookmarks',
  'search'
])

/**
 * Dedup lookup for standing-column types. Returns an existing column
 * matching the (type, viewContext) tuple — pinned or transient — or `null`
 * if none exists or if the type is not a standing type.
 *
 * Exported (not just module-local) for unit testing — see
 * `ColumnsProvider.spec.ts`.
 */
export function findExistingStandingColumn(
  columns: TColumn[],
  type: TColumnType,
  viewContext: string
): TColumn | null {
  if (!STANDING_TYPES.has(type)) return null
  return columns.find((c) => c.type === type && c.viewContext === viewContext) ?? null
}

/**
 * Reconcile the persisted (non-transient) column set from storage with the
 * live transient columns currently in React state.
 *
 * The workspace-sync effect mirrors `storage.getColumns()` into React state when
 * the active workspace's deck data changes. But `getColumns()` only ever returns
 * NON-transient columns — transients live solely in React memory and are
 * deliberately never persisted. A naive `setColumns(storage.getColumns())`
 * therefore destroys every open transient column whenever ANY sibling column
 * triggers a persist. That's the "close one detail column and all the others
 * vanish" bug in append mode (where multiple transients coexist); replace
 * mode hid it because only one transient ever exists at a time.
 *
 * This helper keeps the live transients in place while taking the persisted
 * columns as authoritative:
 *   - walk `prev` so transients hold their position (adjacency to their
 *     parent), substituting each surviving non-transient with its fresh
 *     storage counterpart and dropping non-transients gone from storage
 *     (closed / unpinned);
 *   - then append any persisted columns not already present (e.g. a column
 *     that arrived via NIP-78 deck sync).
 *
 * Exported for unit testing — see `ColumnsProvider.spec.ts`.
 */
export function mergePersistedWithLiveTransients(
  prev: TColumn[],
  persisted: TColumn[]
): TColumn[] {
  const persistedById = new Map(persisted.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const merged: TColumn[] = []
  for (const c of prev) {
    if (c.transient) {
      merged.push(c)
      continue
    }
    const fresh = persistedById.get(c.id)
    if (fresh) {
      merged.push(fresh)
      seen.add(c.id)
    }
    // else: non-transient no longer in storage → drop it
  }
  for (const c of persisted) {
    if (!seen.has(c.id)) merged.push(c)
  }
  return merged
}

/**
 * Persisted set of account pubkeys that have already been auto-seeded with
 * Home + Notifications columns. Lets us distinguish "fresh pairing, give
 * the user starter columns" from "pre-existing account whose columns the
 * user intentionally closed."
 *
 * Stored as a JSON array under a dedicated key to avoid coupling with
 * `accounts` (which lives in NostrProvider/storage) or with `columns`
 * (which only tracks active columns, not history).
 */
// legacy localStorage key — do NOT rename; renaming re-seeds default columns for existing users
const SEEDED_PUBKEYS_KEY = 'spectr.seededColumnsForAccounts'

function readSeededAccountPubkeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEDED_PUBKEYS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set<string>(arr) : new Set()
  } catch {
    return new Set()
  }
}

function writeSeededAccountPubkeys(s: Set<string>) {
  localStorage.setItem(SEEDED_PUBKEYS_KEY, JSON.stringify([...s]))
}

/**
 * Owns the deck's Column[] state. Mounted above DeckManager so both DeckArea
 * (via useColumns) AND DeckManager's pushSecondaryPage interceptor can call
 * into it without prop-drilling.
 *
 * Persistence rule: only non-transient columns are written to localStorage.
 * Transient columns disappear on reload — back to seeded Home column state.
 */
export function ColumnsProvider({ children }: { children: ReactNode }) {
  const { account, accounts, pubkey: activePubkey, setActivePubkey } = useNostr()
  const { transientColumnMode } = useUserPreferences()
  // storage.getColumns() returns already-migrated entries — the legacy
  // accountId→viewContext/signingIdentity split + 'mentions' rename + deep
  // validation all run once in local-storage.service at hydration time.
  //
  // Under Decks v2, getColumns auto-routes through the active workspace's active
  // deck. `setActivePubkey` causes the workspace to swap; the workspace-sync
  // effect below mirrors the new active deck's columns into this React state.
  const [columns, setColumns] = useState<TColumn[]>(() => storage.getColumns())
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set())
  // Mirror of `storage.getWorkspacesByAccount()`. Drives `decks` / `activeDeck` /
  // dirty-state on the v2 context surface. Mutations to workspaces/decks call
  // `refreshWorkspacesByAccount()` to re-read storage and trigger React re-render.
  const [workspacesByAccount, setWorkspacesByAccount] = useState(() =>
    storage.getWorkspacesByAccount()
  )
  const requestFocusedColumn = useSetAtom(focusedColumnRequestAtom)

  /** Refresh the React-mirrored `workspacesByAccount` from storage. */
  const refreshWorkspacesByAccount = useCallback(() => {
    setWorkspacesByAccount(storage.getWorkspacesByAccount())
  }, [])

  // Always-current view of columns for use inside callbacks. Updated post-commit
  // so reading from `columnsRef.current` inside addTransientColumn gets the
  // latest committed state without forcing the callback to re-create on every
  // columns change (which would cascade through SecondaryPageContext consumers).
  const columnsRef = useRef(columns)
  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  const persist = useCallback(
    (cols: TColumn[]) => {
      storage.setColumns(cols.filter((c) => !c.transient))
      // Under v2, setColumns auto-routes through the active workspace's active
      // deck. Refresh the React mirror so derived v2 state (decks /
      // activeDeck / dirty / etc.) stays in sync.
      refreshWorkspacesByAccount()
    },
    [refreshWorkspacesByAccount]
  )

  // Decks v2 lifecycle: ensure a workspace exists for each paired account,
  // seeded with Home + Notifications. Migration from the v1 per-column
  // `seededColumnsForAccounts` localStorage key lives here — if the user's
  // legacy v1 columns predated the v2 migration, the workspace already has its
  // columns (migrateWorkspacesByAccount wrapped them).
  //
  // The `seededColumnsForAccounts` key is still read on the first run to
  // figure out who the pre-existing-v1 accounts are, but the
  // ensureWorkspaceForAccount call below is a no-op for accounts that already
  // have a workspace (the v1 → v2 migration put theirs there at init()).
  //
  // Auto-switch rule (per PM decision): `setActivePubkey(newAccount)` fires
  // ONLY when `activeAccountPubkey === null`. Multi-NostrConnect first pair
  // switches; subsequent pairs create workspaces in background without
  // disturbing active. Existing user adding new account: NO auto-switch.
  const migratedSeededRef = useRef(false)
  useEffect(() => {
    if (!migratedSeededRef.current) {
      migratedSeededRef.current = true
      const existingSeeded = readSeededAccountPubkeys()
      if (existingSeeded.size === 0) {
        // First run: mark accounts that already have a v2 workspace (from the
        // v1 migration) as seeded so we don't double-seed them below.
        const workspacePubkeys = new Set(Object.keys(storage.getWorkspacesByAccount()))
        if (workspacePubkeys.size > 0) {
          writeSeededAccountPubkeys(workspacePubkeys)
        }
      }
    }

    const seeded = readSeededAccountPubkeys()
    const currentSet = new Set(accounts.map((a) => a.pubkey))
    let mutated = false

    // Drop pubkeys whose accounts have been removed, so a future re-pair
    // (which puts the pubkey back in `accounts`) triggers a fresh seed.
    for (const pk of [...seeded]) {
      if (!currentSet.has(pk)) {
        seeded.delete(pk)
        mutated = true
      }
    }

    const toSeed = [...currentSet].filter((pk) => !seeded.has(pk))
    let firstNewlyPaired: string | null = null
    if (toSeed.length > 0) {
      for (const pubkey of toSeed) {
        // Seed the account's workspace with Home + Notifications. Idempotent —
        // ensureWorkspaceForAccount is a no-op when the workspace already exists.
        const initial = getInitialDecksForAccount(pubkey)
        storage.ensureWorkspaceForAccount(pubkey, initial)
        // NIP-78: if this device has never seen this account, try to pull its
        // remote workspace and replace the just-seeded default if still pristine.
        const seededDeckId = initial[0]?.id
        if (seededDeckId) {
          void deckSyncService
            .hydrateNewlyPairedAccount(pubkey, seededDeckId)
            .then((applied) => {
              if (applied) {
                refreshWorkspacesByAccount()
                setColumns(storage.getColumns())
              }
            })
            .catch((err) => console.error('[deck-sync] hydrate failed', err))
        }
        if (firstNewlyPaired === null) firstNewlyPaired = pubkey
        seeded.add(pubkey)
      }
      mutated = true
    }

    if (mutated) {
      writeSeededAccountPubkeys(seeded)
      refreshWorkspacesByAccount()
      // Mirror new active workspace's columns into local React state.
      setColumns(storage.getColumns())
    }

    // Auto-switch rule: only fires when no active account is set yet.
    if (firstNewlyPaired && storage.getActiveAccountPubkey() === null) {
      void setActivePubkey(firstNewlyPaired)
    }
  }, [accounts, refreshWorkspacesByAccount, setActivePubkey])

  // NOTE: workspaces are NOT auto-dropped when an account leaves `accounts`.
  // Logging out (or a NostrConnect re-pair) makes a workspace DORMANT, not
  // deleted — it stays keyed by pubkey in localStorage so re-login restores
  // the user's saved decks. (An earlier version dropped workspaces here, which
  // silently destroyed saved decks on every logout.) Explicit per-account
  // deck cleanup can be a future opt-in action; auto-deletion on logout is
  // the wrong default. `storage.removeWorkspaceForAccount` remains available
  // for that future deliberate path.

  // Workspace-sync — two triggers, two paths:
  //
  //   - Active account changed (Option A's mutable pubkey): a different
  //     workspace is now in view. Synchronously reset `columns` to the new
  //     workspace DURING render via React's set-state-during-render idiom —
  //     running this in a post-render `useEffect` left a one-frame window
  //     where AccountScope saw new `activePubkey` against stale
  //     `signingIdentity` and the dev-mode invariant warning fired. Per
  //     React docs, calling a setter inside a conditional during render
  //     makes React discard the in-flight render and re-render with the new
  //     state; children only ever observe consistent values.
  //     https://react.dev/reference/react/useState#storing-information-from-previous-renders
  //
  //     IMPORTANT: the previous-pubkey marker uses `useState`, NOT `useRef`.
  //     Strict Mode invokes the component body twice in dev; a ref mutated
  //     in invocation 1 would carry into invocation 2, making invocation 2's
  //     guard false and silently dropping setColumns. State setters queue
  //     idempotently and don't mutate the current render — invocation 2 sees
  //     the same pre-update value and re-queues the same updates, so the
  //     setColumns actually commits.
  //     Transients are intentionally wiped on account-change (they were
  //     ephemeral session state scoped to the previous account).
  //
  //   - Same account, `workspacesByAccount` changed (a sibling column's
  //     persist, a NIP-78 deck-sync arrival, a deck mutation): the persisted
  //     set is authoritative, but live transient columns must survive.
  //     `getColumns()` is persisted-only, so a blind reset here would wipe
  //     every open transient — that was the "close one detail column, lose
  //     all the others" bug. Merge instead. Active-account changes do NOT
  //     pass through this effect — they're handled synchronously above.
  const [lastSyncedPubkey, setLastSyncedPubkey] = useState(activePubkey)
  if (lastSyncedPubkey !== activePubkey) {
    setLastSyncedPubkey(activePubkey)
    setColumns(storage.getColumns())
  }
  useEffect(() => {
    setColumns((prev) => mergePersistedWithLiveTransients(prev, storage.getColumns()))
  }, [workspacesByAccount])

  // Track B — mirror pairedAgents into the MCP-server's in-memory state and
  // attach/detach subscriptions as the listen-when-paired gate flips. Fires
  // on workspace hydration + any Workspace mutation that touches pairedAgents.
  useEffect(() => {
    for (const [pubkey, workspace] of Object.entries(workspacesByAccount)) {
      const pairedSet = new Set((workspace.pairedAgents ?? []).map((a) => a.pubkey))
      contextVmServer.setPairedAgents(pubkey, pairedSet)
      if (pairedSet.size > 0) {
        void contextVmServer.attachWorkspace(pubkey)
      } else {
        contextVmServer.detachWorkspace(pubkey)
      }
    }
  }, [workspacesByAccount])

  // beforeunload guard: fire native browser warning if any workspace's active
  // deck has unsaved changes.
  useEffect(() => {
    const dirty = storage.isAnyWorkspaceDirty()
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      // An explicit "Reload" from the update banner is user-consented
      // navigation; deck state is already persisted to localStorage, so let
      // it through without the native "Leave site?" prompt (which otherwise
      // interrupts the SW-driven reload and forces a second click).
      if (isIntentionalReload()) return
      e.preventDefault()
      // Some browsers ignore returnValue but still need it set for the
      // dialog to fire.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [workspacesByAccount, columns])

  const addColumn = useCallback(
    (col: TColumn) => {
      setColumns((prev) => {
        const next = [...prev, col]
        persist(next)
        return next
      })
    },
    [persist]
  )

  const focusOrCreateColumn = useCallback(
    (spec: { type: TColumnType; viewContext: string; signingIdentity: string | null }) => {
      // Match against last-committed state. A column "of this type for this
      // perspective" is keyed on type + viewContext — the signer can be
      // overridden afterward without making it a different launcher target.
      const existing = columnsRef.current.find(
        (c) => c.type === spec.type && c.viewContext === spec.viewContext
      )
      if (existing) {
        requestFocusedColumn(existing.id)
        return
      }
      const col: TColumn = {
        id: randomId(),
        viewContext: spec.viewContext,
        signingIdentity: spec.signingIdentity,
        type: spec.type
      }
      addColumn(col)
      requestFocusedColumn(col.id)
    },
    [addColumn, requestFocusedColumn]
  )

  const addTransientColumn = useCallback(
    (
      route: string,
      source: { viewContext: string; signingIdentity: string | null } | null,
      parentColumnId?: string
    ) => {
      // Route → column-type dispatch. Each branch sets {type, config?,
      // viewContext, signingIdentity}; the spawn/dedup logic below is shared.
      //
      // Negative-match notes (each parser explicitly returns null):
      //   - parseProfileRoute: null for /p/:id/following, /users/:id/relays,
      //     undecodable bech32 → fall through to 'detail'.
      //   - parseHashtagRoute: null for kind/search/domain-scoped note lists
      //     (e.g. long-form article tag chips at /notes?t=tag&k=30023) → fall
      //     through to 'detail'.
      //   - parseRelayRoute: null for /relays/:url/reviews → fall through to
      //     'detail' (the relay-reviews secondary page lives there).
      //   - parseSearchRoute: null for anything other than `/search`; returns
      //     '' for bare `/search`, or the `?q=` value for pre-populated routes.
      const profilePubkey = parseProfileRoute(route)
      const hashtag = parseHashtagRoute(route)
      const relayUrl = parseRelayRoute(route)
      const searchQuery = parseSearchRoute(route)
      const actingPubkey = account?.pubkey ?? null

      // Inherited defaults: detail-column shape, viewContext/signingIdentity
      // from source (or the active account when navigation didn't come from
      // a deck column).
      let resolvedType: TColumnType = 'detail'
      let resolvedConfig: TColumnConfig | undefined = { route }
      let resolvedViewContext: string =
        source?.viewContext ?? actingPubkey ?? ''
      let resolvedSigningIdentity: string | null = source
        ? source.signingIdentity
        : actingPubkey

      if (profilePubkey) {
        // Profile column: ABOUT the clicked user.
        resolvedType = 'profile'
        resolvedConfig = undefined
        resolvedViewContext = profilePubkey
        // signingIdentity stays inherited (you keep acting as whoever you were).
        // Legacy URL → canonical addressbar rewrite. Cold-boot deep-link
        // already calls replaceState('/') so this branch only fires for
        // in-app pushes from a legacy-emitting helper that hasn't migrated.
        if (route.startsWith('/users/')) {
          rewriteAddressBarToCanonical(`/p/${route.slice('/users/'.length)}`)
        }
      } else if (hashtag) {
        // Hashtag column: feed for the tag. View/sign inherit from source.
        resolvedType = 'hashtag'
        resolvedConfig = { hashtags: [hashtag] }
        if (route.startsWith('/notes?t=')) {
          rewriteAddressBarToCanonical(`/t/${encodeURIComponent(hashtag)}`)
        }
      } else if (relayUrl) {
        // Relay column: firehose for the URL. View/sign inherit from source.
        resolvedType = 'relay'
        resolvedConfig = { relayUrl }
        if (route.startsWith('/relays/')) {
          rewriteAddressBarToCanonical(`/r/${encodeURIComponent(relayUrl)}`)
        }
      } else if (searchQuery !== null) {
        // Search column: NIP-50 input lives inline in the body. Spawned from
        // the cmd-K palette via `/search`; account-scoped because the
        // standing-type dedup keys on viewContext.
        if (!actingPubkey) return
        resolvedType = 'search'
        resolvedConfig = { query: searchQuery }
        resolvedViewContext = actingPubkey
        resolvedSigningIdentity = actingPubkey
      } else if (route === '/notifications') {
        // Account-scoped: no active account = nothing to spawn.
        if (!actingPubkey) return
        resolvedType = 'notifications'
        resolvedConfig = undefined
        resolvedViewContext = actingPubkey
        resolvedSigningIdentity = actingPubkey
      } else if (route === '/bookmarks') {
        if (!actingPubkey) return
        resolvedType = 'bookmarks'
        resolvedConfig = undefined
        resolvedViewContext = actingPubkey
        resolvedSigningIdentity = actingPubkey
      } else if (route === '/me' || route === '/profile') {
        // Self-profile shorthand. Rewrite to a Profile column scoped to self.
        if (!actingPubkey) return
        resolvedType = 'profile'
        resolvedConfig = undefined
        resolvedViewContext = actingPubkey
        resolvedSigningIdentity = actingPubkey
      }

      const isProfile = resolvedType === 'profile'
      const isHashtag = resolvedType === 'hashtag'

      // Standing-type dedup (Profile / Notifications / DMs / Bookmarks /
      // Search): at most one column per (type, viewContext) across BOTH
      // pinned and transient. Re-clicking a `/p/<npub>` link with a column
      // already open for that npub focuses the existing column rather than
      // spawning a duplicate.
      if (
        resolvedViewContext &&
        STANDING_TYPES.has(resolvedType)
      ) {
        const existingStanding = findExistingStandingColumn(
          columnsRef.current,
          resolvedType,
          resolvedViewContext
        )
        if (existingStanding) {
          // Update parentColumnId on transient matches so close-back-focus
          // follows the most recent click source; pinned matches don't carry
          // a parent and aren't touched.
          if (
            existingStanding.transient &&
            parentColumnId &&
            existingStanding.parentColumnId !== parentColumnId
          ) {
            setColumns((prev) =>
              prev.map((c) =>
                c.id === existingStanding.id ? { ...c, parentColumnId } : c
              )
            )
          }
          requestFocusedColumn(existingStanding.id)
          return
        }
      }

      // Hashtag dedup: broader than detail's narrow rules — spans pinned AND
      // transient, keys on the tag alone (ignoring signingIdentity). User
      // intent when clicking #clave is "show me this tag"; whose key signs
      // is incidental, and we don't want N variant #clave columns from
      // account cycling. Single-tag exact match only — a multi-tag pinned
      // column (#nostr,#bitcoin) doesn't match a click on #nostr. Pinned
      // matches take priority over transient ones.
      if (isHashtag) {
        const matchesHashtag = (c: TColumn) =>
          c.type === 'hashtag' &&
          c.config?.hashtags?.length === 1 &&
          c.config.hashtags[0] === hashtag
        const existingHashtag =
          columnsRef.current.find((c) => matchesHashtag(c) && !c.transient) ??
          columnsRef.current.find((c) => matchesHashtag(c) && c.transient)
        if (existingHashtag) {
          if (
            existingHashtag.transient &&
            parentColumnId &&
            existingHashtag.parentColumnId !== parentColumnId
          ) {
            setColumns((prev) =>
              prev.map((c) =>
                c.id === existingHashtag.id ? { ...c, parentColumnId } : c
              )
            )
          }
          requestFocusedColumn(existingHashtag.id)
          return
        }
      }

      // Detail dedup predicate (transient-only): re-click reuses the existing
      // transient column keyed on signingIdentity + route. Profile dedup has
      // been pulled up into the standing-type branch above; hashtag has its
      // own; so this branch only ever matches generic detail columns now.
      const matches = (c: TColumn) =>
        !!c.transient &&
        c.type === resolvedType &&
        c.signingIdentity === resolvedSigningIdentity &&
        !isProfile &&
        !isHashtag &&
        c.config?.route === route

      const existing = columnsRef.current.find(matches)
      if (existing) {
        if (parentColumnId && existing.parentColumnId !== parentColumnId) {
          setColumns((prev) =>
            prev.map((c) => (c.id === existing.id ? { ...c, parentColumnId } : c))
          )
        }
        requestFocusedColumn(existing.id)
        return
      }

      const newCol: TColumn = {
        id: randomId(),
        viewContext: resolvedViewContext,
        signingIdentity: resolvedSigningIdentity,
        type: resolvedType,
        transient: true,
        ...(resolvedConfig ? { config: resolvedConfig } : {}),
        parentColumnId
      }
      setColumns((prev) => {
        // Defensive in-updater dedup catches a rapid double-fire that the ref
        // check above might miss (ref lags by one commit). No-op return; the
        // first call's focus signal already fired.
        if (prev.some(matches)) {
          return prev
        }
        // Adjacency: splice the new column in right after its parent. Falls
        // back to end-of-deck when the parent is unknown or already gone.
        // Computed against `prev` (with transients) so a chained-drill parent
        // that is itself a transient still positions the new column correctly.
        const parentIdx = parentColumnId
          ? prev.findIndex((c) => c.id === parentColumnId)
          : -1
        let next: TColumn[]
        if (parentIdx >= 0) {
          next = [...prev]
          next.splice(parentIdx + 1, 0, newCol)
        } else {
          next = [...prev, newCol]
        }
        if (transientColumnMode === 'replace') {
          // Replace mode keeps at most one transient: drop every prior
          // transient while keeping the one we just inserted.
          return next.filter((c) => !c.transient || c.id === newCol.id)
        }
        return next
      })
      // Intentionally NOT calling persist — transient columns don't persist.
    },
    [transientColumnMode, account?.pubkey, requestFocusedColumn]
  )

  const pinColumn = useCallback(
    (id: string) => {
      setColumns((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, transient: false } : c))
        persist(next)
        return next
      })
    },
    [persist]
  )

  const unpinColumn = useCallback(
    (id: string) => {
      setColumns((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, transient: true } : c))
        // Persist drops `transient: true` entries, so demoting a column writes
        // through to the persisted set as "removed". The column stays in the
        // live deck until the user explicitly closes it (or reloads).
        persist(next)
        return next
      })
    },
    [persist]
  )

  // 280ms matches the `column-fade-out` keyframe in src/index.css. Holding
  // the id in `removingIds` for the duration of the animation is what makes
  // the keyboard shortcut animate identically to the mouse X click — both
  // paths now end up here.
  const COLUMN_FADE_MS = 280
  const removeColumn = useCallback(
    (id: string) => {
      // Idempotent: a second call while still animating is a no-op.
      let alreadyRemoving = false
      setRemovingIds((prev) => {
        if (prev.has(id)) {
          alreadyRemoving = true
          return prev
        }
        const next = new Set(prev)
        next.add(id)
        return next
      })
      if (alreadyRemoving) return
      setTimeout(() => {
        setColumns((prev) => {
          const next = prev.filter((c) => c.id !== id)
          persist(next)
          return next
        })
        setRemovingIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, COLUMN_FADE_MS)
    },
    [persist]
  )

  const closeAllUnpinned = useCallback(() => {
    setColumns((prev) => {
      const next = prev.filter((c) => !c.transient)
      persist(next)
      return next
    })
  }, [persist])

  const updateColumnConfig = useCallback(
    (id: string, patch: Partial<TColumn['config']>) => {
      setColumns((prev) => {
        const next = prev.map((c) =>
          c.id === id ? { ...c, config: { ...c.config, ...patch } } : c
        )
        persist(next)
        return next
      })
    },
    [persist]
  )

  const addDvmFeedColumn = useCallback(
    (
      pointer: { pubkey: string; identifier: string },
      source: { signingIdentity: string | null; columnId: string }
    ) => {
      const existing = columnsRef.current.find(
        (c) =>
          c.type === 'dvm-feed' &&
          c.config?.dvmPubkey === pointer.pubkey &&
          c.config?.dvmIdentifier === pointer.identifier
      )
      if (existing) {
        requestFocusedColumn(existing.id)
        return
      }
      // The signer is whose pubkey the kind-5300 will be published as, and
      // whose `["p", ...]` tag personalizes the feed. Inherit from the source
      // (discover) column; fall back to global active account when the source
      // has none. A null signingIdentity means the body falls through to its
      // "Requires a paired account" empty state — that's intentional, not a
      // crash path.
      const signingIdentity = source.signingIdentity ?? account?.pubkey ?? null
      const viewContext = signingIdentity ?? source.signingIdentity ?? account?.pubkey ?? ''
      const newCol: TColumn = {
        id: crypto.randomUUID(),
        viewContext,
        signingIdentity,
        type: 'dvm-feed',
        config: {
          dvmPubkey: pointer.pubkey,
          dvmIdentifier: pointer.identifier
        }
      }
      setColumns((prev) => {
        const parentIdx = prev.findIndex((c) => c.id === source.columnId)
        let next: TColumn[]
        if (parentIdx >= 0) {
          next = [...prev]
          next.splice(parentIdx + 1, 0, newCol)
        } else {
          next = [...prev, newCol]
        }
        persist(next)
        return next
      })
      requestFocusedColumn(newCol.id)
    },
    [account?.pubkey, persist, requestFocusedColumn]
  )

  // Snap removal — no fade. Under Decks v2, account removal additionally
  // drops the account's workspace (handled by the subtractive lifecycle
  // effect above when `accounts` updates). Here we eagerly drop the
  // workspace + clear stragglers from the current active deck so the user's
  // view updates immediately rather than waiting for NostrProvider's
  // removeAccount to propagate through AccountsProvider's setAccounts.
  //
  // We do NOT call setActivePubkey here — NostrProvider's removeAccount
  // owns the active-account fallback (switchAccount(remaining[0]) on
  // removed-active or setAccount(null) when no survivors).
  const closeColumnsForAccount = useCallback((pubkey: string) => {
    // Decks v2: the account's workspace + saved decks PERSIST (dormant)
    // across logout — workspaces are keyed by pubkey and only deleted by an
    // explicit user action, never on logout. Here we only drop the removed
    // account's columns from the LIVE React view so their AccountScope
    // subtrees unmount before the signer is yanked (LogoutDialog calls this
    // before removeAccount). We deliberately do NOT persist() — that would
    // wipe the saved deck — and do NOT removeWorkspaceForAccount(), so
    // re-login restores the saved decks. The workspace-sync effect
    // re-populates `columns` from the next active workspace once
    // removeAccount sets the new active account.
    setColumns((prev) => prev.filter((c) => c.signingIdentity !== pubkey))
  }, [])

  const reorderColumns = useCallback(
    (from: number, to: number) => {
      setColumns((prev) => {
        const next = arrayMove(prev, from, to)
        persist(next)
        return next
      })
    },
    [persist]
  )

  // ──────────────────────────────────────────────────────────────────
  // Decks v2 — deck-level methods. Headless in Phase A (no UI calls these
  // yet; the chip in Phase B will). Each method delegates to the storage
  // service then refreshes the React-mirrored workspacesByAccount + columns.
  // ──────────────────────────────────────────────────────────────────

  const saveActiveDeck = useCallback(() => {
    storage.saveActiveDeck()
    refreshWorkspacesByAccount()
    const pk = storage.getActiveAccountPubkey()
    if (pk) void deckSyncService.publishWorkspace(pk)
  }, [refreshWorkspacesByAccount])

  const reloadFromStorage = useCallback(() => {
    refreshWorkspacesByAccount()
    setColumns(storage.getColumns())
  }, [refreshWorkspacesByAccount])

  const discardActiveDeckChanges = useCallback(() => {
    storage.discardActiveDeckChanges()
    refreshWorkspacesByAccount()
    setColumns(storage.getColumns())
  }, [refreshWorkspacesByAccount])

  const saveActiveDeckAs = useCallback(
    (input: { name: string }) => {
      storage.saveActiveDeckAs(input)
      refreshWorkspacesByAccount()
      setColumns(storage.getColumns())
      const pk = storage.getActiveAccountPubkey()
      if (pk) void deckSyncService.publishWorkspace(pk)
    },
    [refreshWorkspacesByAccount]
  )

  const addEmptyDeck = useCallback(
    (input: { name?: string } = {}) => {
      storage.addEmptyDeck(input)
      refreshWorkspacesByAccount()
      setColumns(storage.getColumns())
    },
    [refreshWorkspacesByAccount]
  )

  const renameDeck = useCallback(
    (deckId: string, name: string) => {
      storage.renameDeck(deckId, name)
      refreshWorkspacesByAccount()
      const pk = storage.getActiveAccountPubkey()
      if (pk) void deckSyncService.publishWorkspace(pk)
    },
    [refreshWorkspacesByAccount]
  )

  const duplicateDeck = useCallback(
    (deckId: string) => {
      storage.duplicateDeck(deckId)
      refreshWorkspacesByAccount()
      const pk = storage.getActiveAccountPubkey()
      if (pk) void deckSyncService.publishWorkspace(pk)
    },
    [refreshWorkspacesByAccount]
  )

  const switchDeck = useCallback(
    (deckId: string) => {
      if (!activePubkey) return
      storage.setActiveDeckIdForAccount(activePubkey, deckId)
      refreshWorkspacesByAccount()
      setColumns(storage.getColumns())
    },
    [activePubkey, refreshWorkspacesByAccount]
  )

  // Recently-deleted undo (5s). Lives in a ref because it's ephemeral — no
  // need to drive renders. Cleared on timer expiry or explicit undoLastDelete.
  const recentlyDeletedRef = useRef<{
    deck: TDeck
    workspaceKey: string
    restorationIndex: number
    timer: number
  } | null>(null)

  const deleteDeck = useCallback(
    (deckId: string) => {
      if (!activePubkey) return
      const workspace = storage.getActiveWorkspace()
      if (!workspace) return
      const idx = workspace.decks.findIndex((d) => d.id === deckId)
      if (idx < 0) return
      const deck = workspace.decks[idx]
      storage.deleteDeck(deckId)
      refreshWorkspacesByAccount()
      setColumns(storage.getColumns())
      void deckSyncService.publishWorkspace(activePubkey)

      // Snapshot for undo. Clear any prior pending undo.
      if (recentlyDeletedRef.current?.timer) {
        clearTimeout(recentlyDeletedRef.current.timer)
      }
      const timer = window.setTimeout(() => {
        recentlyDeletedRef.current = null
      }, 5000)
      recentlyDeletedRef.current = {
        deck,
        workspaceKey: activePubkey,
        restorationIndex: idx,
        timer
      }
    },
    [activePubkey, refreshWorkspacesByAccount]
  )

  const undoLastDelete = useCallback((): boolean => {
    const snap = recentlyDeletedRef.current
    if (!snap) return false
    clearTimeout(snap.timer)
    recentlyDeletedRef.current = null

    const current = storage.getWorkspacesByAccount()
    const workspace = current[snap.workspaceKey]
    if (!workspace) return false

    // Re-insert at the original index. If last-deck guard fired (workspace
    // has a single Untitled+empty deck post-delete), drop it; otherwise keep.
    let nextDecks = [...workspace.decks]
    const lastDeckGuardDeck = nextDecks.find(
      (d) => d.name === 'Untitled deck' && d.columns.length === 0 && d.savedColumns.length === 0
    )
    if (lastDeckGuardDeck && nextDecks.length === 1) {
      nextDecks = []
    }
    nextDecks.splice(snap.restorationIndex, 0, snap.deck)

    storage.setWorkspacesByAccount({
      ...current,
      [snap.workspaceKey]: {
        decks: nextDecks,
        activeDeckId: snap.deck.id
      }
    })
    refreshWorkspacesByAccount()
    setColumns(storage.getColumns())
    void deckSyncService.publishWorkspace(snap.workspaceKey)
    return true
  }, [refreshWorkspacesByAccount])

  // Track B — paired-agent mutators. Write through storage + refresh React
  // state. The pairedAgents-diff effect (above) propagates changes to the
  // in-memory MCP server (attach/detach + pairedAgents map sync).
  const addPairedAgent = useCallback(
    (workspaceOwner: string, agent: import('@/types/column').TPairedAgent) => {
      const current = storage.getWorkspacesByAccount()
      const ws = current[workspaceOwner]
      if (!ws) return
      const existing = ws.pairedAgents ?? []
      const filtered = existing.filter((a) => a.npub !== agent.npub)
      const nextAgents = [...filtered, agent]
      storage.setWorkspacesByAccount({
        ...current,
        [workspaceOwner]: { ...ws, pairedAgents: nextAgents }
      })
      refreshWorkspacesByAccount()
      void deckSyncService.publishWorkspace(workspaceOwner)
    },
    [refreshWorkspacesByAccount]
  )

  const removePairedAgent = useCallback(
    (workspaceOwner: string, npub: string) => {
      const current = storage.getWorkspacesByAccount()
      const ws = current[workspaceOwner]
      if (!ws) return
      const next = (ws.pairedAgents ?? []).filter((a) => a.npub !== npub)
      storage.setWorkspacesByAccount({
        ...current,
        [workspaceOwner]: {
          ...ws,
          ...(next.length > 0 ? { pairedAgents: next } : { pairedAgents: undefined })
        }
      })
      refreshWorkspacesByAccount()
      void deckSyncService.publishWorkspace(workspaceOwner)
    },
    [refreshWorkspacesByAccount]
  )

  const setAllowSiblingExposure = useCallback(
    (workspaceOwner: string, allow: boolean) => {
      const current = storage.getWorkspacesByAccount()
      const ws = current[workspaceOwner]
      if (!ws) return
      storage.setWorkspacesByAccount({
        ...current,
        [workspaceOwner]: { ...ws, allowSiblingExposure: allow }
      })
      refreshWorkspacesByAccount()
      void deckSyncService.publishWorkspace(workspaceOwner)
    },
    [refreshWorkspacesByAccount]
  )

  // Derived v2 surface for context consumers.
  const activeWorkspace = activePubkey ? workspacesByAccount[activePubkey] ?? null : null
  const v2Decks = activeWorkspace?.decks ?? []
  const activeDeck = activeWorkspace
    ? activeWorkspace.decks.find((d) => d.id === activeWorkspace.activeDeckId) ?? null
    : null
  const isActiveDeckDirty = useMemo(
    () => storage.isActiveDeckDirty(),

    [columns, activeDeck, workspacesByAccount]
  )
  const isAnyWorkspaceDirty = useMemo(
    () => storage.isAnyWorkspaceDirty(),

    [columns, workspacesByAccount]
  )

  const value = useMemo(
    () => ({
      columns,
      removingIds,
      addColumn,
      focusOrCreateColumn,
      addTransientColumn,
      pinColumn,
      unpinColumn,
      removeColumn,
      closeAllUnpinned,
      updateColumnConfig,
      closeColumnsForAccount,
      reorderColumns,
      addDvmFeedColumn,
      // Decks v2 surface
      decks: v2Decks,
      activeDeck,
      isActiveDeckDirty,
      isAnyWorkspaceDirty,
      saveActiveDeck,
      reloadFromStorage,
      discardActiveDeckChanges,
      saveActiveDeckAs,
      addEmptyDeck,
      renameDeck,
      duplicateDeck,
      deleteDeck,
      switchDeck,
      undoLastDelete,
      // Track B
      workspacesByAccount,
      addPairedAgent,
      removePairedAgent,
      setAllowSiblingExposure
    }),
    [
      columns,
      removingIds,
      addColumn,
      focusOrCreateColumn,
      addTransientColumn,
      pinColumn,
      unpinColumn,
      removeColumn,
      closeAllUnpinned,
      updateColumnConfig,
      v2Decks,
      activeDeck,
      isActiveDeckDirty,
      isAnyWorkspaceDirty,
      saveActiveDeck,
      reloadFromStorage,
      discardActiveDeckChanges,
      saveActiveDeckAs,
      addEmptyDeck,
      renameDeck,
      duplicateDeck,
      deleteDeck,
      switchDeck,
      undoLastDelete,
      closeColumnsForAccount,
      reorderColumns,
      addDvmFeedColumn,
      workspacesByAccount,
      addPairedAgent,
      removePairedAgent,
      setAllowSiblingExposure
    ]
  )

  return <ColumnsContext.Provider value={value}>{children}</ColumnsContext.Provider>
}
