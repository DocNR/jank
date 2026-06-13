import { kinds, NostrEvent } from 'nostr-tools'
import { isInMutedThread, isMentioningMutedUsers } from './event'
import { tagNameEquals } from './tag'

export function notificationFilter(
  event: NostrEvent,
  {
    pubkey,
    mutePubkeySet,
    muteEventIdSet,
    hideContentMentioningMutedUsers
  }: {
    pubkey?: string | null
    mutePubkeySet: Set<string>
    muteEventIdSet: Set<string>
    hideContentMentioningMutedUsers?: boolean
  }
): boolean {
  if (
    mutePubkeySet.has(event.pubkey) ||
    (hideContentMentioningMutedUsers && isMentioningMutedUsers(event, mutePubkeySet))
  ) {
    return false
  }

  // Muted threads must also drop OUT of the unread counts (column badge +
  // favicon/title), not just the rendered list — otherwise a muted hellthread
  // that keeps tagging you still lights up the badge.
  if (isInMutedThread(event, muteEventIdSet)) {
    return false
  }

  if (pubkey && event.kind === kinds.Reaction) {
    const targetPubkey = event.tags.findLast(tagNameEquals('p'))?.[1]
    if (targetPubkey !== pubkey) return false
  }

  return true
}
