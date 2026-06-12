import { Button } from '@/components/ui/button'
import { isSameAccount } from '@/lib/account'
import { formatPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { TAccountPointer } from '@/types'
import { Loader, LogOut } from 'lucide-react'
import { useState } from 'react'
import LogoutDialog from '../LogoutDialog'
import SignerTypeBadge from '../SignerTypeBadge'
import { SimpleUserAvatar } from '../UserAvatar'
import { SimpleUsername } from '../Username'

export default function AccountList({
  className,
  afterSwitch
}: {
  className?: string
  afterSwitch: () => void
}) {
  const { accounts, account, switchAccount } = useNostr()
  const [switchingAccount, setSwitchingAccount] = useState<TAccountPointer | null>(null)
  // Per-row logout confirmation. Mirrors the avatar-sidebar flow so a
  // misclick on the icon doesn't silently drop an account (and any
  // columns scoped to it — see LogoutDialog's closeColumnsForAccount call).
  const [logoutTarget, setLogoutTarget] = useState<TAccountPointer | null>(null)

  return (
    <div className={cn('space-y-2', className)}>
      {accounts.map((act) => (
        <div
          key={`${act.pubkey}-${act.signerType}`}
          className={cn(
            'relative rounded-lg',
            isSameAccount(act, account) ? 'border-primary border' : 'clickable'
          )}
          onClick={() => {
            if (isSameAccount(act, account)) return
            setSwitchingAccount(act)
            switchAccount(act)
              .then(() => afterSwitch())
              .finally(() => setSwitchingAccount(null))
          }}
        >
          <div className="flex items-center justify-between p-2">
            <div className="relative flex flex-1 items-center gap-2">
              <SimpleUserAvatar userId={act.pubkey} ignorePolicy />
              <div className="w-0 flex-1">
                <SimpleUsername userId={act.pubkey} className="truncate font-semibold" />
                <div className="bg-muted w-fit rounded-full px-2 text-sm">
                  {formatPubkey(act.pubkey)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <SignerTypeBadge signerType={act.signerType} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  setLogoutTarget(act)
                }}
              >
                <LogOut />
              </Button>
            </div>
          </div>
          {switchingAccount && isSameAccount(act, switchingAccount) && (
            <div className="bg-muted/60 absolute top-0 left-0 flex h-full w-full items-center justify-center rounded-lg">
              <Loader size={16} className="animate-spin" />
            </div>
          )}
        </div>
      ))}
      <LogoutDialog
        open={!!logoutTarget}
        setOpen={(o) => {
          if (!o) setLogoutTarget(null)
        }}
        target={logoutTarget}
      />
    </div>
  )
}
