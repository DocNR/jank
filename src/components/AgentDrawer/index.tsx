import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { agentDrawerOpenAtom } from '@/atoms/active-column'
import { useNostr } from '@/providers/NostrProvider'
import { usePairedAgents } from '@/hooks/usePairedAgents'
import { createChatSubstrate, type ChatMessage } from '@/services/chat-substrate'
import client from '@/services/client.service'
import type { TPairedAgent } from '@/types/column'
import { useAtom } from 'jotai'
import { nip19 } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ChatInput from '@/components/chat/ChatInput'
import MessageThread from '@/components/chat/MessageThread'
import { isViewOnlyAccount } from './chat-view-helpers'
import AgentMarkdown from './AgentMarkdown'

/** Decode an agent's chat npub to hex; null if absent or malformed. */
function chatHexOf(agent: TPairedAgent | undefined): string | null {
  if (!agent?.agentChatNpub) return null
  try {
    const decoded = nip19.decode(agent.agentChatNpub)
    return decoded.type === 'npub' ? (decoded.data as string) : null
  } catch {
    return null
  }
}

/** The first paired agent that exposes a chat npub. v1 chats with a single agent. */
export function useChatAgent(ownerPubkey: string | null | undefined): TPairedAgent | undefined {
  const agents = usePairedAgents(ownerPubkey)
  return useMemo(() => agents.find((a) => !!chatHexOf(a)), [agents])
}

/**
 * Track B in-app agent chat drawer (v1-A): a right-side slide-out over the deck
 * for plaintext NIP-04 DMs between the active workspace owner and its single
 * paired chat agent. History is re-fetched from relays on open; nothing is
 * persisted locally. Backed by the {@link ChatSubstrate} seam so a Clave /
 * NIP-17 backend can swap in later.
 */
export default function AgentDrawer() {
  const { t } = useTranslation()
  const { pubkey: ownerPubkey, account } = useNostr()
  const [open, setOpen] = useAtom(agentDrawerOpenAtom)

  const chatAgent = useChatAgent(ownerPubkey)
  const agentHex = chatHexOf(chatAgent)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const hasSigner = !!ownerPubkey && !!client.getSignerFor(ownerPubkey)
  // A watch-only (npub) account has a registered signer object, but it cannot
  // encrypt/sign — treat it as view-only so the input disables cleanly instead
  // of failing on send.
  const viewOnly = isViewOnlyAccount(account?.signerType)

  // One substrate per owner. Recreated only when the active account changes.
  const substrate = useMemo(
    () => (ownerPubkey ? createChatSubstrate(ownerPubkey) : null),
    [ownerPubkey]
  )

  const upsert = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) return prev
      return [...prev, incoming].sort((a, b) => a.createdAt - b.createdAt)
    })
  }, [])

  // On open: backfill history + open a live subscription. Cleanup on close /
  // agent change unsubscribes.
  useEffect(() => {
    if (!open || !substrate || !agentHex) return
    let active = true
    setLoading(true)
    setMessages([])

    substrate
      .fetchHistory(agentHex, { limit: 100 })
      .then((history) => {
        if (active) setMessages(history)
      })
      .catch(() => {
        if (active) toast.error(t('Could not load conversation'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const unsub = substrate.subscribeMessages(agentHex, (m) => {
      if (active) upsert(m)
    })

    return () => {
      active = false
      unsub()
    }
  }, [open, substrate, agentHex, upsert, t])

  const tempIdRef = useRef(0)

  const handleSend = useCallback(
    async (text: string) => {
      if (!substrate || !agentHex || !ownerPubkey) return
      const tempId = `pending-${tempIdRef.current++}`
      const optimistic: ChatMessage = {
        id: tempId,
        fromPubkey: ownerPubkey,
        text,
        createdAt: Math.floor(Date.now() / 1000),
        pending: true
      }
      setMessages((prev) => [...prev, optimistic])
      setSending(true)
      try {
        await substrate.sendMessage(agentHex, text)
        // Sent messages don't echo back through the inbound subscription, so
        // keep the optimistic bubble and just clear its pending flag.
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false } : m))
        )
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        toast.error(t('Message failed to send'))
      } finally {
        setSending(false)
      }
    },
    [substrate, agentHex, ownerPubkey, t]
  )

  // Defensive: if the active account loses its chat agent while open, close.
  useEffect(() => {
    if (open && !agentHex) setOpen(false)
  }, [open, agentHex, setOpen])

  const agentName =
    chatAgent?.name || (chatAgent ? `agent-${chatAgent.npub.slice(5, 13)}` : t('Agent'))

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        hideClose
      >
        <div className="flex items-center gap-3 border-b p-4">
          {agentHex && <SimpleUserAvatar userId={agentHex} size="small" />}
          <div className="min-w-0">
            <div className="truncate font-semibold" dir="auto">
              {agentName}
            </div>
            <div className="text-muted-foreground text-xs">{t('Agent chat')}</div>
          </div>
        </div>
        <MessageThread
          messages={messages}
          ownerPubkey={ownerPubkey ?? ''}
          loading={loading}
          renderBody={(text) => <AgentMarkdown content={text} />}
        />
        <ChatInput
          viewOnly={viewOnly}
          hasSigner={hasSigner}
          sending={sending}
          onSend={handleSend}
        />
      </SheetContent>
    </Sheet>
  )
}
