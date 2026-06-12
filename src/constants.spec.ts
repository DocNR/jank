import { describe, it, expect } from 'vitest'
import { DEFAULT_FEED_TABS } from './constants'

describe('DEFAULT_FEED_TABS', () => {
  it('contains exactly two entries: Notes and Notes and replies', () => {
    expect(DEFAULT_FEED_TABS).toHaveLength(2)
    expect(DEFAULT_FEED_TABS[0]).toMatchObject({
      id: 'posts',
      builtin: 'posts',
      label: 'Notes',
      hideReplies: true
    })
    expect(DEFAULT_FEED_TABS[1]).toMatchObject({
      id: 'postsAndReplies',
      builtin: 'postsAndReplies',
      label: 'Notes and replies'
    })
  })

})
