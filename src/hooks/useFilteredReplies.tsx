import { getEventKey, getThreadRootId, isInMutedThread, isMentioningMutedUsers } from '@/lib/event'
import { TRUST_SCORE_FILTER_ID } from '@/constants'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { useMutedThreadReveal } from '@/providers/MutedThreadRevealProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { NostrEvent } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useAllDescendantThreads } from './useThread'

export function useFilteredReplies(stuffKey: string) {
  const { pubkey } = useNostr()
  const { mutePubkeySet, muteEventIdSet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const { revealed: revealedMutedThreads } = useMutedThreadReveal()
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  // The thread view's shield badge sets this slot (TRUST_SCORE_FILTER_ID.
  // THREAD_REPLIES). 0 = off.
  const trustThreshold = getMinTrustScore(TRUST_SCORE_FILTER_ID.THREAD_REPLIES)
  const allThreads = useAllDescendantThreads(stuffKey)
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const replyKeySet = new Set<string>()
      const thread = allThreads.get(stuffKey) || []
      const filtered: NostrEvent[] = []

      for (const evt of thread) {
        const key = getEventKey(evt)
        if (replyKeySet.has(key)) continue
        replyKeySet.add(key)

        if (mutePubkeySet.has(evt.pubkey)) continue
        if (isInMutedThread(evt, muteEventIdSet) && !revealedMutedThreads.has(getThreadRootId(evt)))
          continue
        if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet)) continue

        filtered.push(evt)
      }

      let out = filtered
      if (trustThreshold > 0) {
        const keep = await Promise.all(
          filtered.map((evt) => meetsMinTrustScore(evt.pubkey, trustThreshold))
        )
        out = filtered.filter((_, i) => keep[i])
      }

      if (cancelled) return
      out.sort((a, b) => b.created_at - a.created_at)
      setReplies(out)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [
    stuffKey,
    allThreads,
    mutePubkeySet,
    muteEventIdSet,
    revealedMutedThreads,
    hideContentMentioningMutedUsers,
    trustThreshold,
    meetsMinTrustScore
  ])

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
  const { revealed: revealedMutedThreads } = useMutedThreadReveal()
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  const trustThreshold = getMinTrustScore(TRUST_SCORE_FILTER_ID.THREAD_REPLIES)
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
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
          if (
            isInMutedThread(evt, muteEventIdSet) &&
            !revealedMutedThreads.has(getThreadRootId(evt))
          )
            continue
          if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet))
            continue

          replyEvents.push(evt)
        }
        parentKeys = events.map((evt) => getEventKey(evt))
      }

      let out = replyEvents
      if (trustThreshold > 0) {
        const keep = await Promise.all(
          replyEvents.map((evt) => meetsMinTrustScore(evt.pubkey, trustThreshold))
        )
        out = replyEvents.filter((_, i) => keep[i])
      }

      if (cancelled) return
      out.sort((a, b) => a.created_at - b.created_at)
      setReplies(out)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [
    stuffKey,
    allThreads,
    mutePubkeySet,
    muteEventIdSet,
    revealedMutedThreads,
    hideContentMentioningMutedUsers,
    trustThreshold,
    meetsMinTrustScore
  ])

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
