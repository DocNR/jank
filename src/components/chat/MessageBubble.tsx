import { cn } from '@/lib/utils'
import type { ChatMessage } from './types'
import { bubbleAlignment } from './alignment'

type Props = {
  message: ChatMessage
  ownerPubkey: string
  /** Optional custom renderer for the OTHER party's message body (non-owner
   *  messages only). If provided, it replaces the default `dir="auto"` span for
   *  inbound messages — e.g. the agent drawer passes an `AgentMarkdown` renderer
   *  so markdown headings / lists / links render correctly. Owner messages always
   *  render as plain text regardless. DM columns omit it and get plain text. */
  renderBody?: (text: string) => React.ReactNode
}

/**
 * One chat row. Owner messages align to the end (right in LTR, flips under
 * RTL); the other party's messages align to the start. The body is
 * user-generated content, so the plain-text fallback carries `dir="auto"` to
 * let the bidi algorithm pick direction per message.
 *
 * If `renderBody` is supplied (e.g. an AgentMarkdown renderer), the bubble
 * body delegates to it; otherwise the text is rendered verbatim in a
 * `dir="auto"` span.
 */
export default function MessageBubble({ message, ownerPubkey, renderBody }: Props) {
  const align = bubbleAlignment(message.fromPubkey, ownerPubkey)
  const isOwner = align === 'end'

  return (
    <div className={cn('flex w-full', isOwner ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] select-text break-words rounded-2xl px-3 py-2 text-sm',
          isOwner
            ? 'bg-primary text-primary-foreground whitespace-pre-wrap rounded-ee-sm'
            : 'bg-muted text-foreground rounded-es-sm',
          message.pending && 'opacity-60'
        )}
      >
        {renderBody && !isOwner ? (
          renderBody(message.text)
        ) : (
          <span dir="auto" className="whitespace-pre-wrap">{message.text}</span>
        )}
      </div>
    </div>
  )
}
