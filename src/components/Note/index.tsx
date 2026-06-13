import { useSecondaryPage } from '@/DeckManager'
import { ExtendedKind, NSFW_DISPLAY_POLICY, SUPPORTED_KINDS } from '@/constants'
import { cn } from '@/lib/utils'
import { getParentStuff, isInMutedThread, isNsfwEvent } from '@/lib/event'
import { toExternalContent, toNote } from '@/lib/link'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Event, kinds } from 'nostr-tools'
import { ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AudioPlayer from '../AudioPlayer'
import ClientTag from '../ClientTag'
import Content from '../Content'
import FollowingBadge from '../FollowingBadge'
import ProtectedBadge from '../ProtectedBadge'
import { FormattedTimestamp } from '../FormattedTimestamp'
import Nip05 from '../Nip05'
import NoteOptions from '../NoteOptions'
import ParentNotePreview from '../ParentNotePreview'
import TranslateButton from '../TranslateButton'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import CommunityDefinition from './CommunityDefinition'
import EmojiPack from './EmojiPack'
import FollowPack from './FollowPack'
import GroupMetadata from './GroupMetadata'
import Highlight from './Highlight'
import LiveEvent from './LiveEvent'
import LongFormArticle from './LongFormArticle'
import LongFormArticlePreview from './LongFormArticlePreview'
import MutedNote from './MutedNote'
import NsfwNote from './NsfwNote'
import PictureNote from './PictureNote'
import Poll from './Poll'
import Reaction from './Reaction'
import RelayReview from './RelayReview'
import UnknownNote from './UnknownNote'
import VideoNote from './VideoNote'

export default function Note({
  event,
  originalNoteId,
  size = 'normal',
  className,
  hideParentNotePreview = false,
  showFull = false,
  actionBar
}: {
  event: Event
  originalNoteId?: string
  size?: 'normal' | 'small'
  className?: string
  hideParentNotePreview?: boolean
  showFull?: boolean
  actionBar?: ReactNode
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const { density } = useUserPreferences()
  const isCompact = density === 'compact'
  const sectionGap = isCompact ? 'mt-1' : 'mt-2'
  const { parentEventId, parentExternalContent } = useMemo(() => {
    return getParentStuff(event)
  }, [event])
  const reactionTargetEventId = useMemo(() => {
    if (event.kind !== kinds.Reaction && event.kind !== ExtendedKind.EXTERNAL_CONTENT_REACTION) {
      return undefined
    }
    const aTag = event.tags.findLast(tagNameEquals('a'))
    if (aTag) return generateBech32IdFromATag(aTag)
    const eTag = event.tags.findLast(tagNameEquals('e'))
    return eTag ? generateBech32IdFromETag(eTag) : undefined
  }, [event])
  const { nsfwDisplayPolicy } = useContentPolicy()
  const [showNsfw, setShowNsfw] = useState(false)
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const [showMuted, setShowMuted] = useState(false)
  const isNsfw = useMemo(
    () => (nsfwDisplayPolicy === NSFW_DISPLAY_POLICY.SHOW ? false : isNsfwEvent(event)),
    [event, nsfwDisplayPolicy]
  )
  const displayTimestamp = useMemo(() => {
    if (event.kind === kinds.LongFormArticle) {
      const publishedAt = event.tags.find(tagNameEquals('published_at'))?.[1]
      const parsed = publishedAt ? parseInt(publishedAt, 10) : NaN
      if (Number.isFinite(parsed)) return parsed
    }
    return event.created_at
  }, [event])

  let content: React.ReactNode
  if (
    ![
      ...SUPPORTED_KINDS,
      kinds.CommunityDefinition,
      kinds.LiveEvent,
      ExtendedKind.GROUP_METADATA
    ].includes(event.kind)
  ) {
    content = <UnknownNote className="mt-1" event={event} />
  } else if (mutePubkeySet.has(event.pubkey) && !showMuted) {
    content = <MutedNote show={() => setShowMuted(true)} />
  } else if (isInMutedThread(event, muteEventIdSet) && !showMuted) {
    content = <MutedNote reason="thread" show={() => setShowMuted(true)} />
  } else if (isNsfw && !showNsfw) {
    content = <NsfwNote show={() => setShowNsfw(true)} />
  } else if (event.kind === kinds.Highlights) {
    content = <Highlight className="mt-2" event={event} />
  } else if (event.kind === kinds.LongFormArticle) {
    content = showFull ? (
      <LongFormArticle className="mt-2" event={event} />
    ) : (
      <LongFormArticlePreview className="mt-2" event={event} />
    )
  } else if (event.kind === kinds.LiveEvent) {
    content = <LiveEvent className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.GROUP_METADATA) {
    content = <GroupMetadata className="mt-2" event={event} originalNoteId={originalNoteId} />
  } else if (event.kind === kinds.CommunityDefinition) {
    content = <CommunityDefinition className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.POLL) {
    content = (
      <>
        <Content className="mt-2" event={event} />
        <Poll className="mt-2" event={event} />
      </>
    )
  } else if (event.kind === ExtendedKind.VOICE || event.kind === ExtendedKind.VOICE_COMMENT) {
    content = <AudioPlayer className="mt-2" src={event.content} />
  } else if (event.kind === ExtendedKind.PICTURE) {
    content = <PictureNote className="mt-2" event={event} />
  } else if (
    event.kind === ExtendedKind.VIDEO ||
    event.kind === ExtendedKind.SHORT_VIDEO ||
    event.kind === ExtendedKind.ADDRESSABLE_NORMAL_VIDEO ||
    event.kind === ExtendedKind.ADDRESSABLE_SHORT_VIDEO
  ) {
    content = <VideoNote className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.RELAY_REVIEW) {
    content = <RelayReview className="mt-2" event={event} />
  } else if (event.kind === kinds.Emojisets) {
    content = <EmojiPack className="mt-2" event={event} />
  } else if (event.kind === ExtendedKind.FOLLOW_PACK) {
    content = <FollowPack className="mt-2" event={event} />
  } else if (event.kind === kinds.Reaction) {
    content = <Reaction className="mt-2" event={event} />
  } else {
    content = <Content className="mt-2" event={event} enableHighlight />
  }

  return (
    <div className={cn('@container', className, isCompact && size === 'normal' && 'text-[14.5px]')}>
      <div className={cn('flex items-start', isCompact ? 'gap-1.5' : 'gap-2')}>
        <UserAvatar userId={event.pubkey} size={size === 'small' ? 'medium' : 'normal'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Username
                userId={event.pubkey}
                className={`flex min-w-0 truncate font-semibold ${size === 'small' ? 'text-sm' : ''}`}
                skeletonClassName={size === 'small' ? 'h-3' : 'h-4'}
              />
              <FollowingBadge pubkey={event.pubkey} />
              <ProtectedBadge event={event} />
              <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden @xl:flex">
                <Nip05 pubkey={event.pubkey} />
              </div>
            </div>
            <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm">
              <FormattedTimestamp
                timestamp={displayTimestamp}
                className="shrink-0"
                short={isSmallScreen}
              />
              <ClientTag event={event} />
              <TranslateButton
                event={event}
                showFull={showFull}
                className={size === 'normal' ? '' : 'pe-0'}
              />
              {size === 'normal' && (
                <NoteOptions event={event} className="shrink-0 py-1 [&_svg]:size-5" />
              )}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden leading-tight @xl:hidden">
            <Nip05 pubkey={event.pubkey} />
          </div>
          {!hideParentNotePreview && (
            <ParentNotePreview
              eventId={parentEventId}
              externalContent={parentExternalContent}
              className={sectionGap}
              onClick={(e) => {
                e.stopPropagation()
                if (parentExternalContent) {
                  push(toExternalContent(parentExternalContent))
                } else if (parentEventId) {
                  push(toNote(parentEventId))
                }
              }}
            />
          )}
          {reactionTargetEventId && (
            <ParentNotePreview
              eventId={reactionTargetEventId}
              label={t('reacted to')}
              className={sectionGap}
              onClick={(e) => {
                e.stopPropagation()
                push(toNote(reactionTargetEventId))
              }}
            />
          )}
          {content}
          {actionBar}
        </div>
      </div>
    </div>
  )
}
