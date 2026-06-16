// src/components/DeckArea/index.tsx
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import {
  activeColumnIdAtom,
  addColumnDialogOpenAtom,
  focusBeamActiveAtom,
  focusedColumnRequestAtom
} from '@/atoms/active-column'
import { cn } from '@/lib/utils'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import AddColumnModal from '@/components/AddColumnModal'
import AddColumnPlaceholder from './AddColumnPlaceholder'
import ColumnPageIndicator from './ColumnPageIndicator'
import EmptyDeckCTA from './EmptyDeckCTA'
import FocusBeamScrim from './FocusBeamScrim'
import SortableColumn from './SortableColumn'

/**
 * Slice B: stateful Column[] consumed from <ColumnsProvider>. Owns dialog open
 * state + DnD wiring. Renders a horizontal flex of <SortableColumn> entries
 * plus a trailing <AddColumnPlaceholder>. Detail columns spawned via deck-home
 * navigation interception in DeckManager.pushSecondaryPage.
 *
 * Height: relies on the parent (DeckHomePage's PrimaryPageLayout with
 * `noScrollArea`) to provide `h-full` containment.
 */
export default function DeckArea() {
  const { account } = useNostr()
  const { deckLeadingGutter } = useUserPreferences()
  const { columns, addColumn, reorderColumns } = useColumns()
  const [activeColumnId, setActiveColumnId] = useAtom(activeColumnIdAtom)
  const [addOpen, setAddOpen] = useAtom(addColumnDialogOpenAtom)
  const [focusBeamActive, setFocusBeamActive] = useAtom(focusBeamActiveAtom)
  const [focusedRequest, setFocusedRequest] = useAtom(focusedColumnRequestAtom)
  const { isSmallScreen } = useScreenSize()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const prevColumnsRef = useRef(columns)
  // Refs for the mobile scroll-settle listener so the effect doesn't re-attach
  // every time `activeColumnId` or `columns` flip — both can change rapidly.
  const activeColumnIdRef = useRef(activeColumnId)
  const columnsRef = useRef(columns)
  useEffect(() => {
    activeColumnIdRef.current = activeColumnId
  }, [activeColumnId])
  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  // Centralized "scroll this column into view" helper. Uses the data-column-id
  // attribute already set by SortableColumn. No-op if the node can't be found
  // (column not in DOM yet, or wrong id).
  //
  // Behavior: on desktop we smooth-scroll and wrap in rAF (gives newly-mounted
  // columns a frame to lay out before measuring). On mobile (where the scroller
  // has `scroll-snap-type: x mandatory` from WS3) we MUST scroll directly with
  // `behavior: 'instant'` — Chromium reverts smooth programmatic scrolls inside
  // snap-mandatory containers, and wrapping in rAF lets state-update churn from
  // the scroll-settle listener interleave with the scroll, sometimes producing
  // a perpetual ping-pong. Direct synchronous scrollIntoView lands cleanly.
  const scrollColumnIntoView = useCallback(
    (columnId: string) => {
      const doScroll = () => {
        const scroller = scrollerRef.current
        if (!scroller) return
        const node = scroller.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`)
        if (!node) return

        if (!isSmallScreen) {
          // Desktop: native smooth scroll, no snap to fight with.
          node.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
          return
        }

        // Mobile: animated pan so the user *sees* the deck swipe to the
        // target column (silent jumps make it hard to tell what happened
        // when a new column opens). Native `behavior: 'smooth'` inside a
        // `snap-mandatory` container gets rejected by Chromium, so
        // temporarily release the snap inline, run the smooth scroll,
        // then restore the snap after the scroll settles. The inline
        // `scrollSnapType: ''` clears the inline override and the CSS
        // class (`max-md:snap-x max-md:snap-mandatory`) re-applies,
        // letting the snap settle cleanly to the final position.
        scroller.style.scrollSnapType = 'none'
        node.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
        // 400ms is a comfortable margin over Chrome's typical smooth-scroll
        // duration (~250-350ms depending on distance) without making
        // subsequent quick taps feel locked.
        window.setTimeout(() => {
          if (scrollerRef.current === scroller) {
            scroller.style.scrollSnapType = ''
          }
        }, 400)
      }
      if (isSmallScreen) {
        doScroll()
      } else {
        requestAnimationFrame(doScroll)
      }
    },
    [isSmallScreen]
  )

  // Keep the FocusBeamScrim mounted for its exit animation (280ms) after
  // beam toggles off. The scrim itself drives its opacity off the `active`
  // prop; this state controls the mount/unmount lifecycle so the fade-out
  // has time to play.
  const [scrimMounted, setScrimMounted] = useState(false)
  useEffect(() => {
    if (focusBeamActive) {
      setScrimMounted(true)
      return
    }
    if (scrimMounted) {
      const t = setTimeout(() => setScrimMounted(false), 320)
      return () => clearTimeout(t)
    }
  }, [focusBeamActive, scrimMounted])

  // Active-column lifecycle:
  //   - On grow: the newly-added column (detected by id-diff, not "last
  //     element") becomes active and scrolls into view. Detail columns
  //     inserted adjacent to their parent are no longer the array tail, so
  //     the old `next[next.length-1]` heuristic is wrong.
  //   - On shrink: if the removed column WAS active and had a `parentColumnId`
  //     pointing to a surviving column, focus the parent. Otherwise fall
  //     back to the neighbor at the same index (or last if rightmost).
  //   - On mount with non-empty deck and no active: select the first column.
  useEffect(() => {
    const prev = prevColumnsRef.current
    const next = columns
    prevColumnsRef.current = next

    if (next.length === 0) {
      if (activeColumnId !== null) setActiveColumnId(null)
      // Defensive: the modal-split rule wraps `column.close` to exit beam
      // before removing, so single-column close lands here with beam already
      // OFF. Catches bulk-close paths (closeAllUnpinned) and any future
      // out-of-band removal.
      if (focusBeamActive) setFocusBeamActive(false)
      return
    }

    if (next.length > prev.length) {
      // Added one (or more). Find by id-diff rather than "last element" —
      // adjacency-spliced detail columns aren't at the tail.
      const prevIds = new Set(prev.map((c) => c.id))
      const added = next.find((c) => !prevIds.has(c.id))
      if (added) {
        setActiveColumnId(added.id)
        scrollColumnIntoView(added.id)
      }
      return
    }

    if (next.length < prev.length) {
      // Removed at least one. If the active column survived, leave it.
      const stillExists = next.some((c) => c.id === activeColumnId)
      if (stillExists) return
      // Prefer parent-of-removed (drill-back-up) when the removed column had
      // a `parentColumnId` pointing to a surviving column.
      const removed = prev.find((c) => c.id === activeColumnId)
      if (removed?.parentColumnId) {
        const parentSurvives = next.some((c) => c.id === removed.parentColumnId)
        if (parentSurvives) {
          setActiveColumnId(removed.parentColumnId)
          scrollColumnIntoView(removed.parentColumnId)
          return
        }
      }
      // Fallback: take the column at the same index (or last if rightmost).
      const oldIdx = prev.findIndex((c) => c.id === activeColumnId)
      const fallback = next[Math.min(Math.max(oldIdx, 0), next.length - 1)]
      setActiveColumnId(fallback.id)
      // WS3 fix: on mobile the deck doesn't auto-track active; we need to
      // explicitly scroll the snapped page to the new active column so the
      // viewport doesn't strand the user on the removed column's old slot.
      scrollColumnIntoView(fallback.id)
      return
    }

    // Length unchanged but maybe items reordered or first mount: ensure
    // we have a valid selection.
    if (activeColumnId === null || !next.some((c) => c.id === activeColumnId)) {
      setActiveColumnId(next[0].id)
    }
  }, [columns, activeColumnId, setActiveColumnId, focusBeamActive, setFocusBeamActive, scrollColumnIntoView])

  // WS3: mobile scroll-settle → setActiveColumnId. Watches horizontal scroll
  // on the deck scroller, finds the closest snapped column, and updates the
  // active id. NEVER calls scrollColumnIntoView from this handler — that
  // would create a feedback loop (scroll → set active → scroll → ...).
  // Debounced via rAF + setTimeout so we only fire on settle, not mid-swipe.
  useEffect(() => {
    if (!isSmallScreen) return
    const scroller = scrollerRef.current
    if (!scroller) return

    let timer: number | null = null
    let rafId: number | null = null
    const onSettle = () => {
      const cols = columnsRef.current
      if (!cols.length) return
      const scrollLeft = scroller.scrollLeft
      // Pick the column whose left edge is closest to the current scroll
      // position. The SortableColumn wrappers are *direct children* of the
      // scroller — we walk `scroller.children` to avoid matching the inner
      // <Column> (which ALSO carries `data-column-id` for the active-click
      // capture). `getBoundingClientRect` gives absolute layout positions;
      // subtracting the scroller's own left + adding scrollLeft yields each
      // wrapper's offset within the scrollable content.
      const scrollerLeft = scroller.getBoundingClientRect().left
      let bestId: string | null = null
      let bestDist = Infinity
      for (const child of Array.from(scroller.children) as HTMLElement[]) {
        const id = child.dataset.columnId
        if (!id) continue // AddColumnPlaceholder etc. have no id
        const childLeftInContent =
          child.getBoundingClientRect().left - scrollerLeft + scrollLeft
        const dist = Math.abs(childLeftInContent - scrollLeft)
        if (dist < bestDist) {
          bestDist = dist
          bestId = id
        }
      }
      if (bestId && bestId !== activeColumnIdRef.current) {
        setActiveColumnId(bestId)
      }
    }
    const onScroll = () => {
      if (timer) clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        timer = window.setTimeout(onSettle, 120)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // 'scrollend' is iOS 16+ / modern Chrome — preferred when available
    // because it fires exactly once per settle. The rAF+timeout fallback
    // above still runs but is harmless (it idempotently re-confirms the
    // current snapped column).
    scroller.addEventListener('scrollend', onSettle, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onSettle)
      if (timer) clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isSmallScreen, setActiveColumnId])

  // Cross-provider focus/scroll request channel. ColumnsProvider sets
  // `focusedColumnRequestAtom` on re-click of an already-open transient
  // detail column — the columns array doesn't change, so the lifecycle
  // effect above won't fire. Listen here, set the column as active, scroll
  // it into view, then clear the request.
  useEffect(() => {
    if (!focusedRequest) return
    if (!columns.some((c) => c.id === focusedRequest)) {
      setFocusedRequest(null)
      return
    }
    setActiveColumnId(focusedRequest)
    scrollColumnIntoView(focusedRequest)
    setFocusedRequest(null)
  }, [focusedRequest, columns, setActiveColumnId, scrollColumnIntoView, setFocusedRequest])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 6px movement before drag activates so single-click events on
      // header buttons (× / 📌) and column body interactions still fire normally.
      activationConstraint: { distance: 6 }
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = columns.findIndex((c) => c.id === active.id)
      const to = columns.findIndex((c) => c.id === over.id)
      if (from === -1 || to === -1) return
      reorderColumns(from, to)
    },
    [columns, reorderColumns]
  )

  const columnIds = columns.map((c) => c.id)

  // Empty-state branch only fires when there's no account AND no columns.
  // If the user logs out while columns exist, columns stay rendered; each column
  // body falls back to its logged-out state inside its own AccountScope.
  if (!account && columns.length === 0) return <EmptyDeckCTA />

  return (
    <>
      <div
        ref={scrollerRef}
        data-deck-scroll=""
        className={cn(
          // pt-0 on mobile so columns sit flush under the top toolbar — the
          // 8px top padding reads as a dark gap above the column in the
          // terminal preset (deck surface is darker than the card). Desktop
          // keeps the floating-card top margin (md:pt-2).
          'flex h-full gap-3 overflow-x-auto px-2 pb-2 pt-0 md:pt-2 max-md:snap-x max-md:snap-mandatory',
          deckLeadingGutter && 'md:ps-32'
        )}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {columns.map((c) => (
              <SortableColumn key={c.id} column={c} />
            ))}
          </SortableContext>
        </DndContext>
        <AddColumnPlaceholder onClick={() => setAddOpen(true)} />
      </div>
      {/* WS3: page-dot indicator pinned above the BottomBar, mobile-only.
          Tap-to-jump synchronously updates activeColumnId AND scrolls the
          deck. The scroll-settle listener doesn't fire from a programmatic
          `scrollIntoView({ behavior: 'instant' })` (Chromium quirk — no
          scroll events from synthetic instant scrolls), so we set the
          active id directly. Real touch swipes still update activeColumnId
          via the listener since native gestures fire scroll events. */}
      {isSmallScreen && (
        <ColumnPageIndicator
          columns={columns}
          activeColumnId={activeColumnId}
          onJumpToColumn={(id) => {
            setActiveColumnId(id)
            scrollColumnIntoView(id)
          }}
          onJumpToAddPlaceholder={() => {
            const scroller = scrollerRef.current
            if (!scroller) return
            scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'instant' })
          }}
        />
      )}
      {/* Focus Beam scrim — viewport-fixed overlay above the deck (z-40),
          below the focused column (z-50). Click anywhere on it to exit.
          Stays mounted for the exit fade-out duration after focusBeamActive
          flips false (see the scrimMounted effect above). Mobile gated: the
          spotlight overlay is meaningless when one column already fills the
          viewport. */}
      {scrimMounted && !isSmallScreen && <FocusBeamScrim active={focusBeamActive} />}
      <AddColumnModal open={addOpen} onOpenChange={setAddOpen} onAdd={addColumn} />
    </>
  )
}
