import { describe, expect, it } from 'vitest'
import { makeContext } from '../context'
import { NIP44v3Error } from '../errors'

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

describe('makeContext', () => {
  it('builds a Context with empty scope', () => {
    const ctx = makeContext(1, new Uint8Array(0))
    expect(ctx.kind).toBe(1)
    expect(ctx.scope.length).toBe(0)
  })

  it('builds a Context with a valid ASCII scope', () => {
    const ctx = makeContext(30078, new TextEncoder().encode('spectr_decks'))
    expect(ctx.kind).toBe(30078)
    expect(new TextDecoder().decode(ctx.scope)).toBe('spectr_decks')
  })

  it('builds a Context with a valid multi-byte UTF-8 scope', () => {
    const ctx = makeContext(1, new TextEncoder().encode('日本語'))
    expect(ctx.scope.length).toBeGreaterThan(0)
  })

  it('rejects non-UTF-8 scope (single 0xff byte) — invalid_decryption[18]', () => {
    expect(() => makeContext(4, hexToBytes('ff'))).toThrow(NIP44v3Error)
    try {
      makeContext(4, hexToBytes('ff'))
    } catch (e) {
      expect((e as NIP44v3Error).kind).toBe('invalidContext')
    }
  })

  it('rejects non-UTF-8 scope (lone continuation byte 0x80)', () => {
    expect(() => makeContext(1, new Uint8Array([0x80]))).toThrow(NIP44v3Error)
  })

  it('rejects non-UTF-8 scope (overlong sequence)', () => {
    // Overlong encoding of '/' as 0xc0 0xaf — invalid per RFC 3629
    expect(() => makeContext(1, new Uint8Array([0xc0, 0xaf]))).toThrow(NIP44v3Error)
  })

  it('rejects kind below 0', () => {
    expect(() => makeContext(-1, new Uint8Array(0))).toThrow(NIP44v3Error)
  })

  it('rejects kind at or above 2^32', () => {
    expect(() => makeContext(2 ** 32, new Uint8Array(0))).toThrow(NIP44v3Error)
  })

  it('accepts kind 0', () => {
    const ctx = makeContext(0, new Uint8Array(0))
    expect(ctx.kind).toBe(0)
  })

  it('accepts kind 2^32 - 1 (max u32)', () => {
    const ctx = makeContext(0xffffffff, new Uint8Array(0))
    expect(ctx.kind).toBe(0xffffffff)
  })

  it('does not canonicalize scope (bytes pass through unchanged)', () => {
    // Sequence with both NFC and NFD representations available
    const nfd = new Uint8Array([0x65, 0xcc, 0x81]) // 'e' + combining acute = NFD form of é
    const ctx = makeContext(1, nfd)
    expect(Array.from(ctx.scope)).toEqual([0x65, 0xcc, 0x81])
  })
})

describe('NIP44v3Error', () => {
  it('carries a discriminating kind field', () => {
    const e = new NIP44v3Error('invalidCiphertext')
    expect(e.kind).toBe('invalidCiphertext')
    expect(e instanceof Error).toBe(true)
  })

  it('carries an optional byte for unsupportedVersion', () => {
    const e = new NIP44v3Error('unsupportedVersion', 0x02)
    expect(e.kind).toBe('unsupportedVersion')
    expect(e.byte).toBe(0x02)
  })
})
