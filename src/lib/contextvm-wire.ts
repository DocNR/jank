import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  type Event as NEvent
} from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  EPHEMERAL_GIFT_WRAP_KIND,
  GIFT_WRAP_JITTER_S,
  GIFT_WRAP_KIND,
  JSONRPC_VERSION,
  SEAL_KIND,
  type TMcpRequest,
  type TMcpResponse,
  type ToolCallResult
} from './contextvm'
import { ISigner } from '@/types'

/** Build an MCP JSON-RPC request envelope. Pure. */
export function encodeMcpRequest(
  id: string,
  method: TMcpRequest['method'],
  params: Record<string, unknown>
): TMcpRequest {
  return { jsonrpc: JSONRPC_VERSION, id, method, params }
}

/** Parse a JSON string into an MCP request envelope. Returns `null` for
 *  malformed input (caller silent-drops). Pure. */
export function parseMcpRequest(raw: string): TMcpRequest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const r = parsed as Record<string, unknown>
  if (r.jsonrpc !== JSONRPC_VERSION) return null
  if (typeof r.method !== 'string') return null
  return parsed as TMcpRequest
}

/** Build an MCP JSON-RPC response envelope. Pure. */
export function encodeMcpResponse<T>(
  id: string | number,
  body: { result: T } | { error: { code: number; message: string; data?: unknown } }
): TMcpResponse<T> {
  return { jsonrpc: JSONRPC_VERSION, id, ...body } as TMcpResponse<T>
}

/** Parse a JSON string into an MCP response. Returns `matched` so callers can
 *  ignore stale or unrelated responses. */
export function parseMcpResponse<T = unknown>(
  raw: string,
  expectedId: string
): { matched: false } | { matched: true; result: ToolCallResult<T> } {
  let parsed: TMcpResponse<{ content?: unknown[]; structuredContent?: T }>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { matched: false }
  }
  if (parsed?.id !== expectedId) return { matched: false }
  if ('error' in parsed) {
    return { matched: true, result: { ok: false, error: parsed.error } }
  }
  if ('result' in parsed && parsed.result) {
    return {
      matched: true,
      result: {
        ok: true,
        content: parsed.result.content,
        structuredContent: parsed.result.structuredContent as T
      }
    }
  }
  return { matched: false }
}

/** Random unix-seconds offset within [-jitterSeconds, 0]. NIP-59 §3 mandates
 *  past-only timestamps ("created_at field for the gift wrap MUST be backdated
 *  up to two days in the past"); relays may reject future-dated events. */
function jitteredTimestamp(jitterSeconds: number = GIFT_WRAP_JITTER_S): number {
  const offset = Math.floor(Math.random() * jitterSeconds)
  return Math.floor(Date.now() / 1000) - offset
}

export type WrapGiftInput = {
  /** Only `signEvent` + `nip44Encrypt` are used — the inner + seal kinds carry
   *  the sender's pubkey via `signEvent` filling it in, and the wrap layer uses
   *  an ephemeral key (not the sender's signer) per NIP-59. */
  senderSigner: Pick<ISigner, 'signEvent' | 'nip44Encrypt'>
  recipientPubkey: string
  innerKind: number
  innerContent: string
  /** Outer wrap kind. 1059 (persistent, default) for requests; 21059
   *  (ephemeral) for short-lived RPC responses. */
  outerKind?: number
  /** Wire format mode.
   *  - 'nip59' (default): strict NIP-59 — wrap encloses a seal (kind 13)
   *    which encloses the signed inner event. 3-layer encryption.
   *  - 'simple': @contextvm/sdk-compatible — wrap directly encloses the
   *    JSON-stringified signed inner event. 2-layer encryption.
   *  The ContextVM ecosystem (Relatr server pipeline, @contextvm/sdk client)
   *  uses 'simple'. Use it for outbound RPC to those endpoints. */
  mode?: 'nip59' | 'simple'
  /** When wrapping a RESPONSE to a previously-received request, pass the
   *  inner event ID of the original request. Adds `['e', responseToEventId]`
   *  to the inner event's tags so the @contextvm/sdk client can correlate
   *  the response to its outstanding request (matches MCP id field too, but
   *  the SDK requires the `e` tag in addition). Without this, the SDK logs
   *  "Received JSON-RPC response without correlation `e` tag" and drops it. */
  responseToEventId?: string
}

/** Build a gift-wrapped MCP envelope.
 *
 *  Two wire-format modes (see WrapGiftInput.mode):
 *  - 'nip59' (default): wrap → seal → inner (3 NIP-44 encryptions, sender
 *    identity proven by seal signature)
 *  - 'simple': wrap → inner (2 NIP-44 encryptions, sender identity proven
 *    by signed inner event's pubkey + signature)
 *
 *  Pure modulo the ephemeral-key randomness + nip44 nonce — output structure
 *  is deterministic. */
export async function wrapGift(input: WrapGiftInput): Promise<NEvent> {
  const { senderSigner, recipientPubkey, innerKind, innerContent } = input
  const mode = input.mode ?? 'nip59'

  // 1. Build + sign the inner event (kind innerKind, e.g. 25910 for MCP RPC).
  //    Sender's pubkey is filled in by signEvent. The signed inner event
  //    carries the sender's identity + cryptographic proof in BOTH wire
  //    modes — readers of the simple-mode wrap rely on this inner sig to
  //    verify the sender, while nip59-mode readers verify via the seal sig.
  //    When this is a RESPONSE, include `['e', responseToEventId]` so the
  //    @contextvm/sdk client can correlate the response to its request.
  const innerTags: string[][] = [['p', recipientPubkey]]
  if (input.responseToEventId) {
    innerTags.push(['e', input.responseToEventId])
  }
  const innerDraft = {
    kind: innerKind,
    created_at: Math.floor(Date.now() / 1000),
    tags: innerTags,
    content: innerContent
  }
  const innerSigned = await senderSigner.signEvent(innerDraft)
  const innerSerialized = JSON.stringify(innerSigned)

  // 2. Build the content that goes inside the outer gift-wrap envelope.
  //    'simple' = JSON-stringified signed inner event (no seal layer).
  //    'nip59' = signed seal (kind 13) whose content is NIP-44(innerSerialized).
  let wrappedContentJson: string
  if (mode === 'simple') {
    wrappedContentJson = innerSerialized
  } else {
    const sealContent = await senderSigner.nip44Encrypt(recipientPubkey, innerSerialized)
    const sealDraft = {
      kind: SEAL_KIND,
      created_at: jitteredTimestamp(),
      tags: [],
      content: sealContent
    }
    const sealSigned = await senderSigner.signEvent(sealDraft)
    wrappedContentJson = JSON.stringify(sealSigned)
  }

  // 3. Gift wrap: kind 1059 (or 21059), NIP-44 encrypted to recipient with
  //    an EPHEMERAL key. Ephemeral signer hides sender identity from the
  //    outer event — readers must decrypt to learn anything about sender.
  const ephemeralSk = generateSecretKey()
  const ephemeralPk = getPublicKey(ephemeralSk)
  const conversationKey = nip44.utils.getConversationKey(ephemeralSk, recipientPubkey)
  const wrapContent = nip44.encrypt(wrappedContentJson, conversationKey)

  // Wrap timestamp policy:
  // - Persistent gift wrap (kind 1059): backdated per NIP-59 §3 ("created_at
  //   MUST be backdated up to two days in the past") to defeat timing analysis
  //   when relays persist the event.
  // - Ephemeral gift wrap (kind 21059): current time. Relays REJECT backdated
  //   ephemeral events with "invalid: ephemeral event expired" because ephemeral
  //   events aren't stored — there's no timing-analysis attack to mitigate by
  //   backdating, and stale timestamps look like replay attempts. Matches what
  //   @contextvm/sdk's encryptMessage does for all kinds.
  const outerKind = input.outerKind ?? GIFT_WRAP_KIND
  const wrapDraft = {
    kind: outerKind,
    created_at:
      outerKind === EPHEMERAL_GIFT_WRAP_KIND
        ? Math.floor(Date.now() / 1000)
        : jitteredTimestamp(),
    tags: [['p', recipientPubkey]],
    content: wrapContent,
    pubkey: ephemeralPk
  }
  return finalizeEvent(wrapDraft, ephemeralSk) as NEvent
}

export type UnwrapGiftInput = {
  gift: NEvent
  recipientSigner: Pick<ISigner, 'nip44Decrypt'>
  recipientPubkey: string
}

export type UnwrapGiftOutput = {
  innerKind: number
  innerContent: string
  senderPubkey: string
  /** ID of the inner (signed) event. Required when building a response: the
   *  response's inner event MUST carry `['e', innerEventId]` so the
   *  @contextvm/sdk client can correlate it to the outstanding request. */
  innerEventId: string
}

/** Unwrap a gift-wrapped MCP envelope. Permissive: handles BOTH wire formats
 *  (see WrapGiftInput.mode) by auto-detecting from the decrypted content's
 *  kind. Returns the inner event's kind + content + verified sender pubkey.
 *
 *  - 'nip59' (3-layer): decrypted wrap content is a SEAL (kind 13), seal's
 *    content is NIP-44(innerEvent). Sender pubkey = seal.pubkey.
 *  - 'simple' (2-layer, SDK): decrypted wrap content IS the signed inner
 *    event directly (kind matches CONTEXTVM_RPC_KIND or whatever the
 *    sender-side chose). Sender pubkey = inner.pubkey.
 *
 *  Accepts BOTH 1059 (persistent wrap) and 21059 (ephemeral wrap) as the
 *  outer kind. */
export async function unwrapGift(input: UnwrapGiftInput): Promise<UnwrapGiftOutput> {
  const { gift, recipientSigner, recipientPubkey } = input
  if (gift.kind !== GIFT_WRAP_KIND && gift.kind !== EPHEMERAL_GIFT_WRAP_KIND) {
    throw new Error(
      `Expected kind ${GIFT_WRAP_KIND} or ${EPHEMERAL_GIFT_WRAP_KIND}, got ${gift.kind}`
    )
  }

  // Fail fast if the gift isn't addressed to this recipient — avoids an opaque
  // decrypt failure when callers pass a mismatched pubkey.
  const addressedTo = gift.tags.find((t) => t[0] === 'p')?.[1]
  if (addressedTo !== recipientPubkey) {
    throw new Error(
      `Gift not addressed to this recipient (expected ${recipientPubkey.slice(0, 16)}…, got ${addressedTo?.slice(0, 16) ?? 'no p-tag'}…)`
    )
  }

  // 1. Decrypt the outer wrap (NIP-44 with the EPHEMERAL pubkey = gift.pubkey).
  const decryptedJson = await recipientSigner.nip44Decrypt(gift.pubkey, gift.content)
  const decrypted = JSON.parse(decryptedJson) as NEvent

  // 2. Auto-detect format from the decrypted event's kind:
  //    - kind === SEAL_KIND (13)  → NIP-59 strict (3-layer); decrypt seal too
  //    - any other kind           → SDK 'simple' (2-layer); decrypted IS inner
  if (decrypted.kind === SEAL_KIND) {
    // NIP-59 3-layer path. The seal's pubkey becomes senderPubkey, so its
    // Schnorr signature MUST be verified before we trust it. The seal is
    // NIP-44-encrypted on the wire — relays only ever validated the EPHEMERAL
    // outer gift-wrap signature, never this one — so this is the sole identity
    // check on the sender. Verify before decrypting the seal content. Throwing
    // is fine: the server silent-drops unwrap failures.
    if (!verifyEvent(decrypted)) {
      throw new Error('unwrapGift: seal signature verification failed (possible sender spoof)')
    }
    const innerJson = await recipientSigner.nip44Decrypt(decrypted.pubkey, decrypted.content)
    const inner = JSON.parse(innerJson) as NEvent
    return {
      innerKind: inner.kind,
      innerContent: inner.content,
      senderPubkey: decrypted.pubkey,
      innerEventId: inner.id
    }
  }

  // SDK simple 2-layer path — the decrypted event IS the signed inner event,
  // and its pubkey becomes senderPubkey. It was NIP-44-encrypted on the wire,
  // so NO relay ever validated its signature — the outer wrap is signed by a
  // throwaway ephemeral key, not the sender. Without this check, anyone who can
  // deliver a gift wrap to the recipient (encrypting to a public key — no
  // secret needed) could forge an inner event claiming a paired agent's pubkey
  // and be authorized as that agent by the server's pairedAgents gate. Verify
  // before returning. Throwing is fine: the server silent-drops unwrap failures.
  if (!verifyEvent(decrypted)) {
    throw new Error('unwrapGift: inner signature verification failed (possible sender spoof)')
  }
  return {
    innerKind: decrypted.kind,
    innerContent: decrypted.content,
    senderPubkey: decrypted.pubkey,
    innerEventId: decrypted.id
  }
}
