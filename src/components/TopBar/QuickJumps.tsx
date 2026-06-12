import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActingPubkey } from '@/hooks/useActingPubkey'
import { cn } from '@/lib/utils'
import { activeColumnIdAtom } from '@/atoms/active-column'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useNotification } from '@/providers/NotificationProvider'
import { TColumn, TColumnType } from '@/types/column'
import { useAtomValue } from 'jotai'
import { Bell, Bookmark, Search, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const QUICK_JUMP_TYPES = ['notifications', 'search', 'profile', 'bookmarks'] as const
type TQuickJumpType = (typeof QUICK_JUMP_TYPES)[number]

/**
 * Pure helper exported for unit testing. Returns the column-type a QuickJumps
 * icon should render as "active", or null if no icon should be active.
 *
 * A QuickJump is active when the focused column matches both its type AND is
 * scoped to the active (signing) pubkey. Foreign-profile columns (viewContext !==
 * activePubkey) do not light up the Profile QuickJump — that icon represents
 * "my profile," not "any profile."
 */
export function deriveActiveQuickJump(
  activeColumnId: string | null,
  columns: TColumn[],
  activePubkey: string | null
): TColumnType | null {
  if (!activeColumnId || !activePubkey) return null
  const focused = columns.find((c) => c.id === activeColumnId)
  if (!focused) return null
  // Home doesn't have a QuickJump icon but the helper returns it for
  // completeness so test coverage can assert on it.
  if (focused.type === 'home' && focused.viewContext === activePubkey) return 'home'
  if (focused.viewContext !== activePubkey) return null
  if ((QUICK_JUMP_TYPES as readonly string[]).includes(focused.type)) {
    return focused.type
  }
  return null
}

export default function QuickJumps() {
  const { t } = useTranslation()
  const { checkLogin, pubkey } = useNostr()
  const { focusOrCreateColumn, columns } = useColumns()
  const actingPubkey = useActingPubkey()
  const activeColumnId = useAtomValue(activeColumnIdAtom)
  const { hasNewNotification, newNotificationCount } = useNotification()
  const activeType = deriveActiveQuickJump(activeColumnId, columns, actingPubkey ?? null)
  const bellLabel =
    newNotificationCount > 0
      ? t('My notifications · {{count}} unread', { count: newNotificationCount })
      : t('My notifications')

  const open = (type: TQuickJumpType) => {
    checkLogin(() => {
      if (!actingPubkey) return
      focusOrCreateColumn({ type, viewContext: actingPubkey, signingIdentity: actingPubkey })
    })
  }

  const items: Array<{
    type: TQuickJumpType
    label: string
    icon: JSX.Element
    unread?: boolean
    gated?: boolean
  }> = [
    {
      type: 'notifications',
      label: bellLabel,
      icon: <Bell className="size-5" />,
      unread: hasNewNotification
    },
    { type: 'search', label: t('Search'), icon: <Search className="size-5" /> },
    { type: 'profile', label: t('Profile'), icon: <User className="size-5" /> },
    {
      type: 'bookmarks',
      label: t('Bookmarks'),
      icon: <Bookmark className="size-5" />,
      gated: !pubkey
    }
  ]

  // Spacing notes: `gap-2` (8px between icons) and `ps-3` (12px from the
  // brand-side divider) give the strip room to breathe. With "Decks"
  // affordances likely landing here later, the strip is sized to host
  // a few more icons without re-densifying.
  return (
    <div className="border-border/40 flex items-center gap-2 border-s ps-3">
      {items.map((it) =>
        it.gated ? null : (
          <Tooltip key={it.type}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'relative size-10 rounded-md',
                  activeType === it.type && 'bg-accent text-accent-foreground'
                )}
                aria-label={it.label}
                onClick={() => open(it.type)}
              >
                {it.icon}
                {it.unread && (
                  <span className="bg-primary ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{it.label}</TooltipContent>
          </Tooltip>
        )
      )}
    </div>
  )
}
