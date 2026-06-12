import { useStuff } from '@/hooks/useStuff'
import { useSigningContext } from '@/hooks/useSigningContext'
import { cn } from '@/lib/utils'
import { pubkeyToHsl } from '@/lib/pubkey'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import stuffStatsService from '@/services/stuff-stats.service'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BookmarkButton from '../BookmarkButton'
import LikeButton from './LikeButton'
import Likes from './Likes'
import ReplyButton from './ReplyButton'
import RepostButton from './RepostButton'
import SeenOnButton from './SeenOnButton'
import TopZaps from './TopZaps'
import ZapButton from './ZapButton'

export default function StuffStats({
  stuff,
  className,
  classNames,
  fetchIfNotExisting = false,
  displayTopZapsAndLikes = false
}: {
  stuff: Event | string
  className?: string
  classNames?: {
    buttonBar?: string
  }
  fetchIfNotExisting?: boolean
  displayTopZapsAndLikes?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const { t } = useTranslation()
  // Stats are fetched for the column's signing identity so the "did I react /
  // repost / zap" indicators reflect the account this column acts as.
  // `signingMismatch` drives a small signing-hue dot on the action bar — a
  // persistent "you're acting as a different account here" cue. Only rendered
  // on mismatch, so the common case adds nothing per-note.
  const { signerPubkey, signingMismatch } = useSigningContext()
  const [loading, setLoading] = useState(false)
  const { event } = useStuff(stuff)

  const signingDot =
    signingMismatch && signerPubkey ? (
      <span
        className="me-1.5 size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: pubkeyToHsl(signerPubkey) }}
        title={t('Actions here sign as a different account')}
        aria-hidden
      />
    ) : null

  useEffect(() => {
    if (!fetchIfNotExisting) return
    setLoading(true)
    stuffStatsService.fetchStuffStats(stuff, signerPubkey).finally(() => setLoading(false))
  }, [event, fetchIfNotExisting, signerPubkey])

  if (isSmallScreen) {
    return (
      <div className={cn('select-none', className)}>
        {displayTopZapsAndLikes && (
          <>
            <TopZaps stuff={stuff} />
            <Likes stuff={stuff} />
          </>
        )}
        <div
          className={cn(
            'flex h-5 items-center justify-between [&_svg]:size-5',
            loading ? 'animate-pulse' : '',
            classNames?.buttonBar
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {signingDot}
          <ReplyButton stuff={stuff} />
          <RepostButton stuff={stuff} />
          <LikeButton stuff={stuff} />
          <ZapButton stuff={stuff} />
          <BookmarkButton stuff={stuff} />
          <SeenOnButton stuff={stuff} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)}>
      {displayTopZapsAndLikes && (
        <>
          <TopZaps stuff={stuff} />
          <Likes stuff={stuff} />
        </>
      )}
      <div
        className={cn(
          'flex h-4 items-center justify-between [&_svg]:size-3.5',
          loading ? 'animate-pulse' : ''
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {signingDot}
        <ReplyButton stuff={stuff} />
        <RepostButton stuff={stuff} />
        <LikeButton stuff={stuff} />
        <ZapButton stuff={stuff} />
        <BookmarkButton stuff={stuff} />
        <SeenOnButton stuff={stuff} />
      </div>
    </div>
  )
}
