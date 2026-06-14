// src/components/AddColumnModal/column-types.ts
import MessagesColumnBody from '@/components/Column/MessagesColumnBody'
import MuteListColumnBody from '@/components/Column/MuteListColumnBody'
import ArticlesColumnBody from '@/components/Column/ArticlesColumnBody'
import RelayColumnBody from '@/components/Column/RelayColumnBody'
import HomeColumnBody from '@/components/Column/HomeColumnBody'
import NotificationsColumnBody from '@/components/Column/NotificationsColumnBody'
import BookmarksColumnBody from '@/components/Column/BookmarksColumnBody'
import FavoritesColumnBody from '@/components/Column/FavoritesColumnBody'
import ProfileColumnBody from '@/components/Column/ProfileColumnBody'
import HashtagColumnBody from '@/components/Column/HashtagColumnBody'
import SearchColumnBody from '@/components/Column/SearchColumnBody'
import DvmFeedColumnBody from '@/components/Column/DvmFeedColumnBody'
import RelatrDiscoveryColumnBody from '@/components/Column/RelatrDiscoveryColumnBody'
import { TAccountPointer } from '@/types'
import { TColumn, TColumnType } from '@/types/column'
import {
  Bell,
  BellOff,
  Bookmark,
  BookOpen,
  Compass,
  Hash,
  Home,
  LucideIcon,
  MessageCircle,
  Radio,
  Search,
  Sparkles,
  Star,
  User
} from 'lucide-react'
import { ComponentType } from 'react'
import RelayUrlPicker from './configs/RelayUrlPicker'
import HashtagPicker from './configs/HashtagPicker'
import SearchPicker from './configs/SearchPicker'
import DvmPicker from './configs/DvmPicker'
import RelatrQueryPicker from './configs/RelatrQueryPicker'

export type ConfigFormProps = {
  draft: Partial<TColumn>
  onChange: (next: Partial<TColumn>) => void
  account: TAccountPointer | undefined
  isCustom: boolean
  setIsCustom: (custom: boolean) => void
  /** Dismiss the modal. Used by config forms that offer an alternate add path
   * (e.g. the DVM picker's "Browse all DVMs as a column" link, which commits a
   * dvm-discover column itself and then needs to close the modal). Optional —
   * existing pickers ignore it. */
  onClose?: () => void
}

export type ColumnTypeDescriptor = {
  type: TColumnType
  icon: LucideIcon
  /** i18n key for the tile label and "Add a __ column" header. */
  label: string
  /**
   * Optional override for the PickerGrid keyboard shortcut (the tile's letter).
   * Defaults to the first letter of `label`; set this when two labels collide
   * on their first letter (e.g. Hashtag vs Home).
   */
  shortcut?: string
  /** Returns the initial draft state when this tile is picked. */
  defaults: (account: TAccountPointer | undefined) => Partial<TColumn>
  /** Optional type-specific config form, rendered above LivePreview in PreviewScreen. */
  ConfigForm?: ComponentType<ConfigFormProps>
  /** Whether the draft has enough config to render the live preview. */
  isReadyToPreview: (draft: Partial<TColumn>) => boolean
  /**
   * Whether the AccountRail offers the "Other user…" row — i.e. the column can
   * be scoped to a foreign pubkey (`viewContext` ≠ a paired account). True for
   * pubkey-scoped types (Home, Notifications); false for Relay.
   */
  supportsViewAs?: boolean
  /** The component that renders the column body. Wrapped in <AccountScope> by LivePreview. */
  PreviewBody: ComponentType<{ column: TColumn }>
  /** i18n key for the preview placeholder shown when isReadyToPreview === false. */
  previewHint: string
  /** Optional hook fired when the account changes in the rail.
   *  Lets a descriptor recompute defaults (e.g. Relay's relayUrl) — UNLESS the
   *  user has manually edited it (custom flag). Only Relay uses this in Slice C. */
  onAccountChange?: (
    draft: Partial<TColumn>,
    newAccount: TAccountPointer,
    custom: boolean
  ) => Partial<TColumn>
}

const HOME_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'home',
  icon: Home,
  label: 'Home',
  // Picking a paired account in the rail sets viewContext === signingIdentity.
  // Phase 5's "Other user…" row lets viewContext be a foreign pubkey while
  // signingIdentity stays a paired account.
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'home'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  supportsViewAs: true,
  PreviewBody: ({ column }) => <HomeColumnBody column={column} />,
  previewHint: 'Pick an account to preview'
}

const NOTIFICATIONS_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'notifications',
  icon: Bell,
  label: 'Notifications',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'notifications'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  supportsViewAs: true,
  PreviewBody: ({ column }) => <NotificationsColumnBody column={column} />,
  previewHint: 'Pick an account to preview'
}

const BOOKMARKS_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'bookmarks',
  icon: Bookmark,
  label: 'Bookmarks',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'bookmarks'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  // Bookmark lists (kind 10003) are public — viewing any pubkey's bookmarks
  // works, so offer the "Other user…" row.
  supportsViewAs: true,
  PreviewBody: ({ column }) => <BookmarksColumnBody column={column} />,
  previewHint: 'Pick an account to preview'
}

const FAVORITES_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'favorites',
  icon: Star,
  label: 'Favorites',
  // First-letter default 'f' is unused by any other column type.
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'favorites'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  // viewContext-scoped: viewing as a different paired account shows that
  // account's Favorites list. Foreign pubkeys land on the empty state
  // (we don't have the signer to decrypt their kind 10010 list) —
  // mirrors the Bookmarks pattern.
  supportsViewAs: true,
  PreviewBody: ({ column }) => <FavoritesColumnBody column={column} />,
  previewHint: 'Pick an account to preview'
}

const PROFILE_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'profile',
  icon: User,
  label: 'Profile',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'profile'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  // The AccountRail's "Other user…" row is the primary path here — it sets
  // viewContext to the foreign pubkey whose profile to show, while
  // signingIdentity stays a paired account.
  supportsViewAs: true,
  PreviewBody: () => <ProfileColumnBody />,
  previewHint: 'Pick an account to preview'
}

const FALLBACK_RELAY_URL = 'wss://relay.damus.io'

/**
 * Synchronously returns a best-guess default relay URL for an account.
 * For Slice C this is the first entry from any cached state we can read
 * synchronously; the async case (RelayUrlPicker fetches the full list) is
 * handled by the picker re-emitting `onChange` once data arrives.
 *
 * If we can't resolve synchronously, fall back to wss://relay.damus.io.
 * The picker will replace this once its async fetch completes.
 */
function defaultRelayUrlFor(_account: TAccountPointer | undefined): string {
  return FALLBACK_RELAY_URL
}

const RELAY_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'relay',
  icon: Radio,
  label: 'Relay',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'relay',
    config: { relayUrl: defaultRelayUrlFor(account) }
  }),
  ConfigForm: RelayUrlPicker,
  isReadyToPreview: (draft) => !!draft.viewContext && !!draft.config?.relayUrl,
  PreviewBody: ({ column }) => <RelayColumnBody column={column} />,
  previewHint: 'Enter a relay URL to preview',
  onAccountChange: (draft, _newAccount, custom) => {
    // If the user has manually edited the URL, preserve it across account switches.
    if (custom) return draft
    // Otherwise, clear config.relayUrl so the picker recomputes from the new
    // account's read list (the picker observes account changes and refetches).
    return { ...draft, config: { ...draft.config, relayUrl: undefined } }
  }
}

const HASHTAG_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'hashtag',
  icon: Hash,
  label: 'Hashtag',
  // "Hashtag" and "Home" collide on their first letter; PickerGrid uses this
  // override so the tile shortcut is `t` ("tag") instead of a dead `h`.
  shortcut: 't',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'hashtag',
    config: { hashtags: [] }
  }),
  ConfigForm: HashtagPicker,
  isReadyToPreview: (draft) => !!draft.viewContext && (draft.config?.hashtags?.length ?? 0) > 0,
  // No supportsViewAs: a hashtag feed is global, so a foreign viewContext
  // wouldn't change it (Relay-style — the account is signing context only).
  PreviewBody: ({ column }) => <HashtagColumnBody column={column} />,
  previewHint: 'Enter a hashtag to preview'
}

const SEARCH_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'search',
  icon: Search,
  label: 'Search',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'search',
    config: { query: '' }
  }),
  // SearchPicker owns the query input and writes draft.config.query so the
  // typed query survives the "Add column" commit. SearchColumnBody hides its
  // own header input while in preview mode (viewOnly) so the two don't
  // double up.
  ConfigForm: SearchPicker,
  isReadyToPreview: (draft) => !!draft.viewContext,
  // No supportsViewAs: NIP-50 search is global (no authors/#p in filter),
  // matching Hashtag and Relay — the account is signing context only.
  PreviewBody: ({ column }) => <SearchColumnBody column={column} />,
  previewHint: 'Pick an account to preview'
}

const DVM_FEED_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'dvm-feed',
  icon: Sparkles,
  label: 'DVM Feed',
  // "DVM" doesn't fit naturally as a single-letter shortcut against the other
  // tile labels — opt for `v` (DV's silent letter) which doesn't collide.
  shortcut: 'v',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'dvm-feed'
  }),
  ConfigForm: DvmPicker,
  isReadyToPreview: (draft) =>
    !!draft.viewContext &&
    !!draft.config?.dvmPubkey &&
    !!draft.config?.dvmIdentifier,
  // No supportsViewAs: a DVM feed's personalization is keyed on the signer's
  // pubkey (the `["p", signer]` tag the kind-5300 carries), so a foreign
  // viewContext wouldn't change the feed — it would just confuse the chrome.
  PreviewBody: ({ column }) => <DvmFeedColumnBody column={column} />,
  previewHint: 'Pick a DVM to preview'
}

const RELATR_DISCOVERY_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'relatr-discovery',
  icon: Compass,
  // Internal type stays `'relatr-discovery'` for storage stability; user-facing
  // label is "Relatr Profile Search" (renamed 2026-05-28). Shortcut stays `e`
  // because Relay already owns `r`.
  label: 'Relatr Profile Search',
  // First-letter defaults: `r` (Relay) and `p` (Profile) were taken when this
  // shipped. `e` reads naturally as "pEople" / "profile sEarch".
  shortcut: 'e',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'relatr-discovery',
    config: { relatrQuery: '' }
  }),
  ConfigForm: RelatrQueryPicker,
  isReadyToPreview: (draft) =>
    !!draft.viewContext && !!draft.config?.relatrQuery?.trim(),
  // No supportsViewAs: Relatr's trust scores are global today (not per-caller-
  // perspective), so a foreign viewContext wouldn't change the column's results.
  PreviewBody: ({ column }) => <RelatrDiscoveryColumnBody column={column} />,
  previewHint: 'Enter a keyword to search profiles'
}

const ARTICLES_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'articles',
  icon: BookOpen,
  label: 'Articles',
  // First-letter default 'a' is unused by any other column type.
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'articles',
    config: { wotOnly: false }
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  // No supportsViewAs: an articles feed is global (no authors/#p in
  // filter), matching Hashtag / Search / Relay — the account is signing
  // context only.
  PreviewBody: ({ column }) => <ArticlesColumnBody column={column} />,
  previewHint:
    "Long-form posts from across Nostr. Toggle 'Show only WoT' in the column menu to narrow to your network."
}

const MESSAGES_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'messages',
  icon: MessageCircle,
  label: 'Messages',
  // First-letter default 'm' is unused by any other column type.
  shortcut: 'm',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'messages'
  }),
  isReadyToPreview: (draft) => !!draft.signingIdentity,
  // Messages are 1-on-1 and require a signing account; viewing a foreign
  // pubkey's inbox is not supported (you don't have their key).
  supportsViewAs: false,
  PreviewBody: () => <MessagesColumnBody />,
  previewHint: 'Pick a signing account to preview'
}

const MUTE_LIST_DESCRIPTOR: ColumnTypeDescriptor = {
  type: 'mute-list',
  icon: BellOff,
  label: 'Muted',
  // 'm' is taken by Messages; use 'u' (mUted) for the tile shortcut.
  shortcut: 'u',
  defaults: (account) => ({
    viewContext: account?.pubkey,
    signingIdentity: account?.pubkey ?? null,
    type: 'mute-list'
  }),
  isReadyToPreview: (draft) => !!draft.viewContext,
  // Mute management is for your own account: you can't read others' private
  // mutes, and viewing a foreign public mute list is out of scope.
  supportsViewAs: false,
  PreviewBody: () => <MuteListColumnBody />,
  previewHint: 'Pick an account to preview'
}

export const COLUMN_TYPES: ColumnTypeDescriptor[] = [
  HOME_DESCRIPTOR,
  NOTIFICATIONS_DESCRIPTOR,
  BOOKMARKS_DESCRIPTOR,
  FAVORITES_DESCRIPTOR,
  PROFILE_DESCRIPTOR,
  RELAY_DESCRIPTOR,
  HASHTAG_DESCRIPTOR,
  SEARCH_DESCRIPTOR,
  ARTICLES_DESCRIPTOR,
  DVM_FEED_DESCRIPTOR,
  RELATR_DISCOVERY_DESCRIPTOR,
  MESSAGES_DESCRIPTOR,
  MUTE_LIST_DESCRIPTOR
]
