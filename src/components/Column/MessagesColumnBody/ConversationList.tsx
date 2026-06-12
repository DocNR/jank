import type { Conversation } from '@/services/nip17/conversations'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import { useTranslation } from 'react-i18next'

type Props = {
  conversations: Conversation[]
  decryptingCount: number
  onOpen: (counterparty: string) => void
  onLoadOlder: () => void
  onCompose: () => void
}

export default function ConversationList({ conversations, decryptingCount, onOpen, onLoadOlder, onCompose }: Props) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col">
      {/* New message button */}
      <div className="flex justify-end px-2 pt-2">
        <button
          className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={onCompose}
        >
          {t('New message')}
        </button>
      </div>
      {decryptingCount > 0 && (
        <div className="p-2 text-xs text-muted-foreground" role="status">
          {t('Decrypting {{count}} messages…', { count: decryptingCount })}
        </div>
      )}
      <div className="px-2 pb-1 text-xs text-muted-foreground">
        {t('Showing the last ~30 days')}
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.map((c) => (
          <button
            key={c.counterparty}
            className="flex w-full items-center gap-2 p-2 hover:bg-muted"
            onClick={() => onOpen(c.counterparty)}
          >
            <SimpleUserAvatar userId={c.counterparty} size="medium" />
            <div className="min-w-0 flex-1 text-start">
              <SimpleUsername
                userId={c.counterparty}
                className="truncate text-sm font-medium"
                withoutSkeleton
              />
              <div className="truncate text-xs text-muted-foreground" dir="auto">
                {c.lastMessage.content}
              </div>
            </div>
            {c.unread > 0 && (
              <span className="shrink-0 rounded-full bg-primary px-2 text-xs text-primary-foreground">
                {c.unread}
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        className="p-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onLoadOlder}
      >
        {t('Load older')}
      </button>
    </div>
  )
}
