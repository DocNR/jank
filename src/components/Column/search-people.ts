import type { TProfile } from '@/types'

/**
 * Rank profile search results for the Search column's People section in three
 * stable tiers: direct follows first, then 2-hop web-of-trust
 * (follows-of-follows, via `isTrusted`) but not already followed, then everyone
 * else. Input order is preserved within each tier. Deduped by pubkey, then
 * capped.
 *
 * `isTrusted` is `useUserTrust().isUserTrusted` — true for both direct follows
 * and follows-of-follows — so the `followingSet` check must come first to keep
 * direct follows in tier one. The web-of-trust set populates asynchronously; in
 * the meantime `isTrusted` returns false for everyone and this degrades to the
 * original follows-then-rest ordering.
 */
export function rankPeopleResults(
  profiles: TProfile[],
  followingSet: Set<string>,
  isTrusted: (pubkey: string) => boolean,
  cap: number
): TProfile[] {
  const seen = new Set<string>()
  const followed: TProfile[] = []
  const wot: TProfile[] = []
  const rest: TProfile[] = []
  for (const profile of profiles) {
    if (seen.has(profile.pubkey)) continue
    seen.add(profile.pubkey)
    if (followingSet.has(profile.pubkey)) followed.push(profile)
    else if (isTrusted(profile.pubkey)) wot.push(profile)
    else rest.push(profile)
  }
  return [...followed, ...wot, ...rest].slice(0, cap)
}
