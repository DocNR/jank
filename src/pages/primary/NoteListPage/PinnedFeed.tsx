import NormalFeed from '@/components/NormalFeed'
import { SPECIAL_FEED_ID } from '@/constants'
import { useNostr } from '@/providers/NostrProvider'
import { useFavorites } from '@/providers/UserListsProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { useEffect, useRef, useState } from 'react'

export default function PinnedFeed() {
  const { pubkey } = useNostr()
  const { favoritePubkeySet } = useFavorites()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return

    async function init() {
      if (!pubkey || favoritePubkeySet.size === 0) {
        setSubRequests([])
        return
      }

      initializedRef.current = true
      const favoritePubkeys = Array.from(favoritePubkeySet)
      setSubRequests(await client.generateSubRequestsForPubkeys(favoritePubkeys, pubkey))
    }

    init()
  }, [pubkey, favoritePubkeySet])

  return <NormalFeed feedId={SPECIAL_FEED_ID.PINNED} subRequests={subRequests} isPubkeyFeed />
}
