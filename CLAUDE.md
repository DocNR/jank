# CLAUDE.md

Orientation for AI agents and contributors working in the jank codebase.

## Quick reference (read first)

> **Type-checking gotcha:** `npx tsc --noEmit` is a **no-op** in this repo (solution-style `tsconfig.json`). Use `npm run build` or `npx tsc -b` for real type checks. CI runs `npm run build`. Trusting `tsc --noEmit` has shipped broken builds before.

> **Release notes (user-facing "What's new"):** When a PR is worth announcing to users, prepend a newest-first entry to `src/release-notes.ts` (`{version, date, highlights, link?}`) **and** bump `package.json` `version` to match. This arms the in-app "What's new" dialog. It is **optional and fail-silent**: skipping it never blocks a merge or build; the reload banner still ships fresh code, the dialog just doesn't show. Highlights are authored UI copy: keep the voice clean. Internal PRs (docs, refactor) skip this entirely.

## Table of contents

- [Project shape](#project-shape)
- [What's different from upstream Jumble](#whats-different-from-upstream-jumble)
- [Architecture](#architecture)
  - [Tech stack](#tech-stack)
  - [Project structure](#project-structure)
  - [Provider tree](#provider-tree)
  - [Services taxonomy](#services-taxonomy)
  - [Signer registry and AccountScope](#signer-registry-and-accountscope)
  - [Routing model](#routing-model)
- [Column types](#column-types)
  - [The 11 column types](#the-11-column-types)
  - [Adding a new column type](#adding-a-new-column-type)
- [Code conventions](#code-conventions)
  - [Components](#components)
  - [Services](#services)
  - [State management](#state-management)
  - [i18n](#i18n)
  - [RTL layout support](#rtl-layout-support)
- [Nostr integration](#nostr-integration)
  - [Supported event kinds](#supported-event-kinds)
  - [Common components](#common-components)
  - [Parsing content](#parsing-content)
- [Development guide](#development-guide)
  - [Environment setup](#environment-setup)
  - [Type-checking](#type-checking)
  - [Style modifications](#style-modifications)

## Project shape

jank is a TweetDeck-style multi-column Nostr client, forked from [Jumble](https://github.com/CodyTseng/jumble) at commit `ce639aa` (MIT, by Cody Tseng) and substantially diverged. Many independent feed columns side-by-side, each scoped to one of the user's paired accounts (typically via NIP-46). Different columns can show the same account's home, mentions, hashtag feed, etc., or split across accounts. Three Relay columns each pointing at a different relay is a first-class use case — the Nostr-native shape no TweetDeck clone could have.

- **Repo:** [`DocNR/jank`](https://github.com/DocNR/jank)
- **Hosting:** Cloudflare Pages, live at [jank.army](https://jank.army) (auto-deploy on push to `main`)
- **License:** MIT (inherited from upstream)
- **Trunk:** `main`. `master` is frozen at the Jumble fork-point (`ce639aa`) for diffing. `upstream/master` tracks Jumble for cherry-picks.
- **Platform:** Web-only SPA (desktop primary, mobile PWA functional). The Electron build target was stripped in Phase 0; never reintroduce it.

## What's different from upstream Jumble

These are the load-bearing invariants jank added on top of Jumble. Treat them as constraints, not implementation details.

- **Per-account signer registry on `ClientService`.** Upstream had `client.signer` / `client.pubkey` as singletons mutated by `NostrProvider`. jank adds `client.signers: Map<pubkey, ISigner>` plus `setSigner` / `removeSigner` / `getSignerFor` / `signAs(pubkey, draft)` / `publishAs(pubkey, urls, draft)`. The legacy fields are preserved for back-compat. `NostrProvider` mirrors the active account's signer into the registry **additively** — switching active does NOT evict prior signers, so column-scoped subtrees stay functional across account switches. `removeAccount` is the only path that explicitly clears registry entries.

- **Column view/signing split.** Each column carries two pubkeys (not one `accountId`): `viewContext` (whose perspective it shows — any pubkey, paired OR foreign) and `signingIdentity` (which paired account's key signs actions taken from it, or `null` = view-only). Unblocks "view any user's Home/Notifications" plus acting as a different account than the column's view. `migrateColumns()` in `local-storage.service.ts` migrates legacy single-`accountId` entries at hydration.

- **`<AccountScope>` provider** at `src/providers/AccountScope.tsx`. Wraps each column; `useAccountScope()` exposes `{viewContext, signingIdentity, account, signer, viewOnly, ready, error, publish}`. `signer`/`publish` resolve from `signingIdentity`; `viewOnly` is true when it's `null`. `useAccountScopeOptional()` is the soft variant (returns `null` outside a scope — for note action buttons that also render in unscoped contexts).

- **`buildSignerForAccount`** helper at `src/providers/NostrProvider/build-signer.ts`. Pure function that builds an `ISigner` for a stored account without mutating provider state. Handles `nsec` / `browser-nsec` / `nip-07` / `bunker` / `npub`. `ncryptsec` deferred (needs interactive password).

- **Per-account deck state (workspaces).** Deck state is keyed `Record<pubkey, TAccountWorkspace>` (one workspace per paired account, each owning its own deck list + active-deck pointer). Switching active swaps the visible workspace. `useNostr().pubkey` is mutable; the `a` shortcut cycles active. NIP-78 deck sync uses one NIP-44-self-encrypted kind-30078 per account (d-tag `spectr_decks`).

- **No Electron.** Web-only SPA. Source-level `if (isElectron())` branches still exist as dead code; do not extend them. If you need main-process capabilities, use Cloudflare Workers/Pages Functions or accept the browser limitation.

## Architecture

### Tech stack

- **Build:** Vite 5.x
- **Frontend:** React 18.3.x + TypeScript
- **Styling:** Tailwind CSS, Radix UI, `next-themes`, `tailwindcss-animate`
- **State:** Jotai 2.x + per-account React context (`<AccountScope>`)
- **Routing:** `path-to-regexp` (custom — see [Routing model](#routing-model))
- **Rich text:** TipTap 2.x
- **Nostr:** `nostr-tools` 2.x
- **Other:** i18next, dayjs, flexsearch, qr-code-styling, yet-another-react-lightbox, `virtua` (feed virtualization)

### Project structure

```
jank/
├── src/
│   ├── components/                        # React components
│   │   ├── ui/                            # Base UI primitives (shadcn/ui style)
│   │   ├── Column/                        # Column body components + header dispatcher
│   │   │   ├── index.tsx                  # Column shell + dispatchBody() switch
│   │   │   ├── ColumnHeader/              # Header + columnLabel() dispatcher
│   │   │   ├── HomeColumnBody.tsx
│   │   │   ├── NotificationsColumnBody.tsx
│   │   │   ├── HashtagColumnBody.tsx
│   │   │   ├── ProfileColumnBody.tsx
│   │   │   ├── SearchColumnBody.tsx
│   │   │   ├── RelayColumnBody.tsx
│   │   │   ├── BookmarksColumnBody.tsx
│   │   │   ├── DvmFeedColumnBody/
│   │   │   ├── DvmDiscoverColumnBody/
│   │   │   ├── RelatrDiscoveryColumnBody/
│   │   │   └── DetailColumnBody.tsx       # Transient detail-column dispatcher
│   │   ├── AddColumnModal/                # Column picker + per-type ConfigForms
│   │   │   ├── column-types.tsx           # COLUMN_TYPES registry (ColumnTypeDescriptor[])
│   │   │   └── configs/                   # Per-type ConfigForm components
│   │   └── ...
│   ├── providers/
│   │   ├── NostrProvider/                 # Active-account session + login UI
│   │   │   ├── index.tsx
│   │   │   ├── build-signer.ts            # Pure ISigner builder
│   │   │   ├── login-flows.ts             # Per-signer-type login dispatcher
│   │   │   └── publish-helpers.ts
│   │   ├── AccountsProvider.tsx           # Paired-accounts list + signer registry view
│   │   ├── AccountScope.tsx               # Per-column signer scope
│   │   ├── ColumnsProvider.tsx            # Deck state + column mutations
│   │   └── ScrollContainerProvider.tsx
│   ├── services/                          # Singletons (see Services taxonomy)
│   │   ├── client.service.ts              # Pool, signer registry, publish, subscribe
│   │   ├── caches/                        # event-cache, replaceable-event-cache, timeline-cache, seen-on
│   │   ├── fetchers/                      # Per-replaceable-list fetchers
│   │   ├── search/                        # user-search-index
│   │   ├── auth-signer.ts                 # selectAuthSigner (NIP-98/NIP-42 routing helper)
│   │   └── ...
│   ├── hooks/
│   │   └── useColumnVisible.ts            # Per-column horizontal-viewport visibility gate
│   ├── pages/
│   │   ├── primary/                       # Only DeckHomePage survives Phase 2
│   │   └── secondary/                     # Routes still used by DetailColumnBody dispatcher
│   ├── types/
│   │   └── column.d.ts                    # TColumnType, TColumnConfig, TColumn, TDeck, TAccountWorkspace
│   ├── i18n/locales/                      # 19+ locale files
│   ├── App.tsx                            # Provider tree root
│   ├── DeckManager.tsx                    # App shell (TopBar + DeckArea)
│   ├── branding.ts                        # Single source for brand identity (name, repo, theme color)
│   └── constants.ts
├── public/
└── docs/                                  # contributor docs
```

### Provider tree

Multi-layered Provider nesting (see `App.tsx`):

```
ScreenSizeProvider
  └─ UserPreferencesProvider
      └─ ThemeProvider
          └─ ContentPolicyProvider
              └─ DeletedEventProvider
                  └─ AccountsProvider          # Paired accounts list + signer registry view
                      └─ NostrProvider         # Active-account state + login UI dialogs
                          └─ ... (more providers)
```

Some providers live in `DeckManager.tsx` rather than `App.tsx` because they need `useSecondaryPage`. Respect dependency ordering when adding new providers.

### Services taxonomy

Service files in `src/services/` encapsulate business logic. Each is a default-exported singleton.

**Core: `client.service.ts`** — pool, signer registry (per-account `signers` map + `signAs` / `publishAs`), publish (`publishEvent`, `determineTargetRelays`), low-level subscribe / query, HTTP-auth signing, sub-request orchestration (`generateSubRequestsForPubkeys`). `auth-signer.ts` extracts the `selectAuthSigner(registry, activeSigner, pubkey?)` helper used by NIP-98 (`signHttpAuth`) and NIP-42 (`subscribe(..., {authPubkey})`).

**Caches** (`src/services/caches/`):

- `event-cache.service.ts` — in-memory + IndexedDB cache for events by id (naddr fallback via replaceable cache)
- `replaceable-event-cache.service.ts` — subscribable dataloader for replaceable events by `pubkey:kind` (the reactive list store's foundation)
- `timeline-cache.service.ts` — timeline subscriptions, pagination, IndexedDB replay
- `seen-on.service.ts` — tracks which relays each event was seen on

**Per-list fetchers** (`src/services/fetchers/`) — small modules for single replaceable per-user lists:

- `relay-list.service.ts` — kind 10002 RelayList
- `follow-list.service.ts` — kind 3 Contacts + favorite-relays aggregation
- `mute-list.service.ts` — kind 10000 Mutelist
- `bookmark-list.service.ts` — kind 10003 BookmarkList
- `pin-list.service.ts` — kind 10001 Pinlist + custom Pinned Users
- `emoji-set.service.ts` — kind 10030 user emoji list
- `blossom-server-list.service.ts` — kind 10063 blossom server list

**Other singletons:** `big-relay-fetcher.service.ts`, `profile-fetcher.service.ts`, `search/user-search-index.service.ts`, `indexed-db.service.ts`, `local-storage.service.ts`, `media-upload.service.ts`, `lightning.service.ts`, `relay-info.service.ts`, `blossom.service.ts`, `custom-emoji.service.ts`, `libre-translate.service.ts`, `translation.service.ts`, `media-manager.service.ts`, `modal-manager.service.ts`, `poll-results.service.ts`, `post-editor-cache.service.ts`, `web.service.ts`.

### Signer registry and AccountScope

`AccountsProvider` owns the paired-accounts list (mirrored from `storage.getAccounts()`) and exposes `useAccounts() → { accounts, addAccount, removeAccount, getSigner }`. Underneath, signers register in `client.signers` as a **refcounted map**: `setSigner(pubkey, signer, owner)` adds an owner symbol; `removeSigner(pubkey, owner)` decrements; the entry deletes only when its owner set drains. Two owner sources today:

- **`ACTIVE_OWNER`** (module-scoped symbol exported from `AccountsProvider.tsx`) — held by `NostrProvider`'s `[account, signer]` mirror useEffect for the currently-active account. Additive on switch; only `removeAccount(act)` releases it.
- **Per-mount `Symbol('AccountScope:'+signingIdentity)`** — held by each `<AccountScope>` instance (keyed on its `signingIdentity`). Symmetric: registered on mount, released on unmount.

Replacement is last-wins on the signer object; refcount only governs entry lifetime. A paired-but-not-active `<AccountScope>` keeps working after the user switches active, without either side yanking the other's entry.

`NostrProvider/index.tsx` is the active-account session: state hydration, login UI dialogs, publish/persist orchestration. Pure helpers live alongside it in `NostrProvider/login-flows.ts` (five signer types + `loginWithAccountPointer` dispatcher) and `NostrProvider/publish-helpers.ts` (sign / publish / attemptDelete / signHttpAuth + persist-replaceable-event helpers).

### Routing model

Phase 2 (shipped 2026-05-17) retired the upstream Jumble primary-route + secondary-stack model. Current shape:

- **`home` primary route** is the only survivor. It renders `DeckHomePage → DeckArea → Column → AccountScope → <body>`. (Plus `FollowingPage` when `IS_COMMUNITY_MODE`.)
- **Deep links** (`/notes/<id>`, `/p/<npub>`, `/t/<tag>`, `/r/<encoded>`, `/settings`, `/notifications`, `/bookmarks`, `/me`) spawn **transient columns** on the deck via `addTransientColumn`. Canonical URLs use `/p/<npub>`, `/t/<tag>`, `/r/<encoded>`; legacy `/users/`, `/notes?t=`, `/relays/` redirect via `replaceState`.
- **`usePrimaryPage` + `PrimaryPageContext` are retired.** Do not reintroduce them.
- **No secondary stack.** `useSecondaryPage().push(url)` exists but inside a column it spawns a transient detail column instead of pushing a stack.
- **Standing-type dedup:** `findExistingStandingColumn` in `addTransientColumn` focuses an existing column of the matching kind instead of duplicating (Profile / Notifications / Bookmarks / Search).

**New surfaces are columns**, not pages. See [Adding a new column type](#adding-a-new-column-type).

## Column types

### The 11 column types

| #   | Type                  | TColumnType value      | Underlying primitive                                       | Filter shape                                                       |
| --- | --------------------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Home                  | `home`                 | `<NormalFeed>`                                             | `{kinds:[1,6], authors: <follow list>}`                            |
| 2   | Notifications         | `notifications`        | per-pubkey `NotificationProvider` + `<NotificationList>`   | `{kinds:[1,6,16,7,9735,9802,1111,1018,1244,1068], '#p':[pubkey]}`  |
| 3   | Hashtag               | `hashtag`              | `<NormalFeed>`                                             | `{kinds:[1], '#t':[tags]}`                                         |
| 4   | Profile               | `profile`              | `<ProfileFeed pubkey={...}>`                               | `{kinds:[1], authors:[pubkey]}`                                    |
| 5   | Search                | `search`               | `<NormalFeed>` w/ NIP-50                                   | `{kinds:[1], search: <query>}`                                     |
| 6   | Relay                 | `relay`                | `<NormalFeed areAlgoRelays>`                               | `{kinds:[1]}` scoped to one relay URL                              |
| 7   | Bookmarks             | `bookmarks`            | unified `<NoteList cacheToIndexedDb>` over kind-10003 list | `{ids: <e-tag ids + resolved a-tag article ids>, kinds: ALLOWED_FILTER_KINDS}` |
| 8   | DVM Feed              | `dvm-feed`             | custom (kind 5300→6300→7000 lifecycle in `useDvmFeed`)     | publishes kind 5300; resolves e-tags from latest kind 6300         |
| 9   | Relatr People         | `relatr-discovery`     | `search_profiles` MCP call via ContextVM transport         | ranked author list (cached pubkeys + per-author Follow)            |
| 10  | Articles              | `articles`             | `<NoteList wotOnly cacheToIndexedDb>`                      | `{kinds:[30023]}` open feed; WoT toggle narrows client-side        |
| 11  | Favorites             | `favorites`            | `<NoteList isPubkeyFeed>` with Notes / Notes-and-replies tabs | `{kinds:[1,6], authors: <favoritePubkeySet>}` (kind 10010 list) |

`dvm-discover` is reachable as a column type via deep link / DVM picker's "Browse all DVMs" link but has no AddColumnModal tile. `detail` is the type used for transient detail columns spawned from in-column clicks.

**Articles** (kind 30023, addressable per NIP-23) and **Favorites** (kind 10010 PINNED_USERS — Jumble extension, not in NIP-51) shipped 2026-05-27 as the home-feed cleanup sprint (PRs #85 strip + #86 Articles + #87 Favorites). The user-facing "Favorites" maps to the internal `PINNED_USERS` wire identifier; the kind number is the protocol contract, the rename was consumer-layer only.

**Bookmarks** (PR #90) is one reverse-chronological `<NoteList>` over a single `{ids}` feed, not two tag-grouped sections. e-tag (note) bookmarks contribute their ids directly; a-tag (addressable article) bookmarks are resolved to concrete event ids in `BookmarksColumnBody.resolveATagEventIds` — local-first via the v24 `coordinateIndex` on the events store (`indexedDb.getEventsByCoordinates`), relay fallback for misses (one query, written back). Folding everything into one ids sub-request gives the fast primary-key IndexedDB replay and one subscription (no per-coordinate REQ fan-out). Bookmarked events (e-tag ids + a-tag coordinates) are exempt from the events-store 5-day TTL in `cleanUpOldEvents`, so saved items paint from cache on reload regardless of age. Companion fix PR #91 corrected `getEventById`'s record-shape read so the per-event `useFetchEvent` cache hits app-wide.

Three Relay columns each pointing at a different relay is three `TColumn` entries with `type: 'relay'` and different `config.relayUrl`. Same data model handles every variant.

**DVM Feed and Relatr People are snapshot column types** (not live subscriptions): each request produces one frozen result; "refresh" is a load-bearing affordance, not a UX nicety. Auto-publishes once on first mount; subsequent refreshes are manual via an inline button at the top of the body. `column.config.lastResultEventId` (DVM Feed) and `column.config.relatrLastResults` (Relatr) cache results so reload renders from cache without re-calling.

### Adding a new column type

Adding a column type touches **7 files minimum**. (Earlier docs said "4 files"; that was wrong, caught when the Relatr People ship missed 3 runtime dispatchers in browser smoke.) Do all 7:

1. **`src/types/column.d.ts`** — add the new value to the `TColumnType` union. If the column needs config beyond `viewContext`, add typed fields to `TColumnConfig` with JSDoc explaining each.

2. **`src/components/Column/<NewType>ColumnBody.tsx`** (or `<NewType>ColumnBody/index.tsx` for multi-file) — the body component. Read `useAccountScope()` for `signingIdentity` / signer / view-only state; `useColumns()` for `updateColumnConfig` (snapshot types). Wrap notes feeds in `<NoteList>`.

3. **`src/components/Column/index.tsx`** — `dispatchBody()` switch. Add an `import` and a `case 'your-type': return <YourTypeColumnBody column={column} />`.

4. **`src/components/Column/ColumnHeader/index.tsx`** — `columnLabel()` switch. Add a `case 'your-type':` returning the i18n-keyed label (and any contextual suffix, e.g. the relay host or the hashtag).

5. **`src/components/AddColumnModal/column-types.tsx`** — define a `ColumnTypeDescriptor` (icon, label, optional `shortcut` override, `defaults`, optional `ConfigForm`, `isReadyToPreview`, optional `supportsViewAs`, `PreviewBody`, `previewHint`). Push it onto `COLUMN_TYPES`. **Watch shortcut collisions:** the picker uses the first letter of `label` by default. Existing overrides: Hashtag uses `t`, DVM Feed uses `v`, Relatr People uses `e`. If your label's first letter is taken, add a `shortcut` override.

6. **`src/services/local-storage.service.ts`** — add the new type to the allowlist inside `migrateColumns()` (the long `if (type !== 'home' && type !== ...)` chain near line 67). Missing this **drops the column from saved decks at next hydration**.

7. **`src/i18n/locales/en.ts`** — add the column label key. **Append at the end of the file**; never insert in the middle. Other locales can be filled in later.

**Situational extras:**

- **Picker config form** (`src/components/AddColumnModal/configs/<NewType>Picker.tsx`) — needed when the column needs input beyond the account rail (relay URL, hashtag, search query, DVM pointer). Wire via the descriptor's `ConfigForm` field.
- **Snapshot vs live:** a snapshot column type needs a `config.lastResultEventId` (or equivalent) cache field plus a refresh affordance at the top of the body. See `DvmFeedColumnBody` and `RelatrDiscoveryColumnBody` for the pattern.
- **`supportsViewAs`:** set `true` if the column makes sense when `viewContext` is a foreign pubkey (Home, Notifications, Bookmarks, Profile do; Relay, Hashtag, Search, DVM Feed, Relatr don't because they're scoped by URL/tag/query rather than by author).
- **Tests:** add unit tests for the body, the descriptor (`isReadyToPreview` boundary cases), and the migrator allowlist.
- **Verify with `npm run build`**, not `npx tsc --noEmit` (see [Type-checking](#type-checking)).

## Code conventions

### Components

1. Each feature component lives in its own folder with `index.tsx` and sub-components.
2. Style with Tailwind utility classes; reach for `class-variance-authority` (cva) for complex variants.
3. All components have explicit TypeScript type definitions.
4. Global state via Jotai atoms; cross-component data via Context Providers.

### Services

To add a service: create a file in `src/services/`, export a singleton, import where needed.

### State management

- Global state → new Provider in `src/providers/` + entry in `App.tsx` provider tree (mind dependency order).
- Or: a singleton service in `src/services/` + Jotai atoms.

### i18n

Locales live in `src/i18n/locales/`. 19+ supported: ar, de, en, es, fa, fr, hi, hu, it, ja, ko, pl, pt-BR, pt-PT, ru, th, tr, zh, zh-TW.

**New translation keys must be appended to the END of each locale file.** Never insert in the middle. Never modify or remove existing keys. At the trial stage you can skip translations; fill them in after the feature is confirmed.

To add a new language:

1. Create `src/i18n/locales/<code>.ts`, mirroring `en.ts`.
2. Register the resource in `src/i18n/index.ts`.
3. Extend `detectLanguage` in `src/lib/utils.ts`.
4. If RTL, add the base code to `RTL_LANGUAGES` in `src/i18n/index.ts`.

### RTL layout support

jank supports RTL languages (Arabic `ar`, Persian `fa`). **All new UI must work in both LTR and RTL.** The app sets `<html dir="rtl">` automatically (`applyDocumentDirection` in `src/i18n/index.ts`) and wraps the tree in a Radix `DirectionProvider` so Radix primitives follow.

**Always prefer logical Tailwind classes over physical ones.** They flip automatically under `dir="rtl"`.

| Use (logical)                                                  | Not (physical)                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `ms-*`, `me-*`                                                 | `ml-*`, `mr-*`                                                 |
| `ps-*`, `pe-*`                                                 | `pl-*`, `pr-*`                                                 |
| `start-*`, `end-*`                                             | `left-*`, `right-*`                                            |
| `text-start`, `text-end`                                       | `text-left`, `text-right`                                      |
| `border-s`, `border-e`                                         | `border-l`, `border-r`                                         |
| `rounded-s-*`, `rounded-e-*`                                   | `rounded-l-*`, `rounded-r-*`                                   |
| `rounded-ss-*`, `rounded-se-*`, `rounded-es-*`, `rounded-ee-*` | `rounded-tl-*`, `rounded-tr-*`, `rounded-bl-*`, `rounded-br-*` |

**Exception:** keep physical classes when anchoring to a screen edge rather than to content flow. Modal close buttons (top-right global convention), notification badges on icon corners, dialog centering via `left-[50%]`, carousel arrows pinned to physical positions should stay physical.

**Does NOT flip automatically:**

- **CSS transforms** (`translate-x-*`, `rotate-*`): not direction-aware. Use the `rtl:` variant, e.g. `translate-x-full rtl:-translate-x-full`.
- **Direction-sensitive icons** from `lucide-react` (`ChevronRight`, `ChevronLeft`, `ArrowLeft`, `ArrowRight`, `ChevronsLeft`, `ChevronsRight`) when used as navigation / drill-in / back indicators: add `className="rtl:-scale-x-100"`. Skip when the icon represents a physical spatial concept (carousel arrows tied to absolute `left-4`/`right-4` buttons).
- **JS-driven directions:** Vaul's `direction="left"`, Embla scroll direction, anything reading `offsetLeft`/`scrollLeft`. Read `i18n.dir()` via `useTranslation` and branch. Example: `<Drawer direction={i18n.dir() === 'rtl' ? 'right' : 'left'}>`.

**User-generated content** (notes, bios, usernames): **add `dir="auto"` to the outermost container.** Lets the Unicode Bidirectional Algorithm pick direction per content. Containers already done: `Content`, `MarkdownContent`, `Username`, `TextWithEmojis`, `ProfileAbout`, `ContentPreview/Content`, `ParentNotePreview`, `GroupMetadata`, `CommunityDefinition`. Do **NOT** put `dir="auto"` on translated UI strings (t() output, button labels, timestamps, relay URLs, event IDs) — those follow chrome direction.

**RTL verification checklist for any new component:**

1. No new `ml-*/mr-*/pl-*/pr-*/left-*/right-*/text-left/right/border-l/r/rounded-l/r*` unless physically anchored.
2. Any chevron/arrow used for navigation flow carries `rtl:-scale-x-100`.
3. User-generated text containers carry `dir="auto"`.
4. Any JS that reads `offsetLeft` or sets `translate-x-*` has been thought through.
5. Smoke-test in Arabic (Settings → Languages → العربية).

## Nostr integration

### Core concepts

- **Events:** all data in Nostr. Different `kind` numbers represent different content types.
- **Relays:** WebSocket servers that store and forward events.
- **NIPs:** Nostr Implementation Proposals.

### Supported event kinds

Kinds rendered in feeds:

- Kind 1: Short Text Note
- Kind 6: Repost
- Kind 20: Picture Note
- Kind 21: Video Note
- Kind 22: Short Video Note
- Kind 1068: Poll
- Kind 1111: Comment
- Kind 1222: Voice Note
- Kind 1244: Voice Comment
- Kind 9802: Highlight
- Kind 30023: Long-Form Article
- Kind 31987: Relay Review
- Kind 34550: Community Definition
- Kind 30311: Live Event
- Kind 39000: Group Metadata
- Kind 30030: Emoji Pack

To support a new kind: add a component under `src/components/Note/`, update `src/components/Note/index.tsx`, then update `src/components/ContentPreview/` for the preview-row variant (one line of text; prefer text-only). **Do not modify the Note framework** (avatars, usernames, timestamps, action buttons); only add content rendering for new kinds.

### Common components

**`src/components/Note`** — renders one event. Props:

- `event: NoteEvent`
- `hideParentNotePreview?: boolean`
- `showFull?: boolean` (default `false`; long content gets truncated with "Show more")

**`src/components/NoteList`** — virtualized infinite-scroll list. Row rendering is virtualized via `NoteList/VirtualNoteList.tsx` (`virtua` — swapped from `@tanstack/react-virtual` in PR #95 for built-in scroll anchoring; only rows in/near viewport mount). virtua anchors the viewport to the top visible row and auto-estimates row sizes from measurements (no `itemSize` hint), so a re-measured row doesn't lurch the feed on scroll-back. NoteList still owns the subscription effect, filtered events, pinned-notes header, "show new notes" pill, and the bottom-IO sentinel for relay pagination. **Each rendered row must carry a stable React `key`** — virtua caches measured heights per key (the old `getItemKey` prop is gone).

Props:

- `subRequests: { urls: string[]; filter: Omit<Filter, 'since' | 'until'> }[]`
- `showKinds: number[]`
- `filterMutedNotes: boolean`
- `hideReplies: boolean`
- `hideUntrustedNotes: boolean`
- `filterFn: (note: NoteEvent) => boolean`

NoteList **must be rendered inside a `<ScrollContainerProvider>`** (mounted at Column body and Primary/Secondary layouts) so the virtualizer can find its scroll element (passed to virtua's `Virtualizer` as `scrollRef`, with `startMargin` for content rendered above the list). Otherwise it falls back to virtua's `WindowVirtualizer`. NoteList also reads `useColumnVisible()` to defer subscription opens for off-screen columns at cold start.

**`src/components/Tabs`** — tab switcher. Props: `tabs`, `value`, `onChange`, `threshold` (default 800; height for scroll-down auto-hide), `options` (right-side slot).

### Parsing content

Use `parseContent` in `src/lib/content-parser.ts` to parse note bodies. It returns `TEmbeddedNode[]`; render each node by type in order. To support a new node type, add a parsing method in `content-parser.ts`. To recognize specific URLs as special nodes, extend `EmbeddedUrlParser`. Full usage example: `src/components/Content/index.tsx`.

## Development guide

### Environment setup

```bash
npm install
npm run dev      # development server
npm run build    # production build (THIS is the real type check)
npm run lint
npm run format
```

### Type-checking

`tsconfig.json` is solution-style. **`npx tsc --noEmit` exits 0 without actually type-checking; it's a no-op.** The real check happens in:

- `npm run build` (Vite + esbuild) — full TS pipeline. **This is what CI runs.**
- `npx tsc -b` (project-references build) — also full check, faster for incremental work.

**Before commit/merge, always `npm run build` (or `tsc -b`).** Don't trust `tsc --noEmit` — it lies. This has bitten previous ships; always use `npm run build`.

### Style modifications

- Global styles: `src/index.css`
- Tailwind config: `tailwind.config.js`
- Component styles: Tailwind classes directly
