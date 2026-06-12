// src/lib/dvm.ts
//
// NIP-90 content-discovery DVM constants + helpers.
//
// Kind 5300 (job request) → Kind 6300 (job result) — pattern is request_kind
// + 1000 = result_kind. Status messages live on kind 7000. DVMs advertise
// support via NIP-89 Handler Information (kind 31990) with a `k` tag of the
// kinds they handle.
//
// References:
//   - https://nips.nostr.com/90
//   - https://nips.nostr.com/89
//   - https://github.com/nostr-protocol/data-vending-machines/blob/master/kinds/5300.md
import { Event as NEvent } from 'nostr-tools'

export const DVM_CONTENT_DISCOVERY_JOB_KIND = 5300
export const DVM_CONTENT_DISCOVERY_RESULT_KIND = 6300
export const DVM_JOB_STATUS_KIND = 7000
export const NIP89_HANDLER_KIND = 31990

export type TDvmHandlerMetadata = {
  /** From parsed kind-31990 content (a JSON-encoded NIP-01 metadata-style blob). */
  name?: string
  display_name?: string
  picture?: string
  banner?: string
  about?: string
  nip90Params?: Record<string, unknown>
}

export type TDvmHandler = {
  event: NEvent
  pubkey: string
  identifier: string
  metadata: TDvmHandlerMetadata
}

/**
 * Validate a kind-31990 event as a content-discovery DVM handler:
 * - declares 5300 as one of its supported kinds (`k` tag)
 * - has parseable JSON content with at least a `name` or `display_name`
 *
 * Returns the normalized handler shape, or `null` if invalid.
 */
export function parseContentDvmHandler(event: NEvent): TDvmHandler | null {
  if (event.kind !== NIP89_HANDLER_KIND) return null

  const kTags = event.tags
    .filter((t) => t[0] === 'k')
    .map((t) => t[1])
    .filter(Boolean)
  if (!kTags.includes(String(DVM_CONTENT_DISCOVERY_JOB_KIND))) return null

  const identifier = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!identifier) return null

  let metadata: TDvmHandlerMetadata
  try {
    const parsed = JSON.parse(event.content)
    if (!parsed || typeof parsed !== 'object') return null
    metadata = parsed as TDvmHandlerMetadata
  } catch {
    return null
  }

  // Need at least some human-readable name to render a row meaningfully.
  if (!metadata.name && !metadata.display_name) return null

  return { event, pubkey: event.pubkey, identifier, metadata }
}

/**
 * Best-effort display name for a DVM handler. Falls back to a truncated pubkey
 * when neither `name` nor `display_name` is set (shouldn't happen for valid
 * handlers, but defensive).
 */
export function getDvmName(handler: TDvmHandler): string {
  return (
    handler.metadata.display_name ||
    handler.metadata.name ||
    `${handler.pubkey.slice(0, 8)}…`
  )
}

/**
 * Parse a kind-6300 result event's `content` field into a flat list of event
 * ids (kind-6300 `content` is a JSON-stringified array of `["e", id, relay?]`
 * or `["a", addr, relay?]` tags). Returns the e-tag ids only — `a` (address)
 * references are skipped for v1 since they require a second resolve hop.
 *
 * Returns an empty array on parse failure or unexpected shape.
 */
export function parseDvmResultEventIds(event: NEvent): string[] {
  if (event.kind !== DVM_CONTENT_DISCOVERY_RESULT_KIND) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(event.content)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const ids: string[] = []
  for (const tag of parsed) {
    if (!Array.isArray(tag) || tag.length < 2) continue
    if (tag[0] === 'e' && typeof tag[1] === 'string' && tag[1]) {
      ids.push(tag[1])
    }
  }
  return ids
}

export type TDvmJobStatus = 'payment-required' | 'processing' | 'error' | 'success' | 'partial'

export type TDvmStatusMessage = {
  status: TDvmJobStatus
  message?: string
  /** The 5300 request id this status refers to (from the `e` tag). */
  requestId?: string
  /** Wall-clock created_at of the status event itself, for ordering. */
  createdAt: number
}

/**
 * Extract the status + human message from a kind-7000 event.
 * Shape per NIP-90: `["status", <status>, <extra info?>]` in tags.
 */
export function parseDvmStatus(event: NEvent): TDvmStatusMessage | null {
  if (event.kind !== DVM_JOB_STATUS_KIND) return null
  const statusTag = event.tags.find((t) => t[0] === 'status')
  if (!statusTag) return null
  const status = statusTag[1] as TDvmJobStatus | undefined
  if (!status) return null
  return {
    status,
    message: statusTag[2] || event.content || undefined,
    requestId: event.tags.find((t) => t[0] === 'e')?.[1],
    createdAt: event.created_at
  }
}
