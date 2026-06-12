/**
 * ContextVM constants + shared types for the hand-rolled MCP-over-Nostr
 * transport in `src/services/context-vm-client.service.ts`.
 *
 * Wire format: see Phase 0 findings §4.2 — gift-wrapped (NIP-59) MCP JSON-RPC
 * requests addressed to a server's pubkey, response gift-wrapped back. Outbound
 * uses kind 1059 (persistent gift wrap); Relatr (and presumably other ContextVM
 * servers) RESPOND with kind 21059 (ephemeral gift wrap) so relays don't
 * persist short-lived RPC responses. Verified end-to-end against the live
 * Relatr server 2026-05-24 — see docs/superpowers/plans/contextvm-traces/README.md.
 *
 * Spec: docs/superpowers/specs/2026-05-23-spectr-ai-track-a-relatr-discovery-column.md
 */

/** Kind used by NIP-59 persistent gift wrap. Outbound requests use this kind. */
export const GIFT_WRAP_KIND = 1059
/** Kind used by NIP-59 ephemeral gift wrap. Relatr (and other ContextVM
 *  servers) RESPOND with this kind so relays don't persist short-lived RPC
 *  responses. Subscribe filter MUST include both 1059 and 21059. Verified
 *  end-to-end against the live Relatr server 2026-05-24 — see
 *  `docs/superpowers/plans/contextvm-traces/README.md` finding. */
export const EPHEMERAL_GIFT_WRAP_KIND = 21059
/** Kind used by NIP-59 seal (the inner-most encrypted envelope). */
export const SEAL_KIND = 13
/** Kind used by the ContextVM RPC envelope (the inner-most signed event
 *  carrying the MCP JSON-RPC payload, before the seal + gift-wrap layers). */
export const CONTEXTVM_RPC_KIND = 25910
/** All three kinds Relatr's official SDK subscribes for on the response side.
 *  The 25910 inclusion is defensive — the inner RPC envelope should always be
 *  wrapped, but matching the SDK exactly hedges against backward-compat edges. */
export const CONTEXTVM_RESPONSE_KINDS = [
  GIFT_WRAP_KIND,
  EPHEMERAL_GIFT_WRAP_KIND,
  CONTEXTVM_RPC_KIND
] as const

/** Default request timeout in ms. Matches DVM Feed's 30s. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Lookback window for the response subscription (handles modest clock skew). */
export const RESPONSE_LOOKBACK_S = 60

/** Maximum random offset (in seconds) for gift-wrap created_at jitter (NIP-59). */
export const GIFT_WRAP_JITTER_S = 2 * 24 * 60 * 60 // ±2 days per NIP-59

/** MCP JSON-RPC version (always "2.0" per JSON-RPC spec). */
export const JSONRPC_VERSION = '2.0'

/** Standard MCP JSON-RPC request shape.
 *
 *  `id` is optional because MCP notifications (e.g. `notifications/initialized`)
 *  omit it. `method` is a `string` (not a literal union) because the server
 *  side accepts arbitrary inbound methods and dispatches dynamically. */
export type TMcpRequest = {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

/** Standard MCP JSON-RPC response shape (either result or error). */
export type TMcpResponse<T = unknown> =
  | { jsonrpc: '2.0'; id: string; result: T }
  | { jsonrpc: '2.0'; id: string; error: { code: number; message: string; data?: unknown } }

/** Public result shape from `contextVmClient.callTool`. */
export type ToolCallResult<T = unknown> =
  | { ok: true; structuredContent: T; content?: unknown[] }
  | { ok: false; error: { code: number; message: string; data?: unknown } }

/** Options for a single `callTool` invocation. */
export type ToolCallOptions = {
  /** Pubkey whose signer should sign the wrapped call. Required. */
  signerPubkey: string
  /** Hard timeout in ms. Default 30000. */
  timeoutMs?: number
  /** Override relays. If omitted, fetches the server's NIP-65 list. */
  relays?: string[]
}
