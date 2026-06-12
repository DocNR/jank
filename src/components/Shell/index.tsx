/**
 * Shell — chrome arrangement for the app.
 *
 * Phase 2 (post-WS2): collapses the previous three arrangements
 * (`'stacked' | 'single' | 'split'`) into one shape. The TopBar contains
 * everything-not-deck (brand, quick-jumps, compose, add-column, account
 * picker); the BottomBar is mobile-only.
 *
 * The Sidebar slot is gone — its surviving roles live in TopBar now.
 */
import {
  MOBILE_BANNER_HEIGHT_REM,
  mobileBannerDismissedAtom
} from '@/components/TopBar/MobileWarningBanner'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useAtomValue } from 'jotai'
import { ReactNode } from 'react'

export default function Shell({
  topbar,
  content,
  bottomBar
}: {
  topbar: ReactNode
  content: ReactNode
  bottomBar: ReactNode
}) {
  const { isSmallScreen } = useScreenSize()
  const bannerDismissed = useAtomValue(mobileBannerDismissedAtom)
  // TopBar grows by the banner's height when it's mounted (mobile + not
  // dismissed). Reserved here so content scrolls beneath it cleanly.
  const bannerRem = isSmallScreen && !bannerDismissed ? MOBILE_BANNER_HEIGHT_REM : 0

  return (
    <div className="bg-surface-background flex h-(--vh) flex-col">
      {topbar}
      {/* Reserve TopBar footprint so content scrolls beneath it instead of
          starting under the fixed bar. The 3rem matches the TopBar's row
          height; safe-area-inset-top + optional banner stack above it. */}
      <div
        className="min-h-0 flex-1"
        style={{
          paddingTop: `calc(env(safe-area-inset-top) + 3rem + ${bannerRem}rem)`
        }}
      >
        {content}
      </div>
      {bottomBar}
    </div>
  )
}
