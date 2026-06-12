import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Honesty strip rendered at the top of a Profile Search column. Explains that
 * results match the keyword against public profile metadata via Relatr, and
 * are ranked by Relatr's (global) trust score, not the user's own follow
 * graph. Dismissable; persistence handled by the parent via
 * `column.config.relatrHideBanner`.
 */
export default function RelatrInfoBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="bg-muted/50 flex items-start gap-2 border-b px-3 py-2 text-xs">
      <Info className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
      <p className="text-muted-foreground flex-1">
        {t(
          "Profile search powered by Relatr. Results match your keyword against profile metadata (name, bio, NIP-05) and are ranked by Relatr's trust score."
        )}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        className="h-5 px-1.5 text-[10px]"
      >
        {t('Dismiss')}
      </Button>
    </div>
  )
}
