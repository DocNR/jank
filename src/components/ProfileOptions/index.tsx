import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { pubkeyToNpub } from '@/lib/pubkey'
import { randomId } from '@/lib/utils'
import { useColumnsOptional } from '@/providers/ColumnsProvider'
import { useMuteList } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Bell, BellOff, Copy, Ellipsis, Home } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function ProfileOptions({
  pubkey,
  variant = 'secondary',
  size = 'icon'
}: {
  pubkey: string
  variant?: 'secondary' | 'ghost'
  size?: 'icon' | 'titlebar-icon'
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { pubkey: accountPubkey } = useNostr()
  const { mutePubkeySet, mutePubkeyPrivately, mutePubkeyPublicly, unmutePubkey } = useMuteList()
  const columnsCtx = useColumnsOptional()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const isMuted = useMemo(() => mutePubkeySet.has(pubkey), [mutePubkeySet, pubkey])

  if (pubkey === accountPubkey) return null

  // Quick-action: add a Home / Notifications column scoped to this profile.
  // viewContext is the profile; signingIdentity stays the active paired
  // account (the user can re-point it via the sidebar afterward).
  const addProfileColumn = (type: 'home' | 'notifications') => {
    if (!columnsCtx) return
    columnsCtx.addColumn({
      id: randomId(),
      viewContext: pubkey,
      signingIdentity: accountPubkey ?? null,
      type
    })
    toast.success(
      type === 'home' ? t('Home column added') : t('Notifications column added')
    )
  }

  const trigger = (
    <Button
      variant={variant}
      size={size}
      className={variant === 'secondary' ? 'rounded-full' : undefined}
      onClick={() => {
        if (isSmallScreen) {
          setIsDrawerOpen(true)
        }
      }}
    >
      <Ellipsis />
    </Button>
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerOverlay onClick={() => setIsDrawerOpen(false)} />
          <DrawerContent hideOverlay>
            <div className="py-2">
              {columnsCtx && (
                <>
                  <Button
                    onClick={() => {
                      setIsDrawerOpen(false)
                      addProfileColumn('home')
                    }}
                    className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                    variant="ghost"
                  >
                    <Home />
                    {t('Add Home column for this user')}
                  </Button>
                  <Button
                    onClick={() => {
                      setIsDrawerOpen(false)
                      addProfileColumn('notifications')
                    }}
                    className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                    variant="ghost"
                  >
                    <Bell />
                    {t('Add Notifications column for this user')}
                  </Button>
                </>
              )}
              <Button
                onClick={() => {
                  setIsDrawerOpen(false)
                  navigator.clipboard.writeText(pubkeyToNpub(pubkey) ?? '')
                }}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
              >
                <Copy />
                {t('Copy user ID')}
              </Button>
              {accountPubkey ? (
                isMuted ? (
                  <Button
                    onClick={() => {
                      setIsDrawerOpen(false)
                      unmutePubkey(pubkey)
                    }}
                    className="text-destructive focus:text-destructive w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                    variant="ghost"
                  >
                    <Bell />
                    {t('Unmute user')}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => {
                        setIsDrawerOpen(false)
                        mutePubkeyPrivately(pubkey)
                      }}
                      className="text-destructive focus:text-destructive w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                      variant="ghost"
                    >
                      <BellOff />
                      {t('Mute user privately')}
                    </Button>
                    <Button
                      onClick={() => {
                        setIsDrawerOpen(false)
                        mutePubkeyPublicly(pubkey)
                      }}
                      className="text-destructive focus:text-destructive w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                      variant="ghost"
                    >
                      <BellOff />
                      {t('Mute user publicly')}
                    </Button>
                  </>
                )
              ) : null}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {columnsCtx && (
          <>
            <DropdownMenuItem onClick={() => addProfileColumn('home')}>
              <Home />
              {t('Add Home column for this user')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addProfileColumn('notifications')}>
              <Bell />
              {t('Add Notifications column for this user')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(pubkeyToNpub(pubkey) ?? '')}>
          <Copy />
          {t('Copy user ID')}
        </DropdownMenuItem>
        {accountPubkey ? (
          isMuted ? (
            <DropdownMenuItem
              onClick={() => unmutePubkey(pubkey)}
              className="text-destructive focus:text-destructive"
            >
              <Bell />
              {t('Unmute user')}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                onClick={() => mutePubkeyPrivately(pubkey)}
                className="text-destructive focus:text-destructive"
              >
                <BellOff />
                {t('Mute user privately')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => mutePubkeyPublicly(pubkey)}
                className="text-destructive focus:text-destructive"
              >
                <BellOff />
                {t('Mute user publicly')}
              </DropdownMenuItem>
            </>
          )
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
