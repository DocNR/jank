import { describe, expect, it } from 'vitest'
import type { TRelatrSearchProfilesResult } from '@/lib/relatr'
import { extractAuthorResults, normalizeQuery, shouldAutoRun } from './helpers'

describe('normalizeQuery', () => {
  it('trims whitespace + lowercases', () => {
    expect(normalizeQuery('  Bitcoin  ')).toBe('bitcoin')
  })
  it('returns empty string for null/undefined', () => {
    expect(normalizeQuery(undefined)).toBe('')
    expect(normalizeQuery(null as unknown as string)).toBe('')
  })
  it('preserves internal whitespace as a single space', () => {
    expect(normalizeQuery('  foo   bar  ')).toBe('foo bar')
  })
})

describe('shouldAutoRun', () => {
  it('returns true on first mount with query + signer + no cache', () => {
    expect(
      shouldAutoRun({ query: 'bitcoin', signerPubkey: 'a'.repeat(64), hasCache: false })
    ).toBe(true)
  })
  it('returns false when cache exists', () => {
    expect(
      shouldAutoRun({ query: 'bitcoin', signerPubkey: 'a'.repeat(64), hasCache: true })
    ).toBe(false)
  })
  it('returns false when query is empty', () => {
    expect(shouldAutoRun({ query: '', signerPubkey: 'a'.repeat(64), hasCache: false })).toBe(
      false
    )
  })
  it('returns false when signer is missing', () => {
    expect(shouldAutoRun({ query: 'bitcoin', signerPubkey: null, hasCache: false })).toBe(false)
  })
})

describe('extractAuthorResults', () => {
  it('returns ordered ranked entries from a Relatr response', () => {
    const result: TRelatrSearchProfilesResult = {
      results: [
        { pubkey: 'a'.repeat(64), trustScore: 0.9, rank: 1 },
        { pubkey: 'b'.repeat(64), trustScore: 0.8, rank: 2, exactMatch: true },
        { pubkey: 'c'.repeat(64), trustScore: 0.7, rank: 3 }
      ],
      totalFound: 3,
      searchTimeMs: 350
    }
    expect(extractAuthorResults(result)).toEqual([
      { pubkey: 'a'.repeat(64), trustScore: 0.9, rank: 1 },
      { pubkey: 'b'.repeat(64), trustScore: 0.8, rank: 2, exactMatch: true },
      { pubkey: 'c'.repeat(64), trustScore: 0.7, rank: 3 }
    ])
  })

  it('returns empty array for empty results', () => {
    expect(extractAuthorResults({ results: [], totalFound: 0, searchTimeMs: 0 })).toEqual([])
  })
})
