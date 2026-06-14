import Tabs from '@/components/Tabs'
import MutedThreadItem from '@/components/Mute/MutedThreadItem'
import MutedUserItem from '@/components/Mute/MutedUserItem'
import MutedWordsSection from '@/components/Mute/MutedWordsSection'
import { useMuteList } from '@/providers/UserListsProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'users', label: 'Users' },
  { value: 'threads', label: 'Threads' },
  { value: 'words', label: 'Words' }
]

export default function MuteListColumnBody() {
  const [tab, setTab] = useState('all')

  const showUsers = tab === 'all' || tab === 'users'
  const showThreads = tab === 'all' || tab === 'threads'
  const showWords = tab === 'all' || tab === 'words'

  return (
    <>
      <Tabs tabs={TABS} value={tab} onTabChange={setTab} />
      <div className="space-y-6 px-4 pb-4 pt-2">
        {showUsers && <UsersSection />}
        {showThreads && <ThreadsSection />}
        {showWords && <WordsSection />}
      </div>
    </>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground mb-2 text-sm font-semibold">{children}</div>
}

function UsersSection() {
  const { t } = useTranslation()
  const { getMutePubkeys } = useMuteList()
  // Reactive so the list populates once the mute-list event loads from relay,
  // and reflects unmutes immediately. Sorted by pubkey for a STABLE order so
  // toggling a user public<->private (which reorders the underlying union)
  // doesn't make rows jump.
  const mutePubkeys = useMemo(() => [...getMutePubkeys()].sort(), [getMutePubkeys])
  const [visible, setVisible] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisible(mutePubkeys.slice(0, 10))
  }, [mutePubkeys])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && mutePubkeys.length > visible.length) {
          setVisible((prev) => [...prev, ...mutePubkeys.slice(prev.length, prev.length + 10)])
        }
      },
      { root: null, rootMargin: '10px', threshold: 1 }
    )
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [visible, mutePubkeys])

  return (
    <div>
      <SectionHeader>{t('Muted users')}</SectionHeader>
      {mutePubkeys.length === 0 ? (
        <div className="text-muted-foreground text-sm">{t('No muted users')}</div>
      ) : (
        <div className="space-y-2">
          {visible.map((pubkey, index) => (
            <MutedUserItem key={`${index}-${pubkey}`} pubkey={pubkey} />
          ))}
          {mutePubkeys.length > visible.length && <div ref={bottomRef} />}
        </div>
      )}
    </div>
  )
}

function ThreadsSection() {
  const { t } = useTranslation()
  const { muteEventIdSet } = useMuteList()
  const muteEventIds = useMemo(() => Array.from(muteEventIdSet), [muteEventIdSet])

  return (
    <div>
      <SectionHeader>{t('Muted threads')}</SectionHeader>
      {muteEventIds.length === 0 ? (
        <div className="text-muted-foreground text-sm">{t('No muted threads')}</div>
      ) : (
        <div className="space-y-2">
          {muteEventIds.map((id) => (
            <MutedThreadItem key={id} eventId={id} />
          ))}
        </div>
      )}
    </div>
  )
}

function WordsSection() {
  const { t } = useTranslation()
  return (
    <div>
      <SectionHeader>{t('Muted words')}</SectionHeader>
      <div className="text-muted-foreground mb-2 text-xs">
        {t('Muted words apply to all your accounts.')}
      </div>
      <MutedWordsSection variant="rows" />
    </div>
  )
}
