import Note from '@/components/Note'
import { useFetchEvent } from '@/hooks'
import { getParentETag } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import timelineCache from '@/services/caches/timeline-cache.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { Loader } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const LIMIT = 100

// Renders one reaction row: resolves the target note referenced by the kind-7
// event and renders it with the reaction emoji/`+` shown above.
function ReactionRow({ reaction }: { reaction: Event }) {
  // getParentETag returns undefined for kind-7 (it only handles comments/notes),
  // so this falls back to the reaction's last e-tag — the conventional target.
  const targetTag = getParentETag(reaction) ?? reaction.tags.filter((tag) => tag[0] === 'e').pop()
  const targetId = targetTag?.[1]
  const { event: target } = useFetchEvent(targetId)
  if (!targetId || !target) return null
  const emoji = reaction.content === '+' || reaction.content === '' ? '❤️' : reaction.content
  return (
    <div className="border-b">
      <div className="text-muted-foreground px-4 pt-2 text-sm">{emoji}</div>
      <Note event={target} />
    </div>
  )
}

export default function ProfileReactionsTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const scope = useAccountScopeOptional()
  const [reactions, setReactions] = useState<Event[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const initialLoadedRef = useRef(false)

  // Subscribe to reactions (kind 7) AUTHORED by this profile. Mirrors
  // ProfileZapsTab's wiring: async init() returns the closer, cleanup via
  // promise.then(closer => closer()).
  useEffect(() => {
    setReactions([])
    setInitialLoading(true)
    initialLoadedRef.current = false

    const init = async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      // The author publishes their reactions to their WRITE relays.
      const urls = relayList.write.concat(getDefaultRelayUrls()).slice(0, 8)

      const { closer } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { kinds: [kinds.Reaction], authors: [pubkey], limit: LIMIT } }],
        {
          onEvents: (newEvents, eosed) => {
            // Only apply the full-replace merged timeline during the INITIAL load.
            if (initialLoadedRef.current) return
            if (newEvents.length > 0) setReactions(newEvents)
            if (eosed) {
              initialLoadedRef.current = true
              setInitialLoading(false)
            }
          },
          onNew: (event) => {
            setReactions((prev) =>
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
  if (initialLoading && reactions.length === 0) {
    return (
      <div className="flex min-h-screen justify-center p-8">
        <Loader className="animate-spin" />
      </div>
    )
  }

  if (!initialLoading && reactions.length === 0) {
    return (
      <div className="text-muted-foreground min-h-screen p-8 text-center">
        {t('No reactions yet')}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      {reactions.map((reaction) => (
        <ReactionRow key={reaction.id} reaction={reaction} />
      ))}
    </div>
  )
}
