import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useSecondaryPage } from '@/DeckManager'
import { useFetchProfile } from '@/hooks'
import { toProfile } from '@/lib/link'
import { useMuteList } from '@/providers/UserListsProvider'
import { Loader, Lock, Unlock } from 'lucide-react'
import { useMemo, useState } from 'react'

export default function MutedUserItem({ pubkey }: { pubkey: string }) {
  const { push } = useSecondaryPage()
  const { changing, getMuteType, switchToPrivateMute, switchToPublicMute } = useMuteList()
  const { profile } = useFetchProfile(pubkey)
  const muteType = useMemo(() => getMuteType(pubkey), [pubkey, getMuteType])
  const [switching, setSwitching] = useState(false)

  return (
    <div
      className="hover:bg-accent/30 -mx-2 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5"
      onClick={() => push(toProfile(pubkey))}
    >
      <UserAvatar userId={pubkey} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <Username
          userId={pubkey}
          className="w-fit max-w-full truncate font-semibold"
          skeletonClassName="h-4"
        />
        <Nip05 pubkey={pubkey} />
        <div className="text-muted-foreground truncate text-sm">{profile?.about}</div>
      </div>
      {/* Action controls: stop row-click navigation so toggling/unmuting
          doesn't also open the profile. */}
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {switching ? (
          <Button disabled variant="ghost" size="icon">
            <Loader className="animate-spin" />
          </Button>
        ) : muteType === 'private' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return
              setSwitching(true)
              switchToPublicMute(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Lock className="text-green-400" />
          </Button>
        ) : muteType === 'public' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (switching) return
              setSwitching(true)
              switchToPrivateMute(pubkey).finally(() => setSwitching(false))
            }}
            disabled={changing}
          >
            <Unlock className="text-muted-foreground" />
          </Button>
        ) : null}
        <MuteButton pubkey={pubkey} />
      </div>
    </div>
  )
}
