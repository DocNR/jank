import { describe, expect, it } from 'vitest'
import { base64 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import vectors from './test-vectors.json'
import { encrypt as encEncrypt, decrypt as encDecrypt } from '../encryption'

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

const encDec = vectors.encrypt_decrypt as EncDecVec[]
const decryptOnly = vectors.decrypt_only as EncDecVec[]

// Inline wire parser/assembler. Replaced by the Ciphertext layer test once
// that file lands, but used here so the encryption layer can be exercised
// against spec vectors in isolation.
function parseWire(b64: string): { nonce: Uint8Array; mac: Uint8Array; kind: number; scope: Uint8Array; ct: Uint8Array } {
  const raw = base64.decode(b64)
  if (raw[0] !== 0x03) throw new Error(`expected version 0x03, got ${raw[0]}`)
  const nonce = raw.subarray(1, 33)
  const mac = raw.subarray(33, 65)
  const kind = ((raw[65] << 24) | (raw[66] << 16) | (raw[67] << 8) | raw[68]) >>> 0
  const scopeLen = ((raw[69] << 24) | (raw[70] << 16) | (raw[71] << 8) | raw[72]) >>> 0
  const scope = raw.subarray(73, 73 + scopeLen)
  const ct = raw.subarray(73 + scopeLen)
  return { nonce, mac, kind, scope, ct }
}

function assembleWire(nonce: Uint8Array, mac: Uint8Array, kind: number, scope: Uint8Array, ct: Uint8Array): string {
  const buf = new Uint8Array(1 + nonce.length + mac.length + 4 + 4 + scope.length + ct.length)
  let o = 0
  buf[o++] = 0x03
  buf.set(nonce, o); o += nonce.length
  buf.set(mac, o); o += mac.length
  buf[o++] = (kind >>> 24) & 0xff
  buf[o++] = (kind >>> 16) & 0xff
  buf[o++] = (kind >>> 8) & 0xff
  buf[o++] = kind & 0xff
  const sl = scope.length
  buf[o++] = (sl >>> 24) & 0xff
  buf[o++] = (sl >>> 16) & 0xff
  buf[o++] = (sl >>> 8) & 0xff
  buf[o++] = sl & 0xff
  buf.set(scope, o); o += scope.length
  buf.set(ct, o)
  return base64.encode(buf)
}

describe('NIP-44 v3 encryption layer — encrypt() against 10 encrypt_decrypt vectors', () => {
  it('produces byte-exact wire ciphertext matching every vector', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const encKey = hexToBytes(v.encryption_key)
      const macKey = hexToBytes(v.mac_key)
      const nonce = hexToBytes(v.nonce)
      const scope = hexToBytes(v.scope_hex)
      const plaintext = hexToBytes(v.plaintext_hex)
      const { ciphertext: ct, mac } = encEncrypt(plaintext, encKey, macKey, v.kind, scope, nonce)
      const wire = assembleWire(nonce, mac, v.kind, scope, ct)
      if (wire !== v.ciphertext) failures.push(`#${i} wire mismatch:\n  expected ${v.ciphertext}\n  actual   ${wire}`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 3).join('\n\n'))
  })
})

describe('NIP-44 v3 encryption layer — decrypt() against 10 encrypt_decrypt vectors', () => {
  it('recovers exact plaintext for every vector', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const encKey = hexToBytes(v.encryption_key)
      const macKey = hexToBytes(v.mac_key)
      const expectedScope = hexToBytes(v.scope_hex)
      const { nonce, mac, kind: wireKind, scope: wireScope, ct } = parseWire(v.ciphertext)
      if (wireKind !== v.kind) failures.push(`#${i} wire kind mismatch`)
      if (bytesToHex(wireScope) !== v.scope_hex) failures.push(`#${i} wire scope mismatch`)
      const plain = encDecrypt(ct, mac, encKey, macKey, v.kind, expectedScope, nonce)
      if (bytesToHex(plain) !== v.plaintext_hex) failures.push(`#${i} plaintext mismatch: got ${bytesToHex(plain)}`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 3).join('\n\n'))
  })
})

describe('NIP-44 v3 encryption layer — decrypt_only (non-standard padding tolerance)', () => {
  // CRITICAL: the 5 decrypt_only vectors are exactly the gotcha-1 trap. They
  // are intentionally padded to lengths that differ from `targetSize(plaintext_length)`,
  // but with all-zero padding. Spec commit c6daedd: "Implementations MUST
  // NOT do any other checks on the padding length."
  it('decrypts all 5 non-standard-padding ciphertexts (Amber PR #456 lesson)', () => {
    const failures: string[] = []
    for (const [i, v] of decryptOnly.entries()) {
      const encKey = hexToBytes(v.encryption_key)
      const macKey = hexToBytes(v.mac_key)
      const expectedScope = hexToBytes(v.scope_hex)
      const { nonce, mac, ct } = parseWire(v.ciphertext)
      try {
        const plain = encDecrypt(ct, mac, encKey, macKey, v.kind, expectedScope, nonce)
        if (bytesToHex(plain) !== v.plaintext_hex) {
          failures.push(`#${i} (${v.note}) plaintext: got ${bytesToHex(plain)}, expected ${v.plaintext_hex}`)
        }
      } catch (e) {
        failures.push(`#${i} (${v.note}) threw: ${(e as Error).message}`)
      }
    }
    if (failures.length > 0) throw new Error(failures.join('\n'))
  })
})

describe('NIP-44 v3 encryption layer — MAC + context binding', () => {
  it('rejects tampered MAC (last byte flipped)', () => {
    const v = encDec[0]
    const encKey = hexToBytes(v.encryption_key)
    const macKey = hexToBytes(v.mac_key)
    const scope = hexToBytes(v.scope_hex)
    const { nonce, mac, ct } = parseWire(v.ciphertext)
    const tampered = new Uint8Array(mac)
    tampered[tampered.length - 1] ^= 0x01
    expect(() => encDecrypt(ct, tampered, encKey, macKey, v.kind, scope, nonce)).toThrow()
  })

  it('rejects wrong expected kind (MAC bound to kind)', () => {
    const v = encDec[0]
    const encKey = hexToBytes(v.encryption_key)
    const macKey = hexToBytes(v.mac_key)
    const scope = hexToBytes(v.scope_hex)
    const { nonce, mac, ct } = parseWire(v.ciphertext)
    expect(() => encDecrypt(ct, mac, encKey, macKey, v.kind + 1, scope, nonce)).toThrow()
  })

  it('rejects wrong expected scope (MAC bound to scope)', () => {
    const v = encDec[0]
    const encKey = hexToBytes(v.encryption_key)
    const macKey = hexToBytes(v.mac_key)
    const { nonce, mac, ct } = parseWire(v.ciphertext)
    const wrongScope = new TextEncoder().encode('different')
    expect(() => encDecrypt(ct, mac, encKey, macKey, v.kind, wrongScope, nonce)).toThrow()
  })

  it('rejects wrong-length encryption key', () => {
    const v = encDec[0]
    const macKey = hexToBytes(v.mac_key)
    const scope = hexToBytes(v.scope_hex)
    const { nonce, mac, ct } = parseWire(v.ciphertext)
    expect(() => encDecrypt(ct, mac, new Uint8Array(31), macKey, v.kind, scope, nonce)).toThrow()
  })

  it('encrypts empty plaintext and decrypts back to empty', () => {
    const encKey = new Uint8Array(32).fill(0x42)
    const macKey = new Uint8Array(32).fill(0x43)
    const nonce = new Uint8Array(32).fill(0x44)
    const { ciphertext: ct, mac } = encEncrypt(new Uint8Array(0), encKey, macKey, 1, new Uint8Array(0), nonce)
    const plain = encDecrypt(ct, mac, encKey, macKey, 1, new Uint8Array(0), nonce)
    expect(plain.length).toBe(0)
  })
})
