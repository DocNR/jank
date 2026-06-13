import { describe, expect, it } from 'vitest'
import { resolveInitialTabId } from '../initial-tab'

const TABS = [{ id: 'posts' }, { id: 'postsAndReplies' }]

describe('resolveInitialTabId', () => {
  it('falls back to the first tab when no preference is persisted', () => {
    expect(resolveInitialTabId(undefined, TABS)).toBe('posts')
  })

  it('honors a persisted tab that matches a visible tab', () => {
    expect(resolveInitialTabId('postsAndReplies', TABS)).toBe('postsAndReplies')
  })

  it('ignores a stale/unknown persisted tab and falls back to the first', () => {
    expect(resolveInitialTabId('media', TABS)).toBe('posts')
  })

  it('returns empty string when there are no tabs (defensive)', () => {
    expect(resolveInitialTabId('posts', [])).toBe('')
  })
})
