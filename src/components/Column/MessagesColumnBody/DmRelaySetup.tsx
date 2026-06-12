import { useAccountScope } from '@/providers/AccountScope'
import { ExtendedKind } from '@/constants'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  defaultRelays: string[]
  onDone: (publishedRelays: string[]) => void
}

/**
 * Shown when the signing account has no kind-10050 DM-relay list yet.
 * Proposes up to 3 of the account's write relays as default DM relays,
 * then publishes a kind-10050 via the column's signing identity.
 */
export default function DmRelaySetup({ defaultRelays, onDone }: Props) {
  const { t } = useTranslation()
  const { publish } = useAccountScope()
  const [relays] = useState(() => defaultRelays.slice(0, 3))
  const [busy, setBusy] = useState(false)

  const publishList = async () => {
    setBusy(true)
    try {
      await publish({
        kind: ExtendedKind.DM_RELAY_LIST,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: relays.map((r) => ['relay', r])
      })
      onDone(relays)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm">{t('Set up DM relays so people can message you privately')}</p>
      {relays.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1">
          {relays.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <button
        className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        disabled={busy}
        onClick={publishList}
      >
        {t('Set up DM relays')}
      </button>
    </div>
  )
}
