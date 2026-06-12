# Profile sub-feeds — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm)
**Scope:** Add Media, Articles, Zaps, Reactions, and an inline Relays view as tabs on the
Profile column, and split the existing "Notes and replies" tab into a mutually-exclusive
"Replies" tab.

## Problem

The Profile column today shows only a note feed with two overlapping tabs ("Notes" =
top-level only, "Notes and replies" = superset). A user visiting a profile cannot browse
that person's long-form articles, their media gallery, their relay list (NIP-65), the zaps
they have received, or the reactions they have made — all of which exist as first-class
Nostr data. This makes the Profile column a faceted browser over a single account's activity.

## Decisions (from brainstorm)

1. **Surface:** new tabs inside the existing `ProfileFeed` tab bar (not separate column
   types). One Profile column; switch tabs to change the sub-feed.
2. **Media scope:** all media in any note — scan kind `1, 20, 21, 22` events, extract every
   image and video, one grid tile per media item, each tile links back to its **source note**.
3. **Media layout:** 2-column CSS masonry (real aspect ratios, no cropping). Video tiles get
   a ▶ badge. Tile click opens the source note as a transient detail column (the backlink) —
   **not** a fullscreen lightbox.
4. **Zaps:** **received** only — zap receipts where this profile is the recipient
   (`#p = pubkey`). Reverse-chronological. Amount-sorting deferred.
5. **Reactions:** **made** by this profile — kind-7 events authored by the pubkey; resolve and
   render each target note with the reaction emoji/`+` overlaid. Flat reverse-chron list.
   Emoji-grouping deferred.
6. **Notes/Replies split:** rename "Notes and replies" → **"Replies"** and filter to *only*
   replies, so Notes (originals) and Replies (conversations) are mutually exclusive.
7. **Staging:** 3 stages, each independently shippable (see below).

## Architecture

### ProfileFeed becomes a content dispatcher

`src/components/Profile/ProfileFeed.tsx` today renders `<Tabs>` + a single `<NoteList>`.
Refactor it so the **tab bar stays** but the **body branches by selected tab**:

- Feed-shaped tabs (Notes, Replies, Articles) → a `<NoteList>` variant (existing path).
- Bespoke tabs (Media, Zaps, Reactions, Relays) → dedicated components.

The `You` tab (viewer↔subject conversation) is unchanged.

`<Tabs>` already wraps a horizontal `ScrollArea` + `ScrollBar`, so 8 tabs scroll cleanly at
the 440px column width. No tab-overflow menu needed.

### Tab list lives separately from DEFAULT_FEED_TABS

`DEFAULT_FEED_TABS` (in `src/constants.ts`) is shared by `NormalFeed` and `FavoritesColumnBody`.
Do **not** add profile-only tabs there. Introduce a new `PROFILE_FEED_TABS` constant (and any
new fields on `TFeedTabConfig`) used solely by `ProfileFeed`.

Final tab order: **Notes · Replies · Media · Articles · Zaps · Reactions · Relays · You**.

### Per-tab components (each small and independently testable)

- `Profile/tabs/ProfileMediaTab.tsx`
- `Profile/tabs/ProfileRelaysTab.tsx`
- `Profile/tabs/ProfileZapsTab.tsx`
- `Profile/tabs/ProfileReactionsTab.tsx`

(Articles and Notes/Replies reuse `<NoteList>` directly inside `ProfileFeed`.)

### Relay selection

All tabs pick relays via `relayListService.fetchRelayList(pubkey)`:
- **Authored content** (Notes, Replies, Media, Articles, Reactions) → author's **write** relays.
- **Zaps received** → author's **read** relays (that's where zappers publish receipts to reach them).
- Fall back to `getDefaultRelayUrls()` when the NIP-65 list is missing.

## Stage 1 — quick wins (reuse existing infra)

### Articles tab
- A `PROFILE_FEED_TABS` entry with fixed `kinds: [kinds.LongFormArticle]`.
- Renders `<NoteList>` over `{ authors: [pubkey], kinds: [30023] }` on the author's write
  relays, with `cacheToIndexedDb` (kind-30023 is sparse — mirror `ArticlesColumnBody`).
- Reuses existing long-form rendering.

### Relays tab
- `ProfileRelaysTab` reads the kind-10002 list via `useFetchRelayList(pubkey)`.
- Renders **Read** and **Write** sections; each relay row shows the host and links to spawn a
  Relay column (and/or show relay info), reusing existing relay-settings row rendering.
- Loading skeleton + empty state ("No relay list published").
- This replaces *nothing* — the existing count link in `Profile/index.tsx` stays as a shortcut.

### Notes/Replies split
- Add an `onlyReplies` capability to the tab config + `NoteList` filter (inverse of the
  existing `hideReplies`). A note is a reply if it carries a kind-1 reply marker (`e`/`q`
  reply tags per NIP-10).
- "Notes" tab keeps `hideReplies: true`; "Replies" tab sets `onlyReplies: true`.

## Stage 2 — Media

`ProfileMediaTab`:
- Paginated subscription to `{ authors: [pubkey], kinds: [1, 20, 21, 22] }` on write relays
  (reuse the timeline/subscription primitives `NoteList` uses; this tab needs a custom render
  so it manages its own subscription + pagination rather than rendering `NoteList`).
- **Extraction:** for each event, collect media items — images via `getImetaInfosFromEvent`
  (`src/lib/event.ts`) plus content-parsed image URLs, and video URLs. Flatten to a list of
  `{ url, type: 'image' | 'video', sourceEvent }`.
- **Layout:** 2-column CSS masonry (`columns: 2; break-inside: avoid`), reusing `<Image>` for
  thumbnails. Video tiles render a poster/first-frame with a ▶ badge.
- **Backlink:** clicking a tile opens the source note as a transient detail column
  (`useSecondaryPage().push(toNote(sourceEvent))`).
- Infinite scroll (bottom sentinel) + IndexedDB caching for fast cold paint.
- Empty state ("No media yet").

## Stage 3 — Zaps & Reactions

### Zaps received (`ProfileZapsTab`)
- Subscribe `{ kinds: [9735], '#p': [pubkey] }` on the author's read relays.
- Parse each receipt with `getZapInfoFromEvent` (`src/lib/event-metadata.ts`): amount (bolt11),
  zapper pubkey (from the embedded kind-9734 `description`), and zapped event (`e`-tag).
- Row = zapper avatar/name + sats amount + optional comment + a preview of the zapped note.
  Reuse `NotificationList/.../ZapNotification` rendering where practical.
- Reverse-chronological. Empty state ("No zaps yet").

### Reactions made (`ProfileReactionsTab`)
- Subscribe `{ kinds: [7], authors: [pubkey] }` on the author's write relays.
- For each reaction, resolve the target note (last `e`-tag) via the event cache, render the
  target note with the reaction `content` (emoji, `+`, or custom emoji) overlaid.
- Flat reverse-chron list. Empty state ("No reactions yet").

## Cross-cutting concerns

- **View-only / foreign profiles:** every new tab is a read-only feed, so it works regardless
  of `signingIdentity` (no signer required). No AccountScope changes needed.
- **Error/empty states:** each tab owns its own loading skeleton and empty copy.
- **i18n:** new tab labels and empty-state strings appended to the END of `src/i18n/locales/en.ts`
  (other locales later).
- **RTL:** masonry + rows use logical Tailwind classes; media grid is direction-neutral.

## Testing

- `ProfileMediaTab` extraction: event → media-items (imeta images, inline image URLs, video
  URLs; events with no media excluded).
- Zap-receipt parsing: amount / zapper / target extraction, including malformed bolt11
  (swallowed gracefully).
- Reaction target resolution: picks correct `e`-tag, renders emoji content.
- `onlyReplies` filter: replies pass, originals excluded (and inverse for `hideReplies`).
- `PROFILE_FEED_TABS` shape + tab dispatch (each tab id maps to the right body).
- **Verify with `npm run build`** (not `tsc --noEmit`, which is a no-op in this repo).

## Out of scope (later polish)

- Zaps: amount-sorting toggle; zaps *sent*.
- Reactions: emoji-grouping with counts; reactions *received*.
- Media: fullscreen lightbox (we use the source-note backlink instead).
- Promoting any sub-feed to a standalone column type.
