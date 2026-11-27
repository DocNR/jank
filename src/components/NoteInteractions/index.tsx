import Tabs from '@/components/Tabs'
import TrustScoreFilter from '@/components/TrustScoreFilter'
import { TRUST_SCORE_FILTER_ID } from '@/constants'
import { useFilteredAllReplies } from '@/hooks'
import { useFilteredLikeCount } from '@/hooks/useFilteredLikeCount'
import { useFilteredRepostCount } from '@/hooks/useFilteredRepostCount'
import { useStuff } from '@/hooks/useStuff'
import { useStuffStatsById } from '@/hooks/useStuffStatsById'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Event } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import QuoteList from '../QuoteList'
import ReactionList from '../ReactionList'
import ReplyNoteList from '../ReplyNoteList'
import RepostList from '../RepostList'
import ZapList from '../ZapList'

type TTabValue = 'replies' | 'quotes' | 'reactions' | 'reposts' | 'zaps'

export default function NoteInteractions({ event }: { event: Event }) {
  const [type, setType] = useState<TTabValue>('replies')
  const { stuffKey } = useStuff(event)
  const noteStats = useStuffStatsById(stuffKey)
  const { replies } = useFilteredAllReplies(stuffKey)
  const repostCount = useFilteredRepostCount(stuffKey)
  const reactionCount = useFilteredLikeCount(stuffKey)
  const zapCount = noteStats?.zaps?.length ?? 0
  const [quoteCount, setQuoteCount] = useState(0)
  const { getMinTrustScore, updateMinTrustScore } = useUserTrust()

  const handleQuoteCountChange = useCallback((count: number) => {
    setQuoteCount(count)
  }, [])

  const tabs = useMemo(
    () => [
      { value: 'replies', label: 'Replies', count: replies.length },
      { value: 'zaps', label: 'Zaps', count: zapCount },
      { value: 'reposts', label: 'Reposts', count: repostCount },
      { value: 'reactions', label: 'Reactions', count: reactionCount },
      { value: 'quotes', label: 'Quotes', count: quoteCount }
    ],
    [replies.length, zapCount, repostCount, reactionCount, quoteCount]
  )

  let list
  switch (type) {
    case 'replies':
      list = <ReplyNoteList stuff={event} />
      break
    case 'reactions':
      list = <ReactionList stuff={event} />
      break
    case 'reposts':
      list = <RepostList event={event} />
      break
    case 'zaps':
      list = <ZapList event={event} />
      break
    default:
      break
  }

  return (
    <>
      <Tabs
        tabs={tabs}
        value={type}
        onTabChange={(tab) => setType(tab as TTabValue)}
        options={
          <TrustScoreFilter
            value={getMinTrustScore(TRUST_SCORE_FILTER_ID.THREAD_REPLIES)}
            onChange={(score) => updateMinTrustScore(TRUST_SCORE_FILTER_ID.THREAD_REPLIES, score)}
          />
        }
      />
      {list}
      <div className={type === 'quotes' ? undefined : 'hidden'}>
        <QuoteList stuff={event} onCountChange={handleQuoteCountChange} />
      </div>
    </>
  )
}
