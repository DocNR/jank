import { useAccountScope } from '@/providers/AccountScope'
import dmInboxServices, { type DmInboxServiceInstance } from '@/services/dm-inbox.service'
import client from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import ConversationList from './ConversationList'
import ComposeDialog from './ComposeDialog'
import DmRelaySetup from './DmRelaySetup'
import MessageThread from '@/components/chat/MessageThread'
import ChatInput from '@/components/chat/ChatInput'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import type { ChatMessage } from '@/components/chat/types'
import type { DmMessage } from '@/services/nip17/conversations'

/**
 * Messages column body — master ⇄ detail DM inbox backed by DmInboxService.
 *
 * List view: shows all conversations (ConversationList).
 * Thread view: shows messages with a specific counterparty (MessageThread + ChatInput).
 *
 * DMs render as PLAIN TEXT — no renderBody prop passed to MessageThread.
 */
export default function MessagesColumnBody() {
  const { t } = useTranslation()
  const { signingIdentity, account, viewOnly, ready } = useAccountScope()

  // Stable owner symbol — one per mount, not recreated on re-render.
  const ownerRef = useRef<symbol>(Symbol('MessagesColumn'))

  const [openWith, setOpenWith] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // own-10050 gate: 'loading' → check in progress, 'none' → no list yet, 'ready' → has relays.
  const [ownRelaysState, setOwnRelaysState] = useState<'loading' | 'none' | 'ready'>('loading')
  const [defaultWriteRelays, setDefaultWriteRelays] = useState<string[]>([])

  // Acquire/release the per-account DmInboxService instance (refcounted).
  // Acquire and release are in the SAME effect, keyed ONLY on signingIdentity,
  // so a signerType change (undefined → 'bunker') does NOT dispose the instance.
  const [service, setService] = useState<DmInboxServiceInstance | null>(null)
  useEffect(() => {
    if (!signingIdentity) {
      setService(null)
      return
    }
    const owner = ownerRef.current
    const svc = dmInboxServices.get(signingIdentity, owner)
    setService(svc)

    // Check own kind-10050 and load write relays for the setup default.
    setOwnRelaysState('loading')
    void Promise.all([
      svc.getOwnDmRelays(),
      relayListService.fetchRelayList(signingIdentity)
    ]).then(([ownRelays, relayList]) => {
      setDefaultWriteRelays(relayList.write)
      setOwnRelaysState(ownRelays.length > 0 ? 'ready' : 'none')
    })

    return () => {
      dmInboxServices.release(signingIdentity, owner)
      setService(null)
    }
  }, [signingIdentity])

  // Start once the account is ready (so signerType is known). start() is idempotent.
  useEffect(() => {
    if (!service || !signingIdentity || !ready) return
    const signer = client.getSignerFor(signingIdentity)
    if (signer) void service.start(signingIdentity, signer, account?.signerType)
  }, [service, signingIdentity, ready, account?.signerType])

  // Subscribe to service updates (new/decrypted messages, slow-signer flags, etc.)
  // via useSyncExternalStore. Use a monotonic version counter so any emit() triggers
  // a re-render — avoids the lossy-hash problem where a new message in an existing
  // conversation doesn't change the hash.
  const _version = useSyncExternalStore(
    (cb) => (service ? service.subscribe(cb) : () => {}),
    () => (service ? service.version : 0)
  )
  void _version

  // Graceful empty state when there is no signing account.
  if (viewOnly || !signingIdentity || !service) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t('Private messages need a signing account')}
      </div>
    )
  }

  // While checking own 10050, show a loading indicator.
  if (ownRelaysState === 'loading') {
    return (
      <div className="p-4 text-sm text-muted-foreground" role="status">
        {t('Loading…')}
      </div>
    )
  }

  // No kind-10050 yet — prompt the user to set one up.
  if (ownRelaysState === 'none') {
    return (
      <DmRelaySetup
        defaultRelays={defaultWriteRelays}
        onDone={(_publishedRelays) => {
          // Optimistically advance — we just published, so the account IS ready.
          setOwnRelaysState('ready')
        }}
      />
    )
  }

  // Derive conversation list and current thread.
  const conversations = service.getConversations(signingIdentity)
  const thread: DmMessage[] = openWith ? service.getThread(openWith) : []
  const chatMessages: ChatMessage[] = thread.map((m) => ({
    id: m.wrapId,
    fromPubkey: m.fromPubkey,
    text: m.content,
    createdAt: m.createdAt
  }))

  const handleSend = async (text: string) => {
    if (!openWith) return
    const signer = client.getSignerFor(signingIdentity)
    if (!signer) return
    setSendError(null)
    setSending(true)
    try {
      await service.send(openWith, text, signer, account?.signerType)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'recipient-not-ready') {
        setSendError(t("This user hasn't enabled private DMs"))
      }
      // Re-throw non-readiness errors so callers can see them.
      if (code !== 'recipient-not-ready') throw err
    } finally {
      setSending(false)
    }
  }

  // Thread (detail) view.
  if (openWith) {
    return (
      <div className="flex h-full flex-col">
        {/* Counterparty header: back + avatar + name so you know who the thread is with. */}
        <div className="flex items-center gap-2 border-b p-2">
          <button
            aria-label={t('Back')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setOpenWith(null)}
          >
            <span className="inline-block text-lg rtl:-scale-x-100">‹</span>
          </button>
          <SimpleUserAvatar userId={openWith} size="small" />
          <SimpleUsername
            userId={openWith}
            showAt
            className="min-w-0 flex-1 truncate text-sm font-semibold"
          />
        </div>
        {/* No renderBody — DMs are always plain text */}
        <MessageThread
          messages={chatMessages}
          ownerPubkey={signingIdentity}
          emptyText={t('No messages yet')}
        />

        {/* Step 3: approval-required notice — signer needs manual approval for each decrypt */}
        {service.approvalLikelyRequired && (
          <div className="mx-2 mb-1 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground" role="status">
            {t('Allow private-message decryption in your signer, or raise its trust level')}
          </div>
        )}

        {/* Step 2: adaptive Clave foreground prompt — remote signer is slow but responding */}
        {!service.approvalLikelyRequired && service.slowRemoteSigner && service.decryptingCount > 0 && (
          <div className="mx-2 mb-1 rounded border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground" role="status">
            {t('Open Clave and keep it in the foreground for much faster decryption')}
          </div>
        )}

        {/* Step 1: recipient-not-ready send error */}
        {sendError && (
          <div className="mx-2 mb-1 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {sendError}
          </div>
        )}

        <ChatInput
          viewOnly={false}
          hasSigner
          onSend={handleSend}
          sending={sending}
          placeholder={t('Write a message…')}
          disabledText={t('Private messages need a signing account')}
        />
      </div>
    )
  }

  // Compose / user-picker view.
  if (composing) {
    return (
      <ComposeDialog
        onPick={(pubkey) => {
          setComposing(false)
          service.markRead(pubkey)
          setOpenWith(pubkey)
        }}
        onClose={() => setComposing(false)}
      />
    )
  }

  // Conversation list (master) view.
  return (
    <ConversationList
      conversations={conversations}
      decryptingCount={service.decryptingCount}
      onOpen={(cp) => {
        service.markRead(cp)
        setOpenWith(cp)
      }}
      onLoadOlder={() => {
        const signer = client.getSignerFor(signingIdentity)
        if (signer) void service.loadOlder(signingIdentity, signer, account?.signerType)
      }}
      onCompose={() => setComposing(true)}
    />
  )
}
