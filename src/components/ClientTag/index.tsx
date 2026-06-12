import { getUsingClient } from '@/lib/event'
import { NostrEvent } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function ClientTag({ event }: { event: NostrEvent }) {
  const { t } = useTranslation()
  const usingClient = useMemo(() => getUsingClient(event), [event])

  if (!usingClient) return null

  return (
    <span className="text-muted-foreground shrink-0 text-sm">
      {t('via {{client}}', { client: usingClient })}
    </span>
  )
}
