import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import vectors from './test-vectors.json'
import { deriveKeys, SALT_PREFIX } from '../keys'

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
}

const encDec = vectors.encrypt_decrypt as EncDecVec[]

describe('NIP-44 v3 keys layer', () => {
  it('exposes the spec salt prefix "nip44-v3\\x00" (9 bytes)', () => {
    expect(SALT_PREFIX.length).toBe(9)
    expect(Array.from(SALT_PREFIX)).toEqual([
      0x6e, 0x69, 0x70, 0x34, 0x34, 0x2d, 0x76, 0x33, 0x00,
    ])
  })

  it('derives the spec PRK + encryption_key + mac_key from secret1 perspective for all 10 vectors', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const seckey = hexToBytes(v.secret1)
      const pubkey = schnorr.getPublicKey(hexToBytes(v.secret2))
      const nonce = hexToBytes(v.nonce)
      const derived = deriveKeys(seckey, pubkey, nonce)
      if (bytesToHex(derived.prk) !== v.prk) failures.push(`#${i} prk: ${bytesToHex(derived.prk)} != ${v.prk}`)
      if (bytesToHex(derived.encryptionKey) !== v.encryption_key) failures.push(`#${i} enc_key: ${bytesToHex(derived.encryptionKey)} != ${v.encryption_key}`)
      if (bytesToHex(derived.macKey) !== v.mac_key) failures.push(`#${i} mac_key: ${bytesToHex(derived.macKey)} != ${v.mac_key}`)
    }
    if (failures.length > 0) throw new Error(failures.slice(0, 5).join('\n'))
  })

  it('derives the same PRK + keys from secret2 perspective (ECDH symmetry)', () => {
    const failures: string[] = []
    for (const [i, v] of encDec.entries()) {
      const seckey = hexToBytes(v.secret2)
      const pubkey = schnorr.getPublicKey(hexToBytes(v.secret1))
      const nonce = hexToBytes(v.nonce)
      const derived = deriveKeys(seckey, pubkey, nonce)
      if (bytesToHex(derived.prk) !== v.prk) failures.push(`#${i}`)
      if (bytesToHex(derived.encryptionKey) !== v.encryption_key) failures.push(`#${i} enc_key`)
      if (bytesToHex(derived.macKey) !== v.mac_key) failures.push(`#${i} mac_key`)
    }
    if (failures.length > 0) throw new Error(failures.join(','))
  })

  it('rejects wrong-length secret key', () => {
    expect(() => deriveKeys(new Uint8Array(31), new Uint8Array(32), new Uint8Array(32))).toThrow()
  })

  it('rejects wrong-length pubkey', () => {
    expect(() => deriveKeys(new Uint8Array(32), new Uint8Array(31), new Uint8Array(32))).toThrow()
  })

  it('rejects wrong-length nonce', () => {
    expect(() => deriveKeys(new Uint8Array(32), new Uint8Array(32), new Uint8Array(31))).toThrow()
  })

  it('PRK is exactly 32 bytes; both derived keys are exactly 32 bytes', () => {
    const v = encDec[0]
    const seckey = hexToBytes(v.secret1)
    const pubkey = schnorr.getPublicKey(hexToBytes(v.secret2))
    const nonce = hexToBytes(v.nonce)
    const derived = deriveKeys(seckey, pubkey, nonce)
    expect(derived.prk.length).toBe(32)
    expect(derived.encryptionKey.length).toBe(32)
    expect(derived.macKey.length).toBe(32)
  })
})
