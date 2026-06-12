import { describe, expect, it } from 'vitest'
import { formatNpub, formatPubkey, formatUserId } from './pubkey'

// A real 63-char npub (hex pubkey = "11...11"). Vanity-ish prefix "zyg3zyg3..."
// lets us assert the leading characters survive truncation.
const NPUB = 'npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h'
const HEX = '1'.repeat(64)

describe('formatNpub', () => {
  it('reveals "npub1" + 5 leading chars at the default length (vanity prefixes stay legible)', () => {
    const out = formatNpub(NPUB)
    // prefix = "npub1" + 5 chars = 10 chars, then "...", then 5 suffix chars
    expect(out).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-5)}`)
    expect(out.startsWith('npub1zyg3z')).toBe(true)
  })

  it('always shows at least 5 chars after the "npub1" prefix even if a smaller length is passed', () => {
    const out = formatNpub(NPUB, 8)
    // length is floored to 15 → prefix stays 10 chars ("npub1" + 5)
    expect(out).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-5)}`)
  })

  it('grows symmetrically for larger lengths (MeDrawer uses 20)', () => {
    const out = formatNpub(NPUB, 20)
    // prefix = floor((20-5)/2)+5 = 12, suffix = 8
    expect(out).toBe(`${NPUB.slice(0, 12)}...${NPUB.slice(-8)}`)
  })

  it('grows symmetrically for larger lengths (PubkeyCopy uses 24)', () => {
    const out = formatNpub(NPUB, 24)
    // prefix = floor((24-5)/2)+5 = 14, suffix = 10
    expect(out).toBe(`${NPUB.slice(0, 14)}...${NPUB.slice(-10)}`)
  })

  it('returns the full npub when the requested length meets or exceeds its length', () => {
    expect(formatNpub(NPUB, 63)).toBe(NPUB)
    expect(formatNpub(NPUB, 100)).toBe(NPUB)
  })
})

describe('formatPubkey', () => {
  it('converts a hex pubkey to npub then truncates with the vanity-safe default', () => {
    expect(formatPubkey(HEX)).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-5)}`)
  })

  it('falls back to hex truncation when the input is not a valid pubkey', () => {
    const bad = 'not-a-valid-pubkey'
    expect(formatPubkey(bad)).toBe(`${bad.slice(0, 4)}...${bad.slice(-4)}`)
  })
})

describe('formatUserId', () => {
  it('truncates an npub directly', () => {
    expect(formatUserId(NPUB)).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-5)}`)
  })

  it('routes a hex pubkey through formatPubkey', () => {
    expect(formatUserId(HEX)).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-5)}`)
  })
})
