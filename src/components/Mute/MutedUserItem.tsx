import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useSecondaryPage } from '@/DeckManager'
import { useFetchProfile } from '@/hooks'
import { toProfile } from '@/lib/link'
import { useMuteList } from '@/providers/UserListsProvider'
import { Globe, Loader, Lock } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function MutedUserItem({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { getMuteType, switchToPrivateMute, switchToPublicMute } = useMuteList()
  const { profile } = useFetchProfile(pubkey)
  const realType = useMemo(() => getMuteType(pubkey), [pubkey, getMuteType])

  // Coalesced optimistic visibility toggle. The label flips instantly on every
  // click (`override`); underneath we publish at most one mutation per settled
  // target — extra clicks while a publish is in flight just update `pendingRef`,
  // so furious flipping never fans out into a cascade of signed kind-10000
  // events (each is a relay publish + a remote sign on a NIP-46 bunker).
  const [override, setOverride] = useState<'public' | 'private' | null>(null)
  const [saving, setSaving] = useState(false)
  const pendingRef = useRef<'public' | 'private' | null>(null)
  const runningRef = useRef(false)

  const shownType = override ?? realType

  const runCommit = async () => {
    runningRef.current = true
    setSaving(true)
    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        try {
          await (target === 'public' ? switchToPublicMute(pubkey) : switchToPrivateMute(pubkey))
        } catch {
          // The provider already surfaced a toast. Don't break: if a newer click
          // queued a different target while this one was failing, honor it on the
          // next iteration. Otherwise the loop exits and the label reconciles to
          // the real state below.
        }
      }
    } finally {
      runningRef.current = false
      setSaving(false)
      // Drop the optimistic override: a successful switch leaves the real type
      // at `target` (label unchanged); a no-op / failure reverts it.
      setOverride(null)
    }
  }

  const handleToggleVisibility = () => {
    const target = shownType === 'private' ? 'public' : 'private'
    setOverride(target)
    pendingRef.current = target
    if (!runningRef.current) void runCommit()
  }

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
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {shownType === 'private' || shownType === 'public' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 gap-1.5 px-2"
                onClick={handleToggleVisibility}
              >
                {saving ? (
                  <Loader className="size-3.5 animate-spin" />
                ) : shownType === 'private' ? (
                  <Lock className="size-3.5" />
                ) : (
                  <Globe className="size-3.5" />
                )}
                <span className="text-xs">
                  {shownType === 'private' ? t('Private') : t('Public')}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {shownType === 'private'
                ? t('Only you can see this mute. Click to make it public.')
                : t('Anyone can see this mute. Click to make it private.')}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <MuteButton pubkey={pubkey} />
      </div>
    </div>
  )
}
