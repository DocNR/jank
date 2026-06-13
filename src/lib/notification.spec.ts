import { describe, it, expect } from 'vitest'
import { kinds, type NostrEvent } from 'nostr-tools'
import { notificationFilter } from './notification'

const ROOT = 'a'.repeat(64)
const OTHER_ROOT = 'b'.repeat(64)
const REPLY_ID = 'd'.repeat(64)

const ev = (over: Partial<NostrEvent>): NostrEvent =>
  ({
    id: 'self',
    kind: kinds.ShortTextNote,
    tags: [],
    content: '',
    pubkey: 'author',
    created_at: 0,
    sig: '',
    ...over
  }) as NostrEvent

const baseOpts = {
  pubkey: 'me',
  mutePubkeySet: new Set<string>(),
  muteEventIdSet: new Set<string>(),
  hideContentMentioningMutedUsers: false
}

describe('notificationFilter — muted threads', () => {
  it('drops a notification that is the muted root note', () => {
    expect(notificationFilter(ev({ id: ROOT }), { ...baseOpts, muteEventIdSet: new Set([ROOT]) })).toBe(
      false
    )
  })

  it('drops a reply that belongs to a muted thread', () => {
    const reply = ev({ id: REPLY_ID, tags: [['e', ROOT, '', 'root']] })
    expect(notificationFilter(reply, { ...baseOpts, muteEventIdSet: new Set([ROOT]) })).toBe(false)
  })

  it('keeps a notification from a different (unmuted) thread', () => {
    const note = ev({ id: REPLY_ID, tags: [['e', OTHER_ROOT, '', 'root']] })
    expect(notificationFilter(note, { ...baseOpts, muteEventIdSet: new Set([ROOT]) })).toBe(true)
  })

  it('keeps everything when no threads are muted', () => {
    expect(notificationFilter(ev({ id: ROOT }), baseOpts)).toBe(true)
  })
})
