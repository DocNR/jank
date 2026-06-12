import { getReplaceableCoordinate } from '@/lib/event'
import listOverlay from '@/services/caches/list-overlay.service'
import privateTagsCache from '@/services/caches/private-tags-cache.service'
import replaceableEventCache from '@/services/caches/replaceable-event-cache.service'
import { Event as NEvent } from 'nostr-tools'
import { useSyncExternalStore } from 'react'

// Module-level constant so usePrivateTags returns a stable [] reference
// (a fresh [] each render would loop useSyncExternalStore's snapshot check).
const EMPTY_TAGS: string[][] = []

/** Canonical (real, signed) replaceable event for pubkey:kind, reactively. */
export function useReplaceableEvent(pubkey: string | null, kind: number): NEvent | undefined {
  const coordinate = pubkey ? getReplaceableCoordinate(kind, pubkey) : ''
  return useSyncExternalStore(
    (cb) => (coordinate ? replaceableEventCache.subscribe(coordinate, cb) : () => {}),
    () => (coordinate ? replaceableEventCache.getSnapshot(coordinate) : undefined)
  )
}

/** Decrypted private tags for an encrypted list (Mute / Pinned-users). */
export function usePrivateTags(pubkey: string | null, kind: number): string[][] {
  const coordinate = pubkey ? getReplaceableCoordinate(kind, pubkey) : ''
  return (
    useSyncExternalStore(
      (cb) => (coordinate ? privateTagsCache.subscribe(coordinate, cb) : () => {}),
      () => (coordinate ? privateTagsCache.getSnapshot(coordinate) : undefined)
    ) ?? EMPTY_TAGS
  )
}

/**
 * The list event a UI surface should render: the optimistic overlay if a
 * mutation is in flight, else the canonical event. Subscribes to both so a
 * change in either re-renders.
 */
export function useUserListEvent(pubkey: string | null, kind: number): NEvent | undefined {
  const coordinate = pubkey ? getReplaceableCoordinate(kind, pubkey) : ''
  return useSyncExternalStore(
    (cb) => {
      if (!coordinate) return () => {}
      const u1 = replaceableEventCache.subscribe(coordinate, cb)
      const u2 = listOverlay.subscribe(coordinate, cb)
      return () => {
        u1()
        u2()
      }
    },
    () =>
      coordinate
        ? (listOverlay.getSnapshot(coordinate) ?? replaceableEventCache.getSnapshot(coordinate))
        : undefined
  )
}
