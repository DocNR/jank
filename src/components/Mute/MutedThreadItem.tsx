import ContentPreview from '@/components/ContentPreview'
import { Button } from '@/components/ui/button'
import { useSecondaryPage } from '@/DeckManager'
import { useFetchEvent } from '@/hooks'
import { toNote } from '@/lib/link'
import { useMuteList } from '@/providers/UserListsProvider'
import { Loader } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function MutedThreadItem({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { changing, unmuteThread } = useMuteList()
  const { event } = useFetchEvent(eventId)
  const [removing, setRemoving] = useState(false)

  return (
    <div
      className="hover:bg-accent/30 -mx-2 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5"
      onClick={() => push(toNote(event ?? eventId))}
    >
      <div className="w-full overflow-hidden">
        <ContentPreview event={event} className="line-clamp-3" />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        disabled={changing || removing}
        onClick={(e) => {
          e.stopPropagation()
          setRemoving(true)
          unmuteThread(eventId).finally(() => setRemoving(false))
        }}
      >
        {removing ? <Loader className="animate-spin" /> : t('Unmute')}
      </Button>
    </div>
  )
}
