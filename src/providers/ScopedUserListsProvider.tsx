// src/providers/ScopedUserListsProvider.tsx
//
// Per-column override of the five viewer-state contexts from UserListsProvider.
// Mounted by <AccountScope>; re-provides FollowList, MuteList, BookmarkList +
// Bookmarks, PinList, and Favorites contexts.
//
// The column splits two pubkeys:
//   - viewContext: whose perspective the column shows. The DISPLAYED lists
//     (following set, mute set, bookmark set, pin set) are read from the
//     reactive replaceable-event store for this pubkey — you see the world as
//     viewContext sees it, and any mutation that updates the store (here or
//     elsewhere) re-renders every consumer.
//   - signingIdentity: which paired account's key signs mutations. follow /
//     mute / bookmark / pin actions fetch-modify-publish against THIS pubkey's
//     own lists (you can only write your own), and are disabled entirely when
//     signingIdentity is null (view-only column).
//
// Reads go through the reactive store (useUserListEvent / usePrivateTags).
// Mutations keep their per-list draft-building + NIP-44 encryption logic, but
// wrap publish in an optimistic overlay (listOverlay / privateTagsCache) that
// flips the UI instantly and ROLLS BACK on failure.
//
// Outside any <AccountScope>, the app-level <UserListsProvider> at App.tsx
// continues to provide active-account data — sidebar / settings UX unchanged.

import {
  BookmarkListContext,
  BookmarksContext,
  FavoritesContext,
  FollowListContext,
  MuteListContext,
  PinListContext
} from '@/providers/UserListsProvider'
import { createFollowListDraftEvent } from '@/lib/draft-event'
import { createMuteListDraftEvent } from '@/lib/draft-event'
import { createBookmarkDraftEvent, buildATag, buildETag } from '@/lib/draft-event'
import { createPinListDraftEvent } from '@/lib/draft-event'
import { formatError } from '@/lib/error'
import {
  getReplaceableCoordinate,
  getReplaceableCoordinateFromEvent,
  isReplaceableEvent
} from '@/lib/event'
import { getPinnedEventHexIdSetFromPinListEvent } from '@/lib/event-metadata'
import { getPubkeysFromPTags } from '@/lib/tag'
import { ExtendedKind, MAX_PINNED_NOTES } from '@/constants'
import { usePrivateTags, useUserListEvent } from '@/hooks/useReplaceableEvent'
import followListService from '@/services/fetchers/follow-list.service'
import muteListService from '@/services/fetchers/mute-list.service'
import bookmarkListService from '@/services/fetchers/bookmark-list.service'
import pinListService from '@/services/fetchers/pin-list.service'
import listOverlay from '@/services/caches/list-overlay.service'
import privateTagsCache from '@/services/caches/private-tags-cache.service'
import replaceableEventCache from '@/services/caches/replaceable-event-cache.service'
import client from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { publishAsAccount } from './user-lists/publish-helpers'

// Ensure a list mutation is strictly newer than its base, so updateCache's
// newer-wins gate (and IndexedDB's created_at>= guard) always installs it —
// otherwise two mutations in the same wall-clock second collide and the second
// silently drops from the canonical store + UI.
function nextCreatedAt(base: Event | null | undefined): number {
  return Math.max(Math.floor(Date.now() / 1000), (base?.created_at ?? 0) + 1)
}

type Props = {
  /** Pubkey whose lists are displayed (any pubkey, paired or foreign). */
  viewContext: string
  /** Paired-account pubkey that signs mutations, or null = view-only. */
  signingIdentity: string | null
  children: ReactNode
}

export function ScopedUserListsProvider({ viewContext, signingIdentity, children }: Props) {
  return (
    <ScopedFollowListInner viewContext={viewContext} signingIdentity={signingIdentity}>
      <ScopedMuteListInner viewContext={viewContext} signingIdentity={signingIdentity}>
        <ScopedBookmarkInner viewContext={viewContext} signingIdentity={signingIdentity}>
          <ScopedPinListInner viewContext={viewContext} signingIdentity={signingIdentity}>
            <ScopedPinnedUsersInner viewContext={viewContext} signingIdentity={signingIdentity}>
              {children}
            </ScopedPinnedUsersInner>
          </ScopedPinListInner>
        </ScopedBookmarkInner>
      </ScopedMuteListInner>
    </ScopedFollowListInner>
  )
}

type InnerProps = {
  viewContext: string
  signingIdentity: string | null
  children: ReactNode
}

// ─── Inner providers (one per overridden context) ─────────────────────────

function ScopedFollowListInner({ viewContext, signingIdentity, children }: InnerProps) {
  const { t } = useTranslation()

  // Display: the shown following set is viewContext's follow list, read
  // reactively (overlay-over-canonical). A mutation's optimistic overlay or a
  // background refetch both re-render here automatically.
  const event = useUserListEvent(viewContext, kinds.Contacts)

  // Warm-up: populate a cold store for viewContext. The fetch flows into the
  // canonical store + notifies; we do NOT keep its result in component state.
  useEffect(() => {
    followListService.fetchFollowListEvent(viewContext)
  }, [viewContext])

  const followingSet = useMemo(
    () => new Set(event ? getPubkeysFromPTags(event.tags) : []),
    [event]
  )

  const follow = useCallback(
    async (pubkey: string) => {
      if (!signingIdentity) return
      const coordinate = getReplaceableCoordinate(kinds.Contacts, signingIdentity)
      // Base the new draft on the in-flight overlay (so rapid sequential
      // mutations stack) else the SIGNER's own freshly-fetched list — never the
      // viewContext's (publishing as the signer with someone else's list would
      // clobber it).
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await followListService.fetchFollowListEvent(signingIdentity))
      if (base && getPubkeysFromPTags(base.tags).includes(pubkey)) return // dedup guard
      if (!base) {
        const result = confirm(t('FollowListNotFoundConfirmation'))
        if (!result) return
      }
      try {
        const created_at = nextCreatedAt(base)
        const draft = createFollowListDraftEvent(
          (base?.tags ?? []).concat([['p', pubkey]]),
          base?.content
        )
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...(base ?? { kind: kinds.Contacts, pubkey: signingIdentity }),
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        if (real.pubkey !== signingIdentity) {
          listOverlay.clear(coordinate)
          return
        }
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to follow: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity, t]
  )

  const unfollow = useCallback(
    async (pubkey: string) => {
      if (!signingIdentity) return
      const coordinate = getReplaceableCoordinate(kinds.Contacts, signingIdentity)
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await followListService.fetchFollowListEvent(signingIdentity))
      if (!base) return
      try {
        const created_at = nextCreatedAt(base)
        const draft = createFollowListDraftEvent(
          base.tags.filter(([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey),
          base.content
        )
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...base,
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        if (real.pubkey !== signingIdentity) {
          listOverlay.clear(coordinate)
          return
        }
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to unfollow: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity]
  )

  const value = useMemo(
    () => ({ followingSet, follow, unfollow }),
    [followingSet, follow, unfollow]
  )

  return <FollowListContext.Provider value={value}>{children}</FollowListContext.Provider>
}

function ScopedMuteListInner({ viewContext, signingIdentity, children }: InnerProps) {
  const { t } = useTranslation()
  const [changing, setChanging] = useState(false)

  // Display: viewContext's mute list, read reactively. Private tags come from
  // the decrypted-private-tags store (empty for a foreign viewContext we can't
  // decrypt).
  const muteListEvent = useUserListEvent(viewContext, kinds.Mutelist)
  const privateTags = usePrivateTags(viewContext, kinds.Mutelist)

  const publicMutePubkeySet = useMemo(
    () => new Set(muteListEvent ? getPubkeysFromPTags(muteListEvent.tags) : []),
    [muteListEvent]
  )
  const privateMutePubkeySet = useMemo(
    () => new Set(getPubkeysFromPTags(privateTags)),
    [privateTags]
  )
  const mutePubkeySet = useMemo(
    () => new Set([...Array.from(privateMutePubkeySet), ...Array.from(publicMutePubkeySet)]),
    [publicMutePubkeySet, privateMutePubkeySet]
  )

  // The signer for the SIGNER's own list — used for nip44 encrypt/decrypt. Read
  // from the registry (not the AccountScope) so this same provider works at the
  // app-level mount, which is not inside an <AccountScope>.
  const migrateToNip44 = useCallback(
    async (event: Event, tags: string[][]) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (!signer || !signingIdentity) return
      try {
        const cipherText = await signer.nip44Encrypt(signingIdentity, JSON.stringify(tags))
        const draft = createMuteListDraftEvent(event.tags, cipherText)
        const newEvent = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(newEvent)
        privateTagsCache.setOptimistic(
          getReplaceableCoordinate(kinds.Mutelist, signingIdentity),
          tags
        )
      } catch (error) {
        console.error('[ScopedMuteList] migrate-to-nip44 failed', error)
      }
    },
    [signingIdentity]
  )

  // Warm-up: populate the cold store for viewContext, decrypt private tags, and
  // trigger the NIP-04 → NIP-44 migration on legacy events.
  useEffect(() => {
    let cancelled = false
    muteListService.fetchMuteListEvent(viewContext).then(async (event) => {
      if (cancelled || !event) return
      const { wasNip04 } = await privateTagsCache.loadFor(event)
      if (cancelled) return
      const tags = privateTagsCache.getSnapshot(
        getReplaceableCoordinateFromEvent(event)
      )
      if (wasNip04 && tags && tags.length > 0) {
        migrateToNip44(event, tags)
      }
    })
    return () => {
      cancelled = true
    }
  }, [viewContext, migrateToNip44])

  const getMutePubkeys = useCallback(() => Array.from(mutePubkeySet), [mutePubkeySet])

  const getMuteType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      if (publicMutePubkeySet.has(pubkey)) return 'public'
      if (privateMutePubkeySet.has(pubkey)) return 'private'
      return null
    },
    [publicMutePubkeySet, privateMutePubkeySet]
  )

  // Decrypt the SIGNER's own current private tags for a mutation. Falls back to
  // an empty list if there's no signer / no content / decrypt fails.
  const decryptSignerPrivateTags = useCallback(
    async (event: Event): Promise<string[][]> => {
      if (!signingIdentity) return []
      await privateTagsCache.loadFor(event)
      return privateTagsCache.getSnapshot(getReplaceableCoordinateFromEvent(event)) ?? []
    },
    [signingIdentity]
  )

  // Stamp the optimistic public + private overlays for a mutation, then publish.
  // On success, refresh the canonical store and reload the private slice from
  // the real event. On failure, roll BOTH overlays back.
  const applyMutation = useCallback(
    async (
      newPublicTags: string[][],
      content: string,
      newPrivate: string[][],
      base: Event | undefined
    ) => {
      if (!signingIdentity) return
      const coordinate = getReplaceableCoordinate(kinds.Mutelist, signingIdentity)
      // Newer-wins gate needs a strictly-greater created_at than a same-second
      // base; nextCreatedAt guarantees it (supersedes the old same-second sleep).
      const created_at = nextCreatedAt(base)
      const draft = createMuteListDraftEvent(newPublicTags, content)
      draft.created_at = created_at
      // Snapshot the prior decrypted private slice so a publish failure restores
      // exactly what was shown — never re-decrypt via loadFor, which empties the
      // set if the signer is gone (a likely CAUSE of the failure) or decrypt throws.
      const priorPrivate = privateTagsCache.getSnapshot(coordinate)
      listOverlay.setOptimistic(coordinate, {
        ...(base ?? { kind: kinds.Mutelist, pubkey: signingIdentity }),
        ...draft,
        id: 'optimistic',
        sig: '',
        created_at
      } as Event)
      privateTagsCache.setOptimistic(coordinate, newPrivate)
      try {
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
        // Reload the private slice off the real event (clears the overlay slot).
        await privateTagsCache.loadFor(real)
      } catch (error) {
        listOverlay.clear(coordinate)
        // Roll the private overlay back to the snapshotted prior value.
        privateTagsCache.setOptimistic(coordinate, priorPrivate ?? [])
        throw error
      }
    },
    [signingIdentity]
  )

  const mutePubkeyPublicly = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (changing || !signer || !signingIdentity) return
      setChanging(true)
      try {
        // Mutations operate on the SIGNER's own mute list. Unlike the other four
        // lists, Mute bases on a fresh fetch rather than listOverlay.getSnapshot:
        // the `changing` lock serializes Mute mutations, so there's no in-flight
        // overlay to stack on. Do NOT switch to overlay-basing here — combined
        // with the lock it would double-apply.
        const current = await muteListService.fetchMuteListEvent(signingIdentity)
        if (!current) {
          const result = confirm(t('MuteListNotFoundConfirmation'))
          if (!result) return
        }
        if (current?.tags.some(([k, v]) => k === 'p' && v === pubkey)) return

        const newTags = (current?.tags ?? []).concat([['p', pubkey]])
        const currentPrivate = current ? await decryptSignerPrivateTags(current) : []
        const content =
          currentPrivate.length > 0
            ? await signer.nip44Encrypt(signingIdentity, JSON.stringify(currentPrivate))
            : ''
        await applyMutation(newTags, content, currentPrivate, current ?? undefined)
      } catch (error) {
        formatError(error).forEach((err) => {
          toast.error('Failed to mute user publicly: ' + err, { duration: 10_000 })
        })
      } finally {
        setChanging(false)
      }
    },
    [signingIdentity, changing, decryptSignerPrivateTags, applyMutation, t]
  )

  const mutePubkeyPrivately = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (changing || !signer || !signingIdentity) return
      setChanging(true)
      try {
        const current = await muteListService.fetchMuteListEvent(signingIdentity)
        if (!current) {
          const result = confirm(t('MuteListNotFoundConfirmation'))
          if (!result) return
        }
        const currentPrivate = current ? await decryptSignerPrivateTags(current) : []
        if (currentPrivate.some(([k, v]) => k === 'p' && v === pubkey)) return

        const newPrivate = currentPrivate.concat([['p', pubkey]])
        const content = await signer.nip44Encrypt(signingIdentity, JSON.stringify(newPrivate))
        await applyMutation(current?.tags ?? [], content, newPrivate, current ?? undefined)
      } catch (error) {
        formatError(error).forEach((err) => {
          toast.error('Failed to mute user privately: ' + err, { duration: 10_000 })
        })
      } finally {
        setChanging(false)
      }
    },
    [signingIdentity, changing, decryptSignerPrivateTags, applyMutation, t]
  )

  const unmutePubkey = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (changing || !signer || !signingIdentity) return
      setChanging(true)
      try {
        const current = await muteListService.fetchMuteListEvent(signingIdentity)
        if (!current) return
        const currentPrivate = await decryptSignerPrivateTags(current)
        const newPrivate = currentPrivate.filter((t) => t[0] !== 'p' || t[1] !== pubkey)
        let content = current.content
        if (newPrivate.length !== currentPrivate.length) {
          content = await signer.nip44Encrypt(signingIdentity, JSON.stringify(newPrivate))
        }
        const newTags = current.tags.filter((t) => t[0] !== 'p' || t[1] !== pubkey)
        await applyMutation(newTags, content, newPrivate, current)
      } catch (error) {
        formatError(error).forEach((err) => {
          toast.error('Failed to unmute user: ' + err, { duration: 10_000 })
        })
      } finally {
        setChanging(false)
      }
    },
    [signingIdentity, changing, decryptSignerPrivateTags, applyMutation]
  )

  const switchToPublicMute = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (changing || !signer || !signingIdentity) return
      setChanging(true)
      try {
        const current = await muteListService.fetchMuteListEvent(signingIdentity)
        if (!current) return
        const currentPrivate = await decryptSignerPrivateTags(current)
        const newPrivate = currentPrivate.filter((t) => t[0] !== 'p' || t[1] !== pubkey)
        if (newPrivate.length === currentPrivate.length) return
        const content = await signer.nip44Encrypt(signingIdentity, JSON.stringify(newPrivate))
        const newTags = current.tags
          .filter((t) => t[0] !== 'p' || t[1] !== pubkey)
          .concat([['p', pubkey]])
        await applyMutation(newTags, content, newPrivate, current)
      } catch (error) {
        formatError(error).forEach((err) => {
          toast.error('Failed to switch to public mute: ' + err, { duration: 10_000 })
        })
      } finally {
        setChanging(false)
      }
    },
    [signingIdentity, changing, decryptSignerPrivateTags, applyMutation]
  )

  const switchToPrivateMute = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (changing || !signer || !signingIdentity) return
      setChanging(true)
      try {
        const current = await muteListService.fetchMuteListEvent(signingIdentity)
        if (!current) return
        const newTags = current.tags.filter((t) => t[0] !== 'p' || t[1] !== pubkey)
        if (newTags.length === current.tags.length) return
        const currentPrivate = await decryptSignerPrivateTags(current)
        const newPrivate = currentPrivate
          .filter((t) => t[0] !== 'p' || t[1] !== pubkey)
          .concat([['p', pubkey]])
        const content = await signer.nip44Encrypt(signingIdentity, JSON.stringify(newPrivate))
        await applyMutation(newTags, content, newPrivate, current)
      } catch (error) {
        formatError(error).forEach((err) => {
          toast.error('Failed to switch to private mute: ' + err, { duration: 10_000 })
        })
      } finally {
        setChanging(false)
      }
    },
    [signingIdentity, changing, decryptSignerPrivateTags, applyMutation]
  )

  const value = useMemo(
    () => ({
      mutePubkeySet,
      changing,
      getMutePubkeys,
      getMuteType,
      mutePubkeyPublicly,
      mutePubkeyPrivately,
      unmutePubkey,
      switchToPublicMute,
      switchToPrivateMute
    }),
    [
      mutePubkeySet,
      changing,
      getMutePubkeys,
      getMuteType,
      mutePubkeyPublicly,
      mutePubkeyPrivately,
      unmutePubkey,
      switchToPublicMute,
      switchToPrivateMute
    ]
  )

  return <MuteListContext.Provider value={value}>{children}</MuteListContext.Provider>
}

function ScopedBookmarkInner({ viewContext, signingIdentity, children }: InnerProps) {
  // Display: viewContext's bookmark list, read reactively.
  const bookmarkListEvent = useUserListEvent(viewContext, kinds.BookmarkList) ?? null

  // Warm-up: populate the cold store for viewContext.
  useEffect(() => {
    bookmarkListService.fetchBookmarkListEvent(viewContext)
  }, [viewContext])

  const bookmarkedEventKeySet = useMemo(() => {
    if (!bookmarkListEvent) return new Set<string>()
    const out = new Set<string>()
    for (const tag of bookmarkListEvent.tags) {
      if (tag[0] === 'a' && tag[1]) out.add(tag[1])
      else if (tag[0] === 'e' && tag[1]) out.add(tag[1])
    }
    return out
  }, [bookmarkListEvent])

  const addBookmark = useCallback(
    async (event: Event) => {
      if (!signingIdentity) return
      const coordinate = getReplaceableCoordinate(kinds.BookmarkList, signingIdentity)
      // Mutations operate on the SIGNER's own bookmark list.
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await bookmarkListService.fetchBookmarkListEvent(signingIdentity))
      const currentTags = base?.tags || []
      const isReplaceable = isReplaceableEvent(event.kind)
      const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id

      if (
        currentTags.some((tag) =>
          isReplaceable
            ? tag[0] === 'a' && tag[1] === eventKey
            : tag[0] === 'e' && tag[1] === eventKey
        )
      ) {
        return
      }

      try {
        const created_at = nextCreatedAt(base)
        const draft = createBookmarkDraftEvent(
          [...currentTags, isReplaceable ? buildATag(event) : buildETag(event.id, event.pubkey)],
          base?.content
        )
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...(base ?? { kind: kinds.BookmarkList, pubkey: signingIdentity }),
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to add bookmark: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity]
  )

  const removeBookmark = useCallback(
    async (event: Event) => {
      if (!signingIdentity) return
      const coordinate = getReplaceableCoordinate(kinds.BookmarkList, signingIdentity)
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await bookmarkListService.fetchBookmarkListEvent(signingIdentity))
      if (!base) return
      const isReplaceable = isReplaceableEvent(event.kind)
      const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id

      const newTags = base.tags.filter((tag) =>
        isReplaceable
          ? tag[0] !== 'a' || tag[1] !== eventKey
          : tag[0] !== 'e' || tag[1] !== eventKey
      )
      if (newTags.length === base.tags.length) return

      try {
        const created_at = nextCreatedAt(base)
        const draft = createBookmarkDraftEvent(newTags, base.content)
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...base,
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to remove bookmark: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity]
  )

  const bookmarkListValue = useMemo(
    () => ({ bookmarkListEvent, bookmarkedEventKeySet }),
    [bookmarkListEvent, bookmarkedEventKeySet]
  )
  const bookmarksValue = useMemo(
    () => ({ addBookmark, removeBookmark }),
    [addBookmark, removeBookmark]
  )

  return (
    <BookmarkListContext.Provider value={bookmarkListValue}>
      <BookmarksContext.Provider value={bookmarksValue}>{children}</BookmarksContext.Provider>
    </BookmarkListContext.Provider>
  )
}

function ScopedPinListInner({ viewContext, signingIdentity, children }: InnerProps) {
  // Display: viewContext's pin list, read reactively.
  const pinListEvent = useUserListEvent(viewContext, kinds.Pinlist) ?? null

  // Warm-up: populate the cold store for viewContext.
  useEffect(() => {
    pinListService.fetchPinListEvent(viewContext)
  }, [viewContext])

  const pinnedEventHexIdSet = useMemo(
    () => getPinnedEventHexIdSetFromPinListEvent(pinListEvent),
    [pinListEvent]
  )

  const pin = useCallback(
    async (event: Event) => {
      // You can only pin your own notes — "your own" = the signing account.
      if (
        !signingIdentity ||
        event.kind !== kinds.ShortTextNote ||
        event.pubkey !== signingIdentity
      )
        return

      const coordinate = getReplaceableCoordinate(kinds.Pinlist, signingIdentity)
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await pinListService.fetchPinListEvent(signingIdentity))
      const currentTags = base?.tags || []
      if (currentTags.some((tag) => tag[0] === 'e' && tag[1] === event.id)) return

      try {
        let newTags = [...currentTags, buildETag(event.id, event.pubkey)]
        const eCount = newTags.filter((tag) => tag[0] === 'e').length
        if (eCount > MAX_PINNED_NOTES) {
          let removed = 0
          const needRemove = eCount - MAX_PINNED_NOTES
          newTags = newTags.filter((tag) => {
            if (tag[0] === 'e' && removed < needRemove) {
              removed += 1
              return false
            }
            return true
          })
        }

        const created_at = nextCreatedAt(base)
        const draft = createPinListDraftEvent(newTags, base?.content)
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...(base ?? { kind: kinds.Pinlist, pubkey: signingIdentity }),
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to pin: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity]
  )

  const unpin = useCallback(
    async (event: Event) => {
      if (
        !signingIdentity ||
        event.kind !== kinds.ShortTextNote ||
        event.pubkey !== signingIdentity
      )
        return

      const coordinate = getReplaceableCoordinate(kinds.Pinlist, signingIdentity)
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await pinListService.fetchPinListEvent(signingIdentity))
      if (!base) return
      const newTags = base.tags.filter((tag) => tag[0] !== 'e' || tag[1] !== event.id)
      if (newTags.length === base.tags.length) return

      try {
        const created_at = nextCreatedAt(base)
        const draft = createPinListDraftEvent(newTags, base.content)
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...base,
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to unpin: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity]
  )

  const value = useMemo(
    () => ({ pinnedEventHexIdSet, pin, unpin }),
    [pinnedEventHexIdSet, pin, unpin]
  )

  return <PinListContext.Provider value={value}>{children}</PinListContext.Provider>
}

function ScopedPinnedUsersInner({ viewContext, signingIdentity, children }: InnerProps) {
  // Display: viewContext's pinned-users list, read reactively (public tags from
  // the event store, private tags from the decrypted-tags store).
  const pinnedUsersEvent = useUserListEvent(viewContext, ExtendedKind.PINNED_USERS) ?? null
  const privateTags = usePrivateTags(viewContext, ExtendedKind.PINNED_USERS)

  const makeDraft = (tags: string[][], content = '') => ({
    kind: ExtendedKind.PINNED_USERS,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  })

  // Signer read from the registry (not the AccountScope) so this provider works
  // at the app-level mount too.
  const migrateToNip44 = useCallback(
    async (event: Event, tags: string[][]) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (!signer || !signingIdentity) return
      try {
        const cipherText = await signer.nip44Encrypt(signingIdentity, JSON.stringify(tags))
        const draft = makeDraft(event.tags, cipherText)
        const newEvent = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(newEvent)
        privateTagsCache.setOptimistic(
          getReplaceableCoordinate(ExtendedKind.PINNED_USERS, signingIdentity),
          tags
        )
      } catch (error) {
        console.error('[ScopedPinnedUsers] migrate-to-nip44 failed', error)
      }
    },
    [signingIdentity]
  )

  // Warm-up: populate the cold store for viewContext, decrypt private tags, and
  // trigger the NIP-04 → NIP-44 migration on legacy events.
  useEffect(() => {
    let cancelled = false
    pinListService.fetchPinnedUsersList(viewContext).then(async (event) => {
      if (cancelled || !event) return
      const { wasNip04 } = await privateTagsCache.loadFor(event)
      if (cancelled) return
      const tags = privateTagsCache.getSnapshot(getReplaceableCoordinateFromEvent(event))
      if (wasNip04 && tags && tags.length > 0) {
        migrateToNip44(event, tags)
      }
    })
    return () => {
      cancelled = true
    }
  }, [viewContext, migrateToNip44])

  const favoritePubkeySet = useMemo(() => {
    if (!pinnedUsersEvent) return new Set<string>()
    return new Set(getPubkeysFromPTags(pinnedUsersEvent.tags.concat(privateTags)))
  }, [pinnedUsersEvent, privateTags])

  const isFavorited = useCallback(
    (pubkey: string) => favoritePubkeySet.has(pubkey),
    [favoritePubkeySet]
  )

  const addFavorite = useCallback(
    async (pubkey: string) => {
      if (!signingIdentity || isFavorited(pubkey)) return
      const coordinate = getReplaceableCoordinate(ExtendedKind.PINNED_USERS, signingIdentity)
      // Mutations operate on the SIGNER's own pinned-users list.
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await pinListService.fetchPinnedUsersList(signingIdentity))
      const currentTags = base?.tags ?? []
      const currentContent = base?.content ?? ''
      if (currentTags.some(([k, v]) => k === 'p' && v === pubkey)) return

      try {
        const created_at = nextCreatedAt(base)
        const newTags = [...currentTags, ['p', pubkey]]
        const draft = makeDraft(newTags, currentContent)
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...(base ?? { kind: ExtendedKind.PINNED_USERS, pubkey: signingIdentity }),
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
      } catch (error) {
        listOverlay.clear(coordinate)
        formatError(error).forEach((err) => {
          toast.error(`Failed to add favorite: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity, isFavorited]
  )

  const removeFavorite = useCallback(
    async (pubkey: string) => {
      const signer = client.getSignerFor(signingIdentity ?? '')
      if (!signingIdentity || !isFavorited(pubkey) || !signer) return
      const coordinate = getReplaceableCoordinate(ExtendedKind.PINNED_USERS, signingIdentity)
      const base =
        listOverlay.getSnapshot(coordinate) ??
        (await pinListService.fetchPinnedUsersList(signingIdentity))
      if (!base) return
      // Decrypt the signer's own current private tags for the mutation.
      await privateTagsCache.loadFor(base)
      const currentPrivate =
        privateTagsCache.getSnapshot(getReplaceableCoordinateFromEvent(base)) ?? []
      // Snapshot the prior decrypted private slice so a publish failure restores
      // exactly what was shown — never re-decrypt via loadFor, which empties the
      // set if the signer is gone (a likely CAUSE of the failure) or decrypt throws.
      const priorPrivate = privateTagsCache.getSnapshot(coordinate)

      try {
        const created_at = nextCreatedAt(base)
        const newTags = base.tags.filter(
          ([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey
        )
        const newPrivate = currentPrivate.filter(
          ([tagName, tagValue]) => tagName !== 'p' || tagValue !== pubkey
        )
        let newContent = base.content
        if (newPrivate.length !== currentPrivate.length) {
          newContent = await signer.nip44Encrypt(signingIdentity, JSON.stringify(newPrivate))
        }
        const draft = makeDraft(newTags, newContent)
        draft.created_at = created_at
        listOverlay.setOptimistic(coordinate, {
          ...base,
          ...draft,
          id: 'optimistic',
          sig: '',
          created_at
        } as Event)
        privateTagsCache.setOptimistic(coordinate, newPrivate)
        const real = await publishAsAccount(signingIdentity, draft)
        await replaceableEventCache.updateCache(real)
        listOverlay.clear(coordinate)
        await privateTagsCache.loadFor(real)
      } catch (error) {
        listOverlay.clear(coordinate)
        // Roll the private overlay back to the snapshotted prior value.
        privateTagsCache.setOptimistic(coordinate, priorPrivate ?? [])
        formatError(error).forEach((err) => {
          toast.error(`Failed to remove favorite: ${err}`, { duration: 10_000 })
        })
      }
    },
    [signingIdentity, isFavorited]
  )

  const toggleFavorite = useCallback(
    async (pubkey: string) => {
      if (isFavorited(pubkey)) {
        await removeFavorite(pubkey)
      } else {
        await addFavorite(pubkey)
      }
    },
    [isFavorited, addFavorite, removeFavorite]
  )

  const value = useMemo(
    () => ({ favoritePubkeySet, isFavorited, addFavorite, removeFavorite, toggleFavorite }),
    [favoritePubkeySet, isFavorited, addFavorite, removeFavorite, toggleFavorite]
  )

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}
