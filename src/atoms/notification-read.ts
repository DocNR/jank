import storage from '@/services/local-storage.service'
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

/** Cap on individually-read ids kept per pubkey (see addCapped). */
export const READ_NOTIFICATIONS_CAP = 1000

/**
 * Reactive, persisted per-pubkey set of individually-read notification ids.
 * Initial value hydrates from localStorage; writes go through
 * useReadNotifications (which also persists). Bounded via addCapped.
 *
 * atomFamily caches by pubkey — pubkey count is bounded (paired accounts +
 * a few view-as), so no leak. TESTS must call
 * readNotificationsAtomFamily.remove(pubkey) in teardown to avoid cross-test
 * state bleed.
 */
export const readNotificationsAtomFamily = atomFamily((pubkey: string) =>
  atom<Set<string>>(new Set(storage.getReadNotifications(pubkey)))
)
