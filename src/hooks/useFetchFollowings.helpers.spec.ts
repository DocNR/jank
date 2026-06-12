import { generateSecretKey, getPublicKey, kinds, type Event as NEvent } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { deriveFollowings } from './useFetchFollowings.helpers'

const PK_A = getPublicKey(generateSecretKey())
const PK_B = getPublicKey(generateSecretKey())

const contactsEvent = (tags: string[][]): NEvent =>
  ({
    id: 'evt',
    kind: kinds.Contacts,
    pubkey: 'author',
    created_at: 1,
    tags,
    content: '',
    sig: 'sig'
  }) as NEvent

describe('deriveFollowings', () => {
  it('returns no followings and a null event when nothing is cached yet', () => {
    expect(deriveFollowings(undefined)).toEqual({ followListEvent: null, followings: [] })
  })

  it('derives the followings from the follow list event p-tags', () => {
    const event = contactsEvent([
      ['p', PK_A],
      ['p', PK_B],
      ['e', 'ignored']
    ])
    const result = deriveFollowings(event)
    expect(result.followListEvent).toBe(event)
    expect(result.followings).toContain(PK_A)
    expect(result.followings).toContain(PK_B)
    expect(result.followings).toHaveLength(2)
  })
})
