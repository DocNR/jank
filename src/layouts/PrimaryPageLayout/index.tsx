import MobileMeDrawerButton from '@/components/MobileMeDrawerButton'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import { ThreeSectionTitlebar, Titlebar } from '@/components/Titlebar'
import { DeepBrowsingProvider } from '@/providers/DeepBrowsingProvider'
import { useNostr } from '@/providers/NostrProvider'
import { PageActiveContext } from '@/providers/PageActiveProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TPrimaryPageName } from '@/routes/primary'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/**
 * Titlebar rendering rules (driven by `useScreenSize().isSmallScreen`, decoupled from the
 * single-/multi-column layout mode):
 *
 * Small screen: uses `mobileTitlebar` if provided; otherwise renders a three-section layout
 *   [MeDrawer avatar | title (centered) | controls]
 * Large screen: uses `titlebar` if provided; otherwise renders an inline layout
 *   [icon + title (left-aligned) | controls (right-aligned)]
 *
 * Simple pages only need to pass `icon` + `title` (+ optional `controls`); those props are shared
 * between mobile and desktop. Pages that need a fully custom titlebar (e.g. SearchPage)
 * can use the `titlebar` / `mobileTitlebar` escape hatches.
 */
const PrimaryPageLayout = forwardRef(
  (
    {
      children,
      title,
      icon,
      controls,
      titlebar,
      mobileTitlebar,
      sideWidth,
      // pageName retained on the type for caller-side discoverability —
      // Phase 2 doesn't read it (only home + community-mode-following render
      // this layout, and active state is constant true).
      pageName: _pageName,
      displayScrollToTopButton = false,
      hideTitlebarBottomBorder = false,
      noTitlebar = false,
      noScrollArea = false
    }: {
      children?: React.ReactNode
      /**
       * Page title.
       * - Small screen: rendered in the exact center of the titlebar (icon is hidden).
       * - Large screen: rendered to the right of the icon, left-aligned.
       */
      title?: React.ReactNode
      /**
       * Page icon. Only shown on large screens, placed to the left of `title`.
       * On small screens the icon is hidden and `title` is centered on its own.
       */
      icon?: React.ReactNode
      /**
       * Right-side actions (buttons, toggles, etc.). Rendered on the far right of the titlebar
       * on both small and large screens.
       */
      controls?: React.ReactNode
      /**
       * Large-screen escape hatch for a fully custom titlebar. When set, `icon` / `title` /
       * `controls` are ignored on large screens. Used for pages whose structure doesn't fit the
       * default inline layout (e.g. NoteListPage's FeedButton).
       */
      titlebar?: React.ReactNode
      /**
       * Small-screen escape hatch for a fully custom titlebar. When set, the three-section
       * layout is bypassed — including the automatically injected MeDrawer button, which the
       * consumer must then include manually via `MobileMeDrawerButton`. Used for pages with
       * special structures (e.g. SearchPage).
       */
      mobileTitlebar?: React.ReactNode
      /**
       * Small-screen only: fixed width of the left and right tracks in the three-section layout
       * (any CSS length, e.g. `"3rem"`, `"7rem"`). Defaults to `3rem` (48px per side), enough
       * for a single icon button. When `controls` is wider than a single icon (e.g.
       * NotificationListPage's text "Hide indirect" button), increase this value; the left
       * MeDrawer avatar track grows by the same amount so that the centered title stays truly
       * centered.
       */
      sideWidth?: string
      pageName: TPrimaryPageName
      displayScrollToTopButton?: boolean
      hideTitlebarBottomBorder?: boolean
      /**
       * Skip rendering the titlebar entirely. Used by deck-home where the deck's
       * own column headers serve as the page identity.
       */
      noTitlebar?: boolean
      /**
       * Skip the small-screen branch's bottom padding (`calc(env(safe-area-inset-bottom) + 3rem)`)
       * AND the dual-column branch's `<ScrollArea>` wrapper + bottom spacer.
       * Used when the page child manages its own height/scroll.
       */
      noScrollArea?: boolean
    },
    ref
  ) => {
    const { pubkey } = useNostr()
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenScrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenLastScrollTopRef = useRef(0)
    const { isSmallScreen } = useScreenSize()

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop: (behavior: ScrollBehavior = 'smooth') => {
          setTimeout(() => {
            if (scrollAreaRef.current) {
              return scrollAreaRef.current.scrollTo({ top: 0, behavior })
            }
            window.scrollTo({ top: 0, behavior })
          }, 10)
        }
      }),
      []
    )

    useEffect(() => {
      const isVisible = () => {
        return smallScreenScrollAreaRef.current?.checkVisibility
          ? smallScreenScrollAreaRef.current?.checkVisibility()
          : false
      }

      if (isVisible()) {
        window.scrollTo({ top: smallScreenLastScrollTopRef.current, behavior: 'instant' })
      }
      const handleScroll = () => {
        if (isVisible()) {
          smallScreenLastScrollTopRef.current = window.scrollY
        }
      }
      window.addEventListener('scroll', handleScroll)
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }, [])

    useEffect(() => {
      smallScreenLastScrollTopRef.current = 0
    }, [pubkey])

    const resolvedTitlebar = isSmallScreen ? (
      mobileTitlebar ? (
        <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
          {mobileTitlebar}
        </PrimaryPageTitlebar>
      ) : (
        <ThreeSectionTitlebar
          left={<MobileMeDrawerButton />}
          center={title}
          right={controls}
          sideWidth={sideWidth}
          hideBottomBorder={hideTitlebarBottomBorder}
        />
      )
    ) : (
      <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
        {titlebar ?? (
          <div className="flex h-full items-center justify-between gap-1">
            <div className="flex min-w-0 items-center gap-2 ps-3">
              {icon}
              <div className="truncate text-lg font-semibold">{title}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">{controls}</div>
          </div>
        )}
      </PrimaryPageTitlebar>
    )

    // Phase 2: PrimaryPageLayout is only ever rendered when its page is
    // the active primary page (home or — community-mode-only — following).
    // Active state is therefore constant true.
    return (
      <PageActiveContext.Provider value={true}>
        <DeepBrowsingProvider active>
          <div
            ref={smallScreenScrollAreaRef}
            style={
              noScrollArea
                ? undefined
                : { paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)' }
            }
            className={noScrollArea ? 'h-full overflow-hidden' : undefined}
          >
            {!noTitlebar && resolvedTitlebar}
            {children}
          </div>
          {displayScrollToTopButton && <ScrollToTopButton />}
        </DeepBrowsingProvider>
      </PageActiveContext.Provider>
    )
  }
)
PrimaryPageLayout.displayName = 'PrimaryPageLayout'
export default PrimaryPageLayout

export type TPrimaryPageLayoutRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
}

function PrimaryPageTitlebar({
  children,
  hideBottomBorder = false
}: {
  children?: React.ReactNode
  hideBottomBorder?: boolean
}) {
  return (
    <Titlebar className="p-1" hideBottomBorder={hideBottomBorder}>
      {children}
    </Titlebar>
  )
}
