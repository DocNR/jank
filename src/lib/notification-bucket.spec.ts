import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtendedKind } from '@/constants'
import { Event } from 'nostr-tools'
import eventCache from '@/services/caches/event-cache.service'
import { isReplyToUser, notificationBucket } from './notification-bucket'

// USER = the notification column's viewContext (the person being notified)
const USER = '1'.repeat(64)
// OTHER = the replier / a third party
const OTHER = '2'.repeat(64)
const PARENT_ID = 'b'.repeat(64)

function ev(partial: Partial<Event>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: OTHER,
    created_at: 0,
    kind: 1,
    tags: [],
    content: '',
    sig: '',
    ...partial
  } as Event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notificationBucket — non-reply kinds', () => {
  it('reactions / zaps / reposts bucket by kind', () => {
    expect(notificationBucket(ev({ kind: 7 }), USER)).toBe('reactions')
    expect(notificationBucket(ev({ kind: 9735 }), USER)).toBe('zaps')
    expect(notificationBucket(ev({ kind: 6 }), USER)).toBe('reposts')
  })
})

describe('isReplyToUser — kind-1 (NIP-10) replies', () => {
  it('reply WITH the pubkey hint at index 4 → reply', () => {
    const reply = ev({
      tags: [['e', PARENT_ID, 'wss://relay', 'reply', USER], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(true)
    expect(notificationBucket(reply, USER)).toBe('replies')
  })

  it('reply to someone ELSE (hint is a third party) → not a reply to the user', () => {
    const reply = ev({
      tags: [['e', PARENT_ID, 'wss://relay', 'reply', OTHER], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(false)
    expect(notificationBucket(reply, USER)).toBe('mentions')
  })

  it('reply WITHOUT the hint but parent is cached and authored by user → reply', () => {
    vi.spyOn(eventCache, 'getCachedEvent').mockReturnValue(
      ev({ id: PARENT_ID, pubkey: USER })
    )
    const reply = ev({
      tags: [['e', PARENT_ID, 'wss://relay', 'reply'], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(true)
    expect(notificationBucket(reply, USER)).toBe('replies')
  })

  it('reply WITHOUT the hint and parent not cached → falls back to mention', () => {
    vi.spyOn(eventCache, 'getCachedEvent').mockReturnValue(undefined)
    const reply = ev({
      tags: [['e', PARENT_ID, 'wss://relay', 'reply'], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(false)
    expect(notificationBucket(reply, USER)).toBe('mentions')
  })

  it('reply WITHOUT the hint, parent cached but authored by someone else → mention', () => {
    vi.spyOn(eventCache, 'getCachedEvent').mockReturnValue(
      ev({ id: PARENT_ID, pubkey: OTHER })
    )
    const reply = ev({
      tags: [['e', PARENT_ID, 'wss://relay', 'reply'], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(false)
    expect(notificationBucket(reply, USER)).toBe('mentions')
  })
})

describe('isReplyToUser — NIP-22 comments (kind 1111 / 1244)', () => {
  it('comment replying to the user (parent pubkey at index 3) → reply', () => {
    const comment = ev({
      kind: ExtendedKind.COMMENT,
      tags: [
        ['E', 'c'.repeat(64), 'wss://relay', USER],
        ['K', '1'],
        ['e', PARENT_ID, 'wss://relay', USER], // NIP-22 parent: pubkey at index 3, no marker
        ['k', '1'],
        ['p', USER]
      ]
    })
    expect(isReplyToUser(comment, USER)).toBe(true)
    expect(notificationBucket(comment, USER)).toBe('replies')
  })

  it('voice comment replying to the user → reply', () => {
    const comment = ev({
      kind: ExtendedKind.VOICE_COMMENT,
      tags: [
        ['e', PARENT_ID, 'wss://relay', USER],
        ['k', '1244'],
        ['p', USER]
      ]
    })
    expect(notificationBucket(comment, USER)).toBe('replies')
  })

  it('comment replying to someone else → mention', () => {
    const comment = ev({
      kind: ExtendedKind.COMMENT,
      tags: [
        ['e', PARENT_ID, 'wss://relay', OTHER],
        ['k', '1'],
        ['p', USER]
      ]
    })
    expect(notificationBucket(comment, USER)).toBe('mentions')
  })
})

describe('isReplyToUser — addressable (NIP-23 a-tag) replies', () => {
  it('reply to the user’s article coordinate → reply', () => {
    const reply = ev({
      tags: [['a', `30023:${USER}:my-article`, 'wss://relay', 'reply'], ['p', USER]]
    })
    expect(isReplyToUser(reply, USER)).toBe(true)
  })

  it('reply to another author’s article → not a reply to the user', () => {
    const reply = ev({
      tags: [['a', `30023:${OTHER}:their-article`, 'wss://relay', 'reply']]
    })
    expect(isReplyToUser(reply, USER)).toBe(false)
  })
})

describe('isReplyToUser — guards', () => {
  it('no user pubkey → false', () => {
    expect(isReplyToUser(ev({}), null)).toBe(false)
  })

  it('top-level note with no parent tag → mention', () => {
    expect(notificationBucket(ev({ tags: [['p', USER]] }), USER)).toBe('mentions')
  })
})
