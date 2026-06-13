import { getEventKey, isInMutedThread, isMentioningMutedUsers } from '@/lib/event'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { NostrEvent } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useAllDescendantThreads } from './useThread'

export function useFilteredReplies(stuffKey: string) {
  const { pubkey } = useNostr()
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const allThreads = useAllDescendantThreads(stuffKey)
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    const replyKeySet = new Set<string>()
    const thread = allThreads.get(stuffKey) || []
    const filtered: NostrEvent[] = []

    for (const evt of thread) {
      const key = getEventKey(evt)
      if (replyKeySet.has(key)) continue
      replyKeySet.add(key)

      if (mutePubkeySet.has(evt.pubkey)) continue
      if (isInMutedThread(evt, muteEventIdSet)) continue
      if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet)) continue

      filtered.push(evt)
    }

    filtered.sort((a, b) => b.created_at - a.created_at)
    setReplies(filtered)
  }, [stuffKey, allThreads, mutePubkeySet, muteEventIdSet, hideContentMentioningMutedUsers])

  useEffect(() => {
    let replied = false
    for (const reply of replies) {
      if (reply.pubkey === pubkey) {
        replied = true
        break
      }
    }
    setHasReplied(replied)
  }, [replies, pubkey])

  return { replies, hasReplied }
}

export function useFilteredAllReplies(stuffKey: string) {
  const { pubkey } = useNostr()
  const allThreads = useAllDescendantThreads(stuffKey)
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    const replyKeySet = new Set<string>()
    const replyEvents: NostrEvent[] = []

    let parentKeys = [stuffKey]
    while (parentKeys.length > 0) {
      const events = parentKeys.flatMap((key) => allThreads.get(key) ?? [])
      for (const evt of events) {
        const key = getEventKey(evt)
        if (replyKeySet.has(key)) continue
        replyKeySet.add(key)

        if (mutePubkeySet.has(evt.pubkey)) continue
        if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet)) continue

        replyEvents.push(evt)
      }
      parentKeys = events.map((evt) => getEventKey(evt))
    }
    setReplies(replyEvents.sort((a, b) => a.created_at - b.created_at))
  }, [stuffKey, allThreads, mutePubkeySet, muteEventIdSet, hideContentMentioningMutedUsers])

  useEffect(() => {
    let replied = false
    for (const reply of replies) {
      if (reply.pubkey === pubkey) {
        replied = true
        break
      }
    }
    setHasReplied(replied)
  }, [replies, pubkey])

  return { replies, hasReplied }
}
