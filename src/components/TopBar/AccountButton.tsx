import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { toSettings, toWallet } from '@/lib/link'
import { pubkeyToHsl } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/DeckManager'
import { useNostr } from '@/providers/NostrProvider'
import { TAccountPointer } from '@/types'
import { ChevronDown, LogIn, LogOut, Plus, Settings, Wallet } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import LoginDialog from '../LoginDialog'
import LogoutDialog from '../LogoutDialog'
import SignerTypeBadge from '../SignerTypeBadge'
import { SimpleUserAvatar } from '../UserAvatar'
import { SimpleUsername } from '../Username'
import SidebarItem from './SidebarItem'

export default function AccountButton({
  collapse = false,
  compact = false
}: {
  collapse?: boolean
  compact?: boolean
}) {
  const { pubkey } = useNostr()

  if (pubkey) {
    return <ProfileButton collapse={collapse} compact={compact} />
  } else {
    return <LoginButton collapse={collapse} compact={compact} />
  }
}

function ProfileButton({ collapse, compact }: { collapse: boolean; compact: boolean }) {
  const { t } = useTranslation()
  const { account, accounts, switchAccount } = useNostr()
  const { push } = useSecondaryPage()
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  // Per-row logout: setting a target opens the confirm dialog for that
  // specific account. Null = closed.
  const [logoutTarget, setLogoutTarget] = useState<TAccountPointer | null>(null)
  const [logoutAllOpen, setLogoutAllOpen] = useState(false)

  // Under Decks v2 per-account-workspaces, AccountButton always reflects the
  // active account. Clicking a paired account in the dropdown switches active
  // (which swaps the visible deck workspace). The pre-v2 "override the focused
  // column's signingIdentity" path was retired because it violated the workspace
  // invariant (column.signingIdentity must equal the workspace's owner).
  const displayPubkey = account?.pubkey

  // Account-switch pulse — replays the one-shot ring animation in the new
  // account's hue every time the active pubkey changes.
  const [switchPulseKey, setSwitchPulseKey] = useState(0)
  const prevDisplayPubkeyRef = useRef(displayPubkey)
  useEffect(() => {
    if (prevDisplayPubkeyRef.current !== displayPubkey) {
      prevDisplayPubkeyRef.current = displayPubkey
      setSwitchPulseKey((k) => k + 1)
    }
  }, [displayPubkey])

  if (!displayPubkey) return null

  const displayAccount = accounts.find((a) => a.pubkey === displayPubkey)
  const otherAccountCount = accounts.length - 1
  const hue = pubkeyToHsl(displayPubkey)

  const handlePickAccount = (act: TAccountPointer) => {
    if (act.pubkey === displayPubkey) return
    switchAccount(act)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'clickable text-foreground hover:text-accent-foreground relative flex items-center rounded-lg shadow-none',
            compact
              ? 'h-10 gap-1.5 px-2 py-1 text-base font-semibold'
              : 'justify-start gap-3 p-2 text-lg font-semibold',
            compact ? '' : collapse ? 'h-12 w-12 justify-center' : 'h-auto w-full'
          )}
          style={{ backgroundColor: pubkeyToHsl(displayPubkey, 0.1) }}
        >
          {/* Color spine — inline-end edge, single hue. */}
          <div
            className="absolute inset-y-1.5 end-0 w-[3.5px] rounded-full"
            style={{ background: hue }}
            aria-hidden
          />
          {/* Account-switch pulse — keyed so it remounts and replays the
              one-shot ring animation on each switch, in the new account's hue. */}
          {switchPulseKey > 0 && (
            <span
              key={switchPulseKey}
              className="account-switch-pulse-ring"
              style={{ '--pulse-hue': hue } as CSSProperties}
              aria-hidden
            />
          )}
          {/* Avatar with optional +N corner badge (collapsed/compact only). */}
          <div className="relative flex shrink-0 items-center">
            <div className="rounded-full" style={{ boxShadow: `0 0 0 2px ${hue}` }}>
              <SimpleUserAvatar size="medium" userId={displayPubkey} ignorePolicy />
            </div>
            {(collapse || compact) && otherAccountCount > 0 && (
              <div
                className="bg-card absolute -end-0.5 -bottom-0.5 flex size-[14px] items-center justify-center rounded-full text-[9px] leading-none font-bold"
                style={{ border: `1.5px solid ${hue}`, color: hue }}
                aria-label={`${otherAccountCount} other account${otherAccountCount === 1 ? '' : 's'} paired`}
              >
                +{otherAccountCount}
              </div>
            )}
          </div>
          {compact && <ChevronDown className="text-muted-foreground size-4 shrink-0" />}
          {!collapse && !compact && (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
                <SimpleUsername
                  userId={displayPubkey}
                  className="truncate text-sm leading-tight font-semibold"
                  skeletonClassName="h-3"
                />
                <div className="flex min-w-0 items-center gap-1.5">
                  {displayAccount && <SignerTypeBadge signerType={displayAccount.signerType} />}
                  {otherAccountCount > 0 && (
                    <span className="text-muted-foreground shrink-0 text-[11px] leading-none">
                      +{otherAccountCount} more
                    </span>
                  )}
                </div>
              </div>
              <ChevronDown className="text-muted-foreground size-4 shrink-0" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? 'bottom' : 'top'} align="end" className="w-72">
        <DropdownMenuItem onClick={() => push(toWallet())}>
          <Wallet />
          {t('Wallet')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => push(toSettings())}>
          <Settings />
          {t('Settings')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('Switch account')}</DropdownMenuLabel>
        {accounts.map((act) => {
          const isSelected = act.pubkey === displayPubkey
          return (
            <DropdownMenuItem
              key={`${act.pubkey}:${act.signerType}`}
              className={cn(
                'gap-2',
                isSelected && 'bg-accent/40 focus:bg-accent/40 cursor-default'
              )}
              onClick={() => {
                if (!isSelected) handlePickAccount(act)
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className="rounded-full"
                  style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(act.pubkey)}` }}
                >
                  <SimpleUserAvatar userId={act.pubkey} ignorePolicy />
                </div>
                <div className="w-0 flex-1">
                  <SimpleUsername
                    userId={act.pubkey}
                    className="truncate font-medium"
                    skeletonClassName="h-3"
                  />
                  <SignerTypeBadge signerType={act.signerType} />
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setLogoutTarget(act)
                }}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 rounded p-1 transition-colors"
                aria-label={t('Logout')}
              >
                <LogOut className="size-4" />
              </button>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuItem
          onClick={() => setLoginDialogOpen(true)}
          className="focus:border-muted-foreground focus:bg-background m-2 border border-dashed"
        >
          <div className="flex w-full items-center justify-center gap-2 py-2">
            <Plus />
            {t('Add an Account')}
          </div>
        </DropdownMenuItem>
        {accounts.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setLogoutAllOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <LogOut />
              {t('Log out from all accounts')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      <LoginDialog open={loginDialogOpen} setOpen={setLoginDialogOpen} />
      <LogoutDialog
        open={logoutTarget !== null}
        setOpen={(open) => {
          if (!open) setLogoutTarget(null)
        }}
        target={logoutTarget}
      />
      <LogoutDialog all open={logoutAllOpen} setOpen={setLogoutAllOpen} />
    </DropdownMenu>
  )
}

function LoginButton({ collapse, compact }: { collapse: boolean; compact: boolean }) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10"
        onClick={() => checkLogin()}
        aria-label={t('Login')}
      >
        <LogIn className="size-5" />
      </Button>
    )
  }

  return (
    <SidebarItem onClick={() => checkLogin()} title="Login" collapse={collapse}>
      <LogIn />
    </SidebarItem>
  )
}
