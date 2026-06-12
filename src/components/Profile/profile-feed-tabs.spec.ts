import { describe, expect, it } from 'vitest'
import { PROFILE_FEED_TABS, buildProfileTabs } from './profile-feed-tabs'

describe('PROFILE_FEED_TABS', () => {
  it('is ordered Notes, Replies, Media, Articles, Zaps, Reactions, Relays', () => {
    expect(PROFILE_FEED_TABS.map((t) => t.id)).toEqual([
      'posts',
      'replies',
      'media',
      'articles',
      'zaps',
      'reactions',
      'relays'
    ])
  })

  it('marks the notes tabs with the correct reply filtering', () => {
    const posts = PROFILE_FEED_TABS.find((t) => t.id === 'posts')!
    const replies = PROFILE_FEED_TABS.find((t) => t.id === 'replies')!
    expect(posts).toMatchObject({ view: 'notes', hideReplies: true })
    expect(replies).toMatchObject({ view: 'notes', onlyReplies: true })
  })

  it('maps bespoke tabs to their view kind', () => {
    expect(PROFILE_FEED_TABS.find((t) => t.id === 'media')!.view).toBe('media')
    expect(PROFILE_FEED_TABS.find((t) => t.id === 'relays')!.view).toBe('relays')
    expect(PROFILE_FEED_TABS.find((t) => t.id === 'zaps')!.view).toBe('zaps')
    expect(PROFILE_FEED_TABS.find((t) => t.id === 'reactions')!.view).toBe('reactions')
    expect(PROFILE_FEED_TABS.find((t) => t.id === 'articles')!.view).toBe('articles')
  })
})

describe('buildProfileTabs', () => {
  it('appends the You tab only when viewing someone else with a signer', () => {
    expect(buildProfileTabs({ isSelf: false, hasViewer: true }).map((t) => t.id)).toContain('you')
    expect(buildProfileTabs({ isSelf: true, hasViewer: true }).some((t) => t.id === 'you')).toBe(
      false
    )
    expect(buildProfileTabs({ isSelf: false, hasViewer: false }).some((t) => t.id === 'you')).toBe(
      false
    )
  })

  it('does not mutate PROFILE_FEED_TABS', () => {
    buildProfileTabs({ isSelf: false, hasViewer: true })
    expect(PROFILE_FEED_TABS).toHaveLength(7)
  })
})
