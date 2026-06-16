import { columnOverviewOpenAtom } from '@/atoms/active-column'
import { SquaresFour } from '@phosphor-icons/react'
import { useSetAtom } from 'jotai'
import BottomNavigationBarItem from './BottomNavigationBarItem'

// "Home base" for the deck on mobile: opens the column overview (the exploding
// grid of all open columns). Replaces the old scroll-to-first-column home
// button — the brand tap in the TopBar still does that, and the overview
// reaches any column including the first.
export default function OverviewButton() {
  const setOverviewOpen = useSetAtom(columnOverviewOpenAtom)
  return (
    <BottomNavigationBarItem onClick={() => setOverviewOpen(true)}>
      <SquaresFour weight="fill" />
    </BottomNavigationBarItem>
  )
}
