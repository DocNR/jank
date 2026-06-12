import { describe, it, expect } from 'vitest'
import { Event, kinds } from 'nostr-tools'
import {
  BOOKMARK_KINDS,
  buildATagResolveFilter,
  buildBookmarksSubRequests,
  extractBookmarkIds,
  parseATagCoordinate
} from './BookmarksColumnBody'

function makeBookmarkListEvent(tags: string[][]): Event {
  return {
    id: 'bookmark-list-id',
    pubkey: 'pubkey-1',
    created_at: 1700000000,
    kind: kinds.BookmarkList,
    tags,
    content: '',
    sig: 'sig'
  }
}

describe('BOOKMARK_KINDS', () => {
  it('includes kind:1 ShortTextNote', () => {
    expect(BOOKMARK_KINDS).toContain(kinds.ShortTextNote)
  })

  it('includes kind:6 Repost', () => {
    expect(BOOKMARK_KINDS).toContain(kinds.Repost)
  })

  it('includes kind:30023 LongFormArticle (so a-tag article bookmarks render)', () => {
    expect(BOOKMARK_KINDS).toContain(kinds.LongFormArticle)
  })

  it('includes picture, video, poll, comment, voice, highlight extended kinds', () => {
    expect(BOOKMARK_KINDS).toContain(20) // PICTURE
    expect(BOOKMARK_KINDS).toContain(21) // VIDEO
    expect(BOOKMARK_KINDS).toContain(22) // SHORT_VIDEO
    expect(BOOKMARK_KINDS).toContain(1068) // POLL
    expect(BOOKMARK_KINDS).toContain(1111) // COMMENT
    expect(BOOKMARK_KINDS).toContain(1222) // VOICE
    expect(BOOKMARK_KINDS).toContain(1244) // VOICE_COMMENT
    expect(BOOKMARK_KINDS).toContain(kinds.Highlights)
  })
})

describe('extractBookmarkIds', () => {
  it('returns empty arrays when the bookmark list event is null', () => {
    const { eTagIds, aTagCoords } = extractBookmarkIds(null)
    expect(eTagIds).toEqual([])
    expect(aTagCoords).toEqual([])
  })

  it('extracts raw hex event ids from e-tags', () => {
    const evt = makeBookmarkListEvent([
      ['e', 'aabbcc'],
      ['e', 'ddeeff']
    ])
    const { eTagIds, aTagCoords } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual(['aabbcc', 'ddeeff'])
    expect(aTagCoords).toEqual([])
  })

  it('extracts coordinate strings from a-tags', () => {
    const evt = makeBookmarkListEvent([['a', '30023:somepubkey:my-article']])
    const { eTagIds, aTagCoords } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual([])
    expect(aTagCoords).toEqual(['30023:somepubkey:my-article'])
  })

  it('splits a mixed list of e and a tags', () => {
    const evt = makeBookmarkListEvent([
      ['e', 'aabbcc'],
      ['a', '30023:somepubkey:my-article'],
      ['e', 'ddeeff']
    ])
    const { eTagIds, aTagCoords } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual(['aabbcc', 'ddeeff'])
    expect(aTagCoords).toEqual(['30023:somepubkey:my-article'])
  })

  it('ignores other tag types', () => {
    const evt = makeBookmarkListEvent([
      ['t', 'hashtag'],
      ['r', 'wss://relay.example.com'],
      ['p', 'pubkey'],
      ['e', 'aabbcc']
    ])
    const { eTagIds, aTagCoords } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual(['aabbcc'])
    expect(aTagCoords).toEqual([])
  })

  it('drops e-tags that have no event id', () => {
    const evt = makeBookmarkListEvent([['e'], ['e', ''], ['e', 'validid']])
    const { eTagIds } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual(['validid'])
  })

  it('dedupes duplicate e-tag ids', () => {
    const evt = makeBookmarkListEvent([
      ['e', 'aabbcc'],
      ['e', 'aabbcc'],
      ['e', 'ddeeff']
    ])
    const { eTagIds } = extractBookmarkIds(evt)
    expect(eTagIds).toEqual(['aabbcc', 'ddeeff'])
  })

  it('dedupes duplicate a-tag coordinates (defends against bookmark list dupes that produce duplicate naddr keys)', () => {
    const evt = makeBookmarkListEvent([
      ['a', '30023:somepubkey:my-article'],
      ['a', '30023:somepubkey:my-article'],
      ['a', '30023:otherpubkey:another-article']
    ])
    const { aTagCoords } = extractBookmarkIds(evt)
    expect(aTagCoords).toEqual(['30023:somepubkey:my-article', '30023:otherpubkey:another-article'])
  })
})

describe('parseATagCoordinate', () => {
  it('parses kind:pubkey:dtag', () => {
    expect(parseATagCoordinate('30023:abc123:my-slug')).toEqual({
      kind: 30023,
      pubkey: 'abc123',
      dTag: 'my-slug'
    })
  })

  it('keeps colons inside the d-tag', () => {
    expect(parseATagCoordinate('30023:abc123:a:b:c')).toEqual({
      kind: 30023,
      pubkey: 'abc123',
      dTag: 'a:b:c'
    })
  })

  it('returns null for malformed coordinates', () => {
    expect(parseATagCoordinate('garbage')).toBeNull()
    expect(parseATagCoordinate('30023:onlypubkey')).toBeNull()
    expect(parseATagCoordinate('notanumber:pubkey:slug')).toBeNull()
  })
})

describe('buildATagResolveFilter', () => {
  it('returns the union of kinds/authors/d-tags', () => {
    const filter = buildATagResolveFilter(['30023:authorA:slug1', '30023:authorB:slug2'])
    expect(filter).toEqual({
      kinds: [30023],
      authors: ['authorA', 'authorB'],
      '#d': ['slug1', 'slug2']
    })
  })

  it('returns null when there are no valid a-tags', () => {
    expect(buildATagResolveFilter([])).toBeNull()
    expect(buildATagResolveFilter(['garbage'])).toBeNull()
  })
})

describe('buildBookmarksSubRequests', () => {
  it('returns a single ids-bounded request with kinds', () => {
    const reqs = buildBookmarksSubRequests(['wss://r'], ['aabbcc', 'ddeeff'])
    expect(reqs).toHaveLength(1)
    expect(reqs[0].filter.ids).toEqual(['aabbcc', 'ddeeff'])
    expect(reqs[0].filter.kinds).toEqual(BOOKMARK_KINDS)
    expect(reqs[0].filter.authors).toBeUndefined()
  })

  it('returns an empty list when there are no ids', () => {
    expect(buildBookmarksSubRequests(['wss://r'], [])).toEqual([])
  })

  it('passes urls through to the sub-request', () => {
    const urls = ['wss://a', 'wss://b']
    const reqs = buildBookmarksSubRequests(urls, ['aabbcc'])
    expect(reqs[0].urls).toEqual(urls)
  })
})
