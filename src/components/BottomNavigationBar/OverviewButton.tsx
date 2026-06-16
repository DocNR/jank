import { columnOverviewOpenAtom } from '@/atoms/active-column'
import { mobileNavStackAtom } from '@/atoms/mobile-nav-stack'
import { SquaresFour } from '@phosphor-icons/react'
import { useSetAtom } from 'jotai'
import BottomNavigationBarItem from './BottomNavigationBarItem'

// "Home base" for the deck on mobile: opens the column overview (the exploding
// grid of all open columns). Replaces the old scroll-to-first-column home
// button — the brand tap in the TopBar still does that, and the overview
// reaches any column including the first.
//
// Also the one-tap escape from a deep push-stack: clears any open drill-down
// screens so you land back on the deck overview from any depth.
export default function OverviewButton() {
  const setOverviewOpen = useSetAtom(columnOverviewOpenAtom)
  const setMobileStack = useSetAtom(mobileNavStackAtom)
  return (
    <BottomNavigationBarItem
      onClick={() => {
        setMobileStack([])
        setOverviewOpen(true)
      }}
    >
      <SquaresFour weight="fill" />
    </BottomNavigationBarItem>
  )
}
