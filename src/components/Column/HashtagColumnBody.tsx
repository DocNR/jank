import NoteList from '@/components/NoteList'
import { normalizeHashtag } from '@/lib/hashtag'
import { getDefaultRelayUrls } from '@/lib/relay'
import { TFeedSubRequest } from '@/types'
import { TColumn } from '@/types/column'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ColumnListStyleProvider, useEffectiveListStyle } from './column-list-style-context'

const HASHTAG_KINDS = [1]

/**
 * Body of a Hashtag column. Renders a chronological feed of kind-1 notes
 * carrying any of the column's configured hashtags (the `'#t'` filter —
 * multiple tags are OR'd). The feed is global (no `authors` / `'#p'`), so it
 * queries the user's default relays; the column still carries an account via
 * <AccountScope> for compose / mute-list / signing context, same as Relay.
 *
 * The `column` prop carries `config.listStyle` — the per-column compact/
 * detailed override, shared with every list-style column type.
 */
export default function HashtagColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const rawHashtags = column.config?.hashtags

  // Defensive re-normalize: config.hashtags is normalized on input by
  // HashtagPicker, but could also arrive from hand-edited storage or a future
  // shared deck. Drop anything that no longer passes the hashtag grammar.
  const hashtags = useMemo(() => {
    const out: string[] = []
    for (const raw of rawHashtags ?? []) {
      const normalized = normalizeHashtag(raw)
      if (normalized && !out.includes(normalized)) out.push(normalized)
    }
    return out
  }, [rawHashtags])

  if (hashtags.length === 0) {
    return <div className="text-muted-foreground p-4 text-sm">{t('No hashtags configured')}</div>
  }

  return (
    <ColumnListStyleProvider styleOverride={column.config?.listStyle}>
      <HashtagFeed hashtags={hashtags} wotOnly={!!column.config?.wotOnly} />
    </ColumnListStyleProvider>
  )
}

function HashtagFeed({ hashtags, wotOnly }: { hashtags: string[]; wotOnly: boolean }) {
  const listStyle = useEffectiveListStyle()
  const subRequests = useMemo<TFeedSubRequest[]>(
    () => [{ urls: getDefaultRelayUrls(), filter: { kinds: HASHTAG_KINDS, '#t': hashtags } }],
    [hashtags]
  )
  return (
    <NoteList
      subRequests={subRequests}
      showKinds={HASHTAG_KINDS}
      listStyle={listStyle}
      wotOnly={wotOnly}
    />
  )
}
