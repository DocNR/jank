// src/components/MobileNavStack/index.tsx
//
// Mobile native push/pop navigation. In-feed drill-downs (note threads,
// profiles, settings, ...) append to mobileNavStackAtom and render here as
// full-screen pushed screens that slide in from the right, instead of spawning
// deck columns. Each screen is a SECONDARY_ROUTES page — which already renders
// its own back-chevron titlebar (SecondaryPageLayout) wired to this stack's
// pop(). Lower layers stay mounted (display:none) so their scroll/state survive
// a back-out, mirroring DetailColumnBody's replace-mode stack.
//
// The stack sits above the deck + TopBar but stops short of the BottomBar, so
// the Overview button stays tappable as the one-tap "back to the deck" escape
// from any depth. push() delegates to the outer (DeckManager) push so it goes
// through the same screen-vs-column classifier — a column-shaped tap from
// inside a screen still spawns a column behind the stack.
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
  useCallback,
  useMemo,
  useRef
} from 'react'
import { useTranslation } from 'react-i18next'

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

  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), [setStack])
  const currentIndex = stack.length - 1

  // Screens push through the outer (DeckManager) push so the screen-vs-column
  // classifier still applies; they pop within this stack.
  const value = useMemo(
    () => ({ push: outer.push, pop, currentIndex }),
    [outer.push, pop, currentIndex]
  )

  if (stack.length === 0) return null

  const getRefs = (id: string): LayerRefs => {
    let r = refs.current.get(id)
    if (!r) {
      r = { scroll: createRef<HTMLDivElement>(), page: createRef() }
      refs.current.set(id, r)
    }
    return r
  }

  return (
    <SecondaryPageContext.Provider value={value}>
      <MutedThreadRevealProvider>
        {stack.map((entry, idx) => {
          const r = getRefs(entry.id)
          const element = buildElement(entry.url, idx, r.page)
          const isTop = idx === currentIndex
          return (
            <div
              key={entry.id}
              ref={r.scroll}
              className="bg-background animate-mobile-screen-in fixed inset-x-0 top-0 z-40 overflow-y-auto [&_.sticky]:!top-0"
              style={{
                paddingTop: 'env(safe-area-inset-top)',
                // Stop above the BottomBar so Overview stays reachable as the
                // one-tap escape back to the deck.
                bottom: 'calc(3rem + env(safe-area-inset-bottom))',
                display: isTop ? 'block' : 'none'
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
        })}
      </MutedThreadRevealProvider>
    </SecondaryPageContext.Provider>
  )
}
