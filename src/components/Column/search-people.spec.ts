import { describe, expect, it } from 'vitest'
import { rankPeopleResults } from './search-people'
import type { TProfile } from '@/types'

const p = (pubkey: string): TProfile =>
  ({ pubkey, npub: 'npub' + pubkey, username: pubkey }) as TProfile

const trusts =
  (...trusted: string[]) =>
  (pubkey: string) =>
    trusted.includes(pubkey)

describe('rankPeopleResults', () => {
  it('puts follows first, then non-follows, preserving input order within each group', () => {
    const profiles = [p('a'), p('b'), p('c'), p('d')]
    const following = new Set(['b', 'd'])
    const result = rankPeopleResults(profiles, following, () => false, 10)
    expect(result.map((x) => x.pubkey)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('caps the result length', () => {
    const profiles = [p('a'), p('b'), p('c'), p('d'), p('e')]
    const result = rankPeopleResults(profiles, new Set(['a']), () => false, 3)
    expect(result.map((x) => x.pubkey)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes by pubkey, keeping the first occurrence', () => {
    const profiles = [p('a'), p('b'), p('a')]
    const result = rankPeopleResults(profiles, new Set(), () => false, 10)
    expect(result.map((x) => x.pubkey)).toEqual(['a', 'b'])
  })

  it('returns an empty array for no input', () => {
    expect(rankPeopleResults([], new Set(['a']), () => false, 3)).toEqual([])
  })

  it('sorts 2-hop-trusted people between direct follows and strangers', () => {
    const profiles = [p('stranger'), p('wot'), p('follow')]
    const following = new Set(['follow'])
    // isUserTrusted is also true for direct follows (wotSet includes them);
    // the following-set check must take precedence so a follow stays tier 1.
    const result = rankPeopleResults(profiles, following, trusts('follow', 'wot'), 10)
    expect(result.map((x) => x.pubkey)).toEqual(['follow', 'wot', 'stranger'])
  })

  it('preserves input order within each of the three tiers', () => {
    const profiles = [p('w1'), p('s1'), p('w2'), p('f1'), p('s2'), p('w3')]
    const following = new Set(['f1'])
    const result = rankPeopleResults(profiles, following, trusts('w1', 'w2', 'w3', 'f1'), 10)
    expect(result.map((x) => x.pubkey)).toEqual(['f1', 'w1', 'w2', 'w3', 's1', 's2'])
  })

  it('applies the cap across the concatenated tiers', () => {
    const profiles = [p('f1'), p('w1'), p('w2'), p('s1')]
    const following = new Set(['f1'])
    const result = rankPeopleResults(profiles, following, trusts('f1', 'w1', 'w2'), 2)
    expect(result.map((x) => x.pubkey)).toEqual(['f1', 'w1'])
  })

  it('dedupes across tiers, keeping the first occurrence', () => {
    const profiles = [p('w'), p('f'), p('w'), p('f')]
    const following = new Set(['f'])
    const result = rankPeopleResults(profiles, following, trusts('w', 'f'), 10)
    expect(result.map((x) => x.pubkey)).toEqual(['f', 'w'])
  })

  it('falls back to follows-then-strangers when nothing is 2-hop-trusted yet', () => {
    // wotSet populates asynchronously; until it does, isTrusted is false for
    // everyone and the ranking must match the original two-tier behavior.
    const profiles = [p('a'), p('b'), p('c')]
    const following = new Set(['b'])
    const result = rankPeopleResults(profiles, following, () => false, 10)
    expect(result.map((x) => x.pubkey)).toEqual(['b', 'a', 'c'])
  })
})
