// src/components/DeckArea/EmptyDeckCTA.tsx
import { Button } from '@/components/ui/button'
import { useNostr } from '@/providers/NostrProvider'
import { LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function EmptyDeckCTA() {
  const { t } = useTranslation()
  const { startLogin } = useNostr()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-2xl font-semibold">{t('Welcome')}</h2>
      <p className="text-muted-foreground max-w-md">{t('Login to start building your deck.')}</p>
      <Button size="lg" onClick={startLogin}>
        <LogIn className="size-5" />
        {t('Login')}
      </Button>
    </div>
  )
}
