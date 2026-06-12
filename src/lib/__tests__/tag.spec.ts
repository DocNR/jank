import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { getPubkeysFromPTags } from '@/lib/tag'

const PK_A = getPublicKey(generateSecretKey())
const PK_B = getPublicKey(generateSecretKey())

describe('getPubkeysFromPTags', () => {
  it('extracts pubkeys from p tags', () => {
    const result = getPubkeysFromPTags([
      ['p', PK_A],
      ['p', PK_B]
    ])
    expect(result).toContain(PK_A)
    expect(result).toContain(PK_B)
    expect(result).toHaveLength(2)
  })

  it('ignores non-p tags', () => {
    const result = getPubkeysFromPTags([
      ['e', PK_A],
      ['p', PK_B],
      ['t', 'nostr']
    ])
    expect(result).toEqual([PK_B])
  })

  it('filters out invalid pubkeys', () => {
    const result = getPubkeysFromPTags([
      ['p', PK_A],
      ['p', 'not-a-valid-pubkey'],
      ['p', '']
    ])
    expect(result).toEqual([PK_A])
  })

  // Backs the follow() dedup guard: a follow list that grew a duplicate p tag
  // (the exact data-integrity bug behind the stale Follow button) must still
  // report the pubkey exactly once, and membership via .includes must hold.
  it('dedupes a pubkey that appears in multiple p tags', () => {
    const result = getPubkeysFromPTags([
      ['p', PK_A],
      ['p', PK_A],
      ['p', PK_B]
    ])
    expect(result.filter((pk) => pk === PK_A)).toHaveLength(1)
    expect(result).toHaveLength(2)
    expect(result.includes(PK_A)).toBe(true)
    expect(result.includes(PK_B)).toBe(true)
  })

  it('reports non-membership for a pubkey not in the list', () => {
    const result = getPubkeysFromPTags([['p', PK_A]])
    expect(result.includes(PK_B)).toBe(false)
  })
})
