import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from './types'
import MessageBubble from './MessageBubble'

type Props = {
  messages: ChatMessage[]
  ownerPubkey: string
  loading?: boolean
  /** Optional custom renderer forwarded to each {@link MessageBubble} for
   *  non-owner messages. The agent drawer passes an `AgentMarkdown` renderer;
   *  DM columns omit it and get plain text. */
  renderBody?: (text: string) => React.ReactNode
  /** Empty state copy. Defaults to the agent-drawer string so existing usages
   *  are unaffected; DM column passes a DM-appropriate string via i18n. */
  emptyText?: string
}

/**
 * Scrolling message list. Auto-scrolls to the newest message whenever the
 * message set grows (new send or inbound reply). No virtualization — agent
 * conversations are short and v1 has no persistence.
 */
export default function MessageThread({ messages, ownerPubkey, loading, renderBody, emptyText }: Props) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {loading && messages.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t('Loading conversation…')}
        </div>
      ) : messages.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {emptyText ?? t('No messages yet. Say hello to your agent.')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} ownerPubkey={ownerPubkey} renderBody={renderBody} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
