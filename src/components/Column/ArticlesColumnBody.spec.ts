import { describe, it, expect } from 'vitest'
import { kinds } from 'nostr-tools'
import { ARTICLES_KINDS, buildArticlesSubRequests, resolveWotOnly } from './ArticlesColumnBody'

describe('ARTICLES_KINDS', () => {
  it('is [kinds.LongFormArticle] (30023)', () => {
    expect(ARTICLES_KINDS).toEqual([kinds.LongFormArticle])
    expect(ARTICLES_KINDS).toEqual([30023])
  })
})

describe('buildArticlesSubRequests', () => {
  it('returns a single sub-request with kinds:[30023]', () => {
    const reqs = buildArticlesSubRequests(['wss://relay.example.com'])
    expect(reqs).toHaveLength(1)
    expect(reqs[0].filter.kinds).toEqual([kinds.LongFormArticle])
  })

  it('has no authors filter (open feed)', () => {
    const reqs = buildArticlesSubRequests(['wss://relay.example.com'])
    expect(reqs[0].filter.authors).toBeUndefined()
  })

  it('passes urls through to the sub-request', () => {
    const urls = ['wss://a.example.com', 'wss://b.example.com']
    const reqs = buildArticlesSubRequests(urls)
    expect(reqs[0].urls).toEqual(urls)
  })
})

describe('resolveWotOnly', () => {
  it('returns false when config is undefined', () => {
    expect(resolveWotOnly(undefined)).toBe(false)
  })

  it('returns false when config.wotOnly is falsy', () => {
    expect(resolveWotOnly({})).toBe(false)
    expect(resolveWotOnly({ wotOnly: false })).toBe(false)
  })

  it('returns true when config.wotOnly is true', () => {
    expect(resolveWotOnly({ wotOnly: true })).toBe(true)
  })
})
