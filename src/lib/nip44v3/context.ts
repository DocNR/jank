/**
 * NIP-44 v3 authenticated-context type.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 *
 * Spec text from `implementing.md`:
 *   "Do not canonicalize or otherwise transform the provided scope, and
 *    reject scopes that are not valid UTF-8."
 *
 * Construction validates UTF-8 via `TextDecoder({fatal: true})`. After that
 * the bytes pass through unchanged — no NFC normalization, no trim, no case
 * fold. Empty scope (0 bytes) is the common case for non-parameterized kinds
 * and is trivially UTF-8 valid.
 */

import { NIP44v3Error } from './errors'

export interface Context {
  readonly kind: number
  readonly scope: Uint8Array
}

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

export function makeContext(kind: number, scope: Uint8Array): Context {
  if (!Number.isInteger(kind) || kind < 0 || kind > 0xffffffff) {
    throw new NIP44v3Error('invalidContext')
  }
  if (scope.length > 0) {
    try {
      STRICT_UTF8_DECODER.decode(scope)
    } catch {
      throw new NIP44v3Error('invalidContext')
    }
  }
  return { kind, scope }
}
