import { useStuff } from '@/hooks/useStuff'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { useBookmarkList, useBookmarks } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { BookmarkIcon, Loader } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function BookmarkButton({ stuff }: { stuff: Event | string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { bookmarkedEventKeySet } = useBookmarkList()
  const { addBookmark, removeBookmark } = useBookmarks()
  const [updating, setUpdating] = useState(false)
  const { event } = useStuff(stuff)
  const isBookmarked = useMemo(() => {
    if (!event) return false
    const isReplaceable = isReplaceableEvent(event.kind)
    const eventKey = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id
    return bookmarkedEventKeySet.has(eventKey)
  }, [bookmarkedEventKeySet, event])

  if (!accountPubkey) return null

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (isBookmarked || !event) return

      setUpdating(true)
      await addBookmark(event)
      setUpdating(false)
    })
  }

  const handleRemoveBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (!isBookmarked || !event) return

      setUpdating(true)
      await removeBookmark(event)
      setUpdating(false)
    })
  }

  return (
    <button
      className={`flex cursor-pointer items-center gap-1 ${
        isBookmarked ? 'text-orange-400' : 'text-muted-foreground'
      } disabled:text-muted-foreground/40 h-full px-3 enabled:hover:text-orange-400 disabled:cursor-default`}
      onClick={isBookmarked ? handleRemoveBookmark : handleBookmark}
      disabled={!event || updating}
      title={isBookmarked ? t('Remove bookmark') : t('Bookmark')}
    >
      {updating ? (
        <Loader className="animate-spin" />
      ) : (
        <BookmarkIcon className={isBookmarked ? 'fill-orange-400' : ''} />
      )}
    </button>
  )
}
