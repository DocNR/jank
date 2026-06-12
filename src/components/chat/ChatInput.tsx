import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SendHorizontal } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isChatInputDisabled } from './alignment'

type Props = {
  viewOnly: boolean
  hasSigner: boolean
  sending?: boolean
  onSend: (text: string) => void
  /** Active placeholder text. Defaults to the agent-drawer string so existing
   *  usages are unaffected; DM column passes a DM-appropriate string via i18n. */
  placeholder?: string
  /** Placeholder shown when the input is disabled. Defaults to the agent-drawer
   *  string; DM column passes a DM-appropriate string via i18n. */
  disabledText?: string
}

/**
 * Chat composer. Enter sends; Shift+Enter inserts a newline. Disabled when the
 * column is view-only or has no signer (see {@link isChatInputDisabled}).
 */
export default function ChatInput({ viewOnly, hasSigner, sending, onSend, placeholder, disabledText }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const disabled = isChatInputDisabled({ viewOnly, hasSigner })

  // Auto-grow the composer with its content: reset to content height each
  // change, then let the min-h/max-h CSS clamp it (it scrolls past the max).
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || sending) return
    onSend(trimmed)
    setText('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={
            disabled
              ? (disabledText ?? t('Sign in to chat with your agent'))
              : (placeholder ?? t('Message your agent…'))
          }
          className="max-h-32 min-h-9 resize-none overflow-y-auto"
        />
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={disabled || sending || text.trim().length === 0}
          aria-label={t('Send')}
        >
          <SendHorizontal className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
      </div>
    </div>
  )
}
