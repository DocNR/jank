import type { ReleaseNote } from '@/release-notes'

const MAX_ENTRIES = 5

export type UnseenReleaseNotes = {
  notes: ReleaseNote[]
  truncated: boolean
}

/**
 * Order is defined by array POSITION (newest-first), never by parsing versions.
 * - lastSeen null (first run) => nothing
 * - lastSeen === current => nothing
 * - no entry whose version === current => nothing (fail-silent)
 * - lastSeen found => every entry above it (newer)
 * - lastSeen NOT found => newest entry only
 * Capped at MAX_ENTRIES, `truncated` set when entries were dropped.
 */
export function getUnseenReleaseNotes(
  lastSeen: string | null,
  current: string,
  notes: ReleaseNote[]
): UnseenReleaseNotes {
  const empty: UnseenReleaseNotes = { notes: [], truncated: false }
  if (!lastSeen || lastSeen === current) return empty
  if (!notes.some((n) => n.version === current)) return empty
  const lastSeenIndex = notes.findIndex((n) => n.version === lastSeen)
  const collected = lastSeenIndex === -1 ? notes.slice(0, 1) : notes.slice(0, lastSeenIndex)
  return {
    notes: collected.slice(0, MAX_ENTRIES),
    truncated: collected.length > MAX_ENTRIES
  }
}
