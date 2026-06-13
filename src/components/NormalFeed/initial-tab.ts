type TabLike = { id: string }

/**
 * Resolve the initial selected feed tab for a <NormalFeed>.
 *
 * Uses the column's persisted `configTab` (e.g. `column.config.feedTab`) when it
 * matches a currently-visible tab; otherwise falls back to the first visible tab
 * — today's "Notes" (replies-hidden) default. Tolerates an unknown/stale
 * persisted value (e.g. a tab that was later removed or renamed) by falling
 * back rather than selecting nothing.
 */
export function resolveInitialTabId(configTab: string | undefined, tabs: TabLike[]): string {
  if (configTab && tabs.some((tab) => tab.id === configTab)) return configTab
  return tabs[0]?.id ?? ''
}
