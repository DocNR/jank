/**
 * NIP-44 v3 per-message key derivation.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 * Reference impl: nostr-land/ncrypt-go (BSD-3), `nip44v3/keys.go`.
 *
 *   shared_secret  = ECDH(seckey, pubkey)             // 32-byte x-coord
 *   salt           = "nip44-v3\x00" || nonce          // 9 + 32 = 41 bytes
 *   prk            = HKDF-Extract(SHA256, salt, shared_secret)   // 32 bytes
 *   encryption_key = HKDF-Expand(SHA256, prk, "encryption_key", 32)
 *   mac_key        = HKDF-Expand(SHA256, prk, "mac_key", 32)
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { extract, expand } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { NIP44v3Error } from './errors'

export const SALT_PREFIX = new TextEncoder().encode('nip44-v3\x00')
const ENCRYPTION_KEY_INFO = new TextEncoder().encode('encryption_key')
const MAC_KEY_INFO = new TextEncoder().encode('mac_key')

export interface DerivedKeys {
  readonly prk: Uint8Array
  readonly encryptionKey: Uint8Array
  readonly macKey: Uint8Array
}

export function deriveKeys(seckey: Uint8Array, pubkey: Uint8Array, nonce: Uint8Array): DerivedKeys {
  if (seckey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (pubkey.length !== 32) throw new NIP44v3Error('invalidKey')
  if (nonce.length !== 32) throw new NIP44v3Error('invalidKey')

  const sharedX = ecdhSharedSecret(seckey, pubkey)

  const salt = new Uint8Array(SALT_PREFIX.length + nonce.length)
  salt.set(SALT_PREFIX, 0)
  salt.set(nonce, SALT_PREFIX.length)

  const prk = extract(sha256, sharedX, salt)
  const encryptionKey = expand(sha256, prk, ENCRYPTION_KEY_INFO, 32)
  const macKey = expand(sha256, prk, MAC_KEY_INFO, 32)

  return { prk, encryptionKey, macKey }
}

function ecdhSharedSecret(seckey: Uint8Array, xOnlyPubkey: Uint8Array): Uint8Array {
  // BIP-340 x-only → SEC1 compressed form with assumed even-y prefix.
  const compressed = new Uint8Array(33)
  compressed[0] = 0x02
  compressed.set(xOnlyPubkey, 1)

  let shared: Uint8Array
  try {
    shared = secp256k1.getSharedSecret(seckey, compressed)
  } catch {
    throw new NIP44v3Error('invalidKey')
  }
  // getSharedSecret returns the 33-byte compressed point (parity || x);
  // strip the parity byte to get the raw x-coord per spec.
  if (shared.length === 33) return shared.subarray(1, 33)
  if (shared.length === 32) return shared
  throw new NIP44v3Error('invalidKey')
}
