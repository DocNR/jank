// src/components/Column/RelayColumnBody.tsx
import NoteList from '@/components/NoteList'
import { TColumn } from '@/types/column'
import { TFeedSubRequest } from '@/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const RELAY_KINDS = [1]

/**
 * Body of a Relay column. Subscribes to kind:1 events from a single configured
 * relay URL. Account-agnostic in terms of the FILTER (no `authors`, no `'#p'`),
 * but the column still carries an accountId via its enclosing <AccountScope>
 * for compose / mute-list / signing context (see Slice C spec, decision #6).
 *
 * areAlgoRelays is hardcoded to false in Slice C — chronological firehose only.
 * Algo-relay mode (Vertex-style ranked feeds) becomes a per-column toggle in
 * Phase 2's settings panel.
 */
export default function RelayColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const relayUrl = column.config?.relayUrl

  const subRequests = useMemo<TFeedSubRequest[]>(
    () => (relayUrl ? [{ urls: [relayUrl], filter: { kinds: RELAY_KINDS } }] : []),
    [relayUrl]
  )

  if (!relayUrl) {
    return <div className="text-muted-foreground p-4 text-sm">{t('Unknown column type')}</div>
  }

  return (
    <NoteList
      subRequests={subRequests}
      showKinds={RELAY_KINDS}
      areAlgoRelays={false}
      wotOnly={!!column.config?.wotOnly}
    />
  )
}
