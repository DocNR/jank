# Profile Sub-Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Media, Articles, Zaps, Reactions, and an inline Relays view as tabs on the Profile column, and split the existing "Notes and replies" tab into a mutually-exclusive "Replies" tab.

**Architecture:** Turn `ProfileFeed` into a tab **dispatcher**: the `<Tabs>` bar stays, but the body branches by the selected tab's `view`. Feed-shaped tabs (Notes, Replies, Articles, You) render the existing `<NoteList>` with different filters/`filterFn`; bespoke tabs (Media, Zaps, Reactions, Relays) render dedicated small components. A new `PROFILE_FEED_TABS` constant keeps profile-only tabs out of the shared `DEFAULT_FEED_TABS`.

**Tech Stack:** React 18 + TypeScript, Tailwind, `nostr-tools`, Vitest. Reuses `NoteList`, `timelineCache`, `getImetaInfosFromEvent`, `isReplyNoteEvent`, `getZapInfoFromEvent`, `ZapNotification`, `useFetchRelayList`, `useFetchEvent`.

**Staging:** Stage 1 (foundation + Notes/Replies split + Articles + Relays), Stage 2 (Media), Stage 3 (Zaps + Reactions). Each stage is independently shippable. Run `npm run build` (NOT `tsc --noEmit`) as the type check.

---

## File Structure

**Created:**
- `src/components/Profile/profile-feed-tabs.ts` — `TProfileTab` type, `PROFILE_FEED_TABS`, `buildProfileTabs()`.
- `src/components/Profile/profile-feed-tabs.spec.ts` — tests for tab list + `buildProfileTabs`.
- `src/components/Profile/tabs/ProfileRelaysTab.tsx` — inline NIP-65 read/write list.
- `src/components/Profile/tabs/ProfileMediaTab.tsx` — masonry media grid.
- `src/components/Profile/tabs/profile-media.ts` — pure `extractMediaItems(event)` helper.
- `src/components/Profile/tabs/profile-media.spec.ts` — extraction tests.
- `src/components/Profile/tabs/ProfileZapsTab.tsx` — zaps-received list.
- `src/components/Profile/tabs/ProfileReactionsTab.tsx` — reactions-made list.

**Modified:**
- `src/components/Profile/ProfileFeed.tsx` — dispatcher refactor; consume `PROFILE_FEED_TABS`.
- `src/i18n/locales/en.ts` — append new tab labels + empty-state strings (END of file).

---

## STAGE 1 — Foundation, Notes/Replies split, Articles, Relays

### Task 1: Profile tab descriptors

**Files:**
- Create: `src/components/Profile/profile-feed-tabs.ts`
- Test: `src/components/Profile/profile-feed-tabs.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/Profile/profile-feed-tabs.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Profile/profile-feed-tabs.spec.ts`
Expected: FAIL — `Cannot find module './profile-feed-tabs'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/Profile/profile-feed-tabs.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Profile/profile-feed-tabs.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Profile/profile-feed-tabs.ts src/components/Profile/profile-feed-tabs.spec.ts
git commit -m "feat(profile): add PROFILE_FEED_TABS descriptors and buildProfileTabs"
```

---

### Task 2: ProfileRelaysTab (inline NIP-65 list)

**Files:**
- Create: `src/components/Profile/tabs/ProfileRelaysTab.tsx`

> No unit test — this is a thin presentational component over the already-tested
> `useFetchRelayList`. Verified via build + manual smoke.

- [ ] **Step 1: Write the component**

```tsx
// src/components/Profile/tabs/ProfileRelaysTab.tsx
import { useFetchRelayList } from '@/hooks'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { SecondaryPageLink } from '@/DeckManager'
import { Loader, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Inline NIP-65 (kind-10002) relay list for a profile. Read and Write sections,
 * each relay row linking to spawn a Relay column. Read-only; no signer needed.
 */
export default function ProfileRelaysTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { relayList, isFetching } = useFetchRelayList(pubkey)

  if (isFetching && relayList.originalRelays.length === 0) {
    return (
      <div className="flex justify-center p-8">
        <Loader className="size-5 animate-spin" />
      </div>
    )
  }

  if (relayList.originalRelays.length === 0) {
    return <div className="text-muted-foreground p-8 text-center">{t('No relays published')}</div>
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <RelaySection title={t('Read relays')} urls={relayList.read} />
      <RelaySection title={t('Write relays')} urls={relayList.write} />
    </div>
  )
}

function RelaySection({ title, urls }: { title: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-semibold uppercase">{title}</div>
      <div className="flex flex-col">
        {urls.map((url) => (
          <SecondaryPageLink
            key={url}
            to={toRelay(url)}
            className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          >
            <Radio className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{simplifyUrl(url)}</span>
          </SecondaryPageLink>
        ))}
      </div>
    </div>
  )
}
```

> **Before implementing, verify these exist** (adjust imports if names differ):
> - `toRelay` in `src/lib/link.ts` (used by the Relay column deep link). If it is named
>   differently, run `grep -n "export const to.*[Rr]elay" src/lib/link.ts` and use that.
> - `simplifyUrl` in `src/lib/url.ts` (`grep -rn "export function simplifyUrl" src/lib`). If
>   absent, fall back to displaying the raw `url`.
> - `relayList.read` / `relayList.write` / `relayList.originalRelays` shape from
>   `useFetchRelayList` (`sed -n '1,40p' src/hooks/useFetchRelayList.tsx`).

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Profile/tabs/ProfileRelaysTab.tsx
git commit -m "feat(profile): inline NIP-65 relays tab body"
```

---

### Task 3: ProfileFeed dispatcher refactor (wires Notes/Replies/Articles/Relays)

**Files:**
- Modify: `src/components/Profile/ProfileFeed.tsx`

This task rewires `ProfileFeed` to consume `PROFILE_FEED_TABS` and dispatch by `view`. The
existing pinned-notes, search box, kind-filter, and You-mode logic are preserved for the
`notes` view. New tabs short-circuit to their own bodies.

- [ ] **Step 1: Replace the tab source + add the dispatcher**

Make these concrete edits in `src/components/Profile/ProfileFeed.tsx`:

1. Replace the import of `DEFAULT_FEED_TABS` with the profile tabs + the reply helper + new bodies:

```ts
import { buildProfileTabs, TProfileTab } from './profile-feed-tabs'
import { isReplyNoteEvent } from '@/lib/event'
import ProfileRelaysTab from './tabs/ProfileRelaysTab'
```

2. Replace `visibleTabs` construction with:

```ts
const visibleTabs = useMemo<TProfileTab[]>(
  () => buildProfileTabs({ isSelf: myPubkey === pubkey, hasViewer: !!myPubkey }),
  [myPubkey, pubkey]
)
```

3. Replace the `selectedTab` typing to `TProfileTab` (was `TFeedTabConfig`). Keep the existing
   `selectedTabId` state + the effect that syncs `selectedTab.id`.

4. Derive view flags after `selectedTab` is resolved:

```ts
const view = selectedTab?.view ?? 'notes'
const isYouMode = selectedTab?.id === 'you'
const isArticles = selectedTab?.id === 'articles'
const tabHasFixedKinds = isArticles
const hideReplies = selectedTab?.hideReplies ?? false
const onlyReplies = selectedTab?.onlyReplies ?? false
const effectiveShowKinds = isArticles ? [kinds.LongFormArticle] : temporaryShowKinds
```

5. In the subRequests `useEffect`, add an Articles branch before the default note branch
   (keeps the relay scoping but pins the kind in the filter):

```ts
if (isArticles) {
  const relayList = await relayListService.fetchRelayList(pubkey)
  setSubRequests([
    {
      urls: relayList.write.concat(getDefaultRelayUrls()).slice(0, 8),
      filter: { authors: [pubkey], kinds: [kinds.LongFormArticle] }
    }
  ])
  return
}
```
Add `isArticles` to that effect's dependency array.

6. The kind filter (`KindFilter`) should only render for the plain notes views, not Articles.
   Change its guard to `{view === 'notes' && !isYouMode && !tabHasFixedKinds && (...)}`.

7. Replace the single `<NoteList>` render at the bottom with a dispatcher:

```tsx
const renderBody = () => {
  switch (view) {
    case 'relays':
      return <ProfileRelaysTab pubkey={pubkey} />
    // 'media', 'zaps', 'reactions' added in later stages; until then they fall through
    // to the note list, which is harmless but replaced in Stage 2/3.
    case 'notes':
    case 'articles':
    default:
      return (
        <NoteList
          ref={noteListRef}
          subRequests={subRequests}
          showKinds={effectiveShowKinds}
          hideReplies={hideReplies}
          filterMutedNotes={false}
          filterFn={onlyReplies ? isReplyNoteEvent : undefined}
          pinnedEventIds={
            isYouMode || tabHasFixedKinds || onlyReplies || !!search ? [] : pinnedEventIds
          }
          showNewNotesDirectly={myPubkey === pubkey}
        />
      )
  }
}
```

Then render `{renderBody()}` where the `<NoteList>` used to be.

8. The search box in `Profile/index.tsx` is passed down as `search`. Search only makes sense
   for note feeds — when `view !== 'notes'`, ignore `search` (the dispatcher already routes
   away from NoteList, so no extra change needed; just confirm the Articles branch ignores it,
   which the code above does).

> **Note on `filterFn`:** `NoteList` already accepts `filterFn?: (event: Event) => boolean`
> (verified at `src/components/NoteList/index.tsx:70`). `isReplyNoteEvent` is exported from
> `src/lib/event.ts:46`. This replaces the spec's proposed `onlyReplies` prop — no shared
> NoteList change required.

- [ ] **Step 2: Run the existing constants/profile tests**

Run: `npx vitest run src/components/Profile/profile-feed-tabs.spec.ts src/constants.spec.ts`
Expected: PASS. (`constants.spec.ts` still asserts `DEFAULT_FEED_TABS` has length 2 — unchanged.)

- [ ] **Step 3: Type-check the whole app**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke**

Run `npm run dev`, open a Profile column. Confirm tab bar shows Notes · Replies · Media ·
Articles · Zaps · Reactions · Relays (and You on others' profiles). Confirm:
- Notes = top-level only; Replies = only replies; Articles = long-form; Relays = inline list.
- Media/Zaps/Reactions currently render the note list (placeholder until later stages).

- [ ] **Step 5: Commit**

```bash
git add src/components/Profile/ProfileFeed.tsx
git commit -m "feat(profile): dispatch profile tabs by view; add Replies/Articles/Relays tabs"
```

---

### Task 4: i18n labels for Stage 1

**Files:**
- Modify: `src/i18n/locales/en.ts` (append at END only)

- [ ] **Step 1: Append keys**

Add these to the very end of the translations object in `src/i18n/locales/en.ts` (keep existing
keys untouched; `Notes` and `Notes and replies` already exist — only add the new ones):

```ts
    Replies: 'Replies',
    Media: 'Media',
    Articles: 'Articles',
    Zaps: 'Zaps',
    Reactions: 'Reactions',
    'Read relays': 'Read relays',
    'Write relays': 'Write relays',
    'No relays published': 'No relays published',
    'No media yet': 'No media yet',
    'No articles yet': 'No articles yet',
    'No zaps yet': 'No zaps yet',
    'No reactions yet': 'No reactions yet'
```

> If any key already exists (e.g. `Articles` from the Articles column), do not duplicate it —
> `grep -n "Articles:" src/i18n/locales/en.ts` first and skip duplicates.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.ts
git commit -m "i18n(profile): add sub-feed tab labels and empty states (en)"
```

**STAGE 1 COMPLETE — shippable.** Notes/Replies split, Articles tab, Relays tab live.

---

## STAGE 2 — Media tab

### Task 5: Media extraction helper (pure, TDD)

**Files:**
- Create: `src/components/Profile/tabs/profile-media.ts`
- Test: `src/components/Profile/tabs/profile-media.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/Profile/tabs/profile-media.spec.ts
import { describe, expect, it } from 'vitest'
import { Event } from 'nostr-tools'
import { extractMediaItems } from './profile-media'

function evt(partial: Partial<Event>): Event {
  return {
    id: 'id1',
    pubkey: 'pk',
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...partial
  } as Event
}

describe('extractMediaItems', () => {
  it('extracts image URLs from kind-1 content', () => {
    const e = evt({ content: 'hello https://img.example/a.jpg world' })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://img.example/a.jpg', type: 'image', sourceEvent: e }
    ])
  })

  it('extracts video URLs as type video', () => {
    const e = evt({ content: 'clip https://v.example/b.mp4' })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://v.example/b.mp4', type: 'video', sourceEvent: e }
    ])
  })

  it('extracts imeta image urls (kind-20 picture note with no inline url)', () => {
    const e = evt({
      kind: 20,
      content: 'my pic',
      tags: [['imeta', 'url https://img.example/c.png', 'm image/png']]
    })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://img.example/c.png', type: 'image', sourceEvent: e }
    ])
  })

  it('dedupes a url that appears in both imeta and content', () => {
    const e = evt({
      content: 'see https://img.example/d.jpg',
      tags: [['imeta', 'url https://img.example/d.jpg']]
    })
    expect(extractMediaItems(e).map((m) => m.url)).toEqual(['https://img.example/d.jpg'])
  })

  it('returns empty for a note with no media', () => {
    expect(extractMediaItems(evt({ content: 'just text, no links' }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Profile/tabs/profile-media.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/Profile/tabs/profile-media.ts
import { getImetaInfosFromEvent } from '@/lib/event'
import { Event } from 'nostr-tools'

export type TMediaItem = {
  url: string
  type: 'image' | 'video'
  sourceEvent: Event
}

const URL_RE = /https?:\/\/[^\s]+/gi
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i

function classify(url: string): 'image' | 'video' | null {
  if (IMAGE_EXT_RE.test(url)) return 'image'
  if (VIDEO_EXT_RE.test(url)) return 'video'
  return null
}

/**
 * Extracts every media item (image/video) from a note. Combines NIP-92 `imeta`
 * tag URLs with URLs found in content. Each item carries its `sourceEvent` so the
 * grid can link the tile back to the original note. Dedupes by URL.
 */
export function extractMediaItems(event: Event): TMediaItem[] {
  const seen = new Set<string>()
  const items: TMediaItem[] = []

  const push = (url: string, type: 'image' | 'video') => {
    if (seen.has(url)) return
    seen.add(url)
    items.push({ url, type, sourceEvent: event })
  }

  // imeta tags first (authoritative; carry mime type)
  for (const info of getImetaInfosFromEvent(event)) {
    if (!info.url) continue
    // imeta `m` (mime) when present; else fall back to extension.
    const mime = (info as { m?: string }).m
    const type = mime?.startsWith('video/')
      ? 'video'
      : mime?.startsWith('image/')
        ? 'image'
        : classify(info.url)
    if (type) push(info.url, type)
  }

  // content URLs
  for (const raw of event.content.match(URL_RE) ?? []) {
    const url = raw.replace(/[.,;:'")\]}]+$/, '')
    const type = classify(url)
    if (type) push(url, type)
  }

  return items
}
```

> Confirm `TImetaInfo` has a `url` field and optional `m` (mime): `grep -n "TImetaInfo" src/types/*.d.ts`.
> If `m` is exposed under a different name, adjust the `mime` read; the extension fallback keeps
> the test green regardless.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Profile/tabs/profile-media.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Profile/tabs/profile-media.ts src/components/Profile/tabs/profile-media.spec.ts
git commit -m "feat(profile): extractMediaItems helper for the media grid"
```

---

### Task 6: ProfileMediaTab (masonry grid + backlinks)

**Files:**
- Create: `src/components/Profile/tabs/ProfileMediaTab.tsx`

> Presentational + subscription wiring; verified by build + manual smoke. The pure extraction
> logic is already tested in Task 5.

- [ ] **Step 1: Write the component**

```tsx
// src/components/Profile/tabs/ProfileMediaTab.tsx
import Image from '@/components/Image'
import { useSecondaryPage } from '@/DeckManager'
import { toNote } from '@/lib/link'
import { getDefaultRelayUrls } from '@/lib/relay'
import relayListService from '@/services/fetchers/relay-list.service'
import timelineCache from '@/services/caches/timeline-cache.service'
import { Loader, Play } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extractMediaItems, TMediaItem } from './profile-media'

const MEDIA_KINDS = [1, 20, 21, 22]
const PAGE_LIMIT = 30

/**
 * Masonry media grid for a profile. Subscribes to the author's notes (kinds
 * 1/20/21/22), extracts all media, renders 2-col masonry. Each tile links back
 * to its source note as a transient detail column.
 */
export default function ProfileMediaTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const [items, setItems] = useState<TMediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [until, setUntil] = useState<number | undefined>(undefined)
  const [hasMore, setHasMore] = useState(true)
  const timelineKeyRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Initial subscription
  useEffect(() => {
    let closer: (() => void) | undefined
    let cancelled = false
    setItems([])
    setLoading(true)
    setHasMore(true)
    ;(async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      const urls = relayList.write.concat(getDefaultRelayUrls()).slice(0, 8)
      const { closer: c, timelineKey } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { authors: [pubkey], kinds: MEDIA_KINDS, limit: PAGE_LIMIT } }],
        {
          onEvents: (events: Event[]) => {
            if (cancelled) return
            setItems(mergeMedia(events))
            setLoading(false)
            const oldest = events[events.length - 1]?.created_at
            if (oldest) setUntil(oldest)
          },
          onNew: (event: Event) => {
            if (cancelled) return
            setItems((prev) => dedupeMedia([...extractMediaItems(event), ...prev]))
          }
        }
      )
      closer = c
      timelineKeyRef.current = timelineKey
    })()
    return () => {
      cancelled = true
      closer?.()
    }
  }, [pubkey])

  const loadMore = useCallback(async () => {
    if (!timelineKeyRef.current || until === undefined) return
    const older = await timelineCache.loadMoreTimeline(timelineKeyRef.current, until, PAGE_LIMIT)
    if (!older || older.length === 0) {
      setHasMore(false)
      return
    }
    setItems((prev) => dedupeMedia([...prev, ...older.flatMap(extractMediaItems)]))
    const oldest = older[older.length - 1]?.created_at
    if (oldest) setUntil(oldest)
  }, [until])

  // Infinite scroll sentinel
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore) loadMore()
      },
      { rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, hasMore])

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center p-8">
        <Loader className="size-5 animate-spin" />
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return <div className="text-muted-foreground p-8 text-center">{t('No media yet')}</div>
  }

  return (
    <div className="p-1">
      <div className="[column-gap:4px] [columns:2]">
        {items.map((item) => (
          <button
            key={`${item.sourceEvent.id}:${item.url}`}
            onClick={() => push(toNote(item.sourceEvent))}
            className="bg-muted relative mb-1 block w-full overflow-hidden rounded-md [break-inside:avoid]"
          >
            <Image image={{ url: item.url }} className="w-full" />
            {item.type === 'video' && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Play className="size-8 fill-white/90 text-white drop-shadow" />
              </span>
            )}
          </button>
        ))}
      </div>
      <div ref={bottomRef} className="h-8" />
      {loading && items.length > 0 && (
        <div className="flex justify-center p-4">
          <Loader className="size-4 animate-spin" />
        </div>
      )}
    </div>
  )
}

function mergeMedia(events: Event[]): TMediaItem[] {
  return dedupeMedia(events.flatMap(extractMediaItems))
}

function dedupeMedia(items: TMediaItem[]): TMediaItem[] {
  const seen = new Set<string>()
  const out: TMediaItem[] = []
  for (const it of items) {
    const key = `${it.sourceEvent.id}:${it.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}
```

> **Verify the `timelineCache.subscribeTimeline` callback contract before implementing** — the
> exact callback names (`onEvents`/`onNew` vs `onEose`/`onUpdate`) and the `loadMoreTimeline`
> return shape: `sed -n '53,160p' src/services/caches/timeline-cache.service.ts`, and copy how
> `NoteList` (`src/components/NoteList/index.tsx:507` and `:577`) calls them. Adjust the callback
> wiring to match the real signature — the masonry render + extraction logic stays the same.
> Also confirm `Image`'s prop name (`image={{ url }}` vs `src`): `sed -n '1,40p' src/components/Image/index.tsx`.

- [ ] **Step 2: Wire into the dispatcher**

In `src/components/Profile/ProfileFeed.tsx`, import and add the case:

```tsx
import ProfileMediaTab from './tabs/ProfileMediaTab'
// ...
case 'media':
  return <ProfileMediaTab pubkey={pubkey} />
```

- [ ] **Step 3: Build + smoke**

Run: `npm run build` then `npm run dev`.
Open a media-heavy profile (e.g. a photographer), open Media tab. Expect a 2-col masonry of
images/videos; clicking a tile opens the source note as a detail column; scrolling loads more.

- [ ] **Step 4: Commit**

```bash
git add src/components/Profile/tabs/ProfileMediaTab.tsx src/components/Profile/ProfileFeed.tsx
git commit -m "feat(profile): masonry media tab with source-note backlinks"
```

**STAGE 2 COMPLETE — shippable.**

---

## STAGE 3 — Zaps & Reactions

### Task 7: ProfileZapsTab (zaps received)

**Files:**
- Create: `src/components/Profile/tabs/ProfileZapsTab.tsx`

> Parsing is already covered by `getZapInfoFromEvent` (tested elsewhere). This component is
> subscription wiring + reuse of the existing `ZapNotification` row renderer.

- [ ] **Step 1: Write the component**

```tsx
// src/components/Profile/tabs/ProfileZapsTab.tsx
import { ZapNotification } from '@/components/NotificationList/NotificationItem/ZapNotification'
import { getDefaultRelayUrls } from '@/lib/relay'
import relayListService from '@/services/fetchers/relay-list.service'
import timelineCache from '@/services/caches/timeline-cache.service'
import { Loader } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PAGE_LIMIT = 30

/**
 * Zaps RECEIVED by a profile: kind-9735 receipts where `#p` = pubkey, on the
 * author's READ relays (where zappers publish to reach them). Reverse-chron.
 * Reuses the ZapNotification row renderer (zapper + amount + comment + target).
 */
export default function ProfileZapsTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const [zaps, setZaps] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const closerRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setZaps([])
    setLoading(true)
    ;(async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      const urls = relayList.read.concat(getDefaultRelayUrls()).slice(0, 8)
      const { closer } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { kinds: [kinds.Zap], '#p': [pubkey], limit: PAGE_LIMIT } }],
        {
          onEvents: (events: Event[]) => {
            if (cancelled) return
            setZaps(events)
            setLoading(false)
          },
          onNew: (event: Event) => {
            if (cancelled) return
            setZaps((prev) =>
              prev.some((e) => e.id === event.id)
                ? prev
                : [event, ...prev].sort((a, b) => b.created_at - a.created_at)
            )
          }
        }
      )
      closerRef.current = closer
    })()
    return () => {
      cancelled = true
      closerRef.current?.()
    }
  }, [pubkey])

  if (loading && zaps.length === 0) {
    return (
      <div className="flex justify-center p-8">
        <Loader className="size-5 animate-spin" />
      </div>
    )
  }
  if (!loading && zaps.length === 0) {
    return <div className="text-muted-foreground p-8 text-center">{t('No zaps yet')}</div>
  }

  return (
    <div className="flex flex-col">
      {zaps.map((zap) => (
        <ZapNotification key={zap.id} notification={zap} />
      ))}
    </div>
  )
}
```

> Match the real `subscribeTimeline` callback names (see Task 6's verification note). The
> `ZapNotification` import path/named-export was verified at
> `src/components/NotificationList/NotificationItem/ZapNotification.tsx`. It renders a row with
> sender, amount, comment, and the zapped note — exactly the received-zap view.

- [ ] **Step 2: Wire into dispatcher**

In `ProfileFeed.tsx`:

```tsx
import ProfileZapsTab from './tabs/ProfileZapsTab'
// ...
case 'zaps':
  return <ProfileZapsTab pubkey={pubkey} />
```

- [ ] **Step 3: Build + smoke**

Run: `npm run build`, then open a well-known profile's Zaps tab. Expect a reverse-chron list of
received zaps with amounts and the zapped note.

- [ ] **Step 4: Commit**

```bash
git add src/components/Profile/tabs/ProfileZapsTab.tsx src/components/Profile/ProfileFeed.tsx
git commit -m "feat(profile): zaps-received tab"
```

---

### Task 8: ProfileReactionsTab (reactions made)

**Files:**
- Create: `src/components/Profile/tabs/ProfileReactionsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/Profile/tabs/ProfileReactionsTab.tsx
import Note from '@/components/Note'
import { useFetchEvent } from '@/hooks'
import { getParentETag } from '@/lib/event'
import { getDefaultRelayUrls } from '@/lib/relay'
import relayListService from '@/services/fetchers/relay-list.service'
import timelineCache from '@/services/caches/timeline-cache.service'
import { Loader } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PAGE_LIMIT = 30

/**
 * Reactions MADE by a profile: kind-7 events authored by pubkey, on the author's
 * WRITE relays. Each row resolves the target note (last `e`-tag) and renders it
 * with the reaction content (emoji / `+`) overlaid. Reverse-chron flat list.
 */
export default function ProfileReactionsTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const [reactions, setReactions] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const closerRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setReactions([])
    setLoading(true)
    ;(async () => {
      const relayList = await relayListService.fetchRelayList(pubkey)
      const urls = relayList.write.concat(getDefaultRelayUrls()).slice(0, 8)
      const { closer } = await timelineCache.subscribeTimeline(
        [{ urls, filter: { kinds: [kinds.Reaction], authors: [pubkey], limit: PAGE_LIMIT } }],
        {
          onEvents: (events: Event[]) => {
            if (cancelled) return
            setReactions(events)
            setLoading(false)
          },
          onNew: (event: Event) => {
            if (cancelled) return
            setReactions((prev) =>
              prev.some((e) => e.id === event.id) ? prev : [event, ...prev]
            )
          }
        }
      )
      closerRef.current = closer
    })()
    return () => {
      cancelled = true
      closerRef.current?.()
    }
  }, [pubkey])

  if (loading && reactions.length === 0) {
    return (
      <div className="flex justify-center p-8">
        <Loader className="size-5 animate-spin" />
      </div>
    )
  }
  if (!loading && reactions.length === 0) {
    return <div className="text-muted-foreground p-8 text-center">{t('No reactions yet')}</div>
  }

  return (
    <div className="flex flex-col">
      {reactions.map((reaction) => (
        <ReactionRow key={reaction.id} reaction={reaction} />
      ))}
    </div>
  )
}

function ReactionRow({ reaction }: { reaction: Event }) {
  const targetTag = getParentETag(reaction) ?? reaction.tags.filter((tag) => tag[0] === 'e').pop()
  const targetId = targetTag?.[1]
  const { event: target } = useFetchEvent(targetId)
  if (!targetId || !target) return null
  const emoji = reaction.content === '+' || reaction.content === '' ? '❤️' : reaction.content
  return (
    <div className="border-b">
      <div className="text-muted-foreground px-4 pt-2 text-sm">{emoji}</div>
      <Note event={target} />
    </div>
  )
}
```

> `getParentETag` is exported from `src/lib/event.ts:82` (handles kind-7 reaction parent). If it
> returns `undefined` for a reaction, the fallback grabs the last `e`-tag. Confirm `Note`'s prop
> name (`event`) and `useFetchEvent`'s return (`{ event }`) — both used widely (e.g.
> `ZapNotification.tsx` uses `useFetchEvent(eventId)` → `{ event }`).

- [ ] **Step 2: Wire into dispatcher**

In `ProfileFeed.tsx`:

```tsx
import ProfileReactionsTab from './tabs/ProfileReactionsTab'
// ...
case 'reactions':
  return <ProfileReactionsTab pubkey={pubkey} />
```

- [ ] **Step 3: Build + smoke**

Run: `npm run build`, open a profile's Reactions tab. Expect a list of target notes each topped
with the reaction emoji.

- [ ] **Step 4: Commit**

```bash
git add src/components/Profile/tabs/ProfileReactionsTab.tsx src/components/Profile/ProfileFeed.tsx
git commit -m "feat(profile): reactions-made tab"
```

**STAGE 3 COMPLETE — feature done.**

---

## Final verification (run after each stage and at the end)

- [ ] `npx vitest run src/components/Profile` — all profile unit tests pass.
- [ ] `npm run build` — full type-check + bundle succeeds (NOT `tsc --noEmit`, a no-op here).
- [ ] `npm run lint` — no new lint errors.
- [ ] Manual smoke in `npm run dev`: each tab loads, empty states render, Media backlinks open
      the source note, RTL check in Arabic (Settings → Languages → العربية) for the masonry +
      tab bar.

## Notes / deviations from spec

- **Replies filter:** uses NoteList's existing `filterFn` + `isReplyNoteEvent` instead of a new
  `onlyReplies` NoteList prop — no shared-code change, same behavior.
- **Out of scope (per spec):** zap amount-sorting, zaps sent, reaction emoji-grouping, reactions
  received, fullscreen media lightbox (we use the source-note backlink).
- **Subscription contract (VERIFIED against `src/services/caches/timeline-cache.service.ts:53`
  and `src/components/NoteList/index.tsx:507`):**
  ```ts
  const { closer, timelineKey } = await timelineCache.subscribeTimeline(
    subRequests,                       // { urls, filter }[]
    {
      onEvents: (events, eosed) => {   // FULL merged list each call — REPLACE state, don't append
        if (events.length > 0) setItems(transform(events))
        if (eosed) setLoading(false)   // all relays EOSE'd → initial load done
      },
      onNew: (event) => { /* single live arrival — prepend */ },
      onClose: (url, reason) => { /* optional */ }
    },
    { needSaveToDb: true }              // cache to IndexedDB (use for Media; optional for Zaps/Reactions)
  )
  // pagination:
  const older = await timelineCache.loadMoreTimeline(
    timelineKey,
    items.length ? lastEvent.created_at - 1 : dayjs().unix(),  // `until`
    LIMIT
  )                                    // returns Event[]; [] when exhausted → append to state
  ```
  Drive the bottom sentinel with the repo's `useInfiniteScroll({ items, showAllInitially: true,
  onLoadMore, initialLoading })` hook (returns `{ bottomRef, shouldShowLoadingIndicator }`) —
  NOT a hand-rolled IntersectionObserver. `onLoadMore` must return `boolean` (false = no more).
  The Task 6/7/8 component drafts below predate this verification; **mirror this contract and
  NoteList's wiring** where they differ.
