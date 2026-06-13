import { useSecondaryPage } from '@/DeckManager'
import { formatError } from '@/lib/error'
import { getNoteBech32Id, getThreadRootId, isProtectedEvent } from '@/lib/event'
import { toRelaySettings, toShareNoteUrl } from '@/lib/link'
import { pubkeyToNpub } from '@/lib/pubkey'
import { simplifyUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFavorites, useMuteList } from '@/providers/UserListsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { usePinList } from '@/providers/UserListsProvider'
import client from '@/services/client.service'
import {
  Bell,
  BellOff,
  Code,
  Copy,
  Link,
  Pin,
  PinOff,
  SatelliteDish,
  Settings,
  Star,
  StarOff,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import RelayIcon from '../RelayIcon'
import { computeBroadcastTargets } from './broadcast-targets'

export interface SubMenuAction {
  label: React.ReactNode
  onClick: () => void
  className?: string
  separator?: boolean
}

export interface MenuAction {
  icon: React.ComponentType
  label: string
  onClick?: () => void
  className?: string
  separator?: boolean
  subMenu?: SubMenuAction[]
}

interface UseMenuActionsProps {
  event: Event
  closeDrawer: () => void
  showSubMenuActions: (subMenu: SubMenuAction[], title: string) => void
  setIsRawEventDialogOpen: (open: boolean) => void
  setIsReportDialogOpen: (open: boolean) => void
  isSmallScreen: boolean
}

export function useMenuActions({
  event,
  closeDrawer,
  showSubMenuActions,
  setIsRawEventDialogOpen,
  setIsReportDialogOpen,
  isSmallScreen
}: UseMenuActionsProps) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey, attemptDelete } = useNostr()
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const relayUrls = useMemo(() => {
    return Array.from(new Set(currentBrowsingRelayUrls.concat(favoriteRelays)))
  }, [currentBrowsingRelayUrls, favoriteRelays])
  const {
    mutePubkeyPublicly,
    mutePubkeyPrivately,
    unmutePubkey,
    mutePubkeySet,
    muteThread,
    unmuteThread,
    isThreadMuted
  } = useMuteList()
  const { pinnedEventHexIdSet, pin, unpin } = usePinList()
  const { isFavorited, toggleFavorite } = useFavorites()
  const isMuted = useMemo(() => mutePubkeySet.has(event.pubkey), [mutePubkeySet, event])

  const broadcastTargets = useMemo(
    () => computeBroadcastTargets({ signedIn: !!pubkey, relaySets, relayUrls }),
    [pubkey, relaySets, relayUrls]
  )

  const broadcastSubMenu: SubMenuAction[] = useMemo(() => {
    const items = broadcastTargets.map((target): SubMenuAction => {
      switch (target.kind) {
        case 'optimal':
          return {
            label: <div className="text-start"> {t('Optimal relays')}</div>,
            separator: target.separator,
            onClick: async () => {
              closeDrawer()
              const promise = async () => {
                const relays = await client.determineTargetRelays(event)
                if (relays?.length) {
                  await client.publishEvent(relays, event)
                }
                return relays ?? []
              }
              toast.promise(promise, {
                loading: t('Republishing...'),
                success: (relays: string[]) => {
                  return t('Republished to {{count}} relays: {{relays}}', {
                    count: relays.length,
                    relays: relays.map(simplifyUrl).join(', ')
                  })
                },
                error: (err) => {
                  return t('Failed to republish to optimal relays: {{error}}', {
                    error: err.message
                  })
                }
              })
            }
          }
        case 'relaySet':
          return {
            label: <div className="truncate text-start">{target.name}</div>,
            separator: target.separator,
            onClick: async () => {
              closeDrawer()
              const promise = client.publishEvent(target.relayUrls, event)
              toast.promise(promise, {
                loading: t('Republishing...'),
                success: () => {
                  return t('Successfully republish to relay set: {{name}}', { name: target.name })
                },
                error: (err) => {
                  return t('Failed to republish to relay set: {{name}}. Error: {{error}}', {
                    name: target.name,
                    error: formatError(err).join('; ')
                  })
                }
              })
            }
          }
        case 'relay':
          return {
            label: (
              <div className="flex w-full items-center gap-2">
                <RelayIcon url={target.url} />
                <div className="flex-1 truncate text-start">{simplifyUrl(target.url)}</div>
              </div>
            ),
            separator: target.separator,
            onClick: async () => {
              closeDrawer()
              const promise = client.publishEvent([target.url], event)
              toast.promise(promise, {
                loading: t('Republishing...'),
                success: () => {
                  return t('Successfully republish to relay: {{url}}', {
                    url: simplifyUrl(target.url)
                  })
                },
                error: (err) => {
                  return t('Failed to republish to relay: {{url}}. Error: {{error}}', {
                    url: simplifyUrl(target.url),
                    error: formatError(err).join('; ')
                  })
                }
              })
            }
          }
      }
    })

    // Always offer a way to create / manage relay sets to republish to.
    items.push({
      label: (
        <div className="flex w-full items-center gap-2 text-start">
          <Settings className="size-4 shrink-0" />
          <div className="flex-1 truncate">{t('Configure relay sets')}</div>
        </div>
      ),
      separator: true,
      onClick: () => {
        closeDrawer()
        push(toRelaySettings('favorite-relays'))
      }
    })

    return items
  }, [broadcastTargets, event, t, closeDrawer, push])

  const menuActions: MenuAction[] = useMemo(() => {
    const actions: MenuAction[] = [
      {
        icon: Copy,
        label: t('Copy event ID'),
        onClick: () => {
          navigator.clipboard.writeText(getNoteBech32Id(event))
          closeDrawer()
        }
      },
      {
        icon: Copy,
        label: t('Copy user ID'),
        onClick: () => {
          navigator.clipboard.writeText(pubkeyToNpub(event.pubkey) ?? '')
          closeDrawer()
        }
      },
      {
        icon: Link,
        label: t('Copy share link'),
        onClick: () => {
          navigator.clipboard.writeText(toShareNoteUrl(event))
          closeDrawer()
        }
      },
      {
        icon: Copy,
        label: t('Copy note content'),
        onClick: () => {
          navigator.clipboard.writeText(event.content)
          closeDrawer()
        }
      },
      {
        icon: Code,
        label: t('View raw event'),
        onClick: () => {
          closeDrawer()
          setIsRawEventDialogOpen(true)
        },
        separator: true
      }
    ]

    const isProtected = isProtectedEvent(event)
    // Only offer "Republish to ..." when there is a real publish target.
    // (The submenu always also carries a "Configure relay sets" entry, so we
    // gate on the targets — not the submenu length — to avoid showing a
    // Republish item whose only action is "Configure".)
    if ((!isProtected || event.pubkey === pubkey) && broadcastTargets.length > 0) {
      actions.push({
        icon: SatelliteDish,
        label: t('Republish to ...'),
        onClick: isSmallScreen
          ? () => showSubMenuActions(broadcastSubMenu, t('Republish to ...'))
          : undefined,
        subMenu: isSmallScreen ? undefined : broadcastSubMenu,
        separator: true
      })
    }

    if (event.pubkey === pubkey && event.kind === kinds.ShortTextNote) {
      const pinned = pinnedEventHexIdSet.has(event.id)
      actions.push({
        icon: pinned ? PinOff : Pin,
        label: pinned ? t('Unpin from profile') : t('Pin to profile'),
        onClick: async () => {
          closeDrawer()
          await (pinned ? unpin(event) : pin(event))
        }
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      const favorited = isFavorited(event.pubkey)
      actions.push({
        icon: favorited ? StarOff : Star,
        label: favorited ? t('Unfavorite user') : t('Favorite user'),
        onClick: async () => {
          closeDrawer()
          await toggleFavorite(event.pubkey)
        }
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      actions.push({
        icon: TriangleAlert,
        label: t('Report'),
        className: 'text-destructive focus:text-destructive',
        onClick: () => {
          closeDrawer()
          setIsReportDialogOpen(true)
        },
        separator: true
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      if (isMuted) {
        actions.push({
          icon: Bell,
          label: t('Unmute user'),
          onClick: () => {
            closeDrawer()
            unmutePubkey(event.pubkey)
          },
          className: 'text-destructive focus:text-destructive',
          separator: true
        })
      } else {
        actions.push(
          {
            icon: BellOff,
            label: t('Mute user privately'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPrivately(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive',
            separator: true
          },
          {
            icon: BellOff,
            label: t('Mute user publicly'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPublicly(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive'
          }
        )
      }
    }

    if (pubkey) {
      const rootId = getThreadRootId(event)
      const threadMuted = isThreadMuted(rootId)
      actions.push({
        icon: threadMuted ? Bell : BellOff,
        label: threadMuted ? t('Unmute thread') : t('Mute thread'),
        onClick: () => {
          closeDrawer()
          if (threadMuted) {
            unmuteThread(rootId)
          } else {
            muteThread(rootId)
          }
        },
        className: 'text-destructive focus:text-destructive',
        separator: true
      })
    }

    if (pubkey && event.pubkey === pubkey) {
      actions.push({
        icon: Trash2,
        label: t('Try deleting this note'),
        onClick: () => {
          closeDrawer()
          attemptDelete(event)
        },
        className: 'text-destructive focus:text-destructive',
        separator: true
      })
    }

    return actions
  }, [
    t,
    event,
    pubkey,
    isMuted,
    isFavorited,
    toggleFavorite,
    isSmallScreen,
    broadcastTargets,
    broadcastSubMenu,
    pinnedEventHexIdSet,
    closeDrawer,
    showSubMenuActions,
    setIsRawEventDialogOpen,
    mutePubkeyPrivately,
    mutePubkeyPublicly,
    unmutePubkey,
    isThreadMuted,
    muteThread,
    unmuteThread
  ])

  return menuActions
}
