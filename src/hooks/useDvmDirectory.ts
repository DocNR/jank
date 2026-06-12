import { getDefaultRelayUrls } from '@/lib/relay'
import {
  DVM_CONTENT_DISCOVERY_JOB_KIND,
  NIP89_HANDLER_KIND,
  parseContentDvmHandler,
  TDvmHandler
} from '@/lib/dvm'
import client from '@/services/client.service'
import { useEffect, useMemo, useState } from 'react'

/**
 * Subscribes to NIP-89 Handler Information events that advertise NIP-90
 * content-discovery (kind 5300) support. Dedupes on `pubkey:identifier`
 * (NIP-89 is parameterized-replaceable so the latest by `created_at` wins),
 * returns the list sorted by recency.
 *
 * Shared between the DvmDiscoverColumnBody directory view and the
 * AddColumnModal DvmPicker — both need the same data.
 */
export function useDvmDirectory(): { handlers: TDvmHandler[]; eosed: boolean } {
  const [handlers, setHandlers] = useState<Map<string, TDvmHandler>>(() => new Map())
  const [eosed, setEosed] = useState(false)

  useEffect(() => {
    setHandlers(new Map())
    setEosed(false)
    const urls = getDefaultRelayUrls()
    const sub = client.subscribe(
      urls,
      {
        kinds: [NIP89_HANDLER_KIND],
        '#k': [String(DVM_CONTENT_DISCOVERY_JOB_KIND)]
      },
      {
        onevent: (evt) => {
          const handler = parseContentDvmHandler(evt)
          if (!handler) return
          setHandlers((prev) => {
            const key = `${handler.pubkey}:${handler.identifier}`
            const existing = prev.get(key)
            if (existing && existing.event.created_at >= handler.event.created_at) {
              return prev
            }
            const next = new Map(prev)
            next.set(key, handler)
            return next
          })
        },
        oneose: (allEosed) => {
          if (allEosed) setEosed(true)
        }
      }
    )
    return () => sub.close()
  }, [])

  const sorted = useMemo(
    () => Array.from(handlers.values()).sort((a, b) => b.event.created_at - a.event.created_at),
    [handlers]
  )

  return { handlers: sorted, eosed }
}
