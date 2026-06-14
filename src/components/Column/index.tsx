// src/components/Column/index.tsx
import { pubkeyToHsl, pubkeyToHslComponents } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useColumns } from '@/providers/ColumnsProvider'
import { AccountScope } from '@/providers/AccountScope'
import { ScrollContainerProvider } from '@/providers/ScrollContainerProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useNostr } from '@/providers/NostrProvider'
import { ColumnVisibilityContext } from '@/hooks/useColumnVisible'
import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { LIST_STYLE_COLUMN_TYPES, WOT_TOGGLE_COLUMN_TYPES } from './column-list-style-context'
import { signingState } from './ColumnHeader/signing-state'
import { TColumn } from '@/types/column'
import { activeColumnIdAtom, focusBeamActiveAtom } from '@/atoms/active-column'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { Loader } from 'lucide-react'
import {
  CSSProperties,
  HTMLAttributes,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { SecondaryPageContext, useSecondaryPage } from '@/DeckManager'
import HomeColumnBody from './HomeColumnBody'
import MessagesColumnBody from './MessagesColumnBody'
import MuteListColumnBody from './MuteListColumnBody'
import NotificationsColumnBody from './NotificationsColumnBody'
import DetailColumnBody from './DetailColumnBody'
import RelayColumnBody from './RelayColumnBody'
import ArticlesColumnBody from './ArticlesColumnBody'
import BookmarksColumnBody from './BookmarksColumnBody'
import FavoritesColumnBody from './FavoritesColumnBody'
import HashtagColumnBody from './HashtagColumnBody'
import ProfileColumnBody from './ProfileColumnBody'
import SearchColumnBody from './SearchColumnBody'
import ColumnHeader from './ColumnHeader'

// Snapshot/DVM column bodies are rare (a deck without them never needs the
// code) and pull in heavier dependencies (the ContextVM transport, DVM
// lifecycle logic). Lazy-load them so a typical Home/Notifications/Relay deck
// doesn't parse them at startup. Suspense below renders a spinner while the
// chunk loads on first use.
const DvmDiscoverColumnBody = lazy(() => import('./DvmDiscoverColumnBody'))
const DvmFeedColumnBody = lazy(() => import('./DvmFeedColumnBody'))
const RelatrDiscoveryColumnBody = lazy(() => import('./RelatrDiscoveryColumnBody'))

type Props = {
  column: TColumn
  /** Drag-handle props (attributes + listeners) to spread on the header. */
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
  /** Optional style override (used by SortableColumn for dnd-kit transform). */
  style?: CSSProperties
}

export function Column({ column, dragHandleProps, style }: Props) {
  // WS3: width tracks `--deck-col-width` (400px desktop / viewport-wide mobile).
  // A per-column `column.width` override still wins when present.
  const baseWidth: number | string = column.width ?? 'var(--deck-col-width, 400px)'
  const { isSmallScreen } = useScreenSize()
  const { pinColumn, unpinColumn, removeColumn, removingIds, updateColumnConfig } = useColumns()
  const { notificationListStyle: globalListStyle } = useUserPreferences()
  const { pubkey: activeAccountPubkey } = useNostr()
  const setActiveColumnId = useSetAtom(activeColumnIdAtom)
  const setFocusBeamActive = useSetAtom(focusBeamActiveAtom)
  // Per-column derived subscriptions: this Column re-renders only when
  // its OWN active/focused state flips, not on every global atom change.
  // Without these, switching active from A to B re-rendered all N
  // Columns + N SortableColumns; with them, only the formerly- and
  // newly-active/focused columns re-render. Cuts beam-toggle and
  // column-click commits from ~400ms (cascade through unmemoized
  // children like KindFilter, ColumnHeader) down to ~80ms.
  const isActiveAtom = useMemo(
    () => atom((get) => get(activeColumnIdAtom) === column.id),
    [column.id]
  )
  const isActive = useAtomValue(isActiveAtom)
  // Beam follows active. Single source of truth: when beam is on, the
  // active column IS the focused one. Other columns aren't separately
  // dimmed — the FocusBeamScrim layered above them handles the dimming.
  // No delayed-exit state: when isFocused flips false, the column snaps
  // back to its slot instantly, under the still-visible scrim (which
  // fades out over 280ms). Snap-then-fade is smoother than animating
  // the column away from center, because there's no teleport-at-end-
  // of-animation discontinuity — the position change happens beneath
  // the scrim before the user sees the deck again.
  const isFocusedAtom = useMemo(
    () =>
      atom(
        (get) => get(focusBeamActiveAtom) && get(activeColumnIdAtom) === column.id
      ),
    [column.id]
  )
  const isFocused = useAtomValue(isFocusedAtom)
  // WS3: Focus Beam spotlight is a no-op on mobile (one column already fills
  // the viewport). Gate the visual lift — fixed-position overlay, entry
  // animation, glow — but keep the raw `isFocused` for behavior (X button
  // tooltip, "exit beam on X" handler) so a BT keyboard `c` press still
  // round-trips even if the user has one wired up to their phone.
  const isFocusedVisual = isFocused && !isSmallScreen
  // Animation state lives in ColumnsProvider so the keyboard `x` shortcut
  // (which calls `removeColumn` directly from the command palette) animates
  // exactly like the mouse-X path. Both routes funnel through removeColumn,
  // which is the only writer to `removingIds`.
  const removing = removingIds.has(column.id)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Perf Slice 1 — per-column horizontal-viewport visibility. Default true:
  // assume visible until the IntersectionObserver reports otherwise, so the
  // initial subscribe in NoteList isn't blocked by a pre-IO render frame.
  // ColumnVisibilityContext is consumed by NoteList's subscribe gate (defer-
  // open behavior — close-on-hide is Perf Slice 2 work).
  const visibilityRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const node = visibilityRef.current
    if (!node) return
    const root = node.closest('[data-deck-scroll]') as HTMLElement | null
    // Defensive: if Column is rendered outside DeckArea (shouldn't happen but
    // possible in tests / standalone usage), skip observation and stay visible.
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries[0].isIntersecting),
      { root, threshold: 0, rootMargin: '0px 200px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Header X behavior in beam: clicking X on the focused column EXITS BEAM
  // (instead of removing the column). The user almost always wants "close
  // this overlay" rather than "delete the column I'm reading." After exit,
  // X reverts to its normal "remove column" behavior — second click removes
  // if that's actually what they wanted.
  //
  // The 280ms fade-out timing lives in ColumnsProvider.removeColumn; both
  // this header X click and the keyboard `x` shortcut go through it.
  const handleHeaderRemove = useCallback(
    (id: string) => {
      if (isFocused) {
        setFocusBeamActive(false)
        return
      }
      removeColumn(id)
    },
    [isFocused, setFocusBeamActive, removeColumn]
  )

  // Clicking the header title bar scrolls this column's body to the top
  // (TweetDeck convention). bodyRef is the column's scroll container — same
  // element ScrollContainerProvider hands to NoteList — so this works for
  // every column type, not just NoteList feeds. Column selection is handled
  // separately by the root onClickCapture, so a single header click both
  // selects the column and scrolls it.
  //
  // Instant, not smooth: in a virtualized feed the rows above the viewport
  // have estimated heights. A smooth animation scrolling up through them
  // makes virtua measure their real heights and re-anchor mid-flight, which
  // stalls the animation partway (the "click 2-3 times to reach top" bug).
  // A direct position set jumps straight to 0 in one frame, no trajectory to
  // fight.
  const handleScrollToTop = useCallback(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  // Per-column compact/detailed list-style toggle, for column types in
  // LIST_STYLE_COLUMN_TYPES (Notifications, Bookmarks…). Constructed here
  // (rather than inside ColumnHeader) so the memoized header doesn't need to
  // subscribe to useColumns() / useUserPreferences() itself — the callback
  // identity only changes when the effective style actually flips, and the
  // column object identity changes whenever config does (so ColumnHeader's
  // memo bails for legitimate updates and short-circuits the rest).
  const effectiveListStyle = column.config?.listStyle ?? globalListStyle
  const onToggleListStyle = useCallback(() => {
    const next =
      effectiveListStyle === NOTIFICATION_LIST_STYLE.COMPACT
        ? NOTIFICATION_LIST_STYLE.DETAILED
        : NOTIFICATION_LIST_STYLE.COMPACT
    updateColumnConfig(column.id, { listStyle: next })
  }, [column.id, effectiveListStyle, updateColumnConfig])

  const wotOnly = !!column.config?.wotOnly
  const onToggleWotOnly = useCallback(() => {
    updateColumnConfig(column.id, { wotOnly: !wotOnly })
  }, [column.id, wotOnly, updateColumnConfig])

  // Account color: single source of truth for the column subtree. The stripe
  // hue is keyed on `viewContext` — "whose perspective is this column" — so it
  // matches the header avatar. These values feed the stripe, focus-within
  // border tint, and the W6 note-arrival pulse (the `--highlight` token).
  // Phase 4 layers a second `signingIdentity` hue on top as a split stripe
  // when the two diverge.
  // `spectrHue`/`--spectr-hue` are internal, legacy-named CSS custom props — left as-is on
  // purpose; renaming churns several files (here + readers below) for zero user-facing gain.
  const spectrHue = pubkeyToHsl(column.viewContext)
  const spectrHueSoft = pubkeyToHsl(column.viewContext, 0.4)
  const highlightComponents = pubkeyToHslComponents(column.viewContext)
  // The two-tone top stripe shows the view/sign mismatch (signing-hue end on
  // the right). It's driven by signingState — same source of truth as the
  // header's SigningIndicator, including the profile-aware baseline (a
  // normally-opened profile column reads as 'quiet' and gets the single-hue
  // stripe). `signingHue` feeds `--signing-hue` for descendants like the
  // StuffStats action-bar signing dot.
  const baselinePubkey =
    column.type === 'profile' && activeAccountPubkey ? activeAccountPubkey : undefined
  const signingMismatch =
    signingState(column.viewContext, column.signingIdentity, baselinePubkey) === 'loud'
  const signingHue = column.signingIdentity ? pubkeyToHsl(column.signingIdentity) : spectrHue

  return (
    <div
      ref={visibilityRef}
      role="region"
      // WS3: the active-column hue border + glow is meaningless on mobile
      // (one column fills the viewport; the visible column IS the active
      // one — no need for a sticky-selection cue). Suppress the
      // `data-active=true` styling there. The atom value itself stays the
      // raw `isActive` so non-visual consumers (focused column resolution,
      // command palette) still work.
      data-active={isActive && !isSmallScreen}
      data-focused={isFocusedVisual}
      data-column-id={column.id}
      onClickCapture={() => {
        if (!isActive) setActiveColumnId(column.id)
      }}
      className={cn(
        'border-border bg-card flex h-full shrink-0 flex-col overflow-hidden rounded-lg border shadow-md transition-[box-shadow,border-color] duration-200',
        // Sticky-selection affordance: recolor the existing 1px border to
        // the account hue (so the top stripe + side border read as one
        // continuous frame, no second outline) and pump the layered
        // hue-tinted glow ~1.5x stronger for the visual lift. Distinct
        // from the Focus Beam's louder ring+glow+scrim stack (which still
        // wins via inline boxShadow on the focused column).
        'data-[active=true]:border-[var(--spectr-hue)] data-[active=true]:shadow-[0_0_0_1px_hsl(var(--highlight)/0.85),0_0_24px_hsl(var(--highlight)/0.4),0_6px_20px_-6px_hsl(var(--highlight)/0.5),0_24px_60px_-12px_hsl(var(--highlight)/0.7)]',
        // Focus Beam v2 (spotlight overlay) — entry animation only. The
        // keyframe sets `transform: translateX(-50%) ...` to preserve the
        // horizontal centering established by the inline style. Exit has
        // no animation (snap to slot under fading scrim — see comment on
        // isFocused above).
        isFocusedVisual && 'focus-beam-column-enter',
        // W6 lifecycle animations
        removing ? 'animate-column-fade-out pointer-events-none' : 'animate-column-slide-in'
      )}
      style={
        {
          width: isFocusedVisual ? 'min(800px, 70vw)' : baseWidth,
          '--spectr-hue': spectrHue,
          '--spectr-hue-soft': spectrHueSoft,
          '--signing-hue': signingHue,
          '--highlight': highlightComponents,
          // Focus Beam v2: focused column becomes a viewport-fixed overlay
          // above the scrim. Top/bottom inset gives it deck-pane breathing
          // room; height auto-fills between them. z-index 50 sits above the
          // scrim (z-40) and below Radix modals (z-100+). The enter keyframe
          // overrides `transform` during entry; this base value matches the
          // keyframe's end state for the steady "shown" window after enter.
          ...(isFocusedVisual && {
            position: 'fixed' as const,
            insetInlineStart: '50%',
            top: '24px',
            bottom: '24px',
            transform: 'translateX(-50%)',
            zIndex: 50,
            height: 'auto',
            // Stronger glow than v1 — needs to cut through the scrim. 2px
            // hue ring frames the column in its account color. 5% inset tint
            // adds a quiet warmth on top of bg-card.
            boxShadow: [
              '0 16px 64px -8px hsl(var(--highlight) / 0.55)',
              '0 0 0 2px hsl(var(--highlight) / 0.45)',
              'inset 0 0 0 1000px hsl(var(--highlight) / 0.05)'
            ].join(', ')
          }),
          ...style
        } as CSSProperties
      }
    >
      <ColumnVisibilityContext.Provider value={isVisible}>
        <div
          className={cn(
            'shrink-0 transition-[height] duration-[600ms] ease-[cubic-bezier(0.65,0,0.35,1)]',
            isFocusedVisual ? 'h-1' : 'h-[3px]'
          )}
          style={{
            // Two-tone (view hue → signing hue) when the column signs as a
            // different account than it shows; single hue otherwise. Same
            // grammar as the sidebar spine.
            background: signingMismatch
              ? 'linear-gradient(to right, var(--spectr-hue) 0 50%, var(--signing-hue) 50% 100%)'
              : 'var(--spectr-hue)'
          }}
          aria-hidden="true"
        />
        <ColumnHeader
          column={column}
          onRemove={handleHeaderRemove}
          onPin={pinColumn}
          onUnpin={unpinColumn}
          onScrollToTop={handleScrollToTop}
          dragHandleProps={dragHandleProps}
          isFocused={isFocused}
          effectiveListStyle={
            LIST_STYLE_COLUMN_TYPES.has(column.type) ? effectiveListStyle : undefined
          }
          onToggleListStyle={
            LIST_STYLE_COLUMN_TYPES.has(column.type) ? onToggleListStyle : undefined
          }
          wotOnly={WOT_TOGGLE_COLUMN_TYPES.has(column.type) ? wotOnly : undefined}
          onToggleWotOnly={
            WOT_TOGGLE_COLUMN_TYPES.has(column.type) ? onToggleWotOnly : undefined
          }
        />
        <div
          ref={bodyRef}
          data-column-body
          className="min-h-0 flex-1 overflow-y-auto [&_.sticky]:!top-0"
        >
          <ScrollContainerProvider scrollRef={bodyRef}>
            <AccountScope
              viewContext={column.viewContext}
              signingIdentity={column.signingIdentity}
              columnType={column.type}
            >
              <ScopedSecondaryPage
                viewContext={column.viewContext}
                signingIdentity={column.signingIdentity}
              >
                <Suspense fallback={<ColumnBodyLoading />}>{dispatchBody(column)}</Suspense>
              </ScopedSecondaryPage>
            </AccountScope>
          </ScrollContainerProvider>
        </div>
      </ColumnVisibilityContext.Provider>
    </div>
  )
}

// Column stripe color is derived from the column's `viewContext` via
// `pubkeyToHsl` (golden-angle stepping + brand-zone exclusion + per-hue
// S/L tuning). The stripe and the column's focus-within border tint
// both read from `--spectr-hue` / `--spectr-hue-soft` custom props set on
// the Column root, so they always agree. The note-arrival pulse reuses
// the same source by overriding the project's --highlight token at the
// column scope.

/**
 * Wraps children in a SecondaryPageContext that auto-injects the column's
 * identity (`viewContext` + `signingIdentity`) into every push() call. So
 * clicks inside this column carry the column's perspective AND its signer for
 * the deck-home transient-column interception in DeckManager — the spawned
 * detail column inherits both.
 */
function ScopedSecondaryPage({
  viewContext,
  signingIdentity,
  children
}: {
  viewContext: string
  signingIdentity: string | null
  children: ReactNode
}) {
  const parentSecondaryPage = useSecondaryPage()
  const wrapped = useMemo(
    () => ({
      ...parentSecondaryPage,
      push: (
        url: string,
        opts?: { sourceViewContext?: string; sourceSigningIdentity?: string | null }
      ) =>
        parentSecondaryPage.push(
          url,
          opts ?? { sourceViewContext: viewContext, sourceSigningIdentity: signingIdentity }
        )
    }),
    [parentSecondaryPage, viewContext, signingIdentity]
  )
  return <SecondaryPageContext.Provider value={wrapped}>{children}</SecondaryPageContext.Provider>
}

// Exported for dispatch-coverage.spec.ts — every TColumnType must have a case
// here or the column renders the Unknown fallback at runtime.
export function dispatchBody(column: TColumn): React.ReactNode {
  switch (column.type) {
    case 'home':
      return <HomeColumnBody column={column} />
    case 'notifications':
      return <NotificationsColumnBody column={column} />
    case 'articles':
      return <ArticlesColumnBody column={column} />
    case 'bookmarks':
      return <BookmarksColumnBody column={column} />
    case 'favorites':
      return <FavoritesColumnBody column={column} />
    case 'hashtag':
      return <HashtagColumnBody column={column} />
    case 'profile':
      return <ProfileColumnBody />
    case 'search':
      return <SearchColumnBody column={column} />
    case 'dvm-discover':
      return <DvmDiscoverColumnBody column={column} />
    case 'dvm-feed':
      return <DvmFeedColumnBody column={column} />
    case 'relatr-discovery':
      return <RelatrDiscoveryColumnBody column={column} />
    case 'messages':
      return <MessagesColumnBody />
    case 'mute-list':
      return <MuteListColumnBody />
    case 'detail':
      return <DetailColumnBody column={column} />
    case 'relay':
      return <RelayColumnBody column={column} />
    default:
      return <UnknownColumnBody />
  }
}

function UnknownColumnBody() {
  const { t } = useTranslation()
  return <div className="text-muted-foreground p-4 text-sm">{t('Unknown column type')}</div>
}

// Suspense fallback shown while a lazily-loaded column body chunk is fetched
// (only the rare snapshot/DVM bodies suspend; eager bodies render immediately).
function ColumnBodyLoading() {
  return (
    <div className="flex items-center justify-center p-8">
      <Loader className="text-muted-foreground size-5 animate-spin" />
    </div>
  )
}
