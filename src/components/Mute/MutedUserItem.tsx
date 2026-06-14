import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import { Button } from '@/components/ui/button'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useFetchProfile } from '@/hooks'
import { useMuteList } from '@/providers/UserListsProvider'
import { Loader, Lock, Unlock } from 'lucide-react'
import { useMemo, useState } from 'react'

export default function MutedUserItem({ pubkey }: { pubkey: string }) {
  const { changing, getMuteType, switchToPrivateMute, switchToPublicMute } = useMuteList()
  const { profile } = useFetchProfile(pubkey)
  const muteType = useMemo(() => getMuteType(pubkey), [pubkey, getMuteType])
  const [switching, setSwitching] = useState(false)

  return (
    <div className="flex items-start gap-2">
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
      <div className="flex items-center gap-2">
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
