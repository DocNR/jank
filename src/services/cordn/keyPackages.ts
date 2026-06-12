/**
 * KeyPackage generation, publication, and consume — Cordn protocol primitive.
 *
 * Three pure async functions that wrap ts-mls + the coordinator client. Used
 * later by the agent pairing flow (Phase 5) to bind jank accounts and agents
 * via MLS KeyPackages. v1 minimum scope: no IndexedDB persistence, no
 * reactive store, no multi-coordinator reconciliation, no last-resort extension
 * (those land in higher-level surfaces when needed).
 *
 * Spec: /tmp/cordn-spec/00.md sections 6 - 10 (identity model + KP publication
 * + client validation).
 *
 * Reference: cordn-web's src/lib/services/chatKeyPackages.svelte.ts.
 */

import {
  generateKeyPackage,
  encode,
  keyPackageEncoder,
  keyPackageDecoder,
  makeKeyPackageRef,
  defaultLifetime,
  defaultCredentialTypes,
  bytesToBase64,
  base64ToBytes,
  type KeyPackage,
  type PrivateKeyPackage,
  type Credential,
  type Decoder
} from 'ts-mls'
import { verifyEvent, type NostrEvent } from 'nostr-tools'

import { createCordnCapabilities, getCiphersuite } from './mlsUtils'
import {
  publishKeyPackage as coordPublishKeyPackage,
  consumeKeyPackage as coordConsumeKeyPackage
} from './coordinatorClient'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/** Build a Cordn BasicCredential whose identity field is the UTF-8 of the
 *  Nostr pubkey hex (cordn-web convention; see chatKeyPackages line 197 +
 *  spec § 6 + § 13). All interoperable implementations MUST agree on this
 *  encoding; cordn-web's createCredential takes the hex pubkey directly and
 *  encodes UTF-8. */
function createBasicCredential(ownerPubkey: string): Credential {
  return {
    credentialType: defaultCredentialTypes.basic,
    identity: utf8Encoder.encode(ownerPubkey)
  }
}

/** Decode a BasicCredential identity (Uint8Array) back to the Nostr pubkey
 *  hex string. Throws if the credential is not BasicCredential.
 *
 *  Note: TS's discriminated-union narrowing on `defaultCredentialTypes.basic`
 *  (a readonly `1`) does not narrow `CredentialBasic | CredentialCustom`
 *  because `CredentialCustom.credentialType` is the wider `number` and TS
 *  cannot prove a `number` is not exactly `1`. We branch on the narrow type
 *  guard manually. */
function readBasicCredentialIdentity(credential: Credential): string {
  const basic = credential as { credentialType: number; identity?: Uint8Array }
  if (basic.credentialType !== defaultCredentialTypes.basic || !basic.identity) {
    throw new Error(
      `cordn keyPackages: expected BasicCredential, got credentialType=${basic.credentialType}`
    )
  }
  return utf8Decoder.decode(basic.identity)
}

/** RFC 9420 KeyPackage reference, hex-encoded. */
async function computeKeyPackageRef(kp: KeyPackage): Promise<string> {
  const cs = await getCiphersuite()
  const ref = await makeKeyPackageRef(kp, cs.hash)
  let hex = ''
  for (let i = 0; i < ref.length; i++) {
    hex += ref[i].toString(16).padStart(2, '0')
  }
  return hex
}

/** Decode TLS-style bytes via the supplied decoder and reject trailing bytes.
 *  ts-mls's `decode` only checks the decoder returned a value; it permits the
 *  decoder to consume a prefix and leave junk. Mirrors cordn-web's
 *  `decodeExact` (chatMlsUtils.ts line ~56). */
function decodeExact<T>(decoder: Decoder<T>, bytes: Uint8Array, label: string): T {
  const decoded = decoder(bytes, 0)
  if (!decoded || decoded[1] !== bytes.length) {
    throw new Error(`cordn keyPackages: invalid ${label} (decode failed or trailing bytes)`)
  }
  return decoded[0]
}

/** A NostrEvent ish that has at minimum the fields verifyEvent needs and the
 *  fields we read off of it (content, pubkey). We keep the unknown surface
 *  narrow so a malicious coordinator can't slip a non-event through the type
 *  guard. */
function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.pubkey === 'string' &&
    typeof obj.sig === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.created_at === 'number' &&
    typeof obj.kind === 'number' &&
    Array.isArray(obj.tags)
  )
}

/** Pull the embedded base64 KeyPackage off the signed publication event body.
 *  Mirrors cordn-web's `readKeyPackageBase64FromPublicationEvent`. Accepts
 *  both the canonical `kp_64` field name and the legacy `keyPackageBase64`
 *  alias for forward-compat. Throws if missing or wrong shape. */
function readEmbeddedKp64(publicationEvent: NostrEvent): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(publicationEvent.content)
  } catch {
    throw new Error('cordn fetchAgentKeyPackage: publication event content is not JSON')
  }
  const args = (parsed as { params?: { arguments?: Record<string, unknown> } })?.params?.arguments
  const candidate =
    typeof args?.kp_64 === 'string'
      ? args.kp_64
      : typeof args?.keyPackageBase64 === 'string'
        ? args.keyPackageBase64
        : null
  if (!candidate) {
    throw new Error('cordn fetchAgentKeyPackage: publication event missing embedded kp_64')
  }
  return candidate
}

// ---------------------------------------------------------------------------
// 1. Generate
// ---------------------------------------------------------------------------

/**
 * Generate a new MLS KeyPackage for the given Nostr pubkey. The
 * BasicCredential identity is bound to the UTF-8 of the pubkey hex per Cordn
 * spec § 6.
 *
 * Caller is responsible for persisting `privatePackage` (with secrecy
 * appropriate to the platform — in the browser, IndexedDB is acceptable for
 * v1) and for publishing `kpRef` + `kpBase64` to a coordinator via
 * `publishOwnKeyPackage`.
 */
export async function generateOwnKeyPackage(ownerPubkey: string): Promise<{
  publicPackage: KeyPackage
  privatePackage: PrivateKeyPackage
  kpRef: string
  kpBase64: string
}> {
  const cs = await getCiphersuite()
  const generated = await generateKeyPackage({
    credential: createBasicCredential(ownerPubkey),
    cipherSuite: cs,
    // Cordn groups require the cordn_group_metadata + app_data_dictionary
    // extensions on every leaf. Bare defaultCapabilities() omits both, and
    // an MLS Add against a cordn group would fail capabilities negotiation.
    capabilities: createCordnCapabilities(),
    lifetime: defaultLifetime()
  })
  const kpRef = await computeKeyPackageRef(generated.publicPackage)
  const kpBase64 = bytesToBase64(encode(keyPackageEncoder, generated.publicPackage))
  return {
    publicPackage: generated.publicPackage,
    privatePackage: generated.privatePackage,
    kpRef,
    kpBase64
  }
}

// ---------------------------------------------------------------------------
// 2. Publish
// ---------------------------------------------------------------------------

/**
 * Publish a previously generated KeyPackage to a coordinator. `signerPubkey`
 * identifies the jank-paired account whose transport-signer signs the
 * gift-wrapped RPC; the coordinator validates this caller identity against
 * the embedded KP's BasicCredential identity per Cordn spec § 8.
 *
 * The Cordn spec's "signed publication payload signature" (§ 7) is satisfied
 * by the ContextVM transport's NIP-59 gift-wrap signature, which is the
 * caller identity the coordinator authenticates. No separate payload-level
 * signature is constructed in v1.
 */
export async function publishOwnKeyPackage(
  coordPubkey: string,
  signerPubkey: string,
  args: { kpRef: string; kpBase64: string }
): Promise<void> {
  const result = await coordPublishKeyPackage(coordPubkey, signerPubkey, {
    kp_ref: args.kpRef,
    kp_64: args.kpBase64
  })
  if (!result.ok) {
    throw new Error(
      `cordn publishOwnKeyPackage: coordinator rejected publication: ${result.error.message}`
    )
  }
}

// ---------------------------------------------------------------------------
// 3. Fetch (consume)
// ---------------------------------------------------------------------------

/** Shape of the `keyPackage` field in a ConsumeKeyPackage response, per
 *  cordn-web's chatGroups.svelte.ts line ~459 (parseConsumedPublishedKeyPackage
 *  call site) and chatKeyPackageQueries' availableKeyPackages query result. */
interface ConsumedKeyPackagePayload {
  /** Stable pubkey the coordinator believes this KP is bound to. The caller
   *  also independently verifies this against the embedded credential. */
  pk: string
  /** RFC 9420 KP reference (hex). */
  kp_ref: string
  /** Base64 of the encoded public KP bytes. */
  kp_64: string
  /** Verbatim signed publication event the coordinator stored at publish time.
   *  Per spec § 7 the coordinator MUST return the same publication payload it
   *  received. `fetchAgentKeyPackage` re-validates it with `verifyEvent` and
   *  decodes the embedded `kp_64` out of its content (per spec § 9). Typed as
   *  `unknown` here because the coordinator surface is untrusted until that
   *  validation runs. */
  event: unknown
  /** True if the KP carries the MLS last-resort extension. */
  last_resort: boolean
}

/**
 * Fetch (consume) an agent's published KeyPackage and perform the full set of
 * client checks required by Cordn spec § 9:
 *
 *   1. the publication payload signature is valid (verifyEvent)
 *   2. the embedded KeyPackage bytes match the signed payload contents
 *      (decoded from the kp_64 INSIDE the signed event content, not from a
 *      coordinator-supplied side channel)
 *   3. the KeyPackage is structurally valid (decodeExact rejects trailing
 *      bytes; ts-mls's decode silently accepts a prefix otherwise)
 *   4. the BasicCredential identity inside the KP matches the signer identity
 *      of the publication payload AND the requested agent identity
 *
 * The kpRef returned here is RECOMPUTED from the decoded KP rather than
 * trusting the coordinator-supplied `kp_ref` field, so a coordinator can't
 * mislabel a KP under a wrong reference.
 *
 * One-shot semantics: a non-last-resort KP is deleted server-side on return.
 */
export async function fetchAgentKeyPackage(
  coordPubkey: string,
  signerPubkey: string,
  agentPubkey: string
): Promise<{ keyPackage: KeyPackage; kpRef: string }> {
  const result = await coordConsumeKeyPackage(coordPubkey, signerPubkey, { id: agentPubkey })
  if (!result.ok) {
    throw new Error(
      `cordn fetchAgentKeyPackage: coordinator rejected consume: ${result.error.message}`
    )
  }
  const sc = result.structuredContent as { keyPackage?: ConsumedKeyPackagePayload } | undefined
  const payload = sc?.keyPackage
  if (!payload || typeof payload.kp_64 !== 'string') {
    throw new Error(
      `cordn fetchAgentKeyPackage: no published key package found for ${agentPubkey.slice(0, 16)}…`
    )
  }

  // Spec § 9 check 1: publication payload is a real Nostr event with a valid
  // signature. Validate shape first so verifyEvent doesn't throw on a
  // malformed object.
  if (!isNostrEvent(payload.event)) {
    throw new Error(
      'cordn fetchAgentKeyPackage: publication event missing or has wrong shape'
    )
  }
  if (!verifyEvent(payload.event)) {
    throw new Error('cordn fetchAgentKeyPackage: publication event signature invalid')
  }
  const publicationEvent = payload.event

  // Spec § 9 check 2: read the KP bytes from the SIGNED event content. This is
  // the binding the signature actually covers; a coordinator that wants to
  // serve a swapped KP would have to re-sign the publication event, which it
  // cannot (it doesn't hold the publisher's key).
  const embeddedKp64 = readEmbeddedKp64(publicationEvent)

  // Belt-and-suspenders: the coordinator also returns kp_64 at the top of the
  // ConsumedKeyPackagePayload. The two MUST agree; if they don't, the
  // coordinator is doing something weird and we refuse to proceed.
  if (embeddedKp64 !== payload.kp_64) {
    throw new Error(
      'cordn fetchAgentKeyPackage: coordinator top-level kp_64 disagrees with signed embedded kp_64'
    )
  }

  // Spec § 9 check 3: structurally valid + no trailing bytes.
  const keyPackage = decodeExact(keyPackageDecoder, base64ToBytes(embeddedKp64), 'key package')

  // Spec § 9 check 4: identity binding. Two independent equalities:
  //   - credential identity == publication signer identity (per spec wording)
  //   - credential identity == requested agent identity (what the caller
  //     asked for; defends against coordinator swapping KPs across pubkeys)
  const credentialIdentity = readBasicCredentialIdentity(keyPackage.leafNode.credential)
  if (credentialIdentity !== publicationEvent.pubkey) {
    throw new Error(
      `cordn fetchAgentKeyPackage: BasicCredential identity does not match publication event signer (kp binds ${credentialIdentity.slice(0, 16)}…, signer ${publicationEvent.pubkey.slice(0, 16)}…)`
    )
  }
  if (credentialIdentity !== agentPubkey) {
    throw new Error(
      `cordn fetchAgentKeyPackage: BasicCredential identity mismatch — requested ${agentPubkey.slice(0, 16)}… but KP binds ${credentialIdentity.slice(0, 16)}…`
    )
  }

  // Recompute kpRef from the decoded KP so the caller doesn't trust a
  // coordinator-supplied label. The coordinator's payload.kp_ref is ignored.
  const kpRef = await computeKeyPackageRef(keyPackage)

  return { keyPackage, kpRef }
}
