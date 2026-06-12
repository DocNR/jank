import { useColumnVisible } from '@/hooks/useColumnVisible'
import { useScrollContainer } from '@/providers/ScrollContainerProvider'
import { ReactNode, RefObject, useLayoutEffect, useRef, useState } from 'react'
import { Virtualizer, WindowVirtualizer } from 'virtua'

interface VirtualNoteListProps<T> {
  items: T[]
  /**
   * Must return a KEYED element (key = stable note key). virtua caches each row's
   * measured height per React child key, so the key must be stable across renders
   * for scroll-back to restore the correct height.
   */
  renderItem: (item: T, index: number) => ReactNode
}

/**
 * Variable-height virtual list backed by virtua.
 *
 * virtua anchors the viewport to the top visible row and compensates when a row
 * measures differently than estimated, so a re-measured row (image decode,
 * embedded-note reveal, "show more") doesn't shift the rows below it. That
 * scroll anchoring is what the previous hand-rolled @tanstack/react-virtual
 * implementation lacked — its flat 200px estimate against rows spanning
 * ~95–1340px produced a big vertical lurch on scroll-back. We deliberately do
 * NOT pass an itemSize hint: virtua's docs recommend auto-estimation from
 * measured sizes for variable-height lists.
 *
 * Reads the nearest scroll container from <ScrollContainerProvider>. With a
 * container ref, mounts <Virtualizer scrollRef={...}> (element scroll, the column
 * case); otherwise <WindowVirtualizer> (window scroll fallback).
 */
export function VirtualNoteList<T>({ items, renderItem }: VirtualNoteListProps<T>) {
  const scrollContainerRef = useScrollContainer()
  return scrollContainerRef !== null ? (
    <ElementVirtualNoteList
      scrollContainerRef={scrollContainerRef}
      items={items}
      renderItem={renderItem}
    />
  ) : (
    <WindowVirtualNoteList items={items} renderItem={renderItem} />
  )
}

function ElementVirtualNoteList<T>({
  scrollContainerRef,
  items,
  renderItem
}: VirtualNoteListProps<T> & { scrollContainerRef: RefObject<HTMLDivElement> }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [startMargin, setStartMargin] = useState(0)
  const columnVisible = useColumnVisible()

  // Offset between the scroll container's content top and where the virtual list
  // begins. Pinned notes / ProfileFeed header / sticky tabs render ABOVE the list
  // in the same scroller; virtua needs this as startMargin to map scrollTop to the
  // correct visible range. If it goes stale, virtua maps scrollTop to the wrong
  // range and unmounts still-visible rows, which paint as empty (black) gaps.
  //
  // Three prior attempts (#99, #101, #107) tried to enumerate every box whose
  // size could affect startMargin and observe it with ResizeObserver: outer,
  // every ancestor up to the scroll container, then each ancestor's preceding
  // siblings. Each round caught some cases and missed others, because the model
  // can't anticipate every reflow source — a conditional sibling that mounts
  // later (Search column's People section) is never added to the observer set;
  // a deep reflow that grows a position:absolute child without resizing its
  // observed parent box never fires RO at all; new ancestors introduced by a
  // future column body wouldn't be observed.
  //
  // The robust move is to stop enumerating sources and just ask `outer` where it
  // is, every frame. requestAnimationFrame piggybacks on the browser's existing
  // paint cadence (zero added wakeups; auto-throttled when the tab is hidden);
  // two getBoundingClientRect reads + an integer comparison per frame is cheap
  // enough to be free. setState only fires when the rounded value actually
  // changes, so React doesn't re-render on idle frames. Gated on
  // useColumnVisible so off-screen columns don't tick.
  useLayoutEffect(() => {
    if (!columnVisible) return

    let raf = 0
    let last = -1

    // Re-read both refs every tick instead of capturing them once at effect
    // setup. Capturing at setup time is what broke #99/#101/#107 and the
    // initial cut of this fix: scrollContainerRef.current was observed as null
    // when VirtualNoteList's useLayoutEffect ran (the bodyRef on the enclosing
    // <Column> hadn't been attached yet by the time the child effect fired —
    // a React commit-order race for refs declared on an ancestor and read via
    // context). The old `if (!outer || !scroll) return` early-returned forever
    // because the effect's deps were stable, leaving startMargin at its
    // initial 0 and virtua unmounting the visible rows below the header.
    //
    // Re-reading inside `measure` means a tick that finds null refs simply
    // skips and tries again on the next frame; once the ancestor's ref
    // attaches, measurement starts immediately. Self-healing.
    const measure = () => {
      const outer = outerRef.current
      const scroll = scrollContainerRef.current
      if (!outer || !scroll) return
      const outerRect = outer.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      const next = Math.round(outerRect.top - scrollRect.top + scroll.scrollTop)
      if (next !== last) {
        last = next
        setStartMargin(next)
      }
    }

    const tick = () => {
      measure()
      raf = requestAnimationFrame(tick)
    }

    measure()
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [scrollContainerRef, columnVisible])

  return (
    <div ref={outerRef}>
      <Virtualizer scrollRef={scrollContainerRef} startMargin={startMargin}>
        {items.map((item, index) => renderItem(item, index))}
      </Virtualizer>
    </div>
  )
}

function WindowVirtualNoteList<T>({ items, renderItem }: VirtualNoteListProps<T>) {
  return (
    <WindowVirtualizer>{items.map((item, index) => renderItem(item, index))}</WindowVirtualizer>
  )
}
