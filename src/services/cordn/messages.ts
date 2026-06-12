/**
 * MLS-encrypted application-message round-trip — Cordn protocol primitives.
 *
 * Two pure async functions over `ClientState`. Mirrors cordn-web's
 * `createApplicationMessageBase64` and the application-message branch of
 * `ingestChatGroupMessages` (chatGroupMessages.ts lines 336-383, 520-559) but
 * with a pure-state API: the caller owns persistence of `newState` and decides
 * when to call `idb.putMlsState`. Matches the pattern set by groups.ts
 * (Task 2.6b).
 *
 * v1 minimum scope: no pending-epoch tracking, no admin-auth callback, no
 * edit/delete/react tag handling, no sync-issue surfacing, no removed-from-
 * group detection, no batch ingestion. Phase 3 (drawer UI), Phase 5 (pairing
 * wizard), and any future message-loop surface compose these primitives.
 *
 * Authorship invariant (spec/02 § 5): every Cordn application message binds
 * the sender's stable Nostr pubkey into the MLS `authenticated_data` (AAD).
 * On encrypt we put `envelope.pubkey` there. On decrypt we extract it and
 * assert it matches both:
 *   1. The `expectedSenderPubkey` provided by the caller (e.g. the publisher
 *      pubkey from the Cordn coordinator's gift-wrap).
 *   2. The `envelope.pubkey` field inside the decrypted envelope. This second
 *      check is handled by `decodeEnvelope` so the two layers stay strict.
 *
 * Forward secrecy: ts-mls returns a `consumed: Uint8Array[]` of ephemeral key
 * material per call. We `zeroOutUint8Array` each entry per the ts-mls README
 * convention. The caller MUST persist `newState` before the next encrypt or
 * decrypt for this group, else the ratchet desyncs.
 *
 * Auth service: `unsafeTestingAuthenticationService` matches cordn-web (see
 * chatGroupMessages.ts lines 348, 378) and groups.ts. Security boundary is
 * the Cordn coordinator's transport-level identity check.
 */

import {
  createApplicationMessage,
  processMessage,
  encode,
  decode,
  mlsMessageEncoder,
  mlsMessageDecoder,
  unsafeTestingAuthenticationService,
  wireformats,
  zeroOutUint8Array,
  type ClientState
} from 'ts-mls'

import { getCiphersuite } from './mlsUtils'
import { decodeEnvelope, type CordnEnvelope } from './envelope'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Wrap a Cordn envelope in an MLS application message. Returns the opaque
 * ciphertext bytes (ready for PostGroupMessage) and the advanced `ClientState`.
 *
 * The envelope JSON is the inner message; `envelope.pubkey` is the AAD that
 * binds the sender identity (the receiving side asserts it via
 * `decryptInbound` + `decodeEnvelope`).
 */
export async function encryptOutbound(input: {
  state: ClientState
  envelope: CordnEnvelope
}): Promise<{
  /** Encoded MLS opaque message bytes ready for PostGroupMessage. */
  ciphertext: Uint8Array
  /** Advanced ClientState. Caller MUST persist via `idb.putMlsState` before
   *  the next encrypt or decrypt for this group, else the ratchet desyncs. */
  newState: ClientState
}> {
  const cipherSuite = await getCiphersuite()
  const result = await createApplicationMessage({
    context: { cipherSuite, authService: unsafeTestingAuthenticationService },
    state: input.state,
    message: utf8Encoder.encode(JSON.stringify(input.envelope)),
    authenticatedData: utf8Encoder.encode(input.envelope.pubkey)
  })

  // Forward-secrecy hygiene per ts-mls README "Basic Usage".
  result.consumed.forEach(zeroOutUint8Array)

  const ciphertext = encode(mlsMessageEncoder, result.message)
  return { ciphertext, newState: result.newState }
}

/**
 * Decode + decrypt an MLS opaque ciphertext into the inner Cordn envelope.
 * Asserts the MLS-authenticated sender matches `expectedSenderPubkey`, then
 * hands the decrypted bytes to `decodeEnvelope` which re-asserts
 * `envelope.pubkey === mlsSender` and re-derives the NIP-01 id.
 *
 * Throws on:
 *   - malformed MLS bytes
 *   - non-application-message kinds (commits/proposals/welcome should be
 *     handled by their own pipelines; this primitive is application-message-
 *     only by design)
 *   - missing or mismatched authenticated sender AAD
 *   - any envelope-decode failure (sig present, pubkey mismatch, id mismatch)
 */
export async function decryptInbound(input: {
  state: ClientState
  /** Encoded MLS opaque message bytes from FetchGroupMessages /
   *  SubscribeGroupMessages. */
  ciphertext: Uint8Array
  /** Expected sender Nostr pubkey, typically the publisher pubkey from the
   *  Cordn coordinator's gift-wrap envelope. Throws on mismatch. */
  expectedSenderPubkey: string
}): Promise<{
  envelope: CordnEnvelope
  /** Advanced ClientState. Caller MUST persist via `idb.putMlsState` before
   *  the next encrypt or decrypt for this group. */
  newState: ClientState
}> {
  const decoded = decode(mlsMessageDecoder, input.ciphertext)
  if (!decoded) {
    throw new Error('cordn decryptInbound: failed to decode MLS message')
  }

  // Narrow to framed (private/public) so processMessage accepts it. A welcome /
  // group_info / key_package coming in here is a routing bug, not a normal flow.
  if (
    decoded.wireformat !== wireformats.mls_private_message &&
    decoded.wireformat !== wireformats.mls_public_message
  ) {
    throw new Error(
      `cordn decryptInbound: expected framed MLS message, got wireformat=${decoded.wireformat}`
    )
  }

  const cipherSuite = await getCiphersuite()
  const processed = await processMessage({
    context: { cipherSuite, authService: unsafeTestingAuthenticationService },
    state: input.state,
    message: decoded
  })

  if (processed.kind !== 'applicationMessage') {
    throw new Error(
      `cordn decryptInbound: expected applicationMessage, got kind=${processed.kind}`
    )
  }

  // Forward-secrecy hygiene per ts-mls README "Basic Usage".
  processed.consumed.forEach(zeroOutUint8Array)

  if (processed.aad.length === 0) {
    throw new Error(
      'cordn decryptInbound: application message missing authenticated sender (AAD empty)'
    )
  }
  const mlsSender = utf8Decoder.decode(processed.aad)
  if (mlsSender !== input.expectedSenderPubkey) {
    throw new Error(
      `cordn decryptInbound: authenticated sender mismatch: expected ${input.expectedSenderPubkey.slice(0, 16)}, got ${mlsSender.slice(0, 16)}`
    )
  }

  // decodeEnvelope re-asserts envelope.pubkey === mlsSender + NIP-01 id integrity.
  const json = utf8Decoder.decode(processed.message)
  const envelope = decodeEnvelope(json, mlsSender)

  return { envelope, newState: processed.newState }
}
