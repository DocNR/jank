import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useUserListEvent } from '@/hooks/useReplaceableEvent'
import { getPubkeysFromPTags } from '@/lib/tag'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useNostr } from '@/providers/NostrProvider'
import { useFollowList } from '@/providers/UserListsProvider'
import { Loader } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FollowButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const scope = useAccountScopeOptional()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { follow, unfollow } = useFollowList()
  const [updating, setUpdating] = useState(false)
  const [hover, setHover] = useState(false)

  const myPubkey = scope?.signingIdentity ?? accountPubkey
  const myFollowEvent = useUserListEvent(myPubkey, kinds.Contacts)
  const isFollowing = useMemo(
    () => (myFollowEvent ? getPubkeysFromPTags(myFollowEvent.tags).includes(pubkey) : false),
    [myFollowEvent, pubkey]
  )

  if (!myPubkey || (pubkey && pubkey === myPubkey)) return null

  const handleFollow = (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (isFollowing) return
      setUpdating(true)
      await follow(pubkey)
      setUpdating(false)
    })
  }
  const handleUnfollow = (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (!isFollowing) return
      setUpdating(true)
      await unfollow(pubkey)
      setUpdating(false)
    })
  }

  return isFollowing ? (
    <div onClick={(e) => e.stopPropagation()}>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className="min-w-28 rounded-full"
            variant={hover ? 'destructive' : 'secondary'}
            disabled={updating}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            {updating ? (
              <Loader className="animate-spin" />
            ) : hover ? (
              t('Unfollow')
            ) : (
              t('buttonFollowing')
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Unfollow')}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Are you sure you want to unfollow this user?')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnfollow} variant="destructive">
              {t('Unfollow')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ) : (
    <Button className="min-w-28 rounded-full" onClick={handleFollow} disabled={updating}>
      {updating ? <Loader className="animate-spin" /> : t('Follow')}
    </Button>
  )
}
