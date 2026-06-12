import { useSecondaryPage } from '@/DeckManager'
import { useStuffStatsById } from '@/hooks/useStuffStatsById'
import { getEventKey } from '@/lib/event'
import { toProfile } from '@/lib/link'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Repeat } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import UserAvatar from '../UserAvatar'
import Username from '../Username'

const SHOW_COUNT = 20

export default function RepostList({ event }: { event: Event }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const noteStats = useStuffStatsById(getEventKey(event))
  const [filteredReposts, setFilteredReposts] = useState<
    Array<{ id: string; pubkey: string; created_at: number }>
  >([])

  useEffect(() => {
    const reposts = [...(noteStats?.reposts ?? [])]
    reposts.sort((a, b) => b.created_at - a.created_at)
    setFilteredReposts(reposts)
  }, [noteStats, event.id])

  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!bottomRef.current || filteredReposts.length <= showCount) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShowCount((c) => c + SHOW_COUNT)
      },
      { rootMargin: '10px', threshold: 0.1 }
    )
    obs.observe(bottomRef.current)
    return () => obs.disconnect()
  }, [filteredReposts.length, showCount])

  return (
    <div className="min-h-[80vh]">
      {filteredReposts.slice(0, showCount).map((repost) => (
        <div
          key={repost.id}
          className="clickable flex items-center gap-3 border-b px-4 py-3 transition-colors"
          onClick={() => push(toProfile(repost.pubkey))}
        >
          <Repeat className="size-5 text-green-400" />

          <UserAvatar userId={repost.pubkey} size="medium" className="shrink-0" />

          <div className="w-0 flex-1">
            <Username
              userId={repost.pubkey}
              className="text-muted-foreground hover:text-foreground max-w-fit truncate text-sm font-semibold"
              skeletonClassName="h-3"
            />
            <div className="text-muted-foreground flex items-center gap-1 text-sm">
              <Nip05 pubkey={repost.pubkey} append="·" />
              <FormattedTimestamp
                timestamp={repost.created_at}
                className="shrink-0"
                short={isSmallScreen}
              />
            </div>
          </div>
        </div>
      ))}

      <div ref={bottomRef} />

      <div className="text-muted-foreground mt-2 text-center text-sm">
        {filteredReposts.length > 0 ? t('No more reposts') : t('No reposts yet')}
      </div>
    </div>
  )
}
