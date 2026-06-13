import { describe, it, expect } from 'vitest'
import { nip19, type Event } from 'nostr-tools'
import { getThreadRootId, isInMutedThread } from '@/lib/event'

const ROOT = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

// minimal Event factory — getThreadRootId only reads id, kind, tags, content
const ev = (over: Partial<Event>): Event =>
  ({
    id: 'self',
    kind: 1,
    tags: [],
    content: '',
    pubkey: '',
    created_at: 0,
    sig: '',
    ...over
  }) as Event

describe('getThreadRootId', () => {
  it('returns own id for a top-level note', () => {
    expect(getThreadRootId(ev({ id: ROOT, tags: [] }))).toBe(ROOT)
  })

  it('returns the root-marked id for a reply', () => {
    expect(getThreadRootId(ev({ id: 'r', tags: [['e', ROOT, '', 'root']] }))).toBe(ROOT)
  })

  it('returns the root for a deep reply (root marker constant down the thread)', () => {
    const deep = ev({
      id: 'd',
      tags: [
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply']
      ]
    })
    expect(getThreadRootId(deep)).toBe(ROOT)
  })

  it('falls back to first positional e tag (legacy, no markers)', () => {
    expect(getThreadRootId(ev({ id: 'r', tags: [['e', ROOT]] }))).toBe(ROOT)
  })
})

describe('isInMutedThread', () => {
  const muted = new Set([ROOT])

  it('hides the muted root note itself', () => {
    expect(isInMutedThread(ev({ id: ROOT, tags: [] }), muted)).toBe(true)
  })

  it('hides a direct reply to the muted root', () => {
    expect(isInMutedThread(ev({ id: 'r', tags: [['e', ROOT, '', 'root']] }), muted)).toBe(true)
  })

  it('hides a deep descendant', () => {
    const deep = ev({
      id: 'd',
      tags: [
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply']
      ]
    })
    expect(isInMutedThread(deep, muted)).toBe(true)
  })

  it('does NOT hide a sibling thread (different root)', () => {
    expect(isInMutedThread(ev({ id: 's', tags: [['e', OTHER, '', 'root']] }), muted)).toBe(false)
  })

  it('does NOT hide a standalone note', () => {
    expect(isInMutedThread(ev({ id: 'x', tags: [] }), muted)).toBe(false)
  })

  it('does NOT hide a quote that embeds the root as nostr:nevent', () => {
    const nevent = nip19.neventEncode({ id: ROOT })
    const quote = ev({
      id: 'q',
      content: `look nostr:${nevent}`,
      tags: [['e', ROOT, '', 'mention']]
    })
    // getRootEventHexId excludes embedded-note ids from its positional fallback,
    // so the quote's computed root is itself → visible.
    expect(isInMutedThread(quote, muted)).toBe(false)
  })

  it('is a fast no-op for an empty mute set', () => {
    expect(isInMutedThread(ev({ id: ROOT }), new Set())).toBe(false)
  })
})
