import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useFilteredRepostCount } from '@/hooks/useFilteredRepostCount'
import { useStuffStatsById } from '@/hooks/useStuffStatsById'
import { useStuff } from '@/hooks/useStuff'
import { createDeletionRequestDraftEvent, createRepostDraftEvent } from '@/lib/draft-event'
import { getNoteBech32Id } from '@/lib/event'
import { cn } from '@/lib/utils'
import { pubkeyToHsl } from '@/lib/pubkey'
import { useSigningContext } from '@/hooks/useSigningContext'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import stuffStatsService from '@/services/stuff-stats.service'
import { Loader, PencilLine, Repeat } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostEditor from '../PostEditor/LazyPostEditor'
import { SimpleUsername } from '../Username'
import { formatCount } from './utils'
import { formatError } from '@/lib/error'
import { toast } from 'sonner'

export default function RepostButton({ stuff }: { stuff: Event | string }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  // signerPubkey / publish resolve to the column's signingIdentity when inside
  // a column scope, else the global active account.
  const { signerPubkey, publish, checkLogin } = useSigningContext()
  const { event, stuffKey } = useStuff(stuff)
  const noteStats = useStuffStatsById(stuffKey)
  const repostCount = useFilteredRepostCount(stuffKey)
  const [reposting, setReposting] = useState(false)
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const hasReposted = useMemo(() => {
    return signerPubkey ? noteStats?.repostPubkeySet?.has(signerPubkey) : false
  }, [noteStats, signerPubkey])

  const canRepost = !hasReposted && !reposting && !!event

  const repost = async () => {
    checkLogin(async () => {
      if (!canRepost || !signerPubkey) return

      setReposting(true)
      const timer = setTimeout(() => setReposting(false), 5000)

      try {
        const hasReposted = noteStats?.repostPubkeySet?.has(signerPubkey)
        if (hasReposted) return
        if (!noteStats?.updatedAt) {
          const noteStats = await stuffStatsService.fetchStuffStats(stuff, signerPubkey)
          if (noteStats.repostPubkeySet?.has(signerPubkey)) {
            return
          }
        }

        const repost = createRepostDraftEvent(event)
        const evt = await publish(repost)
        stuffStatsService.updateStuffStatsByEvents([evt])
        // 5s recovery window — Undo retracts the repost with a kind-5
        // deletion, signed by the same identity that just reposted. The toast
        // names that identity (with its hue dot) so it doubles as a "did I act
        // as the right account?" check.
        toast(
          <span className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: pubkeyToHsl(signerPubkey) }}
              aria-hidden
            />
            <span>{t('Reposted as')}</span>
            <SimpleUsername userId={signerPubkey} className="font-semibold" withoutSkeleton />
          </span>,
          {
            duration: 5000,
            action: {
              label: t('Undo'),
              onClick: () => {
                publish(createDeletionRequestDraftEvent(evt)).catch((err) => {
                  formatError(err).forEach((e) => {
                    toast.error(`${t('Failed to undo')}: ${e}`, { duration: 10_000 })
                  })
                })
              }
            }
          }
        )
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`${t('Failed to repost')}: ${err}`, { duration: 10_000 })
        })
      } finally {
        setReposting(false)
        clearTimeout(timer)
      }
    })
  }

  const trigger = (
    <button
      className={cn(
        'disabled:text-muted-foreground/40 flex h-full cursor-pointer items-center gap-1 px-3 enabled:hover:text-lime-500',
        hasReposted ? 'text-lime-500' : 'text-muted-foreground'
      )}
      disabled={!event}
      title={t('Repost')}
      onClick={() => {
        if (!event) return

        if (isSmallScreen) {
          setIsDrawerOpen(true)
        }
      }}
    >
      {reposting ? <Loader className="animate-spin" /> : <Repeat />}
      {!!repostCount && <div className="text-sm">{formatCount(repostCount)}</div>}
    </button>
  )

  if (!event) {
    return trigger
  }

  const postEditor = (
    <PostEditor
      open={isPostDialogOpen}
      setOpen={setIsPostDialogOpen}
      defaultContent={'\nnostr:' + getNoteBech32Id(event)}
      accountId={signerPubkey ?? undefined}
    />
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerOverlay onClick={() => setIsDrawerOpen(false)} />
          <DrawerContent hideOverlay>
            <div className="py-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  repost()
                }}
                disabled={!canRepost}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
              >
                <Repeat /> {t('Repost')}
              </Button>
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  checkLogin(() => {
                    setIsPostDialogOpen(true)
                  })
                }}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
              >
                <PencilLine /> {t('Quote')}
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
        {postEditor}
      </>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              repost()
            }}
            disabled={!canRepost}
          >
            <Repeat /> {t('Repost')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              checkLogin(() => {
                setIsPostDialogOpen(true)
              })
            }}
          >
            <PencilLine /> {t('Quote')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {postEditor}
    </>
  )
}
