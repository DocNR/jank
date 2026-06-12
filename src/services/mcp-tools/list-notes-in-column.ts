import { kinds, nip19, type Event as NEvent, type Filter } from 'nostr-tools'
import type { TToolDefinition, ToolHandler } from '../context-vm-server.service'
import storage from '../local-storage.service'
import indexedDb from '../indexed-db.service'
import client from '../client.service'
import relayListService from '../fetchers/relay-list.service'
import profileFetcher from '../profile-fetcher.service'
import { getPubkeysFromPTags } from '@/lib/tag'
import { normalizeHashtag } from '@/lib/hashtag'
import { BIG_RELAY_URLS } from '@/constants'
import type { TColumn } from '@/types/column'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

// Read an over-fetch from the local cache so the `since`/`limit` post-filter
// has enough headroom. getEvents already caps by `limit` internally, so we ask
// for a generous slice and trim afterward.
const CACHE_OVERFETCH = MAX_LIMIT * 2

// Hard ceiling on the live relay query. The agent-side budget is tight, so the
// MCP call must never hang: if the relay query has not finished (EOSE) within
// this window we abandon it and fall back to whatever is in cache.
const LIVE_FETCH_TIMEOUT_MS = 6000

// Upper bound on how many relays we open for a live fetch (owner read relays +
// big-relay fallback, deduped). Mirrors the slices the column feeds use.
const MAX_LIVE_RELAYS = 8

// Best-effort author-name enrichment is bounded separately and runs cache-first,
// so it almost always returns instantly. This is the ceiling for the rare case
// where some authors need a network round-trip; names that miss it are skipped.
const PROFILE_ENRICH_TIMEOUT_MS = 2000

type NoteRecord = {
  id: string
  pubkey: string
  kind: number
  content: string
  created_at: number
  tags: string[][]
}

export const listNotesInColumnDef: TToolDefinition = {
  name: 'list_notes_in_column',
  description:
    "List recent notes for a column in the paired account's active deck. READ-ONLY. " +
    'By default this LIVE-FETCHES fresh notes from the relays that back the column ' +
    '(bounded by a ~6s timeout) and merges them with what is already cached locally, ' +
    'so the agent sees the actual feed, not just what one browser tab happened to load. ' +
    'Pass cachedOnly:true for a fast cache-only read (no relay query). If the live ' +
    'query times out or errors it silently falls back to the cached result. Supports ' +
    'column types whose feed maps to a simple author/tag/relay filter: home, hashtag, ' +
    'profile, relay. Other types (search, notifications, bookmarks, dvm-feed, ' +
    'dvm-discover, relatr-discovery, articles, favorites, detail) are not supported in ' +
    'v1 and return an unsupported-column-type error. The headline use case: call ' +
    'list_columns, then this per column, to summarize the feed across the deck. ' +
    'Optional `since` (exclusive floor) and `until` (exclusive ceiling), both unix ' +
    'seconds, bound the time window: each call returns at most `limit` of the ' +
    'MOST-RECENT notes in the (since, until) range. For a long or busy window this ' +
    'means one call only sees the newest slice, so you MUST paginate backward: take ' +
    'the oldest created_at you received and call again with `until` set to that value, ' +
    'repeating until you have enough notes or have walked back across the whole range. ' +
    'Be honest about coverage: do not claim you summarized "the last 24 hours" (or any ' +
    'range) unless you actually paged through all of it; if you only fetched one page, ' +
    'say so. Each returned note carries a `url` (an njump.me link) you can cite directly.',
  inputSchema: {
    type: 'object',
    required: ['columnId'],
    properties: {
      columnId: {
        type: 'string',
        description: 'The id of the column to list notes from (from list_columns).'
      },
      limit: {
        type: 'number',
        description: `Max notes to return. Default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`
      },
      since: {
        type: 'number',
        description:
          'Optional unix-seconds floor (exclusive). Only notes with created_at > since are returned.'
      },
      until: {
        type: 'number',
        description:
          'Optional unix-seconds ceiling (exclusive). Only notes with created_at < until are ' +
          'returned. To page backward, set this to the oldest created_at you received on the ' +
          'previous call.'
      },
      cachedOnly: {
        type: 'boolean',
        description:
          'When true, skip the relay query and return only locally-cached notes (fast ' +
          'path). Default false (live-fetch then merge with cache).'
      }
    },
    additionalProperties: false
  },
  outputSchema: {
    type: 'object',
    required: ['notes'],
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'pubkey', 'kind', 'content', 'created_at', 'tags'],
          properties: {
            id: { type: 'string' },
            pubkey: { type: 'string' },
            kind: { type: 'number' },
            content: { type: 'string' },
            created_at: { type: 'number' },
            tags: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            author_name: {
              type: 'string',
              description: 'Best-effort display name for the author pubkey, if resolved.'
            },
            url: {
              type: 'string',
              description: 'Canonical njump.me link (https://njump.me/<nevent>) for this note.'
            }
          }
        }
      }
    }
  }
}

/**
 * Map a column to the Nostr `Filter` used to read/fetch its notes. Async because
 * the `home` filter is derived from the column's cached kind-3 contact list
 * (read from IndexedDB, never the network).
 *
 * Returns null for column types whose feed is NOT expressible as a simple
 * ids/authors/tag/kinds filter:
 *   - `search`: NIP-50 full-text search is relay-side. nostr-tools `matchFilter`
 *     (which getEvents applies) ignores the `search` field entirely, so a search
 *     filter would return EVERY cached kind-1 note regardless of the query —
 *     misleading. Gated out rather than returning wrong results.
 *   - `notifications`: a `#p` mention feed across many event kinds — not a
 *     content/author feed; out of scope for v1.
 *   - `bookmarks`: an `{ids}` feed resolved from the kind-10003 list (+ a-tag
 *     coordinate resolution). Resolvable in principle but needs the bookmark
 *     list event; out of scope for v1.
 *   - `dvm-feed` / `dvm-discover` / `relatr-discovery`: snapshot result sets, not
 *     filter-derived feeds.
 *   - `articles` / `favorites`: filterable (kind:30023 / author-bounded kind:1,6)
 *     but their feeds layer client-side WoT/list logic; deferred from v1.
 *   - `detail`: a transient single-target column, not a feed.
 */
async function columnToFilter(column: TColumn): Promise<Filter | null> {
  switch (column.type) {
    case 'hashtag': {
      const tags: string[] = []
      for (const raw of column.config?.hashtags ?? []) {
        const normalized = normalizeHashtag(raw)
        if (normalized && !tags.includes(normalized)) tags.push(normalized)
      }
      if (tags.length === 0) return null
      return { kinds: [1], '#t': tags }
    }
    case 'profile': {
      return { kinds: [1], authors: [column.viewContext] }
    }
    case 'relay': {
      // The relay-URL scoping is a subscription concern (handled in relay
      // resolution below). The filter itself is just the column's kind:1 slice.
      return { kinds: [1] }
    }
    case 'home': {
      // Derive the following-feed authors from the cached kind-3 contact list.
      // Cache-only: getReplaceableEvent reads IndexedDB and does not hit a relay.
      let contactEvent
      try {
        contactEvent = await indexedDb.getReplaceableEvent(column.viewContext, kinds.Contacts)
      } catch {
        contactEvent = null
      }
      const follows = contactEvent ? getPubkeysFromPTags(contactEvent.tags) : []
      const authors = Array.from(new Set([column.viewContext, ...follows]))
      return { kinds: [1, 6], authors }
    }
    default:
      return null
  }
}

/**
 * Resolve which relays to query live for a column, mirroring how the column's
 * own feed picks relays:
 *   - `relay`: the single configured relay URL (the column IS that relay).
 *   - home / hashtag / profile: the workspace owner's NIP-65 read relays, with
 *     the app's big-relay set appended as a fallback, deduped and capped. (The
 *     individual column feeds use slightly different per-type sets — e.g. home
 *     fans out over each follow's write relays — but the owner's read relays +
 *     big relays is a sound, predictable superset for a bounded one-shot.)
 */
async function resolveColumnRelays(column: TColumn, ownerPubkey: string): Promise<string[]> {
  if (column.type === 'relay') {
    const url = column.config?.relayUrl
    return url ? [url] : []
  }

  let read: string[] = []
  try {
    const relayList = await relayListService.fetchRelayList(ownerPubkey)
    read = relayList?.read ?? []
  } catch {
    read = []
  }

  const merged: string[] = []
  for (const url of [...read, ...BIG_RELAY_URLS]) {
    if (url && !merged.includes(url)) merged.push(url)
  }
  return merged.slice(0, MAX_LIVE_RELAYS)
}

/**
 * One-shot live relay query bounded by LIVE_FETCH_TIMEOUT_MS. Resolves with the
 * events seen before EOSE, or an empty array on timeout / error — it NEVER
 * rejects, so the caller can always fall back to cache without a try/catch.
 */
async function liveFetch(urls: string[], filter: Filter): Promise<NEvent[]> {
  if (urls.length === 0) return []

  return await new Promise<NEvent[]>((resolve) => {
    let settled = false
    const finish = (events: NEvent[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(events)
    }

    const timer = setTimeout(() => finish([]), LIVE_FETCH_TIMEOUT_MS)

    client
      .query(urls, { ...filter, limit: MAX_LIMIT })
      .then((events) => finish(events))
      .catch(() => finish([]))
  })
}

/**
 * Best-effort, cache-first author display-name resolution for the returned
 * notes. Bounded by PROFILE_ENRICH_TIMEOUT_MS so a slow profile lookup can't
 * blow the tool's latency budget; names that don't resolve in time are simply
 * omitted. Never throws.
 */
async function resolveAuthorNames(pubkeys: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (pubkeys.length === 0) return names

  const work = Promise.allSettled(
    pubkeys.map(async (pk) => {
      const profile = await profileFetcher.fetchProfile(pk)
      const name = profile?.username?.trim()
      if (name) names.set(pk, name)
    })
  )

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, PROFILE_ENRICH_TIMEOUT_MS))
  ])

  return names
}

/**
 * Read-only listing of recent notes for one deck column.
 *
 * Resolves the column in the workspace-owner's active deck (mirrors
 * list-columns.ts, including the sibling-account opsec boundary), derives a
 * Nostr filter from its type+config, reads matching events from the local
 * IndexedDB events store, and (unless cachedOnly) live-fetches fresh notes from
 * the column's relays, bounded by a timeout. Cache + live results are merged,
 * deduped by id, sorted newest-first, then the (since, until) window + `limit`
 * are applied. Author pubkeys are resolved to display names best-effort.
 */
export const listNotesInColumnHandler: ToolHandler = async (args, ctx) => {
  const columnId = typeof args.columnId === 'string' ? args.columnId : ''
  if (!columnId) {
    return { ok: false, error: { code: -32602, message: 'columnId is required' } }
  }

  const limit = clampLimit(args.limit)
  const since =
    typeof args.since === 'number' && Number.isFinite(args.since) ? args.since : undefined
  const until =
    typeof args.until === 'number' && Number.isFinite(args.until) ? args.until : undefined
  const cachedOnly = args.cachedOnly === true

  const workspacesByAccount = storage.getWorkspacesByAccount()
  const workspace = workspacesByAccount[ctx.workspaceOwner]
  if (!workspace) {
    return { ok: false, error: { code: -32603, message: 'Workspace not found' } }
  }
  const activeDeck = workspace.decks.find((d) => d.id === workspace.activeDeckId)
  if (!activeDeck) {
    return { ok: false, error: { code: -32603, message: 'Active deck not found' } }
  }

  // OPSEC FILTER (default ON): a column viewing a sibling paired account is not
  // visible to agents (mirrors list-columns.ts). Treat as if the column does
  // not exist so we don't leak its presence via a distinct error.
  const allowSiblings = workspace.allowSiblingExposure === true
  const siblingPubkeys = allowSiblings
    ? new Set<string>()
    : new Set(
        storage
          .getAccounts()
          .map((a: { pubkey: string }) => a.pubkey)
          .filter((pk: string) => pk !== ctx.workspaceOwner)
      )

  const column = activeDeck.columns.find(
    (c) => c.id === columnId && !siblingPubkeys.has(c.viewContext)
  )
  if (!column) {
    return { ok: false, error: { code: -32602, message: `unknown columnId: ${columnId}` } }
  }

  let filter: Filter | null
  try {
    filter = await columnToFilter(column)
  } catch (err) {
    return {
      ok: false,
      error: { code: -32603, message: 'failed to derive column filter', data: String(err) }
    }
  }

  if (filter === null) {
    return {
      ok: false,
      error: {
        code: -32602,
        message: `unsupported column type for note listing: ${column.type}`
      }
    }
  }

  // Push the time-window bounds INTO the query filter so the relay/cache return
  // the correct window rather than only the newest slice we then trim. `since`
  // and `until` are EXCLUSIVE in this tool; Nostr's relay `since`/`until` are
  // inclusive, so passing the raw values yields a (1-note) superset on each end
  // that the strict post-filter below trims. This is what lets the agent page
  // backward: re-call with `until` = the oldest created_at it just received.
  if (since !== undefined) {
    filter.since = since
  }
  if (until !== undefined) {
    filter.until = until
  }

  // Cache is the backbone / fallback. A genuine cache-read failure is a real
  // error (and stays one even when live-fetch is enabled).
  let cached: { event: NoteRecord }[]
  try {
    cached = (await indexedDb.getEvents({ ...filter, limit: CACHE_OVERFETCH })) as typeof cached
  } catch (err) {
    return {
      ok: false,
      error: { code: -32603, message: 'failed to read cached events', data: String(err) }
    }
  }

  const pool = new Map<string, NoteRecord>()
  for (const record of cached) {
    if (record?.event?.id) pool.set(record.event.id, record.event)
  }

  // Live-fetch (default). Bounded + safe: liveFetch never throws and returns []
  // on timeout/error, so we silently fall back to the cached pool.
  if (!cachedOnly) {
    let relays: string[] = []
    try {
      relays = await resolveColumnRelays(column, ctx.workspaceOwner)
    } catch {
      relays = []
    }
    const liveEvents = await liveFetch(relays, filter)
    for (const evt of liveEvents) {
      if (evt?.id && !pool.has(evt.id)) pool.set(evt.id, evt as NoteRecord)
    }
  }

  // Merge: dedupe-by-id is already done by the Map; sort newest-first, apply the
  // exclusive `since` floor + `until` ceiling, then cap at `limit`.
  const merged = Array.from(pool.values())
    .sort((a, b) => b.created_at - a.created_at)
    .filter(
      (e) =>
        (since === undefined || e.created_at > since) &&
        (until === undefined || e.created_at < until)
    )
    .slice(0, limit)

  const authorNames = await resolveAuthorNames(Array.from(new Set(merged.map((e) => e.pubkey))))

  const notes = merged.map((e) => {
    const note: NoteRecord & { author_name?: string; url?: string } = {
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      content: e.content,
      created_at: e.created_at,
      tags: e.tags
    }
    const url = buildNjumpUrl(e)
    if (url) note.url = url
    const name = authorNames.get(e.pubkey)
    if (name) note.author_name = name
    return note
  })

  // Return ONLY structuredContent, mirroring get_account / list_columns. MCP
  // clients (incl. OpenClaw) serialize structuredContent to the model when there
  // is no `content` block. Emitting a count-only `content` here SHADOWS the
  // notes: the client surfaces that summary text instead of the structured
  // notes, so the agent sees "N notes" but never their content. (Found live via
  // the dude trying to read a column's notes — see PR #123.)
  return {
    ok: true,
    structuredContent: { notes }
  }
}

// A canonical njump.me link for a note, so the agent never has to hand-encode
// one. nevent carries the author hint, which njump uses to resolve the event.
// Returns undefined if the id/pubkey can't be encoded (e.g. a malformed,
// non-hex id) so one bad event never aborts the whole listing.
function buildNjumpUrl(event: { id: string; pubkey: string }): string | undefined {
  try {
    return `https://njump.me/${nip19.neventEncode({ id: event.id, author: event.pubkey })}`
  } catch {
    return undefined
  }
}

function clampLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_LIMIT
  const n = Math.floor(raw)
  if (n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}
