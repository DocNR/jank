/**
 * Single source of truth for brand identity.
 *
 * Imported by:
 *   - runtime code (NotificationProvider, Donation, PostEditor, lightning.service, etc.)
 *   - build-time config (vite.config.ts) — for PWA manifest and index.html injection
 *
 * Renaming the brand is intended to be a single-file edit here, with the
 * possible exception of visual assets in public/ (favicons, PWA icons).
 *
 * `index.html` references brand values via %BRAND_NAME%-style placeholders
 * which are substituted at build time by the `inject-brand` plugin in vite.config.ts.
 *
 * `package.json` cannot import TypeScript, so its `name`, `description`,
 * `repository`, and `homepage` fields must be kept in sync manually.
 */
export const BRAND = {
  name: 'JANK',
  shortName: 'JANK',
  tagline: 'just another nostr klient',
  description: 'A TweetDeck-style multi-column deck for Nostr',
  keywords: 'jank, nostr, deck, multi-column, web, client, relay, social, pwa',
  homepage: 'https://jank.army',
  repo: 'https://github.com/DocNR/jank',
  issuesUrl: 'https://github.com/DocNR/jank/issues/new',
  // NIP-89 client label other clients render as "via JANK". It's a bare
  // ['client', value] label (no d-tag / handler address, not matched in logic),
  // so it's visible brand copy — keep it as JANK, not a lowercase wire id.
  nostrClientTag: 'JANK',
  // Empty until a jank support account exists. ErrorBoundary hides the
  // social-support link when this is empty.
  supportNpub: '',
  // Approximates W2 selected color hsl(186 75% 45%).
  themeColor: '#1DB8C9',
  backgroundColor: '#000000',
  shareUrlBase: 'https://jank.army'
} as const

export type Brand = typeof BRAND
