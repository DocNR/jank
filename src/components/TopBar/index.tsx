/**
 * TopBar — single chrome region for the app shell.
 *
 * Mobile: brand · DeckSwitcher · spacer · AgentChat · Account
 *   (BottomBar handles Overview + New column + Compose; page-dots cover nav)
 * Desktop: brand · QuickJumps (5 icons) · spacer · Compose · Add column · AccountButton compact
 *
 * Surfaces Settings / Wallet / account switch via the AccountButton dropdown,
 * which is reachable on every layout — closes the previous mobile-PWA gap where
 * the Sidebar returned null and account utilities were unreachable.
 */
import DeckSwitcher from '@/components/DeckSwitcher'
import JankMark from '@/components/JankMark'
import { columnOverviewOpenAtom } from '@/atoms/active-column'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useSetAtom } from 'jotai'
import { LayoutGrid } from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import AccountButton from './AccountButton'
import AddColumnButton from './AddColumnButton'
import AgentChatButton from './AgentChatButton'
import ComposeButton from './ComposeButton'
import MobileWarningBanner from './MobileWarningBanner'
import QuickJumps from './QuickJumps'

export default function TopBar() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const setOverviewOpen = useSetAtom(columnOverviewOpenAtom)

  // Brand tap → scroll the deck horizontally back to its first column. Home
  // is the only primary "page" in Phase 2 so no navigate is needed.
  const onBrandTap = useCallback(() => {
    requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLDivElement>('[data-deck-scroll]')
      scroller?.scrollTo({ left: 0, behavior: 'smooth' })
    })
  }, [])

  return (
    <div
      className="bg-background fixed top-0 inset-x-0 z-30 flex flex-col border-b"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {isSmallScreen && <MobileWarningBanner />}
      <div className="flex h-12 items-center justify-between gap-2 px-2">
        <button
          type="button"
          onClick={onBrandTap}
          className="flex h-12 shrink-0 items-center justify-center px-2 transition-opacity hover:opacity-80"
          aria-label="jank — back to deck"
        >
          <JankMark size={28} />
        </button>
        <DeckSwitcher />
        {!isSmallScreen && <QuickJumps />}
        <div className="flex-1" aria-hidden />
        <div className="flex shrink-0 items-center gap-2">
          {!isSmallScreen && <ComposeButton />}
          {!isSmallScreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Show all columns')}
                  onClick={() => setOverviewOpen(true)}
                >
                  <LayoutGrid className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('Show all columns')}</TooltipContent>
            </Tooltip>
          )}
          <AgentChatButton />
          {/* Mobile gets New column in the bottom bar; keep it here on desktop. */}
          {!isSmallScreen && <AddColumnButton />}
          <AccountButton compact />
        </div>
      </div>
    </div>
  )
}
