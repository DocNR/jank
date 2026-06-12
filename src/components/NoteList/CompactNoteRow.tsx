import { useSecondaryPage } from '@/DeckManager'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Event } from 'nostr-tools'
import ContentPreview from '../ContentPreview'
import { FormattedTimestamp } from '../FormattedTimestamp'
import UserAvatar from '../UserAvatar'

/**
 * One-line note row for `NoteList`'s compact list style — avatar + a single
 * line of content + timestamp; clicking opens the note. Same grammar as
 * `BookmarkList`'s compact row and the compact notification row.
 */
export default function CompactNoteRow({ event }: { event: Event }) {
  const { push } = useSecondaryPage()
  const { density } = useUserPreferences()
  const isCompactDensity = density === 'compact'
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 px-4',
        isCompactDensity ? 'py-1 text-[14.5px]' : 'py-2'
      )}
      onClick={(e) => {
        e.stopPropagation()
        push(toNote(event))
      }}
    >
      <UserAvatar userId={event.pubkey} size="small" />
      <ContentPreview className="text-muted-foreground w-0 flex-1 truncate" event={event} />
      <FormattedTimestamp
        timestamp={event.created_at}
        className="text-muted-foreground shrink-0 text-sm"
        short
      />
    </div>
  )
}
