// App-level mount for the five per-account user lists (follow, mute, bookmarks,
// pin, pinned-users). This file owns the five Contexts + their hooks (imported
// by ~31 consumers across the app, and by ScopedUserListsProvider). The actual
// read/mutate logic lives in ScopedUserListsProvider — UserListsProvider just
// mounts it scoped to the active account, so unscoped surfaces (sidebar,
// settings) and per-column <AccountScope> mounts share one implementation.

import { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'
import { useNostr } from './NostrProvider'
import { ScopedUserListsProvider } from './ScopedUserListsProvider'

// ─── FollowList ────────────────────────────────────────────────────────────

type TFollowListContext = {
  followingSet: Set<string>
  follow: (pubkey: string) => Promise<void>
  unfollow: (pubkey: string) => Promise<void>
}

export const FollowListContext = createContext<TFollowListContext | undefined>(undefined)

export const useFollowList = () => {
  const context = useContext(FollowListContext)
  if (!context) {
    throw new Error('useFollowList must be used within a UserListsProvider')
  }
  return context
}

// ─── MuteList ──────────────────────────────────────────────────────────────

type TMuteListContext = {
  mutePubkeySet: Set<string>
  muteEventIdSet: Set<string>
  changing: boolean
  getMutePubkeys: () => string[]
  getMuteType: (pubkey: string) => 'public' | 'private' | null
  mutePubkeyPublicly: (pubkey: string) => Promise<void>
  mutePubkeyPrivately: (pubkey: string) => Promise<void>
  unmutePubkey: (pubkey: string) => Promise<void>
  switchToPublicMute: (pubkey: string) => Promise<void>
  switchToPrivateMute: (pubkey: string) => Promise<void>
  muteThread: (rootId: string) => Promise<void>
  unmuteThread: (rootId: string) => Promise<void>
  isThreadMuted: (rootId: string) => boolean
}

export const MuteListContext = createContext<TMuteListContext | undefined>(undefined)

export const useMuteList = () => {
  const context = useContext(MuteListContext)
  if (!context) {
    throw new Error('useMuteList must be used within a UserListsProvider')
  }
  return context
}

// ─── BookmarkList (reads) + Bookmarks (mutations) ──────────────────────────

type TBookmarkListContext = {
  bookmarkListEvent: Event | null
  /**
   * Set of keys for currently-bookmarked events. For replaceable events the
   * key is the NIP-33 `a` coordinate (`kind:pubkey:d-tag`); for non-replaceable
   * events the key is the event id. Use this to check membership inline rather
   * than walking the tag list per render.
   */
  bookmarkedEventKeySet: Set<string>
}

export const BookmarkListContext = createContext<TBookmarkListContext | undefined>(undefined)

export const useBookmarkList = () => {
  const context = useContext(BookmarkListContext)
  if (!context) {
    throw new Error('useBookmarkList must be used within a UserListsProvider')
  }
  return context
}

type TBookmarksContext = {
  addBookmark: (event: Event) => Promise<void>
  removeBookmark: (event: Event) => Promise<void>
}

export const BookmarksContext = createContext<TBookmarksContext | undefined>(undefined)

export const useBookmarks = () => {
  const context = useContext(BookmarksContext)
  if (!context) {
    throw new Error('useBookmarks must be used within a UserListsProvider')
  }
  return context
}

// ─── PinList (pinned notes) ────────────────────────────────────────────────

type TPinListContext = {
  pinnedEventHexIdSet: Set<string>
  pin: (event: Event) => Promise<void>
  unpin: (event: Event) => Promise<void>
}

export const PinListContext = createContext<TPinListContext | undefined>(undefined)

export const usePinList = () => {
  const context = useContext(PinListContext)
  if (!context) {
    throw new Error('usePinList must be used within a UserListsProvider')
  }
  return context
}

// ─── Favorites (pinned users, kind 10010) ─────────────────────────────────
// User-facing label is "Favorites". The wire/storage identifier stays
// ExtendedKind.PINNED_USERS = 10010 for Nostr protocol compatibility.

type TFavoritesContext = {
  favoritePubkeySet: Set<string>
  isFavorited: (pubkey: string) => boolean
  addFavorite: (pubkey: string) => Promise<void>
  removeFavorite: (pubkey: string) => Promise<void>
  toggleFavorite: (pubkey: string) => Promise<void>
}

export const FavoritesContext = createContext<TFavoritesContext | undefined>(undefined)

export const useFavorites = () => {
  const context = useContext(FavoritesContext)
  if (!context) {
    throw new Error('useFavorites must be used within a UserListsProvider')
  }
  return context
}

// ─── App-level mount ───────────────────────────────────────────────────────

export function UserListsProvider({ children }: { children: React.ReactNode }) {
  const { pubkey } = useNostr()
  // Outside any column, "the user" is the active account: view === sign === active.
  // Logged out → signingIdentity null = view-only (no mutations), matching prior behavior.
  return (
    <ScopedUserListsProvider viewContext={pubkey ?? ''} signingIdentity={pubkey ?? null}>
      {children}
    </ScopedUserListsProvider>
  )
}
