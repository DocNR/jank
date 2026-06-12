import { HouseIcon } from '@phosphor-icons/react'
import { useCallback } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function HomeButton() {
  // Phase 2: only the deck-home primary page exists, and home is the page
  // we're rendering into. The button is always "active" — its meaningful
  // action is scrolling the horizontal deck back to its first column,
  // mirroring the TopBar brand-tap.
  //
  // The deck-scroller's first column gets the snap directly — using its
  // `scrollIntoView` is more reliable inside a snap-mandatory container than
  // `scroller.scrollTo({ left: 0 })` (Chrome rejects the latter and snaps
  // back to wherever it was). No rAF wrap for the same reason — synchronous
  // scrollIntoView lands cleanly.
  const onClick = useCallback(() => {
    const scroller = document.querySelector<HTMLDivElement>('[data-deck-scroll]')
    const firstCol = scroller?.querySelector<HTMLElement>('[data-column-id]')
    firstCol?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' })
  }, [])

  return (
    <BottomNavigationBarItem active onClick={onClick}>
      <HouseIcon weight="fill" />
    </BottomNavigationBarItem>
  )
}
