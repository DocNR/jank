import { Button } from '@/components/ui/button'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function MutedNote({
  show,
  reason = 'user'
}: {
  show: () => void
  reason?: 'user' | 'thread'
}) {
  const { t } = useTranslation()

  return (
    <div className="text-muted-foreground my-4 flex flex-col items-center gap-2 font-medium">
      <div>
        {reason === 'thread'
          ? t('This note is from a thread you muted')
          : t('This user has been muted')}
      </div>
      <Button
        onClick={(e) => {
          e.stopPropagation()
          show()
        }}
        variant="outline"
      >
        <Eye />
        {reason === 'thread' ? t('Reveal muted thread') : t('Temporarily display this note')}
      </Button>
    </div>
  )
}
