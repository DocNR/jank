/**
 * NIP-44 v3 wire-format framing.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 * Reference impl: nostr-land/ncrypt-go (BSD-3), `nip44v3/ciphertext.go`.
 *
 *   base64(
 *     0x03                   // version
 *     || nonce               // 32 bytes
 *     || mac                 // 32 bytes
 *     || u32_be(kind)        // 4 bytes
 *     || u32_be(scope_len)   // 4 bytes
 *     || scope               // scope_len bytes
 *     || chacha20_ciphertext // ≥ 4 bytes
 *   )
 *
 * UTF-8 validation of `scope` lives in the Context layer, not here — bytes
 * pass through transparently.
 */

import { base64 } from '@scure/base'
import { NIP44v3Error } from './errors'

const VERSION: number = 0x03
const MIN_WIRE_SIZE = 77
const MIN_CT_SIZE = 4

export interface WireParts {
  readonly nonce: Uint8Array
  readonly mac: Uint8Array
  readonly kind: number
  readonly scope: Uint8Array
  readonly chacha20Ciphertext: Uint8Array
}

export function encodeWireBase64(parts: WireParts): string {
  const buf = new Uint8Array(1 + 32 + 32 + 4 + 4 + parts.scope.length + parts.chacha20Ciphertext.length)
  let o = 0
  buf[o++] = VERSION
  buf.set(parts.nonce, o); o += 32
  buf.set(parts.mac, o); o += 32
  writeU32BE(buf, o, parts.kind); o += 4
  writeU32BE(buf, o, parts.scope.length); o += 4
  buf.set(parts.scope, o); o += parts.scope.length
  buf.set(parts.chacha20Ciphertext, o)
  return base64.encode(buf)
}

export function decodeWire(b64: string): WireParts {
  if (b64.length === 0) throw new NIP44v3Error('invalidCiphertext')
  // '#' prefix is the spec-reserved sentinel for future non-base64 encodings.
  // Check on the input string BEFORE base64-decode (matches ncrypt-go).
  if (b64.charCodeAt(0) === 0x23) throw new NIP44v3Error('unsupportedVersion', 0x23)

  let raw: Uint8Array
  try {
    raw = base64.decode(b64)
  } catch {
    throw new NIP44v3Error('invalidCiphertext')
  }
  if (raw.length < MIN_WIRE_SIZE) throw new NIP44v3Error('invalidCiphertext')

  const versionByte = raw[0]
  if (versionByte !== VERSION) throw new NIP44v3Error('unsupportedVersion', versionByte)

  const kind = readU32BE(raw, 65)
  const scopeLen = readU32BE(raw, 69)
  if (scopeLen + 73 > raw.length) throw new NIP44v3Error('invalidCiphertext')

  const ctLen = raw.length - 73 - scopeLen
  if (ctLen < MIN_CT_SIZE) throw new NIP44v3Error('invalidCiphertext')

  return {
    nonce: raw.slice(1, 33),
    mac: raw.slice(33, 65),
    kind,
    scope: raw.slice(73, 73 + scopeLen),
    chacha20Ciphertext: raw.slice(73 + scopeLen),
  }
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
