import { agentDrawerOpenAtom } from '@/atoms/active-column'
import { Button } from '@/components/ui/button'
import { useChatAgent } from '@/components/AgentDrawer'
import { useNostr } from '@/providers/NostrProvider'
import { useAtom } from 'jotai'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Toggles the Track B agent chat drawer. Hidden unless the active workspace has
 * a paired agent that exposes a chat npub — existing paired agents without one
 * show no chat surface.
 */
export default function AgentChatButton() {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const chatAgent = useChatAgent(pubkey)
  const [open, setOpen] = useAtom(agentDrawerOpenAtom)

  if (!chatAgent) return null

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10"
      onClick={() => setOpen((v) => !v)}
      aria-label={t('Agent chat')}
      aria-pressed={open}
    >
      <Bot className="size-5" />
    </Button>
  )
}
