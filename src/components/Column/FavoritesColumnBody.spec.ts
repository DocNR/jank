import { describe, it, expect } from 'vitest'
import { FAVORITES_KINDS, buildFavoritesSubRequests } from './FavoritesColumnBody'

describe('FAVORITES_KINDS', () => {
  it('is [1, 6] (kind:1 text notes + kind:6 reposts)', () => {
    expect(FAVORITES_KINDS).toEqual([1, 6])
  })
})

describe('buildFavoritesSubRequests', () => {
  it('returns a single sub-request with kinds:[1,6] and the provided authors', () => {
    const reqs = buildFavoritesSubRequests(
      ['wss://relay.example.com'],
      ['pubkey-a', 'pubkey-b']
    )
    expect(reqs).toHaveLength(1)
    expect(reqs[0].filter.kinds).toEqual([1, 6])
    expect(reqs[0].filter.authors).toEqual(['pubkey-a', 'pubkey-b'])
  })

  it('passes urls through', () => {
    const urls = ['wss://a.example.com', 'wss://b.example.com']
    const reqs = buildFavoritesSubRequests(urls, ['pubkey-a'])
    expect(reqs[0].urls).toEqual(urls)
  })

  it('returns empty authors array when no favorites are passed', () => {
    const reqs = buildFavoritesSubRequests(['wss://relay.example.com'], [])
    expect(reqs[0].filter.authors).toEqual([])
  })
})
