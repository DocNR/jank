import { Separator } from '@/components/ui/separator'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/DeckManager'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Event } from 'nostr-tools'
import { memo, useContext } from 'react'
import Collapsible from '../Collapsible'
import Note from '../Note'
import { NewlyArrivedContext } from '../NoteList/context'
import StuffStats from '../StuffStats'
import PinnedButton from './PinnedButton'
import RepostDescription from './RepostDescription'

function MainNoteCardImpl({
  event,
  className,
  reposters,
  embedded,
  originalNoteId,
  pinned = false
}: {
  event: Event
  className?: string
  reposters?: string[]
  embedded?: boolean
  originalNoteId?: string
  pinned?: boolean
}) {
  const { push } = useSecondaryPage()
  const { density } = useUserPreferences()
  const newlyArrived = useContext(NewlyArrivedContext)
  const isCompact = density === 'compact'
  const isNewlyArrived = newlyArrived.has(event.id)

  return (
    <div
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        push(toNote(originalNoteId ?? event))
      }}
    >
      <div
        className={cn(
          'clickable transition-all duration-200',
          embedded
            ? cn('bg-card rounded-xl border', isCompact ? 'p-2 sm:p-3' : 'p-3 sm:p-4')
            : cn('hover:bg-accent/30', isCompact ? 'py-1.5' : 'py-3'),
          isNewlyArrived && 'animate-note-pulse'
        )}
      >
        <Collapsible alwaysExpand={embedded}>
          {pinned && <PinnedButton event={event} />}
          <RepostDescription className={embedded ? '' : 'px-4'} reposters={reposters} />
          <Note
            className={embedded ? '' : 'px-4'}
            size={embedded ? 'small' : 'normal'}
            event={event}
            originalNoteId={originalNoteId}
            actionBar={
              !embedded ? (
                <StuffStats className={isCompact ? 'mt-1' : 'mt-2'} stuff={event} />
              ) : undefined
            }
          />
        </Collapsible>
      </div>
      {!embedded && <Separator className="bg-border/30" />}
    </div>
  )
}

MainNoteCardImpl.displayName = 'MainNoteCard'

const MainNoteCard = memo(MainNoteCardImpl)
MainNoteCard.displayName = 'MainNoteCard'

export default MainNoteCard
