import { useFilteredAllReplies } from '@/hooks'
import { useSigningContext } from '@/hooks/useSigningContext'
import { useStuff } from '@/hooks/useStuff'
import { cn } from '@/lib/utils'
import { MessageCircle } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostEditor from '../PostEditor/LazyPostEditor'
import { formatCount } from './utils'

export default function ReplyButton({ stuff }: { stuff: Event | string }) {
  const { t } = useTranslation()
  // Replies sign as the column's signingIdentity when inside a column scope.
  const { signerPubkey, checkLogin } = useSigningContext()
  const { stuffKey } = useStuff(stuff)
  const { replies, hasReplied } = useFilteredAllReplies(stuffKey)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className={cn(
          'flex h-full cursor-pointer items-center gap-1 pe-3 enabled:hover:text-blue-400',
          hasReplied ? 'text-blue-400' : 'text-muted-foreground'
        )}
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        title={t('Reply')}
      >
        <MessageCircle />
        {!!replies.length && <div className="text-sm">{formatCount(replies.length)}</div>}
      </button>
      <PostEditor
        parentStuff={stuff}
        open={open}
        setOpen={setOpen}
        accountId={signerPubkey ?? undefined}
      />
    </>
  )
}
