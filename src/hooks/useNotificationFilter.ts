import { notificationFilter } from '@/lib/notification'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { NostrEvent } from 'nostr-tools'
import { useCallback } from 'react'

/**
 * Build a notification-event filter for a specific account's notifications.
 *
 * `pubkey` is the account whose notifications are being shown — the column's
 * `viewContext` in column mode, the active account in page mode. NOT the
 * sidebar-active account: a Notifications column scoped to B while A is
 * active must filter events using B's pubkey, otherwise kind-7 reactions
 * (whose `notificationFilter` rule keeps only events whose last `p` tag
 * matches the recipient) get rejected because the active account doesn't
 * match the column's account.
 */
export function useNotificationFilter(pubkey: string | null | undefined) {
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()

  return useCallback(
    (event: NostrEvent) =>
      notificationFilter(event, {
        pubkey,
        mutePubkeySet,
        muteEventIdSet,
        hideContentMentioningMutedUsers
      }),
    [pubkey, mutePubkeySet, muteEventIdSet, hideContentMentioningMutedUsers]
  )
}
