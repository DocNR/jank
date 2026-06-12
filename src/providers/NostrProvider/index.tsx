import LoginDialog from '@/components/LoginDialog'
import PasswordInputDialog from '@/components/PasswordInputDialog'
import { ApplicationDataKey, ExtendedKind } from '@/constants'
import {
  createFollowListDraftEvent,
  createMuteListDraftEvent,
  createRelayListDraftEvent,
  createSeenNotificationsAtDraftEvent
} from '@/lib/draft-event'
import { getLatestEvent, getReplaceableEventIdentifier } from '@/lib/event'
import { getProfileFromEvent, getRelayListFromEvent } from '@/lib/event-metadata'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { getDefaultRelayUrls } from '@/lib/relay'
import eventCache from '@/services/caches/event-cache.service'
import replaceableEventCache from '@/services/caches/replaceable-event-cache.service'
import client from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import relatrTrust from '@/services/relatr-trust.service'
import blossomServerListService from '@/services/fetchers/blossom-server-list.service'
import followListService from '@/services/fetchers/follow-list.service'
import relayListService from '@/services/fetchers/relay-list.service'
import userSearchIndex from '@/services/search/user-search-index.service'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import stuffStatsService from '@/services/stuff-stats.service'
import {
  ISigner,
  TAccount,
  TAccountPointer,
  TDraftEvent,
  TProfile,
  TPublishOptions,
  TRelayList
} from '@/types'
import dayjs from 'dayjs'
import { Event, kinds, VerifiedEvent } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ACTIVE_OWNER, useAccounts } from '../AccountsProvider'
import { useDeletedEvent } from '../DeletedEventProvider'
import * as loginFlows from './login-flows'
import { buildSignerForAccount } from './build-signer'
import { NpubSigner } from './npub.signer'
import * as publishHelpers from './publish-helpers'
import { getInitialDecksForAccount } from '@/services/get-initial-decks-for-account'

export type { AccumulatedAck, MultiAccumulatorOpts } from './login-flows'

const PUBLISH_AS_OWNER = Symbol('PUBLISH_AS')

type TNostrContext = {
  isInitialized: boolean
  pubkey: string | null
  profile: TProfile | null
  profileEvent: Event | null
  relayList: TRelayList | null
  favoriteRelaysEvent: Event | null
  userEmojiListEvent: Event | null
  notificationsSeenAt: number
  account: TAccountPointer | null
  accounts: TAccountPointer[]
  nsec: string | null
  ncryptsec: string | null
  switchAccount: (account: TAccountPointer | null) => Promise<void>
  /**
   * Decks v2 (Option A): mutable active-account pubkey. Switches the active
   * paired account by pubkey. Looks up the matching `TAccountPointer` in
   * `accounts` and delegates to `switchAccount`. Calling with `null` clears
   * the active account. Calling with a pubkey not in the paired list is a
   * no-op (defensive). Side effects:
   *  - Persists to `StorageKey.ACTIVE_ACCOUNT_PUBKEY` (separately from the
   *    existing `currentAccount` localStorage key).
   *  - Ensures a workspace exists in `workspacesByAccount` for this pubkey.
   *  - Triggers `useNostr().pubkey` to re-render with the new value.
   */
  setActivePubkey: (pubkey: string | null) => Promise<void>
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
  ncryptsecLogin: (ncryptsec: string) => Promise<string>
  nip07Login: () => Promise<string>
  bunkerLogin: (bunker: string) => Promise<string>
  nostrConnectionLoginMulti: (
    opts: import('./login-flows').MultiAccumulatorOpts
  ) => Promise<import('./login-flows').AccumulatedAck[]>
  npubLogin(npub: string): Promise<string>
  removeAccount: (account: TAccountPointer) => void
  removeAllAccounts: () => void
  /**
   * Default publish the event to current relays, user's write relays and additional relays
   */
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>
  /**
   * Publish signed by an arbitrary paired account (by pubkey). Used by per-column
   * / per-modal compose so users can post as any of their accounts without
   * switching the global active account first. Looks up the account + signer via
   * client.signers registry. Throws if the account isn't paired or its signer
   * isn't currently available.
   */
  publishAs: (pubkey: string, draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>
  attemptDelete: (targetEvent: Event) => Promise<void>
  signHttpAuth: (url: string, method: string) => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip04Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  nip44Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip44Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  signer: ISigner | null
  startLogin: () => void
  checkLogin: <T>(cb?: () => T) => Promise<T | void>
  updateRelayListEvent: (relayListEvent: Event) => Promise<void>
  updateProfileEvent: (profileEvent: Event) => Promise<void>
  updateFavoriteRelaysEvent: (favoriteRelaysEvent: Event) => Promise<void>
  updateUserEmojiListEvent: (userEmojiListEvent: Event) => Promise<void>
  updateNotificationsSeenAt: (skipPublish?: boolean, targetPubkey?: string) => Promise<void>
}

const NostrContext = createContext<TNostrContext | undefined>(undefined)

const lastPublishedSeenNotificationsAtEventAtMap = new Map<string, number>()

export const useNostr = () => {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { addDeletedEvent } = useDeletedEvent()
  const {
    accounts,
    addAccount: addPairedAccount,
    removeAccount: removePairedAccount,
    removeAllAccounts: removeAllPairedAccounts
  } = useAccounts()
  const [account, setAccount] = useState<TAccountPointer | null>(null)
  const [nsec, setNsec] = useState<string | null>(null)
  const [ncryptsec, setNcryptsec] = useState<string | null>(null)
  const [signer, setSigner] = useState<ISigner | null>(null)
  const [openLoginDialog, setOpenLoginDialog] = useState(false)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [profileEvent, setProfileEvent] = useState<Event | null>(null)
  const [relayList, setRelayList] = useState<TRelayList | null>(null)
  const [favoriteRelaysEvent, setFavoriteRelaysEvent] = useState<Event | null>(null)
  const [userEmojiListEvent, setUserEmojiListEvent] = useState<Event | null>(null)
  const [notificationsSeenAt, setNotificationsSeenAt] = useState(-1)
  const [isInitialized, setIsInitialized] = useState(false)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const passwordPromiseRef = useRef<{
    resolve: (password: string) => void
    reject: () => void
  } | null>(null)

  useEffect(() => {
    const init = async () => {
      if (hasNostrLoginHash()) {
        return await loginByNostrLoginHash()
      }

      const accounts = storage.getAccounts()
      const act = storage.getCurrentAccount() ?? accounts[0] // auto login the first account
      if (!act) return

      await loginWithAccountPointer(act)
    }
    init().then(() => {
      setIsInitialized(true)
    })

    const handleHashChange = () => {
      if (hasNostrLoginHash()) {
        loginByNostrLoginHash()
      }
    }

    window.addEventListener('hashchange', handleHashChange)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const init = async () => {
      setRelayList(null)
      setProfile(null)
      setProfileEvent(null)
      setNsec(null)
      setFavoriteRelaysEvent(null)
      setNotificationsSeenAt(-1)
      if (!account) {
        return
      }
      const storedNsec = storage.getAccountNsec(account.pubkey)
      if (storedNsec) {
        setNsec(storedNsec)
      } else {
        setNsec(null)
      }
      const storedNcryptsec = storage.getAccountNcryptsec(account.pubkey)
      if (storedNcryptsec) {
        setNcryptsec(storedNcryptsec)
      } else {
        setNcryptsec(null)
      }

      const storedNotificationsSeenAt = storage.getLastReadNotificationTime(account.pubkey)

      const [
        storedRelayListEvent,
        storedProfileEvent,
        storedFavoriteRelaysEvent,
        storedUserEmojiListEvent
      ] = await Promise.all([
        indexedDb.getReplaceableEvent(account.pubkey, kinds.RelayList),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Metadata),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.FAVORITE_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.UserEmojiList)
      ])
      if (controller.signal.aborted) return
      if (storedRelayListEvent) {
        setRelayList(getRelayListFromEvent(storedRelayListEvent, storage.getFilterOutOnionRelays()))
      }
      if (storedProfileEvent) {
        setProfileEvent(storedProfileEvent)
        setProfile(getProfileFromEvent(storedProfileEvent))
      }
      if (storedFavoriteRelaysEvent) {
        setFavoriteRelaysEvent(storedFavoriteRelaysEvent)
      }
      if (storedUserEmojiListEvent) {
        setUserEmojiListEvent(storedUserEmojiListEvent)
      }

      const defaultRelays = getDefaultRelayUrls()
      const relayListEvents = await eventCache.fetchEvents(defaultRelays, {
        kinds: [kinds.RelayList],
        authors: [account.pubkey]
      })
      const relayListEvent = getLatestEvent(relayListEvents) ?? storedRelayListEvent
      const relayList = getRelayListFromEvent(relayListEvent, storage.getFilterOutOnionRelays())
      if (relayListEvent) {
        relayListService.updateRelayListCache(relayListEvent)
        await indexedDb.putReplaceableEvent(relayListEvent)
      }
      if (controller.signal.aborted) return
      setRelayList(relayList)

      const events = await eventCache.fetchEvents(
        relayList.write.concat(defaultRelays).slice(0, 4),
        [
          {
            kinds: [
              kinds.Metadata,
              kinds.Contacts,
              kinds.Mutelist,
              kinds.BookmarkList,
              ExtendedKind.FAVORITE_RELAYS,
              ExtendedKind.BLOSSOM_SERVER_LIST,
              kinds.UserEmojiList,
              kinds.Pinlist,
              ExtendedKind.PINNED_USERS
            ],
            authors: [account.pubkey]
          },
          {
            kinds: [kinds.Application],
            authors: [account.pubkey],
            '#d': [ApplicationDataKey.NOTIFICATIONS_SEEN_AT]
          }
        ]
      )
      if (controller.signal.aborted) return
      const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
      const profileEvent = sortedEvents.find((e) => e.kind === kinds.Metadata)
      const followListEvent = sortedEvents.find((e) => e.kind === kinds.Contacts)
      const muteListEvent = sortedEvents.find((e) => e.kind === kinds.Mutelist)
      const bookmarkListEvent = sortedEvents.find((e) => e.kind === kinds.BookmarkList)
      const favoriteRelaysEvent = sortedEvents.find((e) => e.kind === ExtendedKind.FAVORITE_RELAYS)
      const blossomServerListEvent = sortedEvents.find(
        (e) => e.kind === ExtendedKind.BLOSSOM_SERVER_LIST
      )
      const userEmojiListEvent = sortedEvents.find((e) => e.kind === kinds.UserEmojiList)
      const notificationsSeenAtEvent = sortedEvents.find(
        (e) =>
          e.kind === kinds.Application &&
          getReplaceableEventIdentifier(e) === ApplicationDataKey.NOTIFICATIONS_SEEN_AT
      )
      const pinnedNotesEvent = sortedEvents.find((e) => e.kind === kinds.Pinlist)
      const pinnedUsersEvent = sortedEvents.find((e) => e.kind === ExtendedKind.PINNED_USERS)

      if (profileEvent) {
        const updatedProfileEvent = await indexedDb.putReplaceableEvent(profileEvent)
        if (updatedProfileEvent.id === profileEvent.id) {
          setProfileEvent(updatedProfileEvent)
          setProfile(getProfileFromEvent(updatedProfileEvent))
        }
      } else if (!storedProfileEvent) {
        setProfile({
          pubkey: account.pubkey,
          npub: pubkeyToNpub(account.pubkey) ?? '',
          username: formatPubkey(account.pubkey)
        })
      }
      // The five list events are now owned by replaceableEventCache — updateCache
      // handles both the IndexedDB persist and the reactive notify in one call.
      if (followListEvent) {
        await replaceableEventCache.updateCache(followListEvent)
      }
      if (muteListEvent) {
        await replaceableEventCache.updateCache(muteListEvent)
      }
      if (bookmarkListEvent) {
        await replaceableEventCache.updateCache(bookmarkListEvent)
      }
      if (pinnedNotesEvent) {
        await replaceableEventCache.updateCache(pinnedNotesEvent)
      }
      if (pinnedUsersEvent) {
        await replaceableEventCache.updateCache(pinnedUsersEvent)
      }
      if (favoriteRelaysEvent) {
        const updatedFavoriteRelaysEvent = await indexedDb.putReplaceableEvent(favoriteRelaysEvent)
        if (updatedFavoriteRelaysEvent.id === favoriteRelaysEvent.id) {
          setFavoriteRelaysEvent(updatedFavoriteRelaysEvent)
        }
      }
      if (blossomServerListEvent) {
        await blossomServerListService.updateBlossomServerListEventCache(blossomServerListEvent)
      }
      if (userEmojiListEvent) {
        const updatedUserEmojiListEvent = await indexedDb.putReplaceableEvent(userEmojiListEvent)
        if (updatedUserEmojiListEvent.id === userEmojiListEvent.id) {
          setUserEmojiListEvent(updatedUserEmojiListEvent)
        }
      }

      const notificationsSeenAt = Math.max(
        notificationsSeenAtEvent?.created_at ?? 0,
        storedNotificationsSeenAt
      )
      setNotificationsSeenAt(notificationsSeenAt)
      storage.setLastReadNotificationTime(account.pubkey, notificationsSeenAt)

      userSearchIndex.initFromFollowings(account.pubkey, controller.signal)
      // Warm Relatr trust scores for the follow list so UserItem chips paint
      // synchronously from peekRank. fetchFollowings is cached; warmRanks skips
      // already-fresh entries, so this is ~free after the first run (3-day TTL).
      followListService
        .fetchFollowings(account.pubkey, false)
        .then((followings) => {
          if (controller.signal.aborted) return
          relatrTrust.warmRanks(followings)
        })
        .catch(() => {})
    }
    init()
    return () => {
      controller.abort()
    }
  }, [account])

  useEffect(() => {
    if (!account) return

    const initInteractions = async () => {
      const pubkey = account.pubkey
      const relayList = await relayListService.fetchRelayList(pubkey)
      const events = await eventCache.fetchEvents(relayList.write.slice(0, 4), [
        {
          authors: [pubkey],
          kinds: [kinds.Reaction, kinds.Repost],
          limit: 100
        },
        {
          '#P': [pubkey],
          kinds: [kinds.Zap],
          limit: 100
        }
      ])
      stuffStatsService.updateStuffStatsByEvents(events)
    }
    initInteractions()
  }, [account])

  useEffect(() => {
    if (signer) {
      client.signer = signer
    } else {
      client.signer = undefined
    }
  }, [signer])

  useEffect(() => {
    if (account) {
      client.pubkey = account.pubkey
    } else {
      client.pubkey = undefined
    }
  }, [account])

  // Mirror the active account's signer into the per-account registry so column-
  // scoped callers (publishAs, getSignerFor) can resolve it by pubkey. Additive
  // only — switching the active account does NOT remove the previous signer
  // from the registry; the ACTIVE_OWNER token stays attached to the prior pubkey
  // until removeAccount() releases it. That keeps a paired-but-not-active
  // <AccountScope> working after the user switches active.
  useEffect(() => {
    if (!account || !signer) return
    client.setSigner(account.pubkey, signer, ACTIVE_OWNER)
  }, [account, signer])

  useEffect(() => {
    customEmojiService.init(userEmojiListEvent)
  }, [userEmojiListEvent])

  const requestPassword = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      passwordPromiseRef.current = { resolve, reject }
      setPasswordDialogOpen(true)
    })
  }

  const handlePasswordConfirm = (password: string) => {
    passwordPromiseRef.current?.resolve(password)
    passwordPromiseRef.current = null
    setPasswordDialogOpen(false)
  }

  const handlePasswordCancel = () => {
    passwordPromiseRef.current?.reject()
    passwordPromiseRef.current = null
    setPasswordDialogOpen(false)
  }

  const hasNostrLoginHash = () => {
    return window.location.hash && window.location.hash.startsWith('#nostr-login')
  }

  const loginByNostrLoginHash = async () => {
    const credential = window.location.hash.replace('#nostr-login=', '')
    const urlWithoutHash = window.location.href.split('#')[0]
    history.replaceState(null, '', urlWithoutHash)

    if (credential.startsWith('bunker://')) {
      return await bunkerLogin(credential)
    } else if (credential.startsWith('ncryptsec')) {
      return await ncryptsecLogin(credential)
    } else if (credential.startsWith('nsec')) {
      return await nsecLogin(credential)
    }
  }

  const login = (signer: ISigner, act: TAccount) => {
    addPairedAccount(act)
    storage.switchAccount(act)
    // Decks v2: mirror the active-account pubkey alongside currentAccount.
    // Without this, getActiveAccountPubkey() lags by a render cycle and
    // ColumnsProvider's auto-switch rule sees a stale `null` value.
    storage.setActiveAccountPubkey(act.pubkey)
    setAccount({ pubkey: act.pubkey, signerType: act.signerType })
    setSigner(signer)
    return act.pubkey
  }

  const removeAccount = (act: TAccountPointer) => {
    removePairedAccount(act)
    if (account?.pubkey === act.pubkey) {
      // Removing the active account: fall back to a remaining paired account
      // rather than nulling the session. `accounts` is captured pre-removal,
      // so it still includes `act` — filter it out to get the survivors.
      const remaining = accounts.filter((a) => a.pubkey !== act.pubkey)
      if (remaining.length > 0) {
        void switchAccount(remaining[0])
      } else {
        setAccount(null)
        setSigner(null)
        // Decks v2: clear the mutable active-pubkey when there's no
        // remaining account. Mirrors switchAccount(null)'s behavior.
        storage.setActiveAccountPubkey(null)
      }
    }
  }

  const removeAllAccounts = () => {
    // Null the active session FIRST so the deck + every AccountScope subtree
    // unmount before their signers are torn down — same ordering rationale as
    // the per-account dialog (drop the columns before yanking the signer).
    setAccount(null)
    setSigner(null)
    removeAllPairedAccounts()
  }

  const switchAccount = async (act: TAccountPointer | null) => {
    if (!act) {
      storage.switchAccount(null)
      storage.setActiveAccountPubkey(null)
      setAccount(null)
      setSigner(null)
      return
    }
    await loginWithAccountPointer(act)
    // Mirror the v2 active-account pubkey alongside the existing
    // currentAccount key, so per-account-workspaces reads the right value.
    storage.setActiveAccountPubkey(act.pubkey)
  }

  /**
   * Decks v2 (Option A) entry point. Looks up the matching paired account
   * pointer + delegates to switchAccount. Ensures a workspace exists in storage
   * before the switch so the lifecycle effect downstream doesn't race.
   */
  const setActivePubkey = useCallback(
    async (pubkey: string | null) => {
      if (pubkey === null) {
        await switchAccount(null)
        return
      }
      const target = accounts.find((a) => a.pubkey === pubkey)
      if (!target) {
        // Not in paired list — defensive no-op. Caller should pair the
        // account first via addAccount + a login flow.
        return
      }
      if (!storage.getActiveWorkspace(pubkey)) {
        storage.ensureWorkspaceForAccount(pubkey, getInitialDecksForAccount(pubkey))
      }
      await switchAccount(target)
    },
    [accounts]
  )

  const nsecLogin = (nsecOrHex: string, password?: string, needSetup?: boolean) =>
    loginFlows.nsecLogin({ nsecOrHex, password, needSetup, login, setupNewUser })

  const ncryptsecLogin = (ncryptsec: string) =>
    loginFlows.ncryptsecLogin({ ncryptsec, login, requestPassword })

  const npubLogin = (npub: string) => loginFlows.npubLogin({ npub, login })

  const nip07Login = () => loginFlows.nip07Login({ login, t })

  const bunkerLogin = (bunker: string) => loginFlows.bunkerLogin({ bunker, login })

  const nostrConnectionLoginMulti = (
    opts: import('./login-flows').MultiAccumulatorOpts
  ) => loginFlows.nostrConnectionLoginMulti(opts)

  const loginWithAccountPointer = (act: TAccountPointer) =>
    loginFlows.loginWithAccountPointer({ act, login, requestPassword })

  const setupNewUser = async (signer: ISigner) => {
    const defaultRelays = getDefaultRelayUrls()
    await Promise.allSettled([
      client.publishEvent(defaultRelays, await signer.signEvent(createFollowListDraftEvent([]))),
      client.publishEvent(defaultRelays, await signer.signEvent(createMuteListDraftEvent([]))),
      client.publishEvent(
        defaultRelays,
        await signer.signEvent(
          createRelayListDraftEvent(defaultRelays.map((url) => ({ url, scope: 'both' })))
        )
      )
    ])
  }

  const signEvent = async (draftEvent: TDraftEvent) => {
    if (!signer) {
      throw new Error('sign event failed')
    }
    return publishHelpers.signEvent(signer, draftEvent)
  }

  const publish = async (draftEvent: TDraftEvent, options: TPublishOptions = {}) => {
    if (!account || !signer || account.signerType === 'npub') {
      throw new Error('You need to login first')
    }
    return publishHelpers.publish({
      account,
      signer,
      profile,
      draftEvent,
      options,
      t
    })
  }

  const publishAs = async (
    targetPubkey: string,
    draftEvent: TDraftEvent,
    options: TPublishOptions = {}
  ) => {
    const targetPointer = accounts.find((a) => a.pubkey === targetPubkey)
    if (!targetPointer) {
      throw new Error(t('Account not paired'))
    }
    if (targetPointer.signerType === 'npub') {
      throw new Error(t('Cannot publish from a read-only npub account'))
    }
    // Try the registry first (fast path — signer already mirrored for the
    // active account or held by an AccountScope). Fall back to building
    // from stored account data, then register under PUBLISH_AS_OWNER so
    // subsequent compose-as-this-account calls skip the build (relevant
    // for bunker, whose handshake can take seconds).
    let targetSigner = client.getSignerFor(targetPubkey)
    if (!targetSigner) {
      const stored =
        storage.findAccount({
          pubkey: targetPubkey,
          signerType: targetPointer.signerType as never
        }) ?? storage.getAccounts().find((a) => a.pubkey === targetPubkey)
      if (!stored) {
        throw new Error(t('Account data missing'))
      }
      const built = await buildSignerForAccount(stored)
      if (!built) {
        throw new Error(t('Signer not available for this account'))
      }
      client.setSigner(targetPubkey, built, PUBLISH_AS_OWNER)
      targetSigner = built
    }
    // profile=null skips the cross-account confirm dialog inside
    // publishHelpers (which fires when event.pubkey !== account.pubkey).
    // publishAs is intentional per-account compose; no warning needed.
    return publishHelpers.publish({
      account: targetPointer,
      signer: targetSigner,
      profile: null,
      draftEvent,
      options,
      t
    })
  }

  const attemptDelete = async (targetEvent: Event) => {
    if (!signer || !account) {
      throw new Error(t('You need to login first'))
    }
    const { relayCount } = await publishHelpers.attemptDelete({
      signer,
      account,
      targetEvent,
      addDeletedEvent,
      t
    })
    toast.success(t('Deletion request sent to {{count}} relays', { count: relayCount }))
  }

  const signHttpAuth = async (url: string, method: string, content = '') => {
    if (!signer) {
      throw new Error('sign event failed')
    }
    return publishHelpers.signHttpAuth(signer, url, method, content)
  }

  const nip04Encrypt = async (pubkey: string, plainText: string) => {
    return signer?.nip04Encrypt(pubkey, plainText) ?? ''
  }

  const nip04Decrypt = async (pubkey: string, cipherText: string) => {
    return signer?.nip04Decrypt(pubkey, cipherText) ?? ''
  }

  const nip44Encrypt = async (pubkey: string, plainText: string) => {
    return signer?.nip44Encrypt(pubkey, plainText) ?? ''
  }

  const nip44Decrypt = async (pubkey: string, cipherText: string) => {
    return signer?.nip44Decrypt(pubkey, cipherText) ?? ''
  }

  const checkLogin = async <T,>(cb?: () => T): Promise<T | void> => {
    if (signer) {
      return cb && cb()
    }
    return setOpenLoginDialog(true)
  }

  const updateRelayListEvent = async (relayListEvent: Event) => {
    const newRelayList = await relayListService.updateRelayListCache(relayListEvent)
    setRelayList(getRelayListFromEvent(newRelayList, storage.getFilterOutOnionRelays()))
  }

  const updateProfileEvent = async (event: Event) => {
    const persisted = await indexedDb.putReplaceableEvent(event)
    setProfileEvent(persisted)
    setProfile(getProfileFromEvent(persisted))
  }

  const updateFavoriteRelaysEvent = async (event: Event) => {
    const persisted = await publishHelpers.persistFavoriteRelaysEvent(event)
    if (persisted) setFavoriteRelaysEvent(persisted)
  }

  const updateUserEmojiListEvent = async (event: Event) => {
    const persisted = await publishHelpers.persistUserEmojiListEvent(event)
    if (persisted) setUserEmojiListEvent(persisted)
  }

  const updateNotificationsSeenAt = async (skipPublish = false, targetPubkey?: string) => {
    const pubkey = targetPubkey ?? account?.pubkey
    if (!pubkey) return

    const now = dayjs().unix()
    storage.setLastReadNotificationTime(pubkey, now)

    // Only the active account's React state lives in this provider; foreign /
    // paired-but-not-active targets persist storage but don't touch active state.
    if (pubkey === account?.pubkey) {
      setNotificationsSeenAt(now)
    }

    if (skipPublish || storage.getDisableNotificationSync()) return

    // Throttle keyed per-pubkey so account A's mark-read doesn't silence account B's.
    const lastPublishedSeenNotificationsAtEventAt =
      lastPublishedSeenNotificationsAtEventAtMap.get(pubkey) ?? -1
    if (
      lastPublishedSeenNotificationsAtEventAt >= 0 &&
      now - lastPublishedSeenNotificationsAtEventAt <= 10 * 60
    ) {
      return
    }

    if (pubkey === account?.pubkey) {
      // Active path: existing publish() resolves write relays + AUTH via the active signer.
      lastPublishedSeenNotificationsAtEventAtMap.set(pubkey, now)
      await publish(createSeenNotificationsAtDraftEvent()).catch(() => {
        // ignore
      })
      return
    }

    // Non-active path: paired-but-not-active publishes via the per-account
    // registry; foreign-not-paired (no signer registered) silently skips —
    // we can't sign as them. Storage persistence above still happens for both.
    const signer = client.getSignerFor(pubkey)
    if (!signer) return
    // Npub (read-only) signers are registered but throw on signEvent. Skip
    // before stamping the throttle map so the next attempt isn't silently
    // gated for 10 min after the swallowed throw.
    if (signer instanceof NpubSigner) return
    lastPublishedSeenNotificationsAtEventAtMap.set(pubkey, now)
    const relayList = await relayListService.fetchRelayList(pubkey)
    const urls = relayList.write.length > 0 ? relayList.write : getDefaultRelayUrls()
    await client.publishAs(pubkey, urls, createSeenNotificationsAtDraftEvent()).catch(() => {
      // ignore
    })
  }

  return (
    <NostrContext.Provider
      value={{
        isInitialized,
        pubkey: account?.pubkey ?? null,
        profile,
        profileEvent,
        relayList,
        favoriteRelaysEvent,
        userEmojiListEvent,
        notificationsSeenAt,
        account,
        accounts,
        nsec,
        ncryptsec,
        switchAccount,
        setActivePubkey,
        nsecLogin,
        ncryptsecLogin,
        nip07Login,
        bunkerLogin,
        nostrConnectionLoginMulti,
        npubLogin,
        removeAccount,
        removeAllAccounts,
        publish,
        publishAs,
        attemptDelete,
        signHttpAuth,
        nip04Encrypt,
        nip04Decrypt,
        nip44Encrypt,
        nip44Decrypt,
        signer,
        startLogin: () => setOpenLoginDialog(true),
        checkLogin,
        signEvent,
        updateRelayListEvent,
        updateProfileEvent,
        updateFavoriteRelaysEvent,
        updateUserEmojiListEvent,
        updateNotificationsSeenAt
      }}
    >
      {children}
      <LoginDialog open={openLoginDialog} setOpen={setOpenLoginDialog} />
      <PasswordInputDialog
        open={passwordDialogOpen}
        title={t('Enter Password')}
        description={t('Enter the password to decrypt your ncryptsec')}
        onConfirm={handlePasswordConfirm}
        onCancel={handlePasswordCancel}
      />
    </NostrContext.Provider>
  )
}
