// src/types/column.d.ts
export type TColumnType =
  | 'home'
  | 'notifications'
  | 'detail'
  | 'relay'
  | 'bookmarks'
  | 'hashtag'
  | 'profile'
  | 'search'
  | 'dvm-discover'
  | 'dvm-feed'
  | 'relatr-discovery'
  | 'articles'
  | 'favorites'
  | 'messages'

/**
 * Type-specific column config. Fields are populated based on column type:
 * - 'detail': { route: string } — the secondary route to render
 * - 'relay':  { relayUrl: string } — the wss:// URL of the relay to subscribe to
 * - 'hashtag': { hashtags: string[] } — normalized hashtags (no leading `#`,
 *   lowercased) the column's feed is filtered to; multiple tags are OR'd
 * - 'search': { query: string } — the NIP-50 search query string the column's
 *   feed is filtered to. Edited inline via the column body's search input.
 * - 'notifications' / 'bookmarks' / 'hashtag': { listStyle?: 'compact' | 'detailed' } —
 *   per-column override of the global `notificationListStyle` user pref. Set
 *   via the compact/detailed toggle in the column header; unset means
 *   "follow the global pref." Shared by every feed column that opts into the
 *   list-style toggle (see LIST_STYLE_COLUMN_TYPES in components/Column).
 * - 'dvm-feed': { dvmPubkey, dvmIdentifier, lastResultEventId?, lastRequestedAt? }
 *   — pointer to the kind-31990 handler (NIP-89) the column is pinned to, plus
 *   the cached id of the most recent kind-6300 result this column rendered so
 *   reloads serve from cache without re-publishing. `lastRequestedAt` is unix
 *   seconds, used to mute the auto-publish on first mount once a result lands.
 * - 'relatr-discovery': { relatrQuery, relatrLastResultPubkeys?, relatrLastRefreshedAt?,
 *   relatrHideBanner?, relatrHideFollows? } — user-entered topic + cached author
 *   pubkeys for snapshot+refresh rendering (mirrors dvm-feed's lifecycle).
 *   `relatrHideBanner` is per-column so a future Relatr column gets a fresh
 *   chance to inform. `relatrHideFollows` filters returned authors against the
 *   user's follow list — discovery-mode toggle.
 * - 'home': not set
 *
 * Phase 2 may tighten this into a proper TColumn discriminated union once more
 * column types ship and per-type config schemas have stabilized.
 */
export type TColumnConfig = {
  route?: string
  relayUrl?: string
  hashtags?: string[]
  query?: string
  listStyle?: 'compact' | 'detailed'
  dvmPubkey?: string
  dvmIdentifier?: string
  lastResultEventId?: string
  lastRequestedAt?: number
  /** 'relatr-discovery': user-entered topic. */
  relatrQuery?: string
  /** 'relatr-discovery': cached ranked author results from the most recent
   *  successful search_profiles response. Reload renders the author list from
   *  cache without re-calling Relatr. Inlined shape (rather than importing
   *  TRelatrProfileResult from @/lib/relatr) to avoid a runtime→types import
   *  cycle through `.d.ts` resolution. */
  relatrLastResults?: Array<{
    pubkey: string
    trustScore: number
    rank: number
    exactMatch?: boolean
  }>
  /** 'relatr-discovery': unix seconds of the most recent successful response. */
  relatrLastRefreshedAt?: number
  /** 'relatr-discovery': true once user dismisses the "not personalized" banner;
   *  per-column so future Relatr columns get a fresh chance to inform. */
  relatrHideBanner?: boolean
  /** 'relatr-discovery': when true, the body's `filterFn` drops returned
   *  authors the user already follows — surfaces only "new" people for
   *  discovery. Filter runs client-side over the cached pubkey set; the
   *  Relatr request itself is unchanged. */
  relatrHideFollows?: boolean
  /** Feed columns: when true, hide notes from authors outside the user's
   *  2-hop WoT (your follows + their follows). Per-column binary filter
   *  replacing the prior trustScoreThreshold int. Default false. */
  wotOnly?: boolean
}

export type TColumn = {
  /** Stable identifier across reorders. `randomId()` (UUID v4) for user-added columns. */
  id: string
  /**
   * Pubkey whose perspective this column shows — drives the follow list (Home),
   * the `#p` filter (Notifications), the header avatar, mute lists applied, and
   * like-state. May be ANY pubkey: one of the user's paired accounts, or a
   * foreign pubkey the user has no key for ("view-as"). For 'detail' columns,
   * inherited from the source column.
   */
  viewContext: string
  /**
   * Pubkey of the paired account whose key signs actions taken from this
   * column (Like / Zap / Repost / Reply / Compose / mark-read). Always one of
   * the user's paired accounts, or `null` when no paired account exists on this
   * device yet (writes disabled — view-only). Defaults to `viewContext` for a
   * paired-account column; for a foreign `viewContext` it's the active paired
   * account at creation time, overridable afterward via the sidebar.
   */
  signingIdentity: string | null
  type: TColumnType
  /** True iff this column is in-memory only (not persisted, removed on reload). Used by 'detail' columns spawned from secondary-page navigation. Pinning sets this to false. */
  transient?: boolean
  /** Override width in px. Defaults to 400 in B; user-resizable in Phase 2. */
  width?: number
  /** Type-specific config. See TColumnConfig. */
  config?: TColumnConfig
  /**
   * Id of the column this one was spawned from. Only set on transient detail
   * columns opened by clicking a note / profile / hashtag inside another
   * column. Used to (a) splice the detail column adjacent to its parent on
   * open and (b) return focus to the parent when the detail column is closed.
   * Re-clicking the same target from a different parent updates this pointer
   * so close-focus follows the most recent click source.
   */
  parentColumnId?: string
}

/**
 * v1 deck shape — preserved as input type for `migrateWorkspacesByAccount`. The
 * canonical v2 `TDeck` below drops `ownerPubkey` (implicit via workspace key) and
 * gains `savedColumns` + `lastSavedAt`. Don't add v1 entries to runtime code
 * paths; only read.
 */
export type TDeckV1 = {
  id: string
  name: string
  ownerPubkey: string | null
  columns: TColumn[]
  createdAt: number
  updatedAt: number
}

/**
 * v2 deck shape. Owned implicitly by the workspace key in `TWorkspacesByAccount`. A
 * deck carries TWO column lists:
 *   - `columns`: LIVE state, auto-persisted on every mutation
 *   - `savedColumns`: SAVED SNAPSHOT, updates only on Save / Save As
 * Dirty state = !deepEqual(columns, savedColumns) with transients excluded.
 */
export type TDeck = {
  /** Stable identifier, generated via `randomId()` at creation. */
  id: string
  /** User-editable display name. Default 'My Deck' on initial migration. */
  name: string
  /** The deck's LIVE column set — auto-persisted on every mutation. */
  columns: TColumn[]
  /** Saved snapshot — updates on Save / Save As only. */
  savedColumns: TColumn[]
  /** Unix milliseconds at deck creation. */
  createdAt: number
  /** Unix milliseconds — bumped on every live-state mutation. */
  updatedAt: number
  /** Unix milliseconds — bumped only when `savedColumns` updates. */
  lastSavedAt: number
}

/**
 * Per-account workspace — keyed by paired-account pubkey. Each workspace owns
 * its own deck list + active-deck pointer.
 */
export type TAccountWorkspace = {
  activeDeckId: string
  decks: TDeck[]
  /** Track B paired agents. Optional for backward compat — existing Workspaces
   *  parse fine without it. See spec §6.1. */
  pairedAgents?: TPairedAgent[]
  /** When true, list_columns returns columns whose viewContext is a sibling
   *  paired account on this jank instance. Default false (strict opsec
   *  posture). Toggled via Settings → Agents → "Allow agents to see your other
   *  paired accounts" with a disclosure dialog. See spec §10. */
  allowSiblingExposure?: boolean
}

/** A paired AI agent. v1 is read-only scope; v2 will add 'full'. See spec §6.1. */
export type TPairedAgent = {
  /** Agent's pubkey (hex, canonical). This is the MCP/tool-auth key the agent
   *  is authorized as on the ContextVM server. */
  pubkey: string
  /** Bech32 form of the agent's pubkey — for display + storage convenience. */
  npub: string
  /** Transport-neutral npub the user DMs to chat with this agent (Track B
   *  in-app chat drawer). DISTINCT from `pubkey`/`npub` above: in the real
   *  setup the agent's chat key differs from its tool-auth key. Optional so
   *  existing paired agents migrate cleanly with no chat surface — the drawer
   *  button stays hidden until an agent has a chat npub. */
  agentChatNpub?: string
  /** User-given display name. Optional; defaults to `agent-<first-8-of-npub>`
   *  for rendering when absent. */
  name?: string
  /** Scope grant. v1 always 'read-only'; v2 adds 'full'. */
  scope: 'read-only'
  /** Unix seconds of pair time. */
  pairedAt: number
  /** Unix seconds of most recent successful tool call from this agent.
   *  Throttled write (5-min granularity) — heartbeat-only data. */
  lastCalledAt?: number
}

/** Top-level v2 structure: pubkey → that account's workspace. */
export type TWorkspacesByAccount = Record<string, TAccountWorkspace>
