/**
 * Relatr server constants + response types.
 *
 * Relatr is a public ContextVM server providing trust-score computation
 * over Nostr's social graph. Pubkey verified via nak 2026-05-23.
 *
 * Tool surface (from kind-11317 announcement, 2026-05-23):
 * - search_profiles({query, limit?, extendToNostr?})
 *     → {results: [{pubkey, trustScore (0-1), rank, exactMatch?}], totalFound, searchTimeMs}
 * - calculate_trust_score / calculate_trust_scores (used by slice 2, Path B)
 * - stats (diagnostic)
 *
 * Wire transport: gift-wrapped MCP via `src/services/context-vm-client.service.ts`.
 * Wire mode is `simple` (2-layer) per PR #65 — the SDK-style envelope Relatr
 * actually accepts. Verified empirically against the live server 2026-05-25
 * (`scripts/smoke-relatr-wire-modes.mjs`).
 */

export const RELATR_PUBKEY =
  '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3'
export const RELATR_NPUB =
  'npub1w5rgyvpunuxa446egx6fahyagm376vrtnm3nx5ec5gdruszvt73spqeu4t'

/** Fallback relays if NIP-65 fetch fails. Verified from Relatr's kind-10002
 *  2026-05-25. `context-vm-client.service` already throws when no relays
 *  resolve, so this is purely informational — kept here for parity with the
 *  smoke script and as a single source of truth for engineers debugging. */
export const RELATR_FALLBACK_RELAYS = [
  'wss://relay.contextvm.org',
  'wss://relay2.contextvm.org',
  'wss://relay.primal.net'
]

/** A single profile from search_profiles results. */
export type TRelatrProfileResult = {
  pubkey: string
  /** 0.0 - 1.0 inclusive. */
  trustScore: number
  /** 1-indexed rank within results. */
  rank: number
  /** Whether the profile's name/handle exactly matches the query. Optional. */
  exactMatch?: boolean
}

export type TRelatrSearchProfilesResult = {
  results: TRelatrProfileResult[]
  totalFound: number
  searchTimeMs: number
}

/** Type guard for search_profiles output. Defensive: validates required fields
 *  and rejects malformed entries so a misbehaving server can't poison our UI.
 *  Used by `useRelatrDiscovery` to validate Relatr's structuredContent before
 *  setting state. */
export function isRelatrSearchProfilesResult(
  v: unknown
): v is TRelatrSearchProfilesResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (!Array.isArray(obj.results)) return false
  if (typeof obj.totalFound !== 'number') return false
  if (typeof obj.searchTimeMs !== 'number') return false
  for (const r of obj.results) {
    if (typeof r !== 'object' || r === null) return false
    const entry = r as Record<string, unknown>
    if (typeof entry.pubkey !== 'string' || entry.pubkey.length !== 64) return false
    if (typeof entry.trustScore !== 'number') return false
    if (entry.trustScore < 0 || entry.trustScore > 1) return false
    if (typeof entry.rank !== 'number') return false
    if (entry.exactMatch !== undefined && typeof entry.exactMatch !== 'boolean') return false
  }
  return true
}
