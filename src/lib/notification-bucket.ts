import { ExtendedKind } from '@/constants'
import { getParentTag } from '@/lib/event'
import eventCache from '@/services/caches/event-cache.service'
import { TNotificationType } from '@/types'
import { Event, kinds } from 'nostr-tools'

/**
 * Classifies a notification event into a single chip bucket. Pure, sync,
 * best-effort: for kind-1-family events the reply vs mention distinction
 * uses the e/a-tag's pubkey hint when present, else defaults to 'mentions'
 * (the safer fallback — a reply misclassified as mention still shows in
 * the unfiltered view and in the mentions chip).
 *
 * Never returns 'all' — that value is the "no filter" sentinel reserved
 * for the chip-row state. Every event lands in one of the six per-kind
 * buckets; unknown kinds and POLL_RESPONSE / Highlights fall into mentions.
 */
export function notificationBucket(
  event: Event,
  userPubkey: string | null | undefined
): TNotificationType {
  switch (event.kind) {
    case kinds.Reaction:
    case ExtendedKind.EXTERNAL_CONTENT_REACTION:
      return 'reactions'
    case kinds.Zap:
      return 'zaps'
    case kinds.Repost:
    case kinds.GenericRepost:
      return 'reposts'
    case kinds.ShortTextNote:
    case ExtendedKind.COMMENT:
    case ExtendedKind.VOICE_COMMENT:
    case ExtendedKind.POLL:
      return isReplyToUser(event, userPubkey) ? 'replies' : 'mentions'
    // Fallbacks for kinds without a dedicated chip — fold into mentions
    // so they remain visible in the unfiltered view and the @ filter.
    case kinds.Highlights:
    case ExtendedKind.POLL_RESPONSE:
      return 'mentions'
    default:
      return 'mentions'
  }
}

/**
 * True iff this event is a reply to a target whose author is `userPubkey`.
 *
 * Sync best-effort, mirroring the async `isDirectMention` check in
 * `NotificationItem/MentionNotification.tsx` as closely as a sync function can:
 *
 *  - e-tag parents carry the parent author's pubkey at a kind-dependent index:
 *    NIP-10 kind-1 replies put it at index 4 (`['e', id, relay, marker, pubkey]`),
 *    while NIP-22 comments (kind 1111 / 1244) put it at index 3 with no marker
 *    (`['e', id, relay, pubkey]`). We accept a match at either index. A kind-1
 *    reply's index 3 is always a marker word, never a 64-hex pubkey, so there
 *    is no cross-talk between the two layouts.
 *  - When the e-tag omits the hint (some non-jank clients), we peek the
 *    in-memory event cache for the parent and compare its author. This is the
 *    sync analogue of the display layer's async parent fetch; on a cache miss
 *    we fall back to `false` (treat as a mention — the safe default, since a
 *    misclassified reply still shows in the unfiltered view and the @ chip).
 *  - a-tag parents (NIP-23 addressable) carry the author in the coordinate.
 */
export function isReplyToUser(
  event: Event,
  userPubkey: string | null | undefined
): boolean {
  if (!userPubkey) return false
  const parent = getParentTag(event)
  if (!parent) return false

  if (parent.type === 'e') {
    // NIP-10 hint at index 4; NIP-22 comment parent-author at index 3.
    if (parent.tag[4] === userPubkey || parent.tag[3] === userPubkey) return true

    // Hint absent: best-effort peek at the in-memory cache for the parent.
    const parentId = parent.tag[1]
    if (parentId) {
      const cachedParent = eventCache.getCachedEvent(parentId)
      if (cachedParent) return cachedParent.pubkey === userPubkey
    }
    return false
  }

  if (parent.type === 'a') {
    // NIP-23 a-tag: ['a', '<kind>:<pubkey>:<d-tag>', ...]
    const coordinate = parent.tag[1]
    const parentPubkey = coordinate?.split(':')[1]
    return parentPubkey === userPubkey
  }

  // 'i' (external content) parents — not a reply to a Nostr user.
  return false
}
