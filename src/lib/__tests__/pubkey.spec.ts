import { describe, expect, it } from 'vitest'
import { filterValidPubkeys, isValidPubkey } from '../pubkey'

const VALID_A = 'a'.repeat(64)
const VALID_B = 'b'.repeat(64)

describe('isValidPubkey', () => {
  it('accepts 64-char lowercase hex', () => {
    expect(isValidPubkey(VALID_A)).toBe(true)
  })

  it('rejects empty string, short, and non-hex strings', () => {
    expect(isValidPubkey('')).toBe(false)
    expect(isValidPubkey('abc')).toBe(false)
    expect(isValidPubkey('z'.repeat(64))).toBe(false)
    expect(isValidPubkey('A'.repeat(64))).toBe(false) // uppercase hex not allowed
  })
})

describe('filterValidPubkeys', () => {
  it('drops empty strings and malformed pubkeys, keeping only valid hex', () => {
    const input = [VALID_A, '', 'not-a-pubkey', VALID_B, 'a'.repeat(63)]
    expect(filterValidPubkeys(input)).toEqual([VALID_A, VALID_B])
  })

  it('returns an empty array when every entry is invalid', () => {
    expect(filterValidPubkeys(['', 'nope'])).toEqual([])
  })

  it('returns the array unchanged when every entry is valid', () => {
    expect(filterValidPubkeys([VALID_A, VALID_B])).toEqual([VALID_A, VALID_B])
  })
})
