/** Single source of truth for "unread": newer than the read-floor AND not individually read. */
export function isNotificationUnread(
  event: { id: string; created_at: number },
  floor: number,
  readSet: Set<string>
): boolean {
  return event.created_at > floor && !readSet.has(event.id)
}

/**
 * Returns a NEW set with `id` added, FIFO-evicting the oldest entries when the
 * result would exceed `cap`. When `id` is already present this returns the SAME
 * set reference, so reactive callers can skip a no-op state update / persist.
 * Insertion order = Set iteration order, so the oldest inserted is evicted first.
 */
export function addCapped(set: Set<string>, id: string, cap: number): Set<string> {
  if (set.has(id)) return set
  const next = new Set(set)
  next.add(id)
  if (next.size <= cap) return next
  const overflow = next.size - cap
  const ids = [...next].slice(overflow)
  return new Set(ids)
}
