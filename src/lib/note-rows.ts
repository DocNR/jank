import { Event, kinds } from 'nostr-tools'
import { getEventKey, getKeyFromTag, isReplyNoteEvent } from './event'
import { tagNameEquals } from './tag'

export type TNoteRow = { key: string; event: Event; reposters: string[] }

/**
 * Builds the renderable note rows for a feed from a (newest-first) event list.
 *
 * This is the single source of truth for "which events become rows": key-based
 * dedup, visibility filters, and repost collapsing (a kind-6/16 repost renders
 * as its target's row, accumulating reposters, instead of as its own row).
 * NoteList uses it both to render the feed and to count what a buffered batch
 * of new events would actually add — keeping the "Show n new notes" pill in
 * agreement with what clicking it reveals.
 *
 * Spam filtering (async, per-pubkey) is intentionally not handled here; callers
 * that need it filter the returned rows.
 */
export function buildNoteRows(
  events: Event[],
  {
    hideReplies = false,
    shouldHideEvent
  }: {
    hideReplies?: boolean
    shouldHideEvent?: (evt: Event) => boolean
  } = {}
): TNoteRow[] {
  const keySet = new Set<string>()
  const repostersMap = new Map<string, Set<string>>()
  const rows: { key: string; event: Event }[] = []

  events.forEach((evt) => {
    const key = getEventKey(evt)
    if (keySet.has(key)) return
    keySet.add(key)

    if (shouldHideEvent?.(evt)) return
    if (hideReplies && isReplyNoteEvent(evt)) return
    if (evt.kind !== kinds.Repost && evt.kind !== kinds.GenericRepost) {
      rows.push({ key, event: evt })
      return
    }

    let targetEventKey: string | undefined
    const targetTag = evt.tags.find(tagNameEquals('a')) ?? evt.tags.find(tagNameEquals('e'))
    if (targetTag) {
      targetEventKey = getKeyFromTag(targetTag)
    } else if (evt.content) {
      // Attempt to extract the target event from the repost content
      let eventFromContent: Event | null = null
      try {
        eventFromContent = JSON.parse(evt.content) as Event
      } catch {
        eventFromContent = null
      }
      if (eventFromContent) {
        if (
          eventFromContent.kind === kinds.Repost ||
          eventFromContent.kind === kinds.GenericRepost
        ) {
          return
        }
        targetEventKey = getEventKey(eventFromContent)
      }
    }
    if (!targetEventKey) return

    const reposters = repostersMap.get(targetEventKey)
    if (reposters) {
      reposters.add(evt.pubkey)
    } else {
      repostersMap.set(targetEventKey, new Set([evt.pubkey]))
    }

    // If the target event is not already listed, the repost stands in for it
    if (!keySet.has(targetEventKey)) {
      rows.push({ key: targetEventKey, event: evt })
      keySet.add(targetEventKey)
    }
  })

  return rows.map(({ key, event }) => ({
    key,
    event,
    reposters: Array.from(repostersMap.get(key) ?? [])
  }))
}
