// src/components/MobileNavStack/index.tsx
//
// Mobile native push/pop navigation. In-feed drill-downs (note threads,
// profiles, settings, ...) append to mobileNavStackAtom and render here as
// full-screen pushed screens that slide in from the right, instead of spawning
// deck columns. Each screen is a SECONDARY_ROUTES page — which already renders
// its own back-chevron titlebar (SecondaryPageLayout) wired to this stack's
// pop(). Lower layers stay mounted (no display:none — that would restart their
// slide-in animation on reveal, making "back" wrongly animate from the right)
// so their scroll/state survive a back-out and the previous screen is simply
// revealed beneath the top one.
//
// Back: the back chevron, the hardware/browser back (popstate in DeckManager),
// and an edge swipe-back gesture all pop. The top layer follows the finger on a
// left-edge drag and slides off to the right past the threshold; the chevron
// animates the same slide-out.
//
// The stack sits above the deck + TopBar but stops short of the BottomBar, so
// the Overview button stays tappable as the one-tap "back to the deck" escape
// from any depth. push() delegates to the outer (DeckManager) push so it goes
// through the same screen-vs-column classifier.
import { mobileNavStackAtom } from '@/atoms/mobile-nav-stack'
import { SecondaryPageContext, useSecondaryPage } from '@/DeckManager'
import { normalizeToSecondaryRoute } from '@/lib/link'
import { MutedThreadRevealProvider } from '@/providers/MutedThreadRevealProvider'
import { ScrollContainerProvider } from '@/providers/ScrollContainerProvider'
import { SECONDARY_ROUTES } from '@/routes/secondary'
import { useAtom } from 'jotai'
import {
  cloneElement,
  createRef,
  ReactElement,
  RefObject,
  TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

const EDGE_START_PX = 32 // gesture must begin within this of the left edge
const CLOSE_FRACTION = 0.33 // drag past this fraction of width → pop
const ANIM_MS = 280

function buildElement(
  url: string,
  index: number,
  ref: RefObject<unknown>
): ReactElement | null {
  const path = normalizeToSecondaryRoute(url).split('?')[0].split('#')[0]
  for (const { matcher, element } of SECONDARY_ROUTES) {
    const m = matcher(path)
    if (!m || !element) continue
    return cloneElement(element, { ...m.params, index, ref } as Record<string, unknown>)
  }
  return null
}

type LayerRefs = { scroll: RefObject<HTMLDivElement>; page: RefObject<unknown> }

export default function MobileNavStack() {
  const { t } = useTranslation()
  const [stack, setStack] = useAtom(mobileNavStackAtom)
  const outer = useSecondaryPage()
  const refs = useRef(new Map<string, LayerRefs>())

  // Top-layer horizontal offset: 0 at rest, follows the finger on swipe-back,
  // and animates to the viewport width on close. `dragging` disables the
  // transition for 1:1 finger tracking.
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gestureRef = useRef<{ x: number; y: number; engaged: boolean } | null>(null)
  const closingRef = useRef(false)

  const currentIndex = stack.length - 1
  const topId = stack[currentIndex]?.id

  // Reset the offset whenever the top screen changes (push or pop). Push-in is
  // handled by the CSS slide-in on mount; this just keeps the resting offset 0.
  useEffect(() => {
    setDragX(0)
    setDragging(false)
  }, [topId])

  const closeTop = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setDragging(false)
    setDragX(window.innerWidth) // transition slides the top off to the right
    window.setTimeout(() => {
      setStack((prev) => prev.slice(0, -1))
      setDragX(0)
      closingRef.current = false
    }, ANIM_MS)
  }, [setStack])

  // Screens push through the outer (DeckManager) push so the screen-vs-column
  // classifier still applies; they pop within this stack (animated).
  const value = useMemo(
    () => ({ push: outer.push, pop: closeTop, currentIndex }),
    [outer.push, closeTop, currentIndex]
  )

  const onTouchStart = (e: ReactTouchEvent) => {
    if (closingRef.current) return
    const tch = e.touches[0]
    if (tch.clientX > EDGE_START_PX) {
      gestureRef.current = null
      return
    }
    gestureRef.current = { x: tch.clientX, y: tch.clientY, engaged: false }
  }

  const onTouchMove = (e: ReactTouchEvent) => {
    const g = gestureRef.current
    if (!g) return
    const tch = e.touches[0]
    const dx = tch.clientX - g.x
    const dy = tch.clientY - g.y
    if (!g.engaged) {
      // Decide once: vertical-dominant → let the page scroll; horizontal → swipe.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        gestureRef.current = null
        return
      }
      if (dx > 10) {
        g.engaged = true
        setDragging(true)
      } else {
        return
      }
    }
    setDragX(Math.max(0, dx))
  }

  const onTouchEnd = () => {
    const g = gestureRef.current
    gestureRef.current = null
    if (!g?.engaged) return
    setDragging(false)
    if (dragX > window.innerWidth * CLOSE_FRACTION) closeTop()
    else setDragX(0) // snap back via transition
  }

  if (stack.length === 0) return null

  const getRefs = (id: string): LayerRefs => {
    let r = refs.current.get(id)
    if (!r) {
      r = { scroll: createRef<HTMLDivElement>(), page: createRef() }
      refs.current.set(id, r)
    }
    return r
  }

  const renderLayer = (
    entry: { id: string; url: string },
    idx: number,
    isTop: boolean
  ) => {
    const r = getRefs(entry.id)
    const element = buildElement(entry.url, idx, r.page)
    return (
      <div
        key={entry.id}
        ref={r.scroll}
        onTouchStart={isTop ? onTouchStart : undefined}
        onTouchMove={isTop ? onTouchMove : undefined}
        onTouchEnd={isTop ? onTouchEnd : undefined}
        className="bg-background animate-mobile-screen-in fixed inset-x-0 top-0 z-40 overflow-y-auto [&_.sticky]:!top-0"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          // Stop above the BottomBar so Overview stays reachable as the
          // one-tap escape back to the deck.
          bottom: 'calc(3rem + env(safe-area-inset-bottom))',
          // Only the top layer carries the swipe/close offset; lower layers sit
          // static beneath it and are simply revealed.
          ...(isTop
            ? {
                transform: `translateX(${dragX}px)`,
                transition: dragging
                  ? 'none'
                  : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)'
              }
            : null)
        }}
      >
        <ScrollContainerProvider scrollRef={r.scroll}>
          {element ?? (
            <div className="text-muted-foreground p-4 text-sm">
              {t('Cannot display this content')}
            </div>
          )}
        </ScrollContainerProvider>
      </div>
    )
  }

  return (
    <SecondaryPageContext.Provider value={value}>
      <MutedThreadRevealProvider>
        {/* Opaque backdrop hides the deck while any screen is open, so a
            swipe-back reveals a clean surface instead of the feed you came from
            (which often contains the very note you opened — that's what read as
            a doubled/second screen behind). The deck reappears once the last
            screen is fully popped. */}
        <div
          aria-hidden
          className="bg-background fixed inset-x-0 top-0 z-40"
          style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom))' }}
        />
        {/* Lower layers: static opaque screens beneath the top one. */}
        {stack.slice(0, currentIndex).map((entry, idx) => renderLayer(entry, idx, false))}
        {/* Top layer: draggable, slides over the layer/backdrop beneath it. */}
        {renderLayer(stack[currentIndex], currentIndex, true)}
      </MutedThreadRevealProvider>
    </SecondaryPageContext.Provider>
  )
}
