import { BRAND } from '@/branding'
import { Button } from '@/components/ui/button'
import { useServiceWorkerUpdate } from '@/hooks/useServiceWorkerUpdate'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// Disabled 2026-05-30 to stop nagging users with a "reload" banner on every
// deploy (see docs/BACKLOG.md → "Reload-update banner disabled"). The service
// worker still registers + polls for updates via useServiceWorkerUpdate below,
// so fresh code lands silently on the next full reload; we just never prompt.
// Flip this back to `true` to restore the banner.
const SHOW_UPDATE_BANNER = false

export default function UpdatePrompt(): JSX.Element | null {
  const { t } = useTranslation()
  // Keep this call even while the banner is hidden: it registers the service
  // worker and drives the periodic update check. Removing it would disable PWA
  // caching + silent updates entirely.
  const { needRefresh, reload } = useServiceWorkerUpdate()
  const [dismissed, setDismissed] = useState(false)

  if (!SHOW_UPDATE_BANNER || !needRefresh || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-primary px-4 py-2 text-primary-foreground shadow-md"
    >
      <span className="text-sm">
        {t('A new version of {{brand}} is available.', { brand: BRAND.name })}
      </span>
      <Button size="sm" variant="secondary" onClick={reload}>
        {t('Reload')}
      </Button>
      <button
        type="button"
        aria-label={t('Dismiss')}
        className="absolute end-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
