import { Button } from '@/components/ui/button'
import { useAccountScopeOptional } from '@/providers/AccountScope'
import { useNostr } from '@/providers/NostrProvider'
import { useFavorites } from '@/providers/UserListsProvider'
import { Loader, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function FavoriteButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const scope = useAccountScopeOptional()
  const myPubkey = scope?.signingIdentity ?? accountPubkey
  const { isFavorited, toggleFavorite } = useFavorites()
  const [updating, setUpdating] = useState(false)
  const favorited = useMemo(() => isFavorited(pubkey), [isFavorited, pubkey])

  if (!myPubkey || (pubkey && pubkey === myPubkey)) return null

  const onToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      setUpdating(true)
      try {
        await toggleFavorite(pubkey)
      } catch (error) {
        if (favorited) {
          toast.error(t('Unfavorite user') + ': ' + (error as Error).message)
        } else {
          toast.error(t('Favorite user') + ': ' + (error as Error).message)
        }
      } finally {
        setUpdating(false)
      }
    })
  }

  return (
    <Button
      variant="secondary"
      size="icon"
      className="rounded-full"
      onClick={onToggle}
      disabled={updating}
    >
      {updating ? (
        <Loader className="animate-spin" />
      ) : (
        <Star className={favorited ? 'fill-primary stroke-primary' : ''} />
      )}
    </Button>
  )
}
