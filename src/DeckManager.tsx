/**
 * DeckManager owns the app shell — renames Phase 0's PageManager.
 *
 * Phase 2 PR-A: the desktop chrome collapses. The previously transitional
 * lift-and-shift Sidebar is gone — its surviving roles fold into a
 * horizontal <TopBar> that sits above a single full-width deck. Only
 * `home` remains as a primary "page"; the deck IS the home.
 *
 * Phase 2 PR-B: the secondary-stack right pane retires. Every off-home
 * push becomes a transient column on the deck via addTransientColumn,
 * which dispatches by route (Profile / Hashtag / Relay / Notifications /
 * Bookmarks / Detail). Detail columns wrap an INTERNAL secondary stack
 * inside DetailColumnBody — `useSecondaryPage()` consumed inside one of
 * those columns reads the per-column context, not the outer one defined
 * here.
 */
import { activeColumnIdAtom } from '@/atoms/active-column'
import { mobileNavStackAtom } from '@/atoms/mobile-nav-stack'
import AgentDrawer from '@/components/AgentDrawer'
import CommandDispatcher from '@/components/CommandDispatcher'
import CommandPalette from '@/components/CommandPalette'
import StarterCommands from '@/components/CommandPalette/StarterCommands'
import MobileNavStack from '@/components/MobileNavStack'
import Shell from '@/components/Shell'
import TopBar from '@/components/TopBar'
import { opensAsColumnOnMobile } from '@/lib/link'
import DeckHomePage from '@/pages/primary/DeckHomePage'
import { CurrentRelaysProvider } from '@/providers/CurrentRelaysProvider'
import { useSetAtom, useStore } from 'jotai'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react'
import BackgroundAudio from './components/BackgroundAudio'
import BottomNavigationBar from './components/BottomNavigationBar'
import TooManyRelaysAlertDialog from './components/TooManyRelaysAlertDialog'
import { cn } from './lib/utils'
import { useColumns } from './providers/ColumnsProvider'
import { NotificationProvider } from './providers/NotificationProvider'
import { useNostr } from './providers/NostrProvider'
import { useScreenSize } from './providers/ScreenSizeProvider'
import modalManager from './services/modal-manager.service'

type TSecondaryPageContext = {
  push: (
    url: string,
    opts?: { sourceViewContext?: string; sourceSigningIdentity?: string | null }
  ) => void
  pop: () => void
  /**
   * Always 0 at this outer level — there is no global secondary stack
   * post-Phase-2. DetailColumnBody overrides this context with its own
   * per-column stack index for the layouts that still consume it
   * (SecondaryPageLayout).
   */
  currentIndex: number
}

export const SecondaryPageContext = createContext<TSecondaryPageContext | undefined>(undefined)

export function useSecondaryPage() {
  const context = useContext(SecondaryPageContext)
  if (!context) {
    throw new Error('usePrimaryPage must be used within a SecondaryPageContext.Provider')
  }
  return context
}

export function DeckManager() {
  const { isSmallScreen } = useScreenSize()
  const { addTransientColumn, columns, removeColumn } = useColumns()
  const { account } = useNostr()
  const setMobileStack = useSetAtom(mobileNavStackAtom)
  const ignorePopStateRef = useRef(false)
  // Read the active column id imperatively (not via useAtomValue) so this
  // value can be sampled inside the pushSecondaryPage callback without
  // forcing the callback identity to change on every active-column flip —
  // which would invalidate SecondaryPageContext for every consumer.
  const jotaiStore = useStore()
  // Always-current view of columns for the popstate handler. The handler is
  // registered once on mount via [] deps; without this ref it would see
  // first-render columns forever.
  const columnsRef = useRef(columns)
  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  useEffect(() => {
    // Bech32 prefix shorthand: /npub1… → /p/npub1… and /note1… → /notes/note1…
    // so the boot deep-link below can match against canonical parsers.
    if (['/npub1', '/nprofile1'].some((prefix) => window.location.pathname.startsWith(prefix))) {
      window.history.replaceState(
        null,
        '',
        '/p' + window.location.pathname + window.location.search + window.location.hash
      )
    } else if (
      ['/note1', '/nevent1', '/naddr1'].some((prefix) =>
        window.location.pathname.startsWith(prefix)
      )
    ) {
      window.history.replaceState(
        null,
        '',
        '/notes' + window.location.pathname + window.location.search + window.location.hash
      )
    }
    window.history.pushState(null, '', window.location.href)
    // Phase 2 deep-link handler: cold-boot URLs land as transient columns on
    // the deck via addTransientColumn, which dispatches by route (Profile /
    // Hashtag / Relay / Notifications / Bookmarks / Detail) and dedups
    // standing types. Reset the URL to '/' so a refresh doesn't re-spawn
    // the column — the cached column state survives via the columns atom.
    if (window.location.pathname !== '/') {
      const url = window.location.pathname + window.location.search + window.location.hash
      addTransientColumn(url, null, undefined)
      try {
        window.history.replaceState(null, '', '/')
      } catch {
        /* non-browser env — skip */
      }
    }

    const onPopState = () => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }

      // Modal close-on-back stays — popping a modal consumes the back press
      // and the forward() undoes the history pop.
      const closeModal = modalManager.pop()
      if (closeModal) {
        ignorePopStateRef.current = true
        window.history.forward()
        return
      }

      // Mobile push-stack: back pops one screen. Re-arm a history entry so the
      // NEXT back also fires popstate (instead of exiting the SPA).
      const navStack = jotaiStore.get(mobileNavStackAtom)
      if (navStack.length > 0) {
        setMobileStack(navStack.slice(0, -1))
        try {
          window.history.pushState(null, '', '/')
        } catch {
          /* non-browser env — skip */
        }
        return
      }

      // Back-button closes the focused transient column. There is no
      // history entry per transient column, so one back-click closes one
      // transient — no stack to navigate through. Pinned columns are
      // permanent; the back-button doesn't touch them.
      const focusedId = jotaiStore.get(activeColumnIdAtom)
      if (focusedId) {
        const focused = columnsRef.current.find((c) => c.id === focusedId)
        if (focused?.transient) {
          removeColumn(focused.id)
          // Re-establish the placeholder history entry so the NEXT back-press
          // also fires popstate (instead of exiting the SPA).
          try {
            window.history.pushState(null, '', '/')
          } catch {
            /* non-browser env — skip */
          }
          return
        }
      }
      // No transient to close. Keep the addressbar at '/' so the URL never
      // shows a stale legacy path; the natural back behavior (browser back
      // through actual history) still applies on subsequent presses.
      try {
        window.history.replaceState(null, '', '/')
      } catch {
        /* non-browser env — skip */
      }
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  // All push() calls land as transient deck columns now. The
  // sourceViewContext/sourceSigningIdentity hints, when present, scope the
  // spawned column to the source's identity (you keep acting as whoever you
  // were); the focused column at click time becomes the new column's parent
  // for adjacency + close-back-focus.
  const pushSecondaryPage = useCallback(
    (
      url: string,
      opts?: { sourceViewContext?: string; sourceSigningIdentity?: string | null }
    ) => {
      // Mobile: in-feed drill-downs (note threads, profiles, settings, ...)
      // become native pushed screens. Only feed-shaped standing surfaces
      // (hashtag/relay/search/notifications/bookmarks/mutes) still spawn deck
      // columns. Desktop is unchanged — everything spawns a transient column.
      if (isSmallScreen && !opensAsColumnOnMobile(url)) {
        setMobileStack((prev) => [...prev, { id: crypto.randomUUID(), url }])
        // Arm a history entry so hardware/gesture back pops the screen.
        try {
          window.history.pushState(null, '', '/')
        } catch {
          /* non-browser env — skip */
        }
        return
      }
      const parentColumnId = jotaiStore.get(activeColumnIdAtom) ?? undefined
      const source = opts?.sourceViewContext
        ? {
            viewContext: opts.sourceViewContext,
            signingIdentity: opts.sourceSigningIdentity ?? null
          }
        : null
      addTransientColumn(url, source, parentColumnId)
    },
    [isSmallScreen, setMobileStack, addTransientColumn, jotaiStore]
  )

  // popSecondaryPage outside a DetailColumnBody = "close the focused
  // transient column." Inside a DetailColumnBody, the inner SecondaryPageContext
  // overrides this with the per-column pop logic.
  const popSecondaryPage = useCallback(() => {
    const focusedId = jotaiStore.get(activeColumnIdAtom)
    if (!focusedId) return
    const focused = columnsRef.current.find((c) => c.id === focusedId)
    if (focused?.transient) {
      removeColumn(focused.id)
    }
  }, [jotaiStore, removeColumn])

  const secondaryPageValue = useMemo<TSecondaryPageContext>(
    () => ({
      push: pushSecondaryPage,
      pop: popSecondaryPage,
      currentIndex: 0
    }),
    [pushSecondaryPage, popSecondaryPage]
  )

  return (
    <SecondaryPageContext.Provider value={secondaryPageValue}>
      <CurrentRelaysProvider>
        <NotificationProvider pubkey={account?.pubkey ?? null}>
          <Shell
            topbar={<TopBar />}
            content={<DeckHomePage />}
            bottomBar={isSmallScreen ? <BottomNavigationBar /> : null}
          />
          {isSmallScreen && <MobileNavStack />}
          <TooManyRelaysAlertDialog />
          <AgentDrawer />
          <BackgroundAudio className="fixed end-0 bottom-20 z-50 w-80 overflow-hidden rounded-s-full rounded-e-none border shadow-lg" />
          <CommandDispatcher />
          <CommandPalette />
          <StarterCommands />
        </NotificationProvider>
      </CurrentRelaysProvider>
    </SecondaryPageContext.Provider>
  )
}

export function SecondaryPageLink({
  to,
  children,
  className,
  onClick
}: {
  to: string
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const { push } = useSecondaryPage()

  return (
    <span
      className={cn('cursor-pointer', className)}
      onClick={(e) => {
        if (onClick) {
          onClick(e)
        }
        push(to)
      }}
    >
      {children}
    </span>
  )
}
