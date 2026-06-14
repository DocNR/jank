import { BRAND } from '@/branding'
import { TSearchParams } from '@/types'
import { Event, nip19 } from 'nostr-tools'
import { getNoteBech32Id } from './event'
import { normalizeHashtag } from './hashtag'

export const toHome = () => '/'
export const toNote = (eventOrId: Event | string) => {
  if (typeof eventOrId === 'string') return `/notes/${eventOrId}`
  const nevent = getNoteBech32Id(eventOrId)
  return `/notes/${nevent}`
}
export const toShareNoteUrl = (eventOrId: Event | string) => {
  return `${BRAND.shareUrlBase}${toNote(eventOrId)}`
}
export const toNoteList = ({
  hashtag,
  search,
  domain,
  kinds
}: {
  hashtag?: string
  search?: string
  domain?: string
  kinds?: number[]
}) => {
  const path = '/notes'
  const query = new URLSearchParams()
  if (hashtag) query.set('t', hashtag.toLowerCase())
  if (kinds?.length) {
    kinds.forEach((k) => query.append('k', k.toString()))
  }
  if (search) query.set('s', search)
  if (domain) query.set('d', domain)
  return `${path}?${query.toString()}`
}
export const toProfile = (userId: string) => {
  if (userId.startsWith('npub') || userId.startsWith('nprofile')) return `/p/${userId}`
  const npub = nip19.npubEncode(userId)
  return `/p/${npub}`
}
/**
 * Inverse of `toProfile` for the deck's transient-column routing: returns the
 * hex pubkey for a BARE Profile route, or `null` for anything else —
 * including `/p/:id/following` and `/users/:id/relays`, which stay generic
 * detail routes. `null` on an undecodable id.
 *
 * Matches both shapes:
 * - Canonical: `/p/<npub|nprofile>` (Phase 2 onward)
 * - Legacy:    `/users/<npub|nprofile>` (pre-Phase 2; preserved for existing
 *              bookmarks / shared links; ColumnsProvider rewrites the bar to
 *              the canonical via `history.replaceState`)
 */
export function parseProfileRoute(route: string): string | null {
  const match = route.match(/^\/(?:p|users)\/([^/]+)$/)
  if (!match) return null
  try {
    const decoded = nip19.decode(match[1])
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
    return null
  } catch {
    return null
  }
}
/**
 * Canonical hashtag-column URL emitter. Use this for "spawn a hashtag column"
 * links (e.g., from clickable hashtags in note content). For compound hashtag
 * routes (kind-filtered, search-scoped, etc.) keep using `toNoteList`.
 */
export const toHashtag = (tag: string) => `/t/${encodeURIComponent(tag)}`
/**
 * Inverse of `toHashtag` / `toNoteList({ hashtag })` for the deck's
 * transient-column routing. Returns the normalized tag, or `null` for
 * anything that can't be represented as a plain kind-1 Hashtag column —
 * including:
 *   - kind-filtered hashtag feeds (`/notes?t=tag&k=30023`, used by long-form
 *     article tag chips — those stay as generic detail columns because the
 *     Hashtag column body hardcodes kind 1).
 *   - search-scoped (`?s=...`) or domain-scoped (`?d=...`) note lists.
 *   - hashtags that fail the Unicode-letter grammar enforced by
 *     `normalizeHashtag`.
 *
 * Matches both shapes:
 * - Canonical: `/t/<tag>` (Phase 2 onward)
 * - Legacy:    `/notes?t=<tag>` (pre-Phase 2; preserved for back-compat;
 *              ColumnsProvider rewrites the bar to canonical via
 *              `history.replaceState`)
 */
export function parseHashtagRoute(route: string): string | null {
  // Canonical /t/<tag>
  const canonical = route.match(/^\/t\/([^/?]+)$/)
  if (canonical) {
    try {
      return normalizeHashtag(decodeURIComponent(canonical[1]))
    } catch {
      return null
    }
  }
  // Legacy /notes?t=<tag>
  const [path, query] = route.split('?', 2)
  if (path !== '/notes') return null
  const params = new URLSearchParams(query ?? '')
  const t = params.get('t')
  if (!t) return null
  // Any additional filter param means this is NOT a plain hashtag feed.
  if (params.has('k') || params.has('s') || params.has('d')) return null
  return normalizeHashtag(t)
}
export const toProfileList = ({ search, domain }: { search?: string; domain?: string }) => {
  const path = '/users'
  const query = new URLSearchParams()
  if (search) query.set('s', search)
  if (domain) query.set('d', domain)
  return `${path}?${query.toString()}`
}
export const toFollowingList = (pubkey: string) => {
  const npub = nip19.npubEncode(pubkey)
  return `/users/${npub}/following`
}
export const toOthersRelaySettings = (pubkey: string) => {
  const npub = nip19.npubEncode(pubkey)
  return `/users/${npub}/relays`
}
export const toSearch = (params?: TSearchParams) => {
  if (!params) return '/search'
  const query = new URLSearchParams()
  query.set('t', params.type)
  query.set('q', params.search)
  if (params.input) {
    query.set('i', params.input)
  }
  return `/search?${query.toString()}`
}
export const toExternalContent = (id: string) => `/external-content?id=${encodeURIComponent(id)}`
export const toSettings = () => '/settings'
export const toRelaySettings = (tag?: 'mailbox' | 'favorite-relays') => {
  return '/settings/relays' + (tag ? '#' + tag : '')
}
export const toWallet = () => '/settings/wallet'
export const toPostSettings = () => '/settings/posts'
export const toGeneralSettings = () => '/settings/general'
export const toAppearanceSettings = () => '/settings/appearance'
export const toTranslation = () => '/settings/translation'
export const toEmojiPackSettings = () => '/settings/emoji-packs'
export const toSystemSettings = () => '/settings/system'
export const toAgentsSettings = () => '/settings/agents'
export const toProfileEditor = () => '/profile-editor'
export const toRelay = (url: string) => `/r/${encodeURIComponent(url)}`
export const toRelayReviews = (url: string) => `/relays/${encodeURIComponent(url)}/reviews`
/**
 * Inverse of `toRelay` for the deck's transient-column routing. Returns the
 * decoded relay URL for a BARE Relay route, or `null` for anything else —
 * including `/relays/:url/reviews`, which stays a generic detail route.
 *
 * Matches both shapes:
 * - Canonical: `/r/<encoded-url>` (Phase 2 onward)
 * - Legacy:    `/relays/<encoded-url>` (pre-Phase 2; bare-only, never the
 *              `/reviews` suffix — those land on the relay-reviews secondary
 *              page)
 */
export function parseRelayRoute(route: string): string | null {
  // Canonical /r/<encoded>
  const canonical = route.match(/^\/r\/([^/]+)$/)
  if (canonical) {
    try {
      return decodeURIComponent(canonical[1])
    } catch {
      return null
    }
  }
  // Legacy /relays/<encoded> — bare, NOT /reviews
  const legacy = route.match(/^\/relays\/([^/]+)$/)
  if (legacy) {
    try {
      return decodeURIComponent(legacy[1])
    } catch {
      return null
    }
  }
  return null
}
/**
 * Inverse of `toSearch` for the deck's transient-column routing. Returns the
 * initial query (possibly empty) for a Search route, or `null` for anything
 * else. The Search column owns its NIP-50 input internally — `?q=` is read
 * once at column creation; subsequent edits live in column config only.
 */
export function parseSearchRoute(route: string): string | null {
  const [path, query] = route.split('?', 2)
  if (path !== '/search') return null
  const params = new URLSearchParams(query ?? '')
  return params.get('q') ?? ''
}
/**
 * Routing policy for a Detail column's replace-mode stack: returns `true` when
 * a pushed URL should spawn (or focus) its own deck column rather than drill
 * inline within the Detail column's stack.
 *
 * This MIRRORS `addTransientColumn`'s route → column-type dispatch: any URL the
 * deck would turn into a standing / content column (Profile, Hashtag, Relay,
 * Search, Notifications, Bookmarks, self-Profile) is column-shaped, not
 * detail-page-shaped, and must therefore be handed to the deck-level push.
 *
 * Two reasons it matters:
 *   1. Conceptually these are parallel surfaces — a Profile/Hashtag/Relay
 *      belongs in its own column with standing-type dedup, not buried in one
 *      thread's drill stack.
 *   2. Mechanically, the inline stack matches URLs against `SECONDARY_ROUTES`,
 *      which only knows the LEGACY url forms (`/users/:id`, `/relays/:url`).
 *      The CANONICAL forms the app emits today (`/p/<npub>`, `/t/<tag>`,
 *      `/r/<encoded>`) match nothing there, so drilling them inline silently
 *      no-ops — the click does nothing. Delegating routes through
 *      `addTransientColumn`, whose parsers accept both canonical and legacy.
 *
 * Everything else (note threads `/notes/:id`, following lists, others' relay
 * settings, relay reviews, settings pages, external content, ...) returns
 * `false` and drills inline — which is what replace-mode is for.
 */
export function routeOpensOwnColumn(route: string): boolean {
  return (
    parseProfileRoute(route) !== null ||
    parseHashtagRoute(route) !== null ||
    parseRelayRoute(route) !== null ||
    parseSearchRoute(route) !== null ||
    route === '/notifications' ||
    route === '/bookmarks' ||
    route === '/mutes' ||
    route === '/me' ||
    route === '/profile'
  )
}
export const toMuteList = () => '/mutes'
export const toRizful = () => '/rizful'
export const toBookmarks = () => '/bookmarks'
export const toFollowPack = (eventOrId: Event | string) => {
  if (typeof eventOrId === 'string') return `/follow-packs/${eventOrId}`
  const naddr = getNoteBech32Id(eventOrId)
  return `/follow-packs/${naddr}`
}

export const toChachiChat = (relay: string, d: string) => {
  return `https://chachi.chat/${relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')}/${d}`
}
