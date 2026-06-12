import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import { useColumnsOptional } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TAccountPointer } from '@/types'
import { useTranslation } from 'react-i18next'

/**
 * Confirms logout for a specific account. `target` defaults to the active
 * account when omitted (back-compat with prior single-button flow). Passing
 * a target enables per-row logout from the account picker so a non-active
 * account can be removed without first switching to it.
 *
 * Also closes any columns scoped to the account being removed (snap, no
 * fade). Uses `useColumnsOptional()` because the dialog can mount above
 * the Welcome screen, where ColumnsProvider isn't in scope yet — the
 * cleanup step is a no-op there (there are no columns to clean).
 */
export default function LogoutDialog({
  open = false,
  setOpen,
  target,
  all = false
}: {
  open: boolean
  setOpen: (open: boolean) => void
  target?: TAccountPointer | null
  all?: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { account, accounts, removeAccount, removeAllAccounts } = useNostr()
  const columnsCtx = useColumnsOptional()
  const accountToRemove = target ?? account
  // Count columns this account SIGNS for — those are the ones that get closed
  // when the account is removed (keyed the same as closeColumnsForAccount).
  const columnCount = accountToRemove
    ? (columnsCtx?.columns.filter((c) => c.signingIdentity === accountToRemove.pubkey).length ?? 0)
    : 0

  // Order matters: drop the columns FIRST so React doesn't try to render
  // an AccountScope subtree whose signer is being yanked out mid-frame.
  const handleConfirm = () => {
    if (all) {
      removeAllAccounts()
      return
    }
    if (!accountToRemove) return
    columnsCtx?.closeColumnsForAccount(accountToRemove.pubkey)
    removeAccount(accountToRemove)
  }

  const title = all ? t('Log out from all accounts') : t('Logout')

  const description = all ? (
    t(
      "You'll be signed out of all {{total}} accounts. Your saved decks stay on this device and sync back when you sign in again.",
      { total: accounts.length }
    )
  ) : (
    <>
      {t('Are you sure you want to logout?')}
      {columnCount > 0 && (
        <>
          {' '}
          {t('column will also be closed', { count: columnCount })}
        </>
      )}
    </>
  )

  if (isSmallScreen) {
    return (
      <Drawer defaultOpen={false} open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="w-full">
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                handleConfirm()
              }}
              className="w-full"
            >
              {t('Logout')}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <AlertDialog defaultOpen={false} open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm}>
            {t('Logout')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
