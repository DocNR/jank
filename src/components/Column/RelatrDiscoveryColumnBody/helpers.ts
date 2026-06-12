import type { TRelatrProfileResult, TRelatrSearchProfilesResult } from '@/lib/relatr'

/**
 * Normalize a user-entered query: trim + lowercase + collapse internal
 * whitespace. The normalized form is what we send to Relatr; we also use it
 * as the query-changed sentinel in `useRelatrDiscovery`'s reset effect.
 */
export function normalizeQuery(input: string | null | undefined): string {
  if (!input) return ''
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Decide whether to auto-run a `search_profiles` call on first mount. We only
 * fire when the user has both a non-empty query AND a paired signer, AND we
 * have no cached result yet (reloads with a cache should render instantly
 * from localStorage without a network call — same pattern as DVM Feed).
 */
export function shouldAutoRun(args: {
  query: string
  signerPubkey: string | null
  hasCache: boolean
}): boolean {
  return !!args.query && !!args.signerPubkey && !args.hasCache
}

/** Extract the ranked author entries from a Relatr response, preserving order. */
export function extractAuthorResults(
  result: TRelatrSearchProfilesResult
): TRelatrProfileResult[] {
  return result.results
}
