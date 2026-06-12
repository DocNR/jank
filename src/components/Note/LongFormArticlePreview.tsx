import { useTranslatedEvent } from '@/hooks'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { useSecondaryPage } from '@/DeckManager'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import Image from '../Image'

export default function LongFormArticlePreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { push } = useSecondaryPage()
  const { autoLoadMedia } = useContentPolicy()
  const translatedEvent = useTranslatedEvent(event.id)
  const displayEvent = translatedEvent ?? event
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(displayEvent), [displayEvent])

  const titleComponent = <div className="line-clamp-2 text-xl font-semibold">{metadata.title}</div>

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {metadata.tags.map((tag) => (
        <div
          key={tag}
          className="bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground flex max-w-32 cursor-pointer items-center rounded-full px-2.5 py-0.5 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
          }}
        >
          #<span className="truncate">{tag}</span>
        </div>
      ))}
    </div>
  )

  const summaryComponent = metadata.summary && (
    <div className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
      {metadata.summary}
    </div>
  )

  // Container-query layout: stacks image-over-text in narrow containers
  // (deck columns ~400px, mobile viewport), switches to horizontal at @md
  // (~448px) where there's room for a 235px image alongside readable text.
  // Replaces the prior `isSmallScreen` viewport check, which incorrectly
  // forced the horizontal layout inside narrow desktop columns and squeezed
  // the title to ~40px wide.
  return (
    <div className={cn('@container', className)}>
      <div className="flex flex-col gap-4 @md:flex-row">
        {metadata.image && autoLoadMedia && (
          <Image
            image={{ url: metadata.image, pubkey: event.pubkey }}
            className="bg-foreground aspect-video w-full object-cover @md:aspect-4/3 @md:h-44 @md:w-auto @md:xl:aspect-video"
            hideIfError
          />
        )}
        <div className="space-y-1 @md:w-0 @md:flex-1">
          {titleComponent}
          {summaryComponent}
          {tagsComponent}
        </div>
      </div>
    </div>
  )
}
