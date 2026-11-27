import { describe, it, expect } from 'vitest'
import { meetsTrustScore } from './trust-score'

describe('meetsTrustScore', () => {
  const owner = 'owner-pubkey'
  const trusted = new Set(['wot-pubkey'])
  const loadRank = async (pubkey: string) =>
    ({
      ranked: 42,
      high: 95,
      unranked: null
    })[pubkey] ?? null

  it('passes everyone when the filter is off', async () => {
    expect(await meetsTrustScore('ranked', owner, 0, trusted, loadRank)).toBe(true)
    expect(await meetsTrustScore('unranked', owner, 0, trusted, loadRank)).toBe(true)
  })

  it('always passes the owner and WoT members, at any threshold', async () => {
    expect(await meetsTrustScore(owner, owner, 100, trusted, loadRank)).toBe(true)
    expect(await meetsTrustScore('wot-pubkey', owner, 100, trusted, loadRank)).toBe(true)
  })

  it('passes a ranked author at or above the threshold', async () => {
    expect(await meetsTrustScore('high', owner, 50, trusted, loadRank)).toBe(true)
    expect(await meetsTrustScore('ranked', owner, 42, trusted, loadRank)).toBe(true)
  })

  it('hides a ranked author below the threshold', async () => {
    expect(await meetsTrustScore('ranked', owner, 50, trusted, loadRank)).toBe(false)
    expect(await meetsTrustScore('high', owner, 100, trusted, loadRank)).toBe(false)
  })

  it('fails open for unranked authors', async () => {
    expect(await meetsTrustScore('unranked', owner, 50, trusted, loadRank)).toBe(true)
  })
})
