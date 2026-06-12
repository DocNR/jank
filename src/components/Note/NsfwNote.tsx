import { Button } from '@/components/ui/button'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function NsfwNote({ show }: { show: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="text-muted-foreground my-4 flex flex-col items-center gap-2 font-medium">
      <div>{t('🔞 NSFW 🔞')}</div>
      <Button
        onClick={(e) => {
          e.stopPropagation()
          show()
        }}
        variant="outline"
      >
        <Eye />
        {t('Temporarily display this note')}
      </Button>
    </div>
  )
}
