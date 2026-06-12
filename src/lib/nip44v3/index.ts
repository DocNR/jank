/**
 * NIP-44 v3 top-level public API.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 * Reference impl: nostr-land/ncrypt-go (BSD-3), `nip44v3/nip44v3.go`.
 *
 * Composes keys + encryption + ciphertext + context into
 * `(seckey, pubkey, context, plaintext) → base64 wire` and inverse.
 *
 * `_testOnly_encrypt` accepts a caller-supplied nonce so we can produce
 * byte-exact wire output for spec test vectors. Per `implementing.md`:
 * "Do not allow users to specify a custom nonce. This is required for the
 * test vectors, but should be a strictly internal API." The `_testOnly_`
 * prefix is the discipline marker; production callers must use `encrypt`.
 */

import { randomBytes } from '@noble/hashes/utils.js'
import type { Context } from './context'
import { decodeWire, encodeWireBase64 } from './ciphertext'
import { decrypt as encDecrypt, encrypt as encEncrypt } from './encryption'
import { NIP44v3Error } from './errors'
import { deriveKeys } from './keys'

export { NIP44v3Error } from './errors'
export type { NIP44v3ErrorKind } from './errors'
export { makeContext } from './context'
export type { Context } from './context'

export function encrypt(seckey: Uint8Array, pubkey: Uint8Array, context: Context, plaintext: Uint8Array): string {
  let nonce: Uint8Array
  try {
    nonce = randomBytes(32)
  } catch {
    throw new NIP44v3Error('encryptionFailed')
  }
  return _encryptWithNonce(seckey, pubkey, context, plaintext, nonce)
}

export function decrypt(seckey: Uint8Array, pubkey: Uint8Array, context: Context, ciphertext: string): Uint8Array {
  const parts = decodeWire(ciphertext)
  // Spec algorithm step 4 ("Check the scope and kind to be what is expected"):
  // the embedded `parts.kind` / `parts.scope` are compared against the
  // caller-supplied `context.kind` / `context.scope` BEFORE MAC verify. MAC
  // verify alone is insufficient — because the MAC is computed using caller
  // context (which by construction matches what the encryptor signed in),
  // a wire whose embedded kind/scope bytes are tampered but MAC tag is
  // unchanged would otherwise silently decrypt successfully. Both check
  // mismatches collapse to `decryptionFailed` so a wire-tampering observer
  // can't oracle which kind of mismatch tripped the rejection.
  if (parts.kind !== context.kind || !constantTimeBytesEqual(parts.scope, context.scope)) {
    throw new NIP44v3Error('decryptionFailed')
  }
  const derived = deriveKeys(seckey, pubkey, parts.nonce)
  return encDecrypt(
    parts.chacha20Ciphertext,
    parts.mac,
    derived.encryptionKey,
    derived.macKey,
    context.kind,
    context.scope,
    parts.nonce,
  )
}

/**
 * Constant-time byte equality for the scope comparison in `decrypt`. Native
 * `===` and even `Buffer.compare` short-circuit, leaking the mismatch position
 * via timing. XOR-fold + OR accumulator stays branch-free over the full length.
 * Duplicated rather than imported from encryption.ts because the helper is
 * 5 lines and cross-file private exposure adds little.
 */
function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let accum = 0
  for (let i = 0; i < a.length; i++) accum |= a[i] ^ b[i]
  return accum === 0
}

/**
 * Test-only entry that accepts a nonce. Required to produce byte-exact wire
 * output matching the spec test vectors. Do not call from production code.
 *
 * @internal
 */
export function _testOnly_encrypt(
  seckey: Uint8Array,
  pubkey: Uint8Array,
  context: Context,
  plaintext: Uint8Array,
  nonce: Uint8Array,
): string {
  return _encryptWithNonce(seckey, pubkey, context, plaintext, nonce)
}

function _encryptWithNonce(
  seckey: Uint8Array,
  pubkey: Uint8Array,
  context: Context,
  plaintext: Uint8Array,
  nonce: Uint8Array,
): string {
  const derived = deriveKeys(seckey, pubkey, nonce)
  const { ciphertext, mac } = encEncrypt(
    plaintext,
    derived.encryptionKey,
    derived.macKey,
    context.kind,
    context.scope,
    nonce,
  )
  return encodeWireBase64({
    nonce,
    mac,
    kind: context.kind,
    scope: context.scope,
    chacha20Ciphertext: ciphertext,
  })
}
