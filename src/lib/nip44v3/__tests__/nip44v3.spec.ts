/**
 * NIP-44 v3 top-level + ciphertext-layer test suite.
 *
 * Validates the full 228-vector corpus end-to-end:
 *   - 10 encrypt_decrypt (round-trip + byte-exact wire via test-only nonce)
 *   - 5  decrypt_only (non-standard padding tolerance)
 *   - 18 long_encrypt_decrypt (SHA-256 wire hash + round-trip)
 *   - 19 invalid_decryption (each must throw)
 *   - 176 padded_length (delegated to padding.spec.ts)
 */

import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'
import vectors from './test-vectors.json'
import {
  encrypt as topEncrypt,
  decrypt as topDecrypt,
  _testOnly_encrypt as topTestEncrypt,
  NIP44v3Error,
} from '..'
import { decodeWire, encodeWireBase64 } from '../ciphertext'
import { makeContext } from '../context'

type EncDecVec = {
  secret1: string
  secret2: string
  nonce: string
  kind: number
  scope_hex: string
  prk: string
  encryption_key: string
  mac_key: string
  plaintext_hex: string
  ciphertext: string
  note?: string
}

type LongEncDecVec = {
  secret1: string
  secret2: string
  nonce: string
  kind: number
  scope_hex: string
  pattern_hex: string
  repeat: number
  ciphertext_sha256: string
}

type InvalidVec = {
  secret: string
  public: string
  kind: number
  scope_hex: string
  ciphertext: string
  why: string
}

const encDec = vectors.encrypt_decrypt as EncDecVec[]
const decryptOnly = vectors.decrypt_only as EncDecVec[]
const longEncDec = vectors.long_encrypt_decrypt as LongEncDecVec[]
const invalidDec = vectors.invalid_decryption as InvalidVec[]

function repeatPattern(patternHex: string, n: number): Uint8Array {
  const pat = hexToBytes(patternHex)
  const out = new Uint8Array(pat.length * n)
  for (let i = 0; i < n; i++) out.set(pat, i * pat.length)
  return out
}

function pubkeyFromSecret(seckeyHex: string): Uint8Array {
  return schnorr.getPublicKey(hexToBytes(seckeyHex))
}

describe('NIP-44 v3 top-level encrypt() with injected nonce — 10 encrypt_decrypt vectors', () => {
  it('produces byte-exact wire ciphertext matching every vector (both perspectives)', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
      const plaintext = hexToBytes(v.plaintext_hex)
      const nonce = hexToBytes(v.nonce)

      // Perspective A → B
      const wireA = topTestEncrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, plaintext, nonce)
      if (wireA !== v.ciphertext) failures.push(`#${i} A: ${wireA.slice(0, 40)}...`)

      // Perspective B → A (ECDH is symmetric; same wire)
      const wireB = topTestEncrypt(hexToBytes(v.secret2), pubkeyFromSecret(v.secret1), ctx, plaintext, nonce)
      if (wireB !== v.ciphertext) failures.push(`#${i} B: ${wireB.slice(0, 40)}...`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 3).join('\n'))
  })
})

describe('NIP-44 v3 top-level decrypt() — 10 encrypt_decrypt vectors', () => {
  it('recovers exact plaintext from both perspectives', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
      // Perspective A
      const plainA = topDecrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, v.ciphertext)
      if (bytesToHex(plainA) !== v.plaintext_hex) failures.push(`#${i} A`)
      // Perspective B
      const plainB = topDecrypt(hexToBytes(v.secret2), pubkeyFromSecret(v.secret1), ctx, v.ciphertext)
      if (bytesToHex(plainB) !== v.plaintext_hex) failures.push(`#${i} B`)
    }
    if (failures.length > 0) throw new Error(failures.join(','))
  })
})

describe('NIP-44 v3 — decrypt_only vectors (non-standard padding tolerance)', () => {
  it('decrypts all 5 vectors at the public API', () => {
    const failures: string[] = []
    for (const [i, v] of decryptOnly.entries()) {
      const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
      try {
        const plain = topDecrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, v.ciphertext)
        if (bytesToHex(plain) !== v.plaintext_hex) failures.push(`#${i} (${v.note}): plaintext mismatch`)
      } catch (e) {
        failures.push(`#${i} (${v.note}) threw: ${(e as Error).message}`)
      }
    }
    if (failures.length > 0) throw new Error(failures.join('\n'))
  })
})

describe('NIP-44 v3 — long_encrypt_decrypt vectors (18, large messages)', () => {
  it('encrypts long plaintexts; SHA-256 of wire matches every vector', () => {
    const failures: string[] = []
    for (const [i, v] of longEncDec.entries()) {
      const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
      const plaintext = repeatPattern(v.pattern_hex, v.repeat)
      const wire = topTestEncrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, plaintext, hexToBytes(v.nonce))
      const wireBytes = new TextEncoder().encode(wire)
      const hashHex = bytesToHex(sha256(wireBytes))
      if (hashHex !== v.ciphertext_sha256) failures.push(`#${i}: hash ${hashHex} != ${v.ciphertext_sha256}`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 3).join('\n'))
  })

  it('decrypts every long_encrypt_decrypt vector back to the original plaintext', () => {
    const failures: string[] = []
    for (const [i, v] of longEncDec.entries()) {
      const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
      const plaintext = repeatPattern(v.pattern_hex, v.repeat)
      const wire = topTestEncrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, plaintext, hexToBytes(v.nonce))
      const plain = topDecrypt(hexToBytes(v.secret1), pubkeyFromSecret(v.secret2), ctx, wire)
      if (plain.length !== plaintext.length) failures.push(`#${i} length: ${plain.length} != ${plaintext.length}`)
      else if (bytesToHex(plain) !== bytesToHex(plaintext)) failures.push(`#${i} content mismatch`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 3).join('\n'))
  })
})

describe('NIP-44 v3 — invalid_decryption vectors (19, must all reject)', () => {
  it('every vector throws NIP44v3Error', () => {
    const failures: string[] = []
    for (const [i, v] of invalidDec.entries()) {
      let threw = false
      try {
        const ctx = makeContext(v.kind, hexToBytes(v.scope_hex))
        topDecrypt(hexToBytes(v.secret), hexToBytes(v.public), ctx, v.ciphertext)
      } catch (e) {
        threw = true
        // Vec 18 has scope_hex "ff" (non-UTF-8) — should throw at Context init.
        // Any other vec should throw at decrypt time.
        if (!(e instanceof NIP44v3Error)) failures.push(`#${i} (${v.why}) threw wrong type: ${e}`)
      }
      if (!threw) failures.push(`#${i} (${v.why}) did NOT throw`)
    }
    if (failures.length > 0) throw new Error(failures.join('\n'))
  })

  it('vector 18 (non-UTF-8 scope) fails at Context construction with invalidContext', () => {
    const v = invalidDec[18]
    expect(() => makeContext(v.kind, hexToBytes(v.scope_hex))).toThrow(NIP44v3Error)
    try {
      makeContext(v.kind, hexToBytes(v.scope_hex))
    } catch (e) {
      expect((e as NIP44v3Error).kind).toBe('invalidContext')
    }
  })
})

describe('NIP-44 v3 random-nonce smoke test', () => {
  it('encrypts with the public (random nonce) API and decrypts back', () => {
    const seckeyA = hexToBytes(encDec[0].secret1)
    const pubkeyB = pubkeyFromSecret(encDec[0].secret2)
    const ctx = makeContext(1, new Uint8Array(0))
    const plaintext = new TextEncoder().encode('hello nostr')
    const wire = topEncrypt(seckeyA, pubkeyB, ctx, plaintext)
    // Decrypt from both perspectives (ECDH symmetric)
    const seckeyB = hexToBytes(encDec[0].secret2)
    const pubkeyA = pubkeyFromSecret(encDec[0].secret1)
    const back = topDecrypt(seckeyB, pubkeyA, ctx, wire)
    expect(new TextDecoder().decode(back)).toBe('hello nostr')
  })
})

describe('NIP-44 v3 ciphertext layer — wire framing', () => {
  it('encodeWireBase64 round-trips through decodeWire', () => {
    const parts = {
      nonce: new Uint8Array(32).fill(0xaa),
      mac: new Uint8Array(32).fill(0xbb),
      kind: 30078,
      scope: new TextEncoder().encode('spectr_decks'),
      chacha20Ciphertext: new Uint8Array(64).fill(0xcc),
    }
    const wire = encodeWireBase64(parts)
    const parsed = decodeWire(wire)
    expect(parsed.kind).toBe(30078)
    expect(Array.from(parsed.nonce)).toEqual(Array.from(parts.nonce))
    expect(Array.from(parsed.mac)).toEqual(Array.from(parts.mac))
    expect(new TextDecoder().decode(parsed.scope)).toBe('spectr_decks')
    expect(Array.from(parsed.chacha20Ciphertext)).toEqual(Array.from(parts.chacha20Ciphertext))
  })

  it('rejects empty input', () => {
    expect(() => decodeWire('')).toThrow(NIP44v3Error)
  })

  it('rejects # prefix as unsupportedVersion (byte 0x23)', () => {
    try {
      decodeWire('#abcdef')
      throw new Error('did not throw')
    } catch (e) {
      expect(e).toBeInstanceOf(NIP44v3Error)
      expect((e as NIP44v3Error).kind).toBe('unsupportedVersion')
      expect((e as NIP44v3Error).byte).toBe(0x23)
    }
  })

  it('rejects invalid base64', () => {
    expect(() => decodeWire('not!!base64!!')).toThrow(NIP44v3Error)
  })

  it('rejects too-short decoded payload (< 77 bytes)', () => {
    // Base64 of 50 zero bytes
    const tooShort = Buffer.from(new Uint8Array(50)).toString('base64')
    try {
      decodeWire(tooShort)
      throw new Error('did not throw')
    } catch (e) {
      expect(e).toBeInstanceOf(NIP44v3Error)
      expect((e as NIP44v3Error).kind).toBe('invalidCiphertext')
    }
  })

  it('rejects wrong version byte as unsupportedVersion(byte)', () => {
    // Byte 0x02 = NIP-44 v2, byte 0x04 = NIP-04. Both should route to unsupportedVersion.
    const wire = new Uint8Array(80)
    wire[0] = 0x02
    const b64 = Buffer.from(wire).toString('base64')
    try {
      decodeWire(b64)
      throw new Error('did not throw')
    } catch (e) {
      expect(e).toBeInstanceOf(NIP44v3Error)
      expect((e as NIP44v3Error).kind).toBe('unsupportedVersion')
      expect((e as NIP44v3Error).byte).toBe(0x02)
    }
  })
})

describe('NIP-44 v3 top-level — input validation', () => {
  it('rejects wrong-length secret key in encrypt', () => {
    const ctx = makeContext(1, new Uint8Array(0))
    expect(() => topEncrypt(new Uint8Array(31), new Uint8Array(32), ctx, new Uint8Array(0))).toThrow(NIP44v3Error)
  })

  it('rejects wrong-length pubkey in decrypt', () => {
    const ctx = makeContext(1, new Uint8Array(0))
    const wire = topTestEncrypt(
      hexToBytes(encDec[0].secret1),
      pubkeyFromSecret(encDec[0].secret2),
      ctx,
      new Uint8Array(0),
      new Uint8Array(32).fill(1),
    )
    expect(() => topDecrypt(hexToBytes(encDec[0].secret2), new Uint8Array(31), ctx, wire)).toThrow(NIP44v3Error)
  })
})

// Wire layout offsets — must match Ciphertext.encode / decode.
//   0       version (0x03)
//   1..33   nonce (32)
//   33..65  mac (32)
//   65..69  kind (u32 BE)
//   69..73  scope_len (u32 BE)
//   73..    scope, then chacha20_ct

describe('NIP-44 v3 top-level decrypt() — wire kind / scope tamper rejection', () => {
  /**
   * Validates the spec step-4 check ("Fail if kind != expected_kind / scope
   * != expected_scope"). Without it, a wire whose embedded kind/scope bytes
   * are tampered but whose MAC tag is intact would silently decrypt
   * successfully whenever the caller's context matches what the encryptor
   * signed in (which it always does for legitimate use), so the "embedded
   * context is authenticated" spec invariant would be only partially
   * enforced.
   */

  it('rejects a wire whose embedded kind byte has been flipped', () => {
    const vec = encDec[0]
    const seckey = hexToBytes(vec.secret1)
    const pubkey = pubkeyFromSecret(vec.secret2)
    const ctx = makeContext(vec.kind, hexToBytes(vec.scope_hex))

    const raw = base64.decode(vec.ciphertext).slice()
    expect(raw.length).toBeGreaterThanOrEqual(69)
    // Flip the low byte of kind (offset 68). MAC tag (offset 33..65) is
    // NOT touched.
    raw[68] ^= 0xff
    const tampered = base64.encode(raw)

    expect(() => topDecrypt(seckey, pubkey, ctx, tampered)).toThrow(NIP44v3Error)
  })

  it('rejects a wire whose embedded scope byte has been flipped', () => {
    // Pick a vector with a non-empty scope. encDec[1] has the
    // "spec.nostr.land/nip44v3" scope (23 bytes).
    const vec = encDec[1]
    expect(vec.scope_hex.length).toBeGreaterThan(0)
    const scope = hexToBytes(vec.scope_hex)
    const seckey = hexToBytes(vec.secret1)
    const pubkey = pubkeyFromSecret(vec.secret2)
    const ctx = makeContext(vec.kind, scope)

    const raw = base64.decode(vec.ciphertext).slice()
    expect(raw.length).toBeGreaterThanOrEqual(74)
    // Flip the first scope byte (offset 73). MAC tag is NOT touched.
    raw[73] ^= 0xff
    const tampered = base64.encode(raw)

    expect(() => topDecrypt(seckey, pubkey, ctx, tampered)).toThrow(NIP44v3Error)
  })
})
