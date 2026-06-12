import { ExtendedKind } from '@/constants'
import { useStuff } from '@/hooks/useStuff'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import seenOnService from '@/services/caches/seen-on.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { TFeedSubRequest } from '@/types'
import { Event, Filter, kinds } from 'nostr-tools'
import { useEffect, useState } from 'react'
import NoteList from '../NoteList'

export default function QuoteList({
  stuff,
  onCountChange
}: {
  stuff: Event | string
  onCountChange?: (count: number) => void
}) {
  const { event, externalContent } = useStuff(stuff)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  useEffect(() => {
    let cancelled = false
    async function init() {
      const relaySet = new Set(getDefaultRelayUrls())
      const filters: Filter[] = []
      if (event) {
        const relayList = await relayListService.fetchRelayList(event.pubkey)
        relayList.read.slice(0, 5).forEach((url) => relaySet.add(url))
        const seenOn = seenOnService.getSeenEventRelayUrls(event.id)
        seenOn.forEach((url) => relaySet.add(url))

        const isReplaceable = isReplaceableEvent(event.kind)
        const key = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id
        filters.push({
          '#q': [key],
          kinds: [
            kinds.ShortTextNote,
            kinds.LongFormArticle,
            ExtendedKind.COMMENT,
            ExtendedKind.POLL
          ]
        })
        if (isReplaceable) {
          filters.push({
            '#a': [key],
            kinds: [kinds.Highlights]
          })
        } else {
          filters.push({
            '#e': [key],
            kinds: [kinds.Highlights]
          })
        }
      }
      if (externalContent) {
        filters.push({
          '#r': [externalContent],
          kinds: [kinds.Highlights]
        })
      }
      if (cancelled) return
      const urls = Array.from(relaySet)
      setSubRequests(filters.map((filter) => ({ urls, filter })))
    }

    init()
    return () => {
      cancelled = true
    }
  }, [event, externalContent])

  return <NoteList subRequests={subRequests} onFilteredCountChange={onCountChange} />
}
