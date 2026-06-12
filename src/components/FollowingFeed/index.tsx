import { BRAND } from '@/branding'
import NormalFeed from '@/components/NormalFeed'
import { Button } from '@/components/ui/button'
import { SPECIAL_FEED_ID } from '@/constants'
import { useSecondaryPage } from '@/DeckManager'
import { useFollowList } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import followListService from '@/services/fetchers/follow-list.service'
import { TFeedSubRequest } from '@/types'
import { Search, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** Override pubkey for column-scoped use. If absent, falls back to the global active account. */
  pubkey?: string
}

export default function FollowingFeed({ pubkey: pubkeyProp }: Props = {}) {
  const { t } = useTranslation()
  const { pubkey: activePubkey } = useNostr()
  const pubkey = pubkeyProp ?? activePubkey
  const { followingSet } = useFollowList()
  const { push } = useSecondaryPage()
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [hasFollowings, setHasFollowings] = useState<boolean | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const initializedRef = useRef(false)

  // Re-arm the init guard whenever the active pubkey changes so switching
  // accounts re-runs the fetch. Without this, initializedRef latches after
  // the first successful init and the feed sticks to the original account.
  useEffect(() => {
    initializedRef.current = false
  }, [pubkey])

  useEffect(() => {
    if (initializedRef.current) return

    async function init() {
      if (!pubkey) {
        setSubRequests([])
        setHasFollowings(null)
        return
      }

      const followings = await followListService.fetchFollowings(pubkey)
      setHasFollowings(followings.length > 0)
      setSubRequests(await client.generateSubRequestsForPubkeys([pubkey, ...followings], pubkey))

      if (followings.length) {
        initializedRef.current = true
      }
    }

    init()
  }, [pubkey, followingSet, refreshCount])

  // Show empty state when user has no followings
  if (hasFollowings === false && subRequests.length > 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <UserPlus size={64} className="text-muted-foreground mb-4" strokeWidth={1.5} />
        <h2 className="mb-2 text-2xl font-semibold">
          {t('Welcome to {{appName}}!', { appName: BRAND.name })}
        </h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          {t(
            'Your feed is empty because you are not following anyone yet. Start by exploring interesting content and following users you like!'
          )}
        </p>
        <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => push('/search')} className="w-full">
            <Search className="size-5" />
            {t('Explore')}
          </Button>
          <Button size="lg" variant="outline" onClick={() => push('/search')} className="w-full">
            <Search className="size-5" />
            {t('Search Users')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <NormalFeed
      feedId={SPECIAL_FEED_ID.FOLLOWING}
      subRequests={subRequests}
      onRefresh={() => {
        initializedRef.current = false
        setRefreshCount((count) => count + 1)
      }}
      isPubkeyFeed
    />
  )
}
