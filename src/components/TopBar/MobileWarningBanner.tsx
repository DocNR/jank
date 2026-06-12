/**
 * MobileWarningBanner — advisory strip at the top of the mobile shell that
 * warns users the mobile PWA is rough-edged and points them at desktop.
 *
 * - Mounted by TopBar only when isSmallScreen is true.
 * - One-time dismiss persisted to localStorage; subsequent sessions never
 *   re-show until the flag is cleared manually.
 * - Visibility lives in a Jotai atom so Shell can shift its content
 *   paddingTop accordingly and the dismiss propagates without a remount.
 * - Fixed height of 2.5rem (h-10) keeps the layout calc trivial.
 */
import { atom, useAtom } from 'jotai'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// legacy localStorage key — do NOT rename; renaming re-fires the dismissed banner for existing users
export const MOBILE_BANNER_DISMISSED_KEY = 'spectr.mobileBannerDismissed'

/** Banner visible-height in rem when mounted+undismissed. 0 when dismissed. */
export const MOBILE_BANNER_HEIGHT_REM = 2.5

/**
 * Pure predicate (testable). Returns true when the dismiss flag is stored.
 * Wrapped in try/catch so private-mode / disabled-storage browsers
 * gracefully fall back to "show the banner."
 */
export function isMobileBannerDismissed(
  getItem: (key: string) => string | null
): boolean {
  try {
    return getItem(MOBILE_BANNER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function readDismissedFromLocalStorage(): boolean {
  if (typeof window === 'undefined') return false
  return isMobileBannerDismissed((key) => window.localStorage.getItem(key))
}

export const mobileBannerDismissedAtom = atom<boolean>(readDismissedFromLocalStorage())

export default function MobileWarningBanner() {
  const [dismissed, setDismissed] = useAtom(mobileBannerDismissedAtom)
  const { t } = useTranslation()

  if (dismissed) return null

  const onDismiss = () => {
    try {
      window.localStorage.setItem(MOBILE_BANNER_DISMISSED_KEY, '1')
    } catch {
      // best-effort — even if persistence fails, the in-memory atom flips
      // so the banner disappears for the rest of the session.
    }
    setDismissed(true)
  }

  return (
    <div
      role="status"
      className="flex h-10 items-center gap-2 border-b border-amber-300 bg-amber-100 ps-3 pe-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{t('Mobile is under construction')}</span>{' '}
        <span className="opacity-90">
          {t('jank is best on desktop for now. Most things work — some rough edges.')}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('Dismiss')}
        className="-me-1 shrink-0 rounded p-1.5 transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/60"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
