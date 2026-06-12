export type TProfileTabView = 'notes' | 'media' | 'articles' | 'zaps' | 'reactions' | 'relays'

export type TProfileTab = {
  id: string
  /** i18n key for the tab label. */
  label: string
  /** Which body to render for this tab. */
  view: TProfileTabView
  /** Notes view only: hide replies (top-level only). */
  hideReplies?: boolean
  /** Notes view only: show only replies. */
  onlyReplies?: boolean
}

export const PROFILE_FEED_TABS: TProfileTab[] = [
  { id: 'posts', label: 'Notes', view: 'notes', hideReplies: true },
  { id: 'replies', label: 'Replies', view: 'notes', onlyReplies: true },
  { id: 'media', label: 'Media', view: 'media' },
  { id: 'articles', label: 'Articles', view: 'articles' },
  { id: 'zaps', label: 'Zaps', view: 'zaps' },
  { id: 'reactions', label: 'Reactions', view: 'reactions' },
  { id: 'relays', label: 'Relays', view: 'relays' }
]

const YOU_TAB: TProfileTab = { id: 'you', label: 'YouTabName', view: 'notes' }

/**
 * Returns the visible tab list for a profile. Appends the You tab (viewer↔subject
 * conversation) only when viewing someone else AND a viewer pubkey exists.
 */
export function buildProfileTabs({
  isSelf,
  hasViewer
}: {
  isSelf: boolean
  hasViewer: boolean
}): TProfileTab[] {
  if (!isSelf && hasViewer) {
    return [...PROFILE_FEED_TABS, YOU_TAB]
  }
  return [...PROFILE_FEED_TABS]
}
