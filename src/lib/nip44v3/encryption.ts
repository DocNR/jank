/**
 * NIP-44 v3 ChaCha20 + HMAC-SHA256 encryption layer.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 * Reference impl: nostr-land/ncrypt-go (BSD-3), `nip44v3/encryption.go`.
 *
 * Composes pre-derived `(encryptionKey, macKey, nonce)` with `kind` + `scope`
 * into a ChaCha20-encrypted body and an HMAC-SHA256 tag. Stays one level
 * below the wire framing (Ciphertext layer).
 *
 *   prefixed_plaintext = u32_be(len(plaintext)) || plaintext
 *   padded_plaintext   = prefixed_plaintext || zeros(target_size - len)
 *   chacha20_ct        = ChaCha20(encryptionKey, padded_plaintext)
 *   ad                 = nonce || u32_be(kind) || u32_be(len(scope)) || scope || chacha20_ct
 *   mac                = HMAC-SHA256(macKey, ad)
 *
 * ⚠ Critical (gotcha #1): on decrypt, padding-all-zero MUST be checked, but
 * the actual padding length MUST NOT be compared against
 * targetSize(plaintext_length). Spec commit c6daedd. The 5 `decrypt_only`
 * vectors exist precisely to catch this. Amber's PR #448 got it wrong;
 * #456 is the fix.
 */

import { chacha20 } from '@noble/ciphers/chacha.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { NIP44v3Error } from './errors'
import { targetSize } from './padding'

const MAX_PLAINTEXT = 0x7fffffff
const CHACHA20_NONCE = new Uint8Array(12) // 12 bytes of 0x00 per spec

export function encrypt(
  plaintext: Uint8Array,
  encryptionKey: Uint8Array,
  macKey: Uint8Array,
  kind: number,
  scope: Uint8Array,
  nonce: Uint8Array,
): { ciphertext: Uint8Array; mac: Uint8Array } {
  if (encryptionKey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (macKey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (nonce.length !== 32) throw new NIP44v3Error('invalidKey')
  if (plaintext.length > MAX_PLAINTEXT) throw new NIP44v3Error('encryptionFailed')

  const prefixedLen = 4 + plaintext.length
  const padLen = targetSize(prefixedLen)
  const padded = new Uint8Array(padLen)
  writeU32BE(padded, 0, plaintext.length)
  padded.set(plaintext, 4)
  // remaining bytes [prefixedLen ..< padLen] are already zero

  const ciphertext = chacha20(encryptionKey, CHACHA20_NONCE, padded)
  const mac = computeMac(macKey, nonce, kind, scope, ciphertext)
  return { ciphertext, mac }
}

export function decrypt(
  chacha20Ciphertext: Uint8Array,
  mac: Uint8Array,
  encryptionKey: Uint8Array,
  macKey: Uint8Array,
  kind: number,
  scope: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  if (encryptionKey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (macKey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (nonce.length !== 32) throw new NIP44v3Error('invalidKey')

  // Verify MAC FIRST, constant-time. Spec binds (kind, scope) into the MAC,
  // so caller-supplied context mismatch surfaces here as decryptionFailed.
  const expectedMac = computeMac(macKey, nonce, kind, scope, chacha20Ciphertext)
  if (!constantTimeEqual(expectedMac, mac)) throw new NIP44v3Error('decryptionFailed')

  if (chacha20Ciphertext.length < 4) throw new NIP44v3Error('decryptionFailed')

  const padded = chacha20(encryptionKey, CHACHA20_NONCE, chacha20Ciphertext)
  const plaintextLen = readU32BE(padded, 0)
  if (plaintextLen > MAX_PLAINTEXT) throw new NIP44v3Error('decryptionFailed')
  if (4 + plaintextLen > padded.length) throw new NIP44v3Error('decryptionFailed')

  // ⚠ Constant-time all-zero check ONLY. Do NOT compare against
  // targetSize(plaintextLen) — that breaks the 5 decrypt_only vectors.
  if (!constantTimeAllZero(padded, 4 + plaintextLen, padded.length)) {
    throw new NIP44v3Error('decryptionFailed')
  }

  return padded.slice(4, 4 + plaintextLen)
}

function computeMac(macKey: Uint8Array, nonce: Uint8Array, kind: number, scope: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  // ad = nonce || u32_be(kind) || u32_be(scope.len) || scope || ciphertext
  const adLen = nonce.length + 4 + 4 + scope.length + ciphertext.length
  const ad = new Uint8Array(adLen)
  let o = 0
  ad.set(nonce, o); o += nonce.length
  writeU32BE(ad, o, kind); o += 4
  writeU32BE(ad, o, scope.length); o += 4
  ad.set(scope, o); o += scope.length
  ad.set(ciphertext, o)
  return hmac(sha256, macKey, ad)
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let accum = 0
  for (let i = 0; i < a.length; i++) accum |= a[i] ^ b[i]
  return accum === 0
}

function constantTimeAllZero(buf: Uint8Array, from: number, to: number): boolean {
  if (from > to || to > buf.length) return false
  let accum = 0
  for (let i = from; i < to; i++) accum |= buf[i]
  return accum === 0
}
