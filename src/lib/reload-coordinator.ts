/**
 * Coordinates intentional in-app reloads with the unsaved-changes
 * `beforeunload` guard in `ColumnsProvider`.
 *
 * The PWA "new version available" banner reloads via a programmatic
 * `window.location.reload()` (fired from workbox's `controlling` event once the
 * waiting service worker takes control). When the unsaved-deck `beforeunload`
 * guard is active, that programmatic reload trips the browser's native "Leave
 * site?" prompt and the reload is interrupted, so the user has to click Reload
 * (and confirm the prompt) more than once.
 *
 * Clicking "Reload" is explicit consent to navigate, and deck state is already
 * persisted to localStorage on every mutation (the guard only warns about
 * NIP-78 sync divergence, not local data loss). So we mark the reload as
 * intentional and let the guard stand down for it.
 */
let intentional = false

/** Mark the next page unload as an intentional, user-initiated reload. */
export function markIntentionalReload(): void {
  intentional = true
}

/** True when the user has explicitly initiated a reload via the update banner. */
export function isIntentionalReload(): boolean {
  return intentional
}

/** Test-only: reset module state between cases. */
export function resetIntentionalReload(): void {
  intentional = false
}
