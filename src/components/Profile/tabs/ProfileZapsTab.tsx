import { ZapNotification } from '@/components/NotificationList/NotificationItem/ZapNotification'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import timelineCache from '@/services/caches/timeline-cache.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { Loader } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const LIMIT = 100

export default function ProfileZapsTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const scope = useAccountScopeOptional()
  const [zaps, setZaps] = useState<Event[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const initialLoadedRef = useRef(false)

  // Subscribe to zap receipts (kind 9735) where #p is this profile — i.e. zaps
  // RECEIVED. Mirrors ProfileMediaTab's wiring: async init() returns the closer,
  // cleanup via promise.then(closer => closer()).
  useEffect(() => {
    setZaps([])
    setInitialLoading(true)
    initialLoadedRef.current = false

    const init = async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      // Zaps are published to the recipient's READ relays so they reach them.
      const urls = relayList.read.concat(getDefaultRelayUrls()).slice(0, 8)

      const { closer } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { kinds: [kinds.Zap], '#p': [pubkey], limit: LIMIT } }],
        {
          onEvents: (newEvents, eosed) => {
            // Only apply the full-replace merged timeline during the INITIAL load.
            if (initialLoadedRef.current) return
            if (newEvents.length > 0) setZaps(newEvents)
            if (eosed) {
              initialLoadedRef.current = true
              setInitialLoading(false)
            }
          },
          onNew: (event) => {
            setZaps((prev) =>
              prev.some((e) => e.id === event.id)
                ? prev
                : [event, ...prev].sort((a, b) => b.created_at - a.created_at)
            )
          }
        },
        { needSaveToDb: false, authPubkey: scope?.signingIdentity ?? undefined }
      )
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer())
    }
  }, [pubkey, scope?.signingIdentity])

  // min-height on every state keeps the column body from collapsing on tab
  // switch (see ProfileMediaTab for the full rationale).
  if (initialLoading && zaps.length === 0) {
    return (
      <div className="flex min-h-screen justify-center p-8">
        <Loader className="animate-spin" />
      </div>
    )
  }

  if (!initialLoading && zaps.length === 0) {
    return (
      <div className="text-muted-foreground min-h-screen p-8 text-center">{t('No zaps yet')}</div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      {zaps.map((zap) => (
        <ZapNotification key={zap.id} notification={zap} perspective="other" />
      ))}
    </div>
  )
}
