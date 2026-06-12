import { Button } from '@/components/ui/button'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { hasBackgroundAudioAtom } from '@/services/media-manager.service'
import { useAtomValue } from 'jotai'
import { ArrowUp } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function NewNotesButton({
  newEvents = [],
  onClick
}: {
  newEvents?: Event[]
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const hasBackgroundAudio = useAtomValue(hasBackgroundAudioAtom)
  const pubkeys = useMemo(() => {
    const arr: string[] = []
    for (const event of newEvents) {
      if (!arr.includes(event.pubkey)) {
        arr.push(event.pubkey)
      }
      if (arr.length >= 3) break
    }
    return arr
  }, [newEvents])

  return (
    <>
      {newEvents.length > 0 && (
        <div
          className="pointer-events-none sticky z-40 flex w-full justify-center"
          style={{
            bottom: isSmallScreen
              ? `calc(${hasBackgroundAudio ? 7.35 : 4}rem + env(safe-area-inset-bottom))`
              : '1rem'
          }}
        >
          <Button
            onClick={onClick}
            className="group pointer-events-auto h-fit rounded-full py-2 ps-2 pe-3 transition-colors"
            style={{
              // Inside a column the Column root sets --spectr-hue; outside (Profile,
              // Trending, etc.) the var is unset and we fall back to the brand color.
              backgroundColor: 'var(--spectr-hue, hsl(186 75% 45%))'
            }}
          >
            {pubkeys.length > 0 && (
              <div className="data-[slot=avatar]:*:ring-background flex -space-x-2 data-[slot=avatar]:*:ring-2 data-[slot=avatar]:*:grayscale">
                {pubkeys.map((pubkey) => (
                  <SimpleUserAvatar key={pubkey} userId={pubkey} size="small" />
                ))}
              </div>
            )}
            <div className="text-md font-medium">
              {t('Show n new notes', { n: newEvents.length > 99 ? '99+' : newEvents.length })}
            </div>
            <ArrowUp />
          </Button>
        </div>
      )}
    </>
  )
}
