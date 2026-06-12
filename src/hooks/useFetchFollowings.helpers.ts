import { getPubkeysFromPTags } from '@/lib/tag'
import { Event as NEvent } from 'nostr-tools'

/** Pure projection of a kind-3 follow list event into the hook's return shape. */
export function deriveFollowings(event: NEvent | undefined): {
  followListEvent: NEvent | null
  followings: string[]
} {
  return {
    followListEvent: event ?? null,
    followings: event ? getPubkeysFromPTags(event.tags) : []
  }
}
