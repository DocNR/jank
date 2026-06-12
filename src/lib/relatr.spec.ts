import { describe, expect, it } from 'vitest'
import {
  RELATR_PUBKEY,
  RELATR_NPUB,
  isRelatrSearchProfilesResult,
  type TRelatrSearchProfilesResult
} from './relatr'

describe('Relatr constants', () => {
  it('exposes Relatr pubkey + npub as constants', () => {
    expect(RELATR_PUBKEY).toBe(
      '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3'
    )
    expect(RELATR_NPUB).toMatch(/^npub1/)
  })
})

describe('isRelatrSearchProfilesResult', () => {
  it('accepts a well-formed response', () => {
    const good: TRelatrSearchProfilesResult = {
      results: [{ pubkey: 'a'.repeat(64), trustScore: 0.79, rank: 1, exactMatch: true }],
      totalFound: 1,
      searchTimeMs: 350
    }
    expect(isRelatrSearchProfilesResult(good)).toBe(true)
  })

  it('rejects null / undefined / wrong type', () => {
    expect(isRelatrSearchProfilesResult(null)).toBe(false)
    expect(isRelatrSearchProfilesResult(undefined)).toBe(false)
    expect(isRelatrSearchProfilesResult('not an object')).toBe(false)
  })

  it('rejects missing results array', () => {
    expect(isRelatrSearchProfilesResult({ totalFound: 0, searchTimeMs: 0 })).toBe(false)
  })

  it('rejects malformed result entry', () => {
    const bad = {
      results: [{ pubkey: 'short', trustScore: 'not a number', rank: 1 }],
      totalFound: 1,
      searchTimeMs: 0
    }
    expect(isRelatrSearchProfilesResult(bad)).toBe(false)
  })

  it('accepts trustScore at the boundaries (0 and 1)', () => {
    const edge = {
      results: [
        { pubkey: 'a'.repeat(64), trustScore: 0, rank: 1 },
        { pubkey: 'b'.repeat(64), trustScore: 1, rank: 2 }
      ],
      totalFound: 2,
      searchTimeMs: 100
    }
    expect(isRelatrSearchProfilesResult(edge)).toBe(true)
  })
})
