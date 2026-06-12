import followListService from '@/services/fetchers/follow-list.service'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { deriveFollowings } from './useFetchFollowings.helpers'
import { useReplaceableEvent } from './useReplaceableEvent'

export function useFetchFollowings(pubkey?: string | null) {
  const [isFetching, setIsFetching] = useState(true)

  // Reactive read of the canonical kind-3 from the subscribable cache, so the
  // followings live-update whenever a newer follow list lands (e.g. the viewed
  // user edits theirs, or the viewer follows/unfollows them).
  const event = useReplaceableEvent(pubkey ?? null, kinds.Contacts)
  const { followListEvent, followings } = useMemo(() => deriveFollowings(event), [event])

  // Trigger a fetch so the cache is populated for pubkeys we haven't loaded yet
  // (e.g. a foreign profile). The displayed value still comes from the reactive
  // read above; this only seeds/refreshes the cache and drives `isFetching`.
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        setIsFetching(true)
        if (!pubkey) return
        await followListService.fetchFollowListEvent(pubkey)
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [pubkey])

  return { followings, followListEvent, isFetching }
}
